/**
 * Capture detaillee de ce qu'une execution a laisse dans le repository.
 *
 * TASK-008 capturait deja `git diff --stat` et la liste des fichiers modifies.
 * C'est utile et insuffisant : cela dit *combien* de lignes ont bouge, jamais
 * *lesquelles*. Ce module produit le detail — un patch par fichier — au moment
 * precis ou l'execution se termine.
 *
 * ## Pourquoi maintenant, et pas a l'affichage
 *
 * Parce qu'une review doit raconter le passe. Si NOX recalculait le diff a
 * l'ouverture de la page, la moindre edition faite entre-temps dans l'editeur —
 * exactement ce qu'on attend de l'utilisateur apres une review — changerait
 * retroactivement ce que l'agent est cense avoir produit. Un temoignage qui se
 * reecrit tout seul est pire qu'aucun temoignage.
 *
 * ## Strictement en lecture
 *
 * Aucune commande de ce module n'ecrit quoi que ce soit. Pas de `git add` — ce
 * qui oblige a traiter les fichiers non suivis autrement, voir plus bas —, pas
 * de `reset`, pas de `restore`, pas de fichier temporaire, pas de reseau.
 * `execFile` sans shell : le chemin du repository et les chemins de fichiers sont
 * des arguments, jamais des fragments de commande.
 *
 * ## Le point de comparaison est `headBefore`
 *
 * Pas `HEAD`. Le repository etait obligatoirement propre au lancement, donc
 * « `headBefore` + arbre de travail final » decrit exactement ce que l'execution
 * a produit. Comparer a `HEAD` donnerait une reponse fausse dans le seul cas ou
 * la question compte vraiment : celui ou l'agent a cree un commit interdit.
 */

import { lstat, open } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  PATCH_TRUNCATION_NOTICE,
  REVIEW_LIMITS,
  RUN_CHANGE_TYPE,
  RUNNER_ERROR,
  isAbsoluteLikePath,
  isSensitiveRepositoryPath,
  type RunChangeType,
  type RunFileChange,
  type RunnerErrorCode,
} from "@nox/shared";

import {
  collectEnvironmentSecrets,
  SECRET_PLACEHOLDER,
  stripControlCharacters,
} from "../claude/stream/sanitize-event.ts";
import { runGitCommand, type GitCommandRunner } from "./git-state.ts";

/**
 * Delai accorde a chaque commande Git de la capture.
 *
 * Plus genereux que celui de l'etat Git : produire le patch d'un fichier de
 * plusieurs megaoctets prend plus de temps que lire une branche.
 */
export const GIT_REVIEW_TIMEOUT_MS = 20_000;

/** Taille lue d'un fichier non suivi avant d'abandonner. */
const MAX_UNTRACKED_BYTES = REVIEW_LIMITS.patchPerFile;

/** Octets inspectes pour decider si un fichier non suivi est binaire. */
const BINARY_SNIFF_BYTES = 8_000;

export type ReviewCaptureOptions = {
  runGit?: GitCommandRunner;
  timeoutMs?: number;
  environment?: Record<string, string | undefined>;
};

export type RepositoryChanges = {
  files: RunFileChange[];
  /** Fichiers changes mais non decrits, faute de place. */
  omittedFiles: number;
};

export type ReviewCaptureResult =
  | { ok: true; changes: RepositoryChanges }
  | { ok: false; code: RunnerErrorCode };

/** Ce que Git rapporte d'un fichier avant qu'on aille chercher son patch. */
type ChangeEntry = {
  path: string;
  previousPath: string | null;
  changeType: RunChangeType;
  additions: number | null;
  deletions: number | null;
  isBinary: boolean;
};

/**
 * Traduit la lettre de statut de Git.
 *
 * Un statut inconnu devient `MODIFIED` plutot qu'un type invente : la liste des
 * types est fermee, et « quelque chose a change ici » reste vrai dans tous les
 * cas que cette branche peut atteindre.
 */
