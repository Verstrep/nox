/**
 * Lecture d'une commande Bash telle que Claude Code l'emet reellement.
 *
 * ## Pourquoi ce module existe
 *
 * TASK-011 comparait la commande entiere au texte enregistre par la tache. Le
 * premier run reel a montre que Claude Code 2.1.223 n'envoie jamais la commande
 * nue : il la prefixe de son repertoire de travail.
 *
 * ```text
 * enregistre par la tache : git diff --check
 * emis par Claude Code    : cd "D:/Projets/Dev/nox-claude-test" && git diff --check
 * ```
 *
 * Les deux chaines different, donc rien ne correspondait : la commande restait
 * « Not run » alors qu'elle avait bel et bien tourne, et la timeline affichait
 * « Running an allowed command » pour un simple `git status`.
 *
 * Claude Code, lui, avait autorise cette commande — son moteur de permissions
 * **decompose** la ligne et reconnait `git diff --check` parmi ses parties.
 * L'asymetrie etait la : un cote decompose, l'autre comparait un bloc opaque.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il n'interprete pas un shell. Il ne connait qu'une seule construction — le
 * chainage `&&` — et un seul prefixe — `cd <chemin>`. Tout le reste fait echouer
 * la lecture, et une lecture qui echoue signifie « je ne sais pas », donc « je
 * n'affiche rien et je ne valide rien ».
 *
 * C'est volontaire. Un analyseur de shell approximatif finirait par autoriser ce
 * qu'il n'a pas compris ; ici, ce qui n'est pas compris est refuse.
 *
 * ## La correspondance reste exacte
 *
 * Un **segment** doit correspondre mot pour mot a une commande enregistree pour
 * etre une validation. `git diff --check --cached` reste distinct de
 * `git diff --check`, et `git diff --check 2>&1` est refuse d'emblee — il porte
 * une redirection. La decomposition retire un prefixe de navigation ; elle ne
 * relache aucune comparaison.
 */

import { CLAUDE_GIT_READ_ONLY_COMMANDS } from "@nox/shared";

/**
 * Caracteres qui font renoncer a lire la commande.
 *
 * Redirections, tuyaux, substitutions, chainages autres que `&&` : chacun
 * change ce que la ligne fait reellement, et aucun n'a besoin d'etre compris
 * pour que NOX fasse son travail.
 */
const REFUSED_CHARACTERS = /[;|<>`\n\r\0]|\$\(/;

/** `cd chemin`, seule forme de navigation reconnue — quottee ou non. */
const NAVIGATION = /^cd\s+("[^"]*"|'[^']*'|[^\s'"]+)$/;

/** Un segment de commande ne peut porter ni guillemet ni antislash. */
const UNQUOTED = /^[^'"\\]*$/;

export type BashCommandReading = {
  /**
   * Texte affichable, prefixe de navigation retire, ou `null`.
   *
   * `null` signifie « NOX ne sait pas ce que cette ligne fait » : l'appelant
   * affiche alors « Running an allowed command ». Ce n'est jamais une chaine
   * reconstruite librement — chaque segment conserve est deja autorise mot pour
   * mot, exactement comme avant TASK-011 corrective.
   */
  display: string | null;
  /**
   * Commandes de validation enregistrees reconnues parmi les segments.
   *
   * Vide dans l'immense majorite des cas. Deux entrees signifient que la ligne
   * enchainait deux validations declarees par la tache.
   */
  validations: readonly string[];
};

/** Lecture qui a renonce : rien a afficher, rien a valider. */
function refused(): BashCommandReading {
  return { display: null, validations: [] };
}

/**
 * Lit une commande Bash observee dans le flux.
 *
 * Ne leve jamais : une commande illisible est un cas normal du flux d'un
 * processus exterieur.
 */
export function readBashCommand(
  raw: string,
  allowedCommands: readonly string[],
): BashCommandReading {
  const command = raw.trim();
  if (command === "" || REFUSED_CHARACTERS.test(command)) {
    return refused();
  }

  // Une esperluette isolee met la commande en arriere-plan ; seul le chainage
  // `&&` est compris. Les retirer d'abord isole les autres.
  if (command.replaceAll("&&", "").includes("&")) {
    return refused();
  }

  const kept: string[] = [];

  for (const piece of command.split("&&")) {
    const segment = piece.trim();
    if (segment === "") {
      return refused();
    }
    // Le repertoire de travail est retire, jamais affiche : c'est un chemin
    // absolu de la machine, et il n'a rien a faire dans le navigateur.
    if (NAVIGATION.test(segment)) {
      continue;
    }
    if (!UNQUOTED.test(segment) || !isAuthorizedSegment(segment, allowedCommands)) {
      return refused();
    }
    kept.push(segment);
  }

  if (kept.length === 0) {
    return refused();
  }

  const validations: string[] = [];
  for (const segment of kept) {
    if (allowedCommands.includes(segment) && !validations.includes(segment)) {
      validations.push(segment);
    }
  }

  return { display: kept.join(" && "), validations };
}

/**
 * Ce segment peut-il etre affiche tel quel ?
 *
 * Correspondance exacte avec une commande de validation enregistree, ou
 * commande Git en lecture seule. Inchange depuis TASK-010 : seule l'echelle a
 * change — la regle s'applique desormais a un segment plutot qu'a la ligne.
 */
function isAuthorizedSegment(segment: string, allowedCommands: readonly string[]): boolean {
  if (allowedCommands.includes(segment)) {
    return true;
  }
  return CLAUDE_GIT_READ_ONLY_COMMANDS.some(
    (git) => segment === git || segment.startsWith(`${git} `),
  );
}
