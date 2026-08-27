/**
 * Livraison Git : inspection, commit, push.
 *
 * ## La seule frontiere de NOX qui ecrit dans Git
 *
 * Trois commandes d'ecriture, et trois seulement : `git add`, `git commit`,
 * `git push`. Aucune autre n'est atteignable depuis ce module, et aucune n'est
 * atteignable ailleurs. Sont **absents par construction** — pas desactives, pas
 * conditionnes, absents — `reset`, `restore`, `checkout`, `clean`, `rebase`,
 * `merge`, `pull`, `stash`, `cherry-pick`, `revert`, la suppression de branche,
 * l'ecriture de tag, l'ecriture de configuration et toute mutation de remote.
 *
 * Il n'y a donc pas de « nettoyage » possible apres un echec. C'est voulu : un
 * `reset` automatique detruirait exactement ce qu'un humain doit relire pour
 * comprendre ce qui s'est passe.
 *
 * ## Jamais d'interpreteur de commandes
 *
 * `execFile`, sans `shell`. Les chemins de fichiers deviennent des pathspecs
 * litteraux — `:(literal)notes[1].md` — et non des motifs : sans cette syntaxe,
 * un fichier dont le nom contient un crochet ne serait pas trouve, et Git
 * repondrait « aucun fichier ne correspond » sur un fichier qui existe.
 *
 * ## Jamais interactif
 *
 * `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS` et `SSH_ASKPASS` neutralises,
 * `GIT_OPTIONAL_LOCKS=0`. Un push sans identifiants echoue proprement au lieu
 * d'immobiliser le runner sur une invite que personne ne verra. Aucune commande
 * n'ouvre d'editeur : le message est passe par `-m`.
 *
 * ## Ce que NOX ne contourne jamais
 *
 * `--no-verify` n'est jamais passe. `--no-gpg-sign` n'est jamais passe.
 * `--force` et `--force-with-lease` n'existent nulle part dans ce fichier. Une
 * protection que le repository s'est donnee reste en place ; si elle empeche une
 * livraison automatique, c'est la livraison qui renonce.
 *
 * ## Aucun secret conserve
 *
 * L'environnement transmis a Git est prive de toute variable `NOX_*`, comme pour
 * Claude Code et pour les validations. Les sorties d'erreur sont bornees et
 * passees au nettoyeur : une URL de remote porteuse d'identifiants n'est jamais
 * enregistree.
 */

import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  DELIVERY_LIMITS,
  RUNNER_ERROR,
  type DeliveryCandidateEntry,
  type DeliveryCommitRequest,
  type DeliveryCommitSuccess,
  type DeliveryInspection,
  type DeliveryPushRequest,
  type DeliveryPushSuccess,
  type RunnerErrorCode,
} from "@nox/shared";

import { sanitizeEnvironment } from "../claude/executable.ts";
import { createEventSanitizer } from "../claude/stream/sanitize-event.ts";
import type { GitCommandOutcome } from "./git-state.ts";
import { resolveRepository, type GitRunner } from "./resolve-repository.ts";
import {
  computeWorkspaceFingerprint,
  fingerprintsMatch,
  parseStatusEntries,
} from "./workspace-fingerprint.ts";

/**
 * Delais accordes aux commandes de livraison.
 *
 * Des constantes, jamais des variables d'environnement. Le push est le seul a
 * toucher le reseau, et le seul a meriter davantage : les autres commandes sont
 * locales, et une lecture Git qui prend trente secondes est deja un probleme.
 */
export const DELIVERY_TIMEOUTS = {
  read: 15_000,
  stage: 30_000,
  commit: 60_000,
  push: 120_000,
} as const;

/** Hooks dont la presence rend un commit non deterministe. */
const COMMIT_HOOKS = [
  "pre-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-push",
] as const;

export type DeliveryOptions = {
  runGit?: GitRunner;
  fingerprintKey: Buffer;
  environment?: Record<string, string | undefined>;
};

export type DeliveryInspectResult =
  | { ok: true; inspection: DeliveryInspection }
  | { ok: false; code: RunnerErrorCode };

/**
 * Ce qu'une tentative d'ecriture rend.
 *
 * `ok: false` est reserve aux requetes qui ne peuvent pas etre honorees :
 * repository introuvable, branche differente, empreinte divergente, index
 * garni. La reponse de Git elle-meme — un hook qui refuse, un serveur distant
 * qui rejette — voyage dans `ok: true`, exactement comme le code de sortie
 * d'une validation autonome : la commande a demarre, et ce qu'elle a dit est
 * l'information recherchee.
 */
