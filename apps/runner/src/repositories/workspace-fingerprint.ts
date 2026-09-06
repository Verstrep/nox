/**
 * Empreinte opaque du dossier de travail.
 *
 * ## Le probleme
 *
 * Une correction ciblee reprend la session Claude d'une execution relue, et le
 * repository est alors **volontairement sale** : il porte le travail que
 * l'utilisateur vient de relire. On ne peut donc pas exiger qu'il soit propre.
 *
 * Mais on ne peut pas non plus l'accepter tel quel. Si l'utilisateur a modifie
 * deux fichiers a la main entre la review et le clic, la correction produira un
 * etat dont plus personne ne saura dire quelle part vient de l'agent. La review
 * suivante deviendrait un temoignage faux.
 *
 * D'ou cette notion : **l'etat exactement relu**. Pas « un repository sale »,
 * mais « ce repository sale-la ».
 *
 * ## Pourquoi une empreinte, et pas une liste de fichiers
 *
 * Une liste de chemins dirait qu'un fichier a change ; elle ne dirait pas que
 * son *contenu* a change. Or c'est le contenu qui compte : editer `README.md`
 * apres la review ne modifie ni la liste, ni les statistiques de Git si le
 * nombre de lignes est conserve. L'empreinte couvre le contenu, l'etat d'index,
 * le type d'entree, la branche et `HEAD`.
 *
 * Elle couvre aussi **tous** les fichiers changes, pas seulement les 200 que la
 * review sait afficher. La review est une aide a la lecture ; l'empreinte est un
 * controle de securite, et un controle partiel n'en est pas un.
 *
 * ## Pourquoi elle est authentifiee
 *
 * Un `.env` peut faire partie du dossier de travail. Stocker `SHA256(contenu)`
 * en base offrirait a quiconque lit le fichier SQLite la possibilite de tester
 * hors ligne des secrets de faible entropie jusqu'a retrouver le bon.
 *
 * L'empreinte est donc un HMAC dont la cle est derivee du jeton du runner :
 *
 * ```text
 * fingerprintKey = HMAC-SHA256(NOX_RUNNER_TOKEN, "nox-workspace-fingerprint-v1")
 * empreinte      = HMAC-SHA256(fingerprintKey, representation canonique)
 * ```
 *
 * La cle n'est jamais ecrite en base, jamais journalisee, et ne quitte jamais le
 * runner. Si le jeton change, les anciennes empreintes deviennent invérifiables :
 * NOX bloque alors la reprise et le dit, plutot que de contourner le controle.
 *
 * ## Determinisme
 *
 * `--no-renames` est passe volontairement : la detection de renommage est une
 * heuristique dont le seuil depend de la configuration Git de l'utilisateur. Un
 * renommage apparait alors comme une suppression plus un fichier non suivi — ce
 * qui change l'empreinte exactement comme il se doit, sans dependre d'un reglage.
 *
 * ## Strictement en lecture
 *
 * Aucune commande de ce module n'ecrit. Pas de `git add`, pas de fichier
 * temporaire, pas de reseau. Un lien symbolique n'est **jamais** suivi : c'est sa
 * cible textuelle qui entre dans l'empreinte, jamais le contenu qu'elle designe.
 */

import { createHmac, timingSafeEqual, type Hmac } from "node:crypto";
import { lstat, open, readlink } from "node:fs/promises";
import path from "node:path";

import {
  RUNNER_ERROR,
  WORKSPACE_ENTRY_LIMITS,
  WORKSPACE_FINGERPRINT_VERSION,
  type RunnerErrorCode,
  type WorkspaceEntryDigest,
} from "@nox/shared";

import { runGitCommand, type GitCommandRunner } from "./git-state.ts";

/** Delai accorde a chaque commande Git de l'empreinte. */
export const FINGERPRINT_TIMEOUT_MS = 20_000;

/**
 * Bornes du calcul.
 *
 * Des constantes, comme celles de la review. Un depassement ne produit jamais une
 * empreinte partielle : il produit un refus. « Je ne sais pas » est une reponse
 * sure ; « voici une empreinte incomplete » ne l'est pas.
 */
export const FINGERPRINT_LIMITS = {
  /** Entrees changees prises en compte. Dix fois la limite d'affichage. */
  maxEntries: 2_000,
  /** Octets lus pour un seul fichier. */
  maxFileBytes: 16 * 1024 * 1024,
  /** Octets lus au total. */
  maxTotalBytes: 64 * 1024 * 1024,
} as const;