function toChangeType(status: string): RunChangeType {
  switch (status.charAt(0)) {
    case "A":
      return RUN_CHANGE_TYPE.ADDED;
    case "D":
      return RUN_CHANGE_TYPE.DELETED;
    case "R":
      return RUN_CHANGE_TYPE.RENAMED;
    case "C":
      return RUN_CHANGE_TYPE.COPIED;
    case "T":
      return RUN_CHANGE_TYPE.TYPE_CHANGED;
    default:
      return RUN_CHANGE_TYPE.MODIFIED;
  }
}

/** Decoupe une sortie Git `-z` en jetons, sans jeton vide final. */
function splitNul(stdout: string): string[] {
  const tokens = stdout.split("\0");
  while (tokens.length > 0 && tokens[tokens.length - 1] === "") {
    tokens.pop();
  }
  return tokens;
}

/**
 * Lit `git diff --name-status -z`.
 *
 * Le format `-z` existe precisement pour ce module : la sortie « humaine » separe
 * les champs par des espaces et des tabulations, que les noms de fichiers ont
 * parfaitement le droit de contenir. Un parseur base sur les espaces se trompe
 * des le premier fichier nomme « notes de version.md ».
 */
export function parseNameStatus(stdout: string): Omit<ChangeEntry, "additions" | "deletions" | "isBinary">[] {
  const tokens = splitNul(stdout);
  const entries: Omit<ChangeEntry, "additions" | "deletions" | "isBinary">[] = [];

  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index] ?? "";
    const letter = status.charAt(0);

    if (letter === "R" || letter === "C") {
      const previous = tokens[index + 1];
      const current = tokens[index + 2];
      index += 3;
      if (previous === undefined || current === undefined || current === "") {
        continue;
      }
      entries.push({
        path: current,
        previousPath: previous === "" ? null : previous,
        changeType: toChangeType(status),
      });
      continue;
    }

    const current = tokens[index + 1];
    index += 2;
    if (current === undefined || current === "" || status === "") {
      continue;
    }
    entries.push({ path: current, previousPath: null, changeType: toChangeType(status) });
  }

  return entries;
}

/** Compteurs par chemin, lus depuis `git diff --numstat -z`. */
export function parseNumstat(
  stdout: string,
): Map<string, { additions: number | null; deletions: number | null }> {
  const tokens = splitNul(stdout);
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    const parts = token.split("\t");
    if (parts.length < 3) {
      index += 1;
      continue;
    }

    // `-` signale un fichier binaire : Git ne compte pas ses lignes, et NOX
    // n'invente pas de valeur pour combler la case.
    const additions = parts[0] === "-" ? null : Number.parseInt(parts[0] ?? "", 10);
    const deletions = parts[1] === "-" ? null : Number.parseInt(parts[1] ?? "", 10);

    // Pour un renommage, le troisieme champ est vide et les deux chemins
    // suivent, chacun dans son propre jeton.
    if (parts[2] === "" && parts.length === 3) {
      const current = tokens[index + 2];
      index += 3;
      if (current !== undefined && current !== "") {
        counts.set(current, { additions: sane(additions), deletions: sane(deletions) });
      }
      continue;
    }

    // Un nom de fichier peut contenir une tabulation : les champs au-dela du
    // deuxieme sont donc recolles.
    const filePath = parts.slice(2).join("\t");
    index += 1;
    if (filePath !== "") {
      counts.set(filePath, { additions: sane(additions), deletions: sane(deletions) });
    }
  }

  return counts;
}

function sane(value: number | null): number | null {
  return value === null || Number.isNaN(value) ? null : value;
}

/**
 * Le chemin est-il utilisable tel quel ?
 *
 * Git ne devrait jamais produire autre chose qu'un chemin relatif au
 * repository ; ce controle existe pour que, s'il le faisait un jour, le fichier
 * soit ecarte plutot que stocke. Un chemin absolu en base finirait par etre
 * affiche, et il nomme un disque et un utilisateur.
 */
function isUsablePath(value: string): boolean {
  return (
    value !== "" &&
    value.length <= REVIEW_LIMITS.path &&
    !isAbsoluteLikePath(value) &&
    !value.includes("\0")
  );
}