export type DeliveryCommitResult =
  | { ok: true; value: DeliveryCommitSuccess }
  | { ok: false; code: RunnerErrorCode; detail: string };

export type DeliveryPushResult =
  | { ok: true; value: DeliveryPushSuccess }
  | { ok: false; code: RunnerErrorCode; detail: string };

/**
 * Environnement transmis a Git.
 *
 * Prive de toute variable `NOX_*` — le filtre porte sur le prefixe entier, donc
 * une variable ajoutee plus tard est couverte d'office — et complete de ce qui
 * rend Git non interactif. `HOME`, `PATH`, `SSH_AUTH_SOCK` et les identifiants
 * deja configures sur la machine restent : NOX n'ajoute aucun identifiant, et
 * n'en stocke aucun.
 */
function deliveryEnvironment(
  environment: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  return {
    ...sanitizeEnvironment(environment),
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

/**
 * Execute une commande Git de livraison, sans shell.
 *
 * Distincte de `runGitCommand` sur un seul point, et il compte : l'environnement
 * est celui ci-dessus, non interactif. Une commande de lecture n'en a pas
 * besoin ; un push, si.
 */
function runDeliveryGit(
  directory: string,
  args: readonly string[],
  timeoutMs: number,
  environment?: Record<string, string | undefined>,
): Promise<GitCommandOutcome> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", directory, ...args],
      {
        timeout: timeoutMs,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        env: deliveryEnvironment(environment),
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ status: "ok", stdout });
          return;
        }
        const { code, killed } = error as NodeJS.ErrnoException & { killed?: boolean };
        if (code === "ENOENT") {
          resolve({ status: "unavailable" });
        } else if (killed === true || code === "ETIMEDOUT") {
          resolve({ status: "timeout" });
        } else {
          resolve({ status: "failed", stderr: `${stdout}\n${stderr}` });
        }
      },
    );
  });
}

/** Ce qui remplace les identifiants inscrits dans une URL de remote. */
export const REMOTE_CREDENTIALS_PLACEHOLDER = "<identifiants-masques>";

/**
 * Nettoie une sortie Git avant de la rendre au serveur web.
 *
 * ## Pourquoi la sanitation centralisee, et pas un nettoyeur local
 *
 * Parce que c'est la meme regle que pour la timeline : **toute** chaine
 * publique y passe, pas seulement celles qui paraissent suspectes. Les chemins
 * du repository deviennent relatifs, les chemins exterieurs sont masques, les
 * variables `NOX_*` disparaissent par valeur et par nom, les caracteres de
 * controle sont retires, la taille est bornee. Un message d'erreur de Git
 * nomme volontiers un chemin absolu — le laisser passer reviendrait a faire
 * arriver un disque et un nom d'utilisateur jusqu'au navigateur.
 *
 * Une chose s'y ajoute, propre a Git : les identifiants parfois inscrits dans
 * une URL de remote — `https://jeton@github.com/...` apparait tel quel dans
 * certains refus. NOX ne stocke aucun identifiant Git, et n'en journalise
 * aucun.
 */
export function sanitizeGitOutput(
  text: string,
  repositoryRoot: string,
  environment?: Record<string, string | undefined>,
): string {
  const sanitize = createEventSanitizer({
    repositoryRoot,
    environment: environment ?? process.env,
  });
  const redacted = text.replace(
    /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]+@/giu,
    `$1://${REMOTE_CREDENTIALS_PLACEHOLDER}@`,
  );
  return sanitize(redacted, DELIVERY_LIMITS.output);
}

function readFailure(outcome: GitCommandOutcome): RunnerErrorCode {
  switch (outcome.status) {
    case "unavailable":
      return RUNNER_ERROR.GIT_NOT_AVAILABLE;
    case "timeout":
      return RUNNER_ERROR.GIT_TIMEOUT;
    default:
      return RUNNER_ERROR.GIT_PREFLIGHT_FAILED;
  }
}