/** Chaine de domaine : elle lie la cle derivee a cet usage precis. */
const KEY_DOMAIN = `nox-workspace-fingerprint-${WORKSPACE_FINGERPRINT_VERSION}`;

export type FingerprintResult =
  | {
      ok: true;
      value: string;
      branch: string;
      head: string;
      /**
       * Une empreinte par entree changee, calculee sur les memes octets.
       *
       * Elle ne decide de rien : `value` reste la seule autorite. Elle permet a
       * un refus de **nommer** les chemins qui ont diverge, ce qu'un HMAC unique
       * ne saura jamais faire. Voir `workspace-entries.ts` dans `@nox/shared`.
       */
      entries: readonly WorkspaceEntryDigest[];
    }
  | { ok: false; code: RunnerErrorCode };

export type FingerprintOptions = {
  runGit?: GitCommandRunner;
  timeoutMs?: number;
};

/**
 * Derive la cle d'empreinte a partir du jeton du runner.
 *
 * Le jeton lui-meme ne sert jamais directement de cle : une cle derivee pour un
 * usage precis ne peut pas etre reutilisee ailleurs, et un HMAC calcule avec elle
 * n'apprend rien sur le jeton.
 */
export function deriveFingerprintKey(token: string): Buffer {
  return createHmac("sha256", token).update(KEY_DOMAIN, "utf8").digest();
}

/**
 * Compare deux empreintes en temps constant.
 *
 * Une comparaison de chaines s'arrete au premier caractere different, et la duree
 * de la reponse renseignerait alors sur le prefixe correct. Le gain est theorique
 * ici — l'attaquant devrait deja pouvoir appeler le runner — mais la primitive
 * existe, et l'utiliser ne coute rien.
 */