/**
 * Nettoie un patch avant de le conserver.
 *
 * ## Ce qui est retire
 *
 * Les caracteres de controle — ils permettent d'afficher autre chose que le
 * texte reel — et les valeurs des variables `NOX_*`, dont le jeton du runner.
 *
 * ## Ce qui est deliberement preserve
 *
 * Les chemins et l'indentation. Le nettoyeur d'evenements de TASK-010 rend les
 * chemins relatifs et ecrase les espaces multiples : parfait pour une ligne de
 * timeline, destructeur pour un diff. Un patch dont on a reecrit les chemins ou
 * reindente les lignes ne decrit plus le fichier qu'il pretend decrire — et une
 * review qui ment est pire qu'une review absente.
 */
function cleanPatch(patch: string, secrets: readonly string[]): string {
  let text = stripControlCharacters(patch);
  for (const secret of secrets) {
    text = text.split(secret).join(SECRET_PLACEHOLDER);
  }
  return text;
}

/** Fabrique le diff unifie d'un fichier non suivi, sans jamais faire `git add`. */
export function buildUntrackedPatch(filePath: string, content: string): string {
  const lines = content.split("\n");
  // Un fichier terminé par un saut de ligne produit un dernier element vide :
  // il ne correspond a aucune ligne ajoutee.
  const hasTrailingNewline = lines.length > 0 && lines[lines.length - 1] === "";
  const body = hasTrailingNewline ? lines.slice(0, -1) : lines;

  const header = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${String(body.length)} @@\n`;
  const added = body.map((line) => `+${line}`).join("\n");
  const marker = hasTrailingNewline || body.length === 0 ? "" : "\n\\ No newline at end of file";

  return body.length === 0 ? header : `${header}${added}${marker}\n`;
}

/** Contenu d'un fichier non suivi, tel que la capture le voit. */
type UntrackedContent =
  | { kind: "text"; content: string; lines: number; truncated: boolean }
  | { kind: "binary" }
  | { kind: "unreadable" };

/**
 * Lit un fichier non suivi, sans jamais le charger entierement.
 *
 * La lecture est bornee des l'appel systeme : un fichier de 500 Mio depose par
 * megarde dans le repository ne doit pas passer par la memoire du runner avant
 * d'etre ecarte. Au-dela de la borne, le debut est conserve et la coupe est
 * signalee — un debut de diff vaut mieux que rien.
 *
 * Un lien symbolique est refuse, comme partout ailleurs dans NOX : sa cible peut
 * sortir du repository, et afficher son contenu reviendrait a lire un fichier
 * que personne n'a designe. `git ls-files --others` ne descend pas dans un
 * dossier lie, donc un fichier liste ne peut pas non plus etre atteint a travers
 * un parent symbolique.
 */
async function readUntracked(root: string, relativePath: string): Promise<UntrackedContent> {
  const absolute = path.join(root, relativePath);

  try {
    const stats = await lstat(absolute);
    if (!stats.isFile()) {
      return { kind: "unreadable" };
    }

    const handle = await open(absolute, "r");
    let bytes: Buffer;
    try {
      const buffer = Buffer.allocUnsafe(MAX_UNTRACKED_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, MAX_UNTRACKED_BYTES, 0);
      bytes = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }

    const sniff = bytes.subarray(0, BINARY_SNIFF_BYTES);
    if (sniff.includes(0)) {
      return { kind: "binary" };
    }

    const truncated = stats.size > bytes.length;
    const content = bytes.toString("utf8");
    // Un caractere de remplacement apres decodage trahit un fichier qui n'etait
    // pas de l'UTF-8 : le traiter comme du texte afficherait du charabia. Sur un
    // fichier coupe, le dernier caractere peut l'etre parce que la coupe tombe au
    // milieu d'une sequence — il est alors retire plutot que compte comme binaire.
    const decoded = truncated ? content.replace(/�+$/u, "") : content;
    if (decoded.includes("�")) {
      return { kind: "binary" };
    }

    const lines = decoded === "" ? 0 : decoded.replace(/\n$/u, "").split("\n").length;
    return { kind: "text", content: decoded, lines, truncated };
  } catch {
    return { kind: "unreadable" };
  }
}

/**
 * Capture les changements du repository par rapport a `headBefore`.
 *
 * Ne leve jamais : un echec produit un code d'erreur, et l'appelant conserve le
 * resultat de Claude Code. Un diff que NOX n'a pas su lire ne transforme pas une
 * execution reussie en execution ratee.
 */
export async function captureRepositoryChanges(
  root: string,
  headBefore: string,
  options: ReviewCaptureOptions = {},
): Promise<ReviewCaptureResult> {
  const runGit = options.runGit ?? runGitCommand;
  const timeoutMs = options.timeoutMs ?? GIT_REVIEW_TIMEOUT_MS;
  const secrets = collectEnvironmentSecrets(options.environment ?? process.env);

  const nameStatus = await runGit(
    root,
    ["diff", "--name-status", "-z", "-M", "-C", headBefore],
    timeoutMs,
  );
  if (nameStatus.status !== "ok") {
    return { ok: false, code: toFailureCode(nameStatus.status) };
  }

  const numstat = await runGit(
    root,
    ["diff", "--numstat", "-z", "-M", "-C", headBefore],
    timeoutMs,
  );
  if (numstat.status !== "ok") {
    return { ok: false, code: toFailureCode(numstat.status) };
  }

  // Les fichiers non suivis ne figurent dans aucun `git diff` : sans cette
  // commande, tout ce que l'agent a **cree** serait invisible dans la review.
  // C'est precisement le cas le plus interessant a relire.
  const untracked = await runGit(
    root,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    timeoutMs,
  );
  if (untracked.status !== "ok") {
    return { ok: false, code: toFailureCode(untracked.status) };
  }

  const counts = parseNumstat(numstat.stdout);
  const entries: ChangeEntry[] = [];

  for (const entry of parseNameStatus(nameStatus.stdout)) {
    if (!isUsablePath(entry.path)) {
      continue;
    }
    const count = counts.get(entry.path);
    entries.push({
      ...entry,
      previousPath: entry.previousPath !== null && isUsablePath(entry.previousPath)
        ? entry.previousPath
        : null,
      additions: count?.additions ?? null,
      deletions: count?.deletions ?? null,
      // Git n'annonce pas « binaire » dans `--name-status` : c'est l'absence de
      // compteurs dans `--numstat` qui le dit.
      isBinary: count !== undefined && count.additions === null && count.deletions === null,
    });
  }

  for (const filePath of splitNul(untracked.stdout)) {
    if (!isUsablePath(filePath)) {
      continue;
    }
    entries.push({
      path: filePath,
      previousPath: null,
      changeType: RUN_CHANGE_TYPE.UNTRACKED,
      additions: null,
      deletions: null,
      isBinary: false,
    });
  }

  // Ordre stable et independant de la locale : deux captures du meme etat
  // produisent la meme review, et une navigation par `?file=` reste
  // reproductible.
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const kept = entries.slice(0, REVIEW_LIMITS.maxFiles);
  const omittedFiles = entries.length - kept.length;

  const files: RunFileChange[] = [];
  let patchBudget = REVIEW_LIMITS.patchTotal;
  let lineBudget = REVIEW_LIMITS.diffLines;

  for (const [position, entry] of kept.entries()) {
    const isSensitive = isSensitiveRepositoryPath(entry.path);

    const base: RunFileChange = {
      position,
      path: entry.path,
      previousPath: entry.previousPath,
      changeType: entry.changeType,
      additions: entry.additions,
      deletions: entry.deletions,
      isBinary: entry.isBinary,
      isSensitive,
      isTruncated: false,
      patch: null,
    };

    // Un fichier sensible ou binaire n'a pas de patch, donc pas de commande a
    // lancer : son chemin, son type et ses statistiques suffisent, et c'est
    // exactement ce que la review doit montrer de lui.
    if (isSensitive || entry.isBinary) {
      files.push(base);
      continue;
    }

    if (patchBudget <= 0 || lineBudget <= 0) {
      files.push({ ...base, isTruncated: true });
      continue;
    }

    const produced =
      entry.changeType === RUN_CHANGE_TYPE.UNTRACKED
        ? await untrackedPatch(root, entry)
        : await trackedPatch(runGit, root, headBefore, entry, timeoutMs);

    if (produced === null) {
      files.push({ ...base, isTruncated: true });
      continue;
    }

    if (produced.binary) {
      files.push({ ...base, isBinary: true });
      continue;
    }

    const cleaned = cleanPatch(produced.patch, secrets);
    const bounded = boundPatch(cleaned, Math.min(REVIEW_LIMITS.patchPerFile, patchBudget));
    const lines = countLines(bounded.patch);

    patchBudget -= bounded.patch.length;
    lineBudget -= lines;

    files.push({
      ...base,
      additions: base.additions ?? produced.additions,
      deletions: base.deletions ?? produced.deletions,
      // Trois facons d'etre incomplet, une seule marque : le contenu source
      // etait deja coupe, le patch depasse la borne par fichier, ou il epuise
      // le budget de lignes de l'execution.
      isTruncated: produced.truncated || bounded.truncated || lineBudget < 0,
      patch: bounded.patch,
    });
  }

  return { ok: true, changes: { files, omittedFiles } };
}

function toFailureCode(status: "unavailable" | "timeout" | "failed"): RunnerErrorCode {
  switch (status) {
    case "unavailable":
      return RUNNER_ERROR.GIT_NOT_AVAILABLE;
    case "timeout":
      return RUNNER_ERROR.GIT_TIMEOUT;
    default:
      return RUNNER_ERROR.CLAUDE_REVIEW_FAILED;
  }
}

type ProducedPatch = {
  patch: string;
  binary: boolean;
  additions: number | null;
  deletions: number | null;
  /** Vrai lorsque le contenu source etait deja incomplet a la lecture. */
  truncated: boolean;
};

/**
 * Demande a Git le patch d'un fichier suivi.
 *
 * Le chemin est passe avec la syntaxe `:(literal)` : sans elle, un fichier nomme
 * `notes[1].md` serait lu comme un motif de recherche, et Git ne trouverait
 * rien. Pour un renommage, les deux chemins sont demandes — sinon Git verrait
 * une suppression et une creation la ou il y a un deplacement.
 */
async function trackedPatch(
  runGit: GitCommandRunner,
  root: string,
  headBefore: string,
  entry: ChangeEntry,
  timeoutMs: number,
): Promise<ProducedPatch | null> {
  const pathspecs =
    entry.previousPath === null
      ? [`:(literal)${entry.path}`]
      : [`:(literal)${entry.previousPath}`, `:(literal)${entry.path}`];

  const outcome = await runGit(
    root,
    ["diff", "--no-color", "-M", "-C", headBefore, "--", ...pathspecs],
    timeoutMs,
  );

  if (outcome.status !== "ok") {
    return null;
  }

  return {
    patch: outcome.stdout,
    binary: /^Binary files .* differ$/mu.test(outcome.stdout),
    additions: null,
    deletions: null,
    truncated: false,
  };
}

/** Fabrique le patch d'un fichier non suivi a partir de son contenu. */
async function untrackedPatch(root: string, entry: ChangeEntry): Promise<ProducedPatch | null> {
  const content = await readUntracked(root, entry.path);

  if (content.kind === "binary") {
    return { patch: "", binary: true, additions: null, deletions: null, truncated: false };
  }
  if (content.kind === "unreadable") {
    return null;
  }

  return {
    patch: buildUntrackedPatch(entry.path, content.content),
    binary: false,
    additions: content.lines,
    deletions: 0,
    truncated: content.truncated,
  };
}

/** Coupe un patch trop long et le dit explicitement. */
export function boundPatch(patch: string, maxLength: number): { patch: string; truncated: boolean } {
  if (patch.length <= maxLength) {
    return { patch, truncated: false };
  }
  const room = Math.max(0, maxLength - PATCH_TRUNCATION_NOTICE.length);
  return { patch: patch.slice(0, room) + PATCH_TRUNCATION_NOTICE, truncated: true };
}

function countLines(value: string): number {
  if (value === "") {
    return 0;
  }
  let lines = 1;
  for (const character of value) {
    if (character === "\n") {
      lines += 1;
    }
  }
  return lines;
}