/** Lecture Git tolerante : `null` plutot qu'un refus, pour un fait facultatif. */
async function readOptional(
  root: string,
  args: readonly string[],
  environment?: Record<string, string | undefined>,
): Promise<string | null> {
  const outcome = await runDeliveryGit(root, args, DELIVERY_TIMEOUTS.read, environment);
  return outcome.status === "ok" ? outcome.stdout.trim() : null;
}

/**
 * Les entrees changees d'un repository, fichiers ignores exclus.
 *
 * `--untracked-files=all` : une source creee par Claude Code est un changement
 * legitime, et la masquer derriere son dossier rendrait le candidat faux.
 * `--no-renames` : la detection de renommage est une heuristique dont le seuil
 * depend de la configuration de l'utilisateur, et un candidat ne doit pas
 * dependre d'un reglage. Un renommage apparait donc comme une suppression et une
 * creation — ce qui se livre exactement aussi bien.
 *
 * Les fichiers **ignores** n'y figurent pas : `dist/`, `coverage/` et les caches
 * produits par une validation ne sont pas du travail a livrer.
 */
export function parseDeliveryEntries(status: string): {
  entries: DeliveryCandidateEntry[];
  omitted: number;
} {
  const parsed = parseStatusEntries(status).map((entry) => ({
    code: entry.code,
    path: entry.path,
  }));
  parsed.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const kept = parsed.slice(0, DELIVERY_LIMITS.maxEntries);
  return { entries: kept, omitted: parsed.length - kept.length };
}

/**
 * Lit tout ce qu'une decision de livraison exige, sans rien ecrire.
 *
 * Aucune commande de cette fonction ne modifie le repository, ne cree de fichier
 * temporaire, ni ne touche au reseau. Elle peut donc etre appelee au rendu d'une
 * page sans qu'un rafraichissement produise quoi que ce soit.
 */
export async function inspectDelivery(
  repositoryPath: string,
  trailer: string | null,
  options: DeliveryOptions,
): Promise<DeliveryInspectResult> {
  const resolved = await resolveRepository(repositoryPath, { runGit: options.runGit });
  if (!resolved.ok) {
    return { ok: false, code: resolved.code };
  }
  const root = resolved.canonicalPath;
  const environment = options.environment;

  const headOutcome = await runDeliveryGit(
    root,
    ["rev-parse", "HEAD"],
    DELIVERY_TIMEOUTS.read,
    environment,
  );
  if (headOutcome.status !== "ok") {
    return { ok: false, code: readFailure(headOutcome) };
  }
  const head = headOutcome.stdout.trim();
  if (head === "") {
    return { ok: false, code: RUNNER_ERROR.GIT_PREFLIGHT_FAILED };
  }

  // `--show-current` ne rend rien quand `HEAD` est detache : c'est un fait
  // rapporte, pas une erreur — la decision de refuser appartient a l'appelant.
  const branchRaw = await readOptional(root, ["branch", "--show-current"], environment);
  const branch = branchRaw === null || branchRaw === "" ? null : branchRaw;

  const parentsRaw = await readOptional(root, ["rev-list", "--parents", "-n", "1", "HEAD"], environment);
  const headParents =
    parentsRaw === null ? [] : parentsRaw.split(/\s+/u).filter((token) => token !== "").slice(1);

  // Le message de `HEAD`, et uniquement celui-la. La recherche reste bornee :
  // le flux normal sait exactement ou le commit devrait se trouver, et parcourir
  // l'historique pour retrouver une livraison serait lent **et** ambigu.
  const headMessage = await readOptional(root, ["log", "-1", "--format=%B", "HEAD"], environment);
  const headTrailerMatches =
    trailer !== null && headMessage !== null && headMessage.includes(trailer);

  const statusOutcome = await runDeliveryGit(
    root,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"],
    DELIVERY_TIMEOUTS.read,
    environment,
  );
  if (statusOutcome.status !== "ok") {
    return { ok: false, code: readFailure(statusOutcome) };
  }
  const { entries, omitted } = parseDeliveryEntries(statusOutcome.stdout);

  // `--quiet` rend 1 quand l'index differe de `HEAD` : c'est un code de sortie,
  // donc un `failed` pour le lanceur. L'absence de sortie distingue ce cas d'une
  // vraie panne.
  const indexOutcome = await runDeliveryGit(
    root,
    ["diff", "--cached", "--name-only"],
    DELIVERY_TIMEOUTS.read,
    environment,
  );
  if (indexOutcome.status !== "ok") {
    return { ok: false, code: readFailure(indexOutcome) };
  }
  const indexDirty = indexOutcome.stdout.trim() !== "";

  const upstream = await readUpstream(root, branch, environment);

  const fingerprint =
    branch === null
      ? null
      : await (async () => {
          const computed = await computeWorkspaceFingerprint(root, options.fingerprintKey, {
            runGit: (directory, args, timeoutMs) =>
              runDeliveryGit(directory, args, timeoutMs, environment),
          });
          return computed.ok ? computed.value : null;
        })();

  const name = await readOptional(root, ["config", "--get", "user.name"], environment);
  const email = await readOptional(root, ["config", "--get", "user.email"], environment);
  const signing = await readOptional(root, ["config", "--get", "commit.gpgsign"], environment);

  return {
    ok: true,
    inspection: {
      branch,
      head,
      headParents,
      headTrailerMatches,
      upstreamRemote: upstream?.remote ?? null,
      upstreamRef: upstream?.ref ?? null,
      upstreamCommit: upstream?.commit ?? null,
      indexDirty,
      entries,
      omittedEntries: omitted,
      fingerprint,
      identityComplete: name !== null && name !== "" && email !== null && email !== "",
      signingConfigured: signing !== null && /^(true|1|yes|on)$/iu.test(signing),
      hooks: await installedCommitHooks(root, environment),
    },
  };
}