export function fingerprintsMatch(left: string, right: string): boolean {
  if (left.length !== right.length || left === "") {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** Une entree changee, telle que `git status` la rapporte. */
type StatusEntry = {
  /** Les deux lettres d'etat : index puis dossier de travail. */
  code: string;
  /** Chemin relatif, separateurs `/`. */
  path: string;
};

/**
 * Lit `git status --porcelain=v1 -z`.
 *
 * Le format `-z` est indispensable, exactement comme pour la capture de review :
 * la sortie « humaine » separe les champs par des espaces, que les noms de
 * fichiers ont le droit de contenir.
 */
export function parseStatusEntries(stdout: string): StatusEntry[] {
  const entries: StatusEntry[] = [];

  for (const token of stdout.split("\0")) {
    if (token.length < 4) {
      continue;
    }
    entries.push({
      code: token.slice(0, 2),
      path: token.slice(3).replaceAll("\\", "/"),
    });
  }

  // L'ordre de Git est deja stable, mais le trier explicitement retire une
  // hypothese : deux calculs de la meme arborescence doivent donner le meme
  // resultat, quelle que soit la version de Git.
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return entries;
}

/**
 * Ecrit un champ dans un ou plusieurs HMAC, longueur d'abord.
 *
 * Depuis HOTFIX-006, deux HMAC avancent en parallele : celui du dossier de
 * travail entier, et celui de l'entree en cours. Les alimenter par la **meme**
 * fonction est ce qui garantit qu'ils voient exactement les memes octets — deux
 * chemins d'ecriture finiraient par diverger, et l'un des deux se mettrait a
 * accepter ce que l'autre refuse.
 *
 * L'empreinte globale n'a pas change d'un octet : elle recoit la meme suite
 * d'appels qu'avant, dans le meme ordre. C'etait la contrainte a tenir — la
 * modifier aurait rendu inverifiables toutes les empreintes deja enregistrees,
 * donc irreprenables toutes les executions deja relues.
 */
function field(hmac: Hmac, value: string): void {
  // La longueur precede la valeur : sans elle, « ab » + « c » et « a » + « bc »
  // produiraient la meme empreinte, et deux etats differents deviendraient
  // indistinguables.
  hmac.update(`${String(Buffer.byteLength(value, "utf8"))}:`, "utf8");
  hmac.update(value, "utf8");
  hmac.update("\0", "utf8");
}

/**
 * Calcule l'empreinte du dossier de travail.
 *
 * Ne leve pas pour un probleme attendu : Git absent, delai depasse, borne
 * atteinte, entree illisible produisent tous un refus explicite.
 */
export async function computeWorkspaceFingerprint(
  root: string,
  key: Buffer,
  options: FingerprintOptions = {},
): Promise<FingerprintResult> {
  const runGit = options.runGit ?? runGitCommand;
  const timeoutMs = options.timeoutMs ?? FINGERPRINT_TIMEOUT_MS;

  const unavailable = {
    ok: false as const,
    code: RUNNER_ERROR.WORKSPACE_FINGERPRINT_UNAVAILABLE,
  };

  const read = async (args: readonly string[]): Promise<string | null> => {
    const outcome = await runGit(root, args, timeoutMs);
    return outcome.status === "ok" ? outcome.stdout : null;
  };

  const head = (await read(["rev-parse", "HEAD"]))?.trim() ?? "";
  const branch = (await read(["branch", "--show-current"]))?.trim() ?? "";
  if (head === "" || branch === "") {
    return unavailable;
  }

  const status = await read([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]);
  if (status === null) {
    return unavailable;
  }

  const entries = parseStatusEntries(status);
  if (entries.length > FINGERPRINT_LIMITS.maxEntries) {
    return unavailable;
  }

  const hmac = createHmac("sha256", key);
  field(hmac, KEY_DOMAIN);
  field(hmac, branch);
  field(hmac, head);
  field(hmac, String(entries.length));

  let totalBytes = 0;
  const digests: WorkspaceEntryDigest[] = [];

  for (const entry of entries) {
    // L'empreinte de l'entree est independante des autres : elle ne recoit ni la
    // branche, ni `HEAD`, ni le rang de l'entree. C'est ce qui la rend
    // comparable d'une capture a l'autre — sans quoi ajouter un fichier ferait
    // « changer » tous les suivants, et la divergence nommerait n'importe quoi.
    const local = createHmac("sha256", key);
    field(local, KEY_DOMAIN);

    const both = (value: string): void => {
      field(hmac, value);
      field(local, value);
    };

    // Les deux lettres d'etat entrent dans l'empreinte **globale** — elles font
    // partie de l'etat relu — mais pas dans celle de l'entree. Celle-ci doit
    // identifier un **contenu** : les melanger ferait lire un simple `git add`
    // comme une modification du fichier, et le diagnostic designerait une
    // edition qui n'a pas eu lieu.
    field(hmac, entry.code);
    both(entry.path);

    const absolute = path.join(root, entry.path);
    let stats;
    try {
      stats = await lstat(absolute);
    } catch {
      // Le fichier n'existe plus : c'est le cas normal d'une suppression, et
      // « absent » est un etat parfaitement descriptible.
      both("ABSENT");
      digests.push({ path: entry.path, code: entry.code, digest: shorten(local) });
      continue;
    }

    if (stats.isSymbolicLink()) {
      // La cible est lue comme du **texte**, jamais suivie : un lien vers un
      // fichier exterieur ne doit pas faire lire ce fichier.
      try {
        both("SYMLINK");
        both((await readlink(absolute)).replaceAll("\\", "/"));
      } catch {
        return unavailable;
      }
      digests.push({ path: entry.path, code: entry.code, digest: shorten(local) });
      continue;
    }

    if (!stats.isFile()) {
      // Sous-module, socket, peripherique : NOX ne sait pas les representer
      // surement, et refuse plutot que d'ignorer.
      return unavailable;
    }

    if (stats.size > FINGERPRINT_LIMITS.maxFileBytes) {
      return unavailable;
    }
    totalBytes += stats.size;
    if (totalBytes > FINGERPRINT_LIMITS.maxTotalBytes) {
      return unavailable;
    }

    both("FILE");
    both(String(stats.size));

    try {
      const handle = await open(absolute, "r");
      try {
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let position = 0;
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (bytesRead === 0) {
            break;
          }
          const chunk = buffer.subarray(0, bytesRead);
          hmac.update(chunk);
          local.update(chunk);
          position += bytesRead;
        }
      } finally {
        await handle.close();
      }
    } catch {
      return unavailable;
    }

    hmac.update("\0", "utf8");
    local.update("\0", "utf8");
    digests.push({ path: entry.path, code: entry.code, digest: shorten(local) });
  }

  return { ok: true, value: hmac.digest("hex"), branch, head, entries: digests };
}

/**
 * Reduit un HMAC d'entree a sa longueur conservee.
 *
 * Trente-deux caracteres hexadecimaux, soit seize octets. La valeur ne protege
 * rien — l'empreinte globale s'en charge — et la raccourcir divise par deux le
 * volume d'une colonne qui peut porter cinq cents entrees.
 */
function shorten(hmac: Hmac): string {
  return hmac.digest("hex").slice(0, WORKSPACE_ENTRY_LIMITS.digestLength);
}