/** L'upstream configure d'une branche, tel que Git le declare. */
type UpstreamInfo = { remote: string; ref: string; commit: string | null };

/**
 * Lit l'upstream depuis la configuration de la branche.
 *
 * `branch.<nom>.remote` et `branch.<nom>.merge` sont la source autoritative :
 * elles disent ce que l'utilisateur a configure, sans heuristique de decoupage
 * sur un `origin/main` dont le nom de remote pourrait lui-meme contenir une
 * barre oblique.
 */
async function readUpstream(
  root: string,
  branch: string | null,
  environment?: Record<string, string | undefined>,
): Promise<UpstreamInfo | null> {
  if (branch === null) {
    return null;
  }
  const remote = await readOptional(
    root,
    ["config", "--get", `branch.${branch}.remote`],
    environment,
  );
  const ref = await readOptional(root, ["config", "--get", `branch.${branch}.merge`], environment);
  if (remote === null || remote === "" || ref === null || ref === "") {
    return null;
  }

  // La reference de suivi **locale** : ce que cette machine a reussi a envoyer,
  // pas l'etat du serveur distant a cet instant. Aucun `fetch` n'est fait pour
  // lever le doute — cela toucherait au reseau sans que personne l'ait demande.
  const trackingName = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
  const commit = await readOptional(
    root,
    ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${trackingName}`],
    environment,
  );

  return { remote, ref, commit: commit === null || commit === "" ? null : commit };
}

/**
 * Hooks de commit reellement installes.
 *
 * `core.hooksPath` est respecte : un repository qui deporte ses hooks — ce que
 * fait `husky` — serait sinon annonce comme n'en ayant aucun.
 */
async function installedCommitHooks(
  root: string,
  environment?: Record<string, string | undefined>,
): Promise<string[]> {
  const hooksPath = await readOptional(root, ["rev-parse", "--git-path", "hooks"], environment);
  if (hooksPath === null || hooksPath === "") {
    return [];
  }
  const directory = path.isAbsolute(hooksPath) ? hooksPath : path.join(root, hooksPath);

  const present: string[] = [];
  for (const hook of COMMIT_HOOKS) {
    try {
      await access(path.join(directory, hook), constants.F_OK);
      present.push(hook);
    } catch {
      // Absent : le cas normal.
    }
  }
  return present;
}

/**
 * Prepare les chemins exacts du candidat, puis cree le commit.
 *
 * ## L'ordre, et pourquoi il est celui-la
 *
 * Tout ce qui peut refuser refuse **avant** la premiere ecriture. Un repository
 * qui a change, un index deja garni, une identite Git absente : aucun de ces cas
 * ne doit laisser derriere lui un index a moitie prepare.
 *
 * ## La reconciliation vient en premier
 *
 * Avant meme de verifier l'etat, le runner regarde si `HEAD` porte deja le
 * trailer de cette livraison et descend de `expectedHead`. Si oui, le commit a
 * ete cree lors d'une tentative precedente dont la reponse s'est perdue : il est
 * rendu tel quel, et aucun second commit identique n'est produit.
 *
 * ## Le pathspec est ferme
 *
 * `git add -A -- :(literal)<chemin>` pour chaque chemin du candidat, et rien
 * d'autre. Jamais `git add .`, jamais `git add -A` sans pathspec. Un fichier
 * apparu apres la validation n'est donc pas prepare — il fait d'ailleurs echouer
 * la verification d'empreinte bien avant.
 *
 * Le `-A` n'elargit rien : restreint a des chemins litteraux, il ne fait que
 * traiter uniformement creation, modification et suppression. Sans lui, la
 * suppression d'un fichier suivi dependrait de la version de Git.
 */
export async function commitDelivery(
  request: DeliveryCommitRequest,
  options: DeliveryOptions,
): Promise<DeliveryCommitResult> {
  const resolved = await resolveRepository(request.repositoryPath, { runGit: options.runGit });
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, detail: "Le repository n'a pas pu etre resolu." };
  }
  const root = resolved.canonicalPath;
  const environment = options.environment;

  const inspected = await inspectDelivery(root, request.trailer, options);
  if (!inspected.ok) {
    return { ok: false, code: inspected.code, detail: "Le repository n'a pas pu etre inspecte." };
  }
  const state = inspected.inspection;

  // 1. Le commit existe-t-il deja ? Deux conditions ensemble : le trailer prouve
  //    l'intention, le parent prouve la place. Un trailer seul pourrait venir
  //    d'un `cherry-pick`.
  if (
    state.headTrailerMatches &&
    state.headParents.length === 1 &&
    state.headParents[0] === request.expectedHead
  ) {
    return {
      ok: true,
      value: {
        ok: true,
        commitSha: state.head,
        alreadyCommitted: true,
        worktreeClean: state.entries.length === 0,
        failureCode: null,
        failureDetail: null,
      },
    };
  }

  // 2. L'etat, entierement relu. Le serveur web a deja verifie ; cette frontiere
  //    ne s'y fie pas — c'est elle qui touche reellement le repository.
  if (state.branch === null) {
    return {
      ok: false,
      code: RUNNER_ERROR.GIT_DETACHED_HEAD,
      detail: "HEAD est detache : NOX ne change jamais de branche pour livrer.",
    };
  }
  if (state.branch !== request.expectedBranch) {
    return {
      ok: false,
      code: RUNNER_ERROR.GIT_BRANCH_CHANGED,
      detail: "La branche courante n'est plus celle du travail valide.",
    };
  }
  if (state.head !== request.expectedHead) {
    return {
      ok: false,
      code: RUNNER_ERROR.GIT_HEAD_CHANGED,
      detail: "HEAD a change depuis la validation.",
    };
  }
  if (state.indexDirty) {
    return {
      ok: false,
      code: RUNNER_ERROR.DELIVERY_INDEX_NOT_EMPTY,
      detail: "L'index porte deja des changements prepares.",
    };
  }
  if (state.fingerprint === null) {
    return {
      ok: false,
      code: RUNNER_ERROR.WORKSPACE_FINGERPRINT_UNAVAILABLE,
      detail: "L'empreinte du dossier de travail n'a pas pu etre calculee.",
    };
  }
  if (!fingerprintsMatch(state.fingerprint, request.expectedFingerprint)) {
    return {
      ok: false,
      code: RUNNER_ERROR.DELIVERY_REPOSITORY_CHANGED,
      detail: "Le contenu du repository n'est plus celui qui a ete valide.",
    };
  }
  if (!state.identityComplete) {
    return {
      ok: false,
      code: RUNNER_ERROR.DELIVERY_IDENTITY_MISSING,
      detail: "Git n'a ni user.name ni user.email : NOX n'en configure aucun.",
    };
  }

  const expected = [...new Set(request.paths)].sort();
  const observed = state.entries.map((entry) => entry.path).sort();
  if (expected.length !== observed.length || expected.some((value, index) => value !== observed[index])) {
    return {
      ok: false,
      code: RUNNER_ERROR.DELIVERY_REPOSITORY_CHANGED,
      detail: "Les fichiers changes ne sont plus ceux du candidat valide.",
    };
  }

  // 3. Preparation, par lots de pathspecs litteraux.
  for (let index = 0; index < expected.length; index += DELIVERY_LIMITS.pathspecChunk) {
    const chunk = expected.slice(index, index + DELIVERY_LIMITS.pathspecChunk);
    const staged = await runDeliveryGit(
      root,
      ["add", "-A", "--", ...chunk.map((value) => `:(literal)${value}`)],
      DELIVERY_TIMEOUTS.stage,
      environment,
    );
    if (staged.status !== "ok") {
      return {
        ok: false,
        code: RUNNER_ERROR.DELIVERY_STAGING_FAILED,
        detail:
          staged.status === "failed"
            ? sanitizeGitOutput(staged.stderr, root, environment)
            : staged.status,
      };
    }
  }

  // 4. Ce qui est prepare doit etre exactement ce qui devait l'etre. Une
  //    verification apres coup, parce qu'un `.gitattributes` avec un filtre, ou
  //    un `.gitignore` inattendu, peut faire diverger le resultat de l'intention.
  const stagedList = await runDeliveryGit(
    root,
    ["diff", "--cached", "--name-only", "-z"],
    DELIVERY_TIMEOUTS.read,
    environment,
  );
  if (stagedList.status !== "ok") {
    return {
      ok: false,
      code: readFailure(stagedList),
      detail: "L'index n'a pas pu etre relu apres preparation.",
    };
  }
  const stagedPaths = stagedList.stdout.split("\0").filter((value) => value !== "").sort();
  if (stagedPaths.length === 0) {
    return {
      ok: false,
      code: RUNNER_ERROR.DELIVERY_STAGED_MISMATCH,
      detail: "Aucun changement n'a pu etre prepare.",
    };
  }
  const unexpected = stagedPaths.filter((value) => !expected.includes(value));
  if (unexpected.length > 0) {
    return {
      ok: false,
      code: RUNNER_ERROR.DELIVERY_STAGED_MISMATCH,
      detail: `L'index porte des chemins absents du candidat : ${unexpected.slice(0, 5).join(", ")}`,
    };
  }

  // 5. Le commit. Ni `--no-verify`, ni `--no-gpg-sign` : ce que le repository
  //    exige de ses commits continue de s'appliquer. Le message vient tel quel,
  //    fige a la reservation, trailer compris.
  const committed = await runDeliveryGit(
    root,
    ["commit", "-m", request.message],
    DELIVERY_TIMEOUTS.commit,
    environment,
  );
  if (committed.status !== "ok") {
    // Un hook qui refuse, une signature qui echoue, un delai depasse : Git a
    // repondu, et sa reponse est ce que l'utilisateur doit lire. Rien n'est
    // defait — l'index garde ce qui a ete prepare, et NOX le dit plutot que de
    // le nettoyer dans le dos de quelqu'un.
    return {
      ok: true,
      value: {
        ok: true,
        commitSha: null,
        alreadyCommitted: false,
        worktreeClean: false,
        failureCode: RUNNER_ERROR.DELIVERY_COMMIT_FAILED,
        failureDetail:
          committed.status === "failed"
            ? sanitizeGitOutput(committed.stderr, root, environment)
            : `La commande de commit s'est terminee : ${committed.status}.`,
      },
    };
  }

  // 6. Verification de ce qui a reellement ete cree. Un hook a pu modifier le
  //    contenu ou le message ; NOX ne pretend pas avoir livre ce qu'il voulait
  //    livrer sans l'avoir constate. Rien n'est defait dans ce cas.
  const after = await inspectDelivery(root, request.trailer, options);
  if (!after.ok) {
    return {
      ok: false,
      code: after.code,
      detail: "Le commit a ete cree, mais l'etat obtenu n'a pas pu etre relu.",
    };
  }
  const final = after.inspection;

  if (final.headParents.length !== 1 || final.headParents[0] !== request.expectedHead) {
    return {
      ok: false,
      code: RUNNER_ERROR.DELIVERY_TREE_MISMATCH,
      detail: "Le commit cree ne descend pas de l'etat valide.",
    };
  }

  return {
    ok: true,
    value: {
      ok: true,
      commitSha: final.head,
      alreadyCommitted: false,
      // Fichiers ignores exclus : une validation a le droit d'avoir laisse un
      // `dist/`, et l'exiger propre ferait echouer toute tache dont la preuve
      // est une compilation.
      worktreeClean: final.entries.length === 0,
      failureCode: null,
      failureDetail: null,
    },
  };
}

/**
 * Pousse la branche courante vers son upstream deja configure.
 *
 * ## Aucune destination ne vient de l'appelant
 *
 * Le remote et la reference sont lus dans la configuration du repository. Le
 * corps de la requete ne porte ni remote, ni URL, ni refspec : il n'existe aucun
 * moyen de faire pousser NOX ailleurs que la ou la branche pointe deja.
 *
 * ## Aucune configuration n'est creee
 *
 * Pas de `push -u`, pas de `remote add`, pas de `branch --set-upstream-to`. Sans
 * upstream, le push est refuse — configurer la destination d'une branche est une
 * decision, pas un detail d'implementation.
 *
 * ## Aucun forcage, aucune reconciliation
 *
 * Ni `--force`, ni `--force-with-lease`. Un refus de type « non-fast-forward »
 * remonte tel quel : NOX ne tire pas, ne fusionne pas, ne rebase pas. Comment
 * reconcilier deux histoires est une question dont la reponse appartient a un
 * humain.
 */
export async function pushDelivery(
  request: DeliveryPushRequest,
  options: DeliveryOptions,
): Promise<DeliveryPushResult> {
  const resolved = await resolveRepository(request.repositoryPath, { runGit: options.runGit });
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, detail: "Le repository n'a pas pu etre resolu." };
  }
  const root = resolved.canonicalPath;
  const environment = options.environment;

  const branch = await readOptional(root, ["branch", "--show-current"], environment);
  if (branch === null || branch === "") {
    return {
      ok: false,
      code: RUNNER_ERROR.GIT_DETACHED_HEAD,
      detail: "HEAD est detache : il n'y a pas de branche a pousser.",
    };
  }
  if (branch !== request.expectedBranch) {
    return {
      ok: false,
      code: RUNNER_ERROR.GIT_BRANCH_CHANGED,
      detail: "La branche courante n'est plus celle du commit a pousser.",
    };
  }

  const head = await readOptional(root, ["rev-parse", "HEAD"], environment);
  if (head !== request.expectedHead) {
    return {
      ok: false,
      code: RUNNER_ERROR.GIT_HEAD_CHANGED,
      detail: "HEAD n'est plus le commit cree par cette livraison.",
    };
  }

  const upstream = await readUpstream(root, branch, environment);
  if (upstream === null) {
    return {
      ok: false,
      code: RUNNER_ERROR.GIT_UPSTREAM_MISSING,
      detail: "La branche courante n'a pas d'upstream configure.",
    };
  }

  // Le push a-t-il deja abouti ? La reference de suivi locale est mise a jour
  // par Git **au moment du push** : si elle designe deja ce commit, une reponse
  // a ete perdue, pas un push.
  if (upstream.commit === request.expectedHead) {
    return {
      ok: true,
      value: {
        ok: true,
        pushed: true,
        alreadyPushed: true,
        remote: upstream.remote,
        remoteRef: upstream.ref,
        failureCode: null,
        failureDetail: null,
      },
    };
  }

  const pushed = await runDeliveryGit(
    root,
    ["push", upstream.remote, `${branch}:${upstream.ref}`],
    DELIVERY_TIMEOUTS.push,
    environment,
  );

  if (pushed.status !== "ok") {
    // Un refus du serveur distant et une panne de reseau demandent deux gestes
    // differents ; les confondre ferait chercher au mauvais endroit. Le commit
    // local, lui, reste : aucun `reset`, aucun `restore`.
    const rejected =
      pushed.status === "failed" &&
      /(non-fast-forward|rejected|fetch first|behind its remote)/iu.test(pushed.stderr);
    return {
      ok: true,
      value: {
        ok: true,
        pushed: false,
        alreadyPushed: false,
        remote: upstream.remote,
        remoteRef: upstream.ref,
        failureCode: rejected
          ? RUNNER_ERROR.DELIVERY_PUSH_REJECTED
          : RUNNER_ERROR.DELIVERY_PUSH_FAILED,
        failureDetail:
          pushed.status === "failed"
            ? sanitizeGitOutput(pushed.stderr, root, environment)
            : `La commande de push s'est terminee : ${pushed.status}.`,
      },
    };
  }

  return {
    ok: true,
    value: {
      ok: true,
      pushed: true,
      alreadyPushed: false,
      remote: upstream.remote,
      remoteRef: upstream.ref,
      failureCode: null,
      failureDetail: null,
    },
  };
}
