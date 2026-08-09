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
 * TASK-011 corrective a introduit le decoupage sur `&&` et le retrait du prefixe
 * `cd`. Les runs reels de TASK-012 ont montre la forme suivante, bien plus
 * frequente :
 *
 * ```text
 * cd "D:\…\depot" && git diff --check && echo "OK" && git status --short && git diff
 * ```
 *
 * Un seul segment inconnu — ici un `echo` — faisait renoncer a **toute** la
 * ligne : ni affichage, ni validation. La commande enregistree avait pourtant
 * bel et bien tourne, et son resultat etait connu.
 *
 * ## Les deux questions sont desormais separees
 *
 * 1. **Que peut-on afficher ?** Un segment n'est affiche que s'il correspond mot
 *    pour mot a une commande enregistree, ou s'il s'agit d'une commande Git en
 *    lecture seule. Les autres sont remplaces par `...` : leur existence est
 *    dite, jamais leur contenu.
 * 2. **Quelles validations ont tourne ?** Uniquement les segments qui
 *    correspondent **mot pour mot** a une commande enregistree — que le reste de
 *    la ligne soit affichable ou non.
 *
 * Lier les deux, comme avant, revenait a perdre une information certaine — « la
 * commande a tourne » — a cause d'une information inconnue.
 *
 * ## Ce que ce module ne fait toujours pas
 *
 * Il n'interprete pas un shell. Il connait le chainage `&&`, le prefixe
 * `cd <chemin>`, et les chaines quottees — ces dernieres uniquement pour savoir
 * ou un segment s'arrete. Redirection, tuyau, point-virgule, substitution,
 * esperluette isolee : la lecture renonce entierement, et « je ne sais pas »
 * signifie « je n'affiche rien et je ne valide rien ».
 *
 * ## La correspondance reste exacte
 *
 * `git diff --check --cached` reste distinct de `git diff --check`. Le decoupage
 * respecte les guillemets : `echo "a && git diff --check"` est **un** segment, et
 * ne produit aucune validation. Sans cette precaution, une chaine de caracteres
 * bien choisie suffirait a faire croire qu'une validation a tourne.
 */

import { CLAUDE_GIT_READ_ONLY_COMMANDS } from "@nox/shared";

/**
 * Caracteres qui font renoncer a lire la commande.
 *
 * Redirections, tuyaux, substitutions, chainages autres que `&&` : chacun
 * change ce que la ligne fait reellement, et aucun n'a besoin d'etre compris
 * pour que NOX fasse son travail. Le test porte sur la ligne entiere, y compris
 * a l'interieur des guillemets — un refus de trop ne coute qu'un affichage
 * generique.
 */
const REFUSED_CHARACTERS = /[;|<>`\n\r\0]|\$\(/;

/** `cd chemin`, seule forme de navigation reconnue — quottee ou non. */
const NAVIGATION = /^cd\s+("[^"]*"|'[^']*'|[^\s'"]+)$/;

/** Un segment affiche ne peut porter ni guillemet ni antislash. */
const UNQUOTED = /^[^'"\\]*$/;

/**
 * Marque d'un segment que NOX n'affiche pas.
 *
 * Il dit qu'une commande a tourne la, et rien d'autre : ni son nom, ni sa
 * longueur, ni un fragment. Sans lui, afficher les seuls segments reconnus
 * laisserait croire que la ligne se limitait a eux.
 */
const HIDDEN = "...";

export type BashCommandReading = {
  /**
   * Texte affichable, prefixe de navigation retire, ou `null`.
   *
   * `null` signifie « NOX n'a rien a montrer de cette ligne » : l'appelant
   * affiche alors « Running an allowed command ». Chaque commande qui y figure
   * est autorisee mot pour mot ; tout le reste est reduit a `...`.
   */
  display: string | null;
  /**
   * Commandes de validation enregistrees reconnues parmi les segments.
   *
   * Vide dans l'immense majorite des cas. Deux entrees signifient que la ligne
   * enchainait deux validations declarees par la tache.
   */
  validations: readonly string[];
  /**
   * Nombre de commandes reelles de la ligne, prefixe `cd` exclu.
   *
   * Sert a une seule chose, mais elle est essentielle : un echec ne peut etre
   * impute a une validation que si elle etait **seule** sur la ligne. Ailleurs,
   * le resultat unique ne dit pas quel maillon de la chaine a cede.
   */
  commandCount: number;
};

/** Lecture qui a renonce : rien a afficher, rien a valider. */
function refused(): BashCommandReading {
  return { display: null, validations: [], commandCount: 0 };
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

  const pieces = splitChaining(command);
  if (pieces === null) {
    return refused();
  }

  const shown: string[] = [];
  const validations: string[] = [];
  let commandCount = 0;

  for (const piece of pieces) {
    const segment = piece.trim();
    if (segment === "") {
      return refused();
    }
    // Le repertoire de travail est retire, jamais affiche : c'est un chemin
    // absolu de la machine, et il n'a rien a faire dans le navigateur.
    if (NAVIGATION.test(segment)) {
      continue;
    }

    commandCount += 1;

    // Une commande enregistree ne peut contenir ni guillemet ni antislash — la
    // saisie les refuse deja —, donc une correspondance exacte est toujours
    // affichable. La classification generique ne prime jamais sur la liste de
    // la tache : un `git status` enregistre **est** une validation.
    const registered = allowedCommands.includes(segment);
    if (registered && !validations.includes(segment)) {
      validations.push(segment);
    }

    if (registered || (UNQUOTED.test(segment) && isReadOnlyGit(segment))) {
      shown.push(segment);
      continue;
    }

    // Deux segments inconnus consecutifs ne meritent pas deux marques : ce qui
    // compte est qu'il y a eu autre chose, pas combien.
    if (shown[shown.length - 1] !== HIDDEN) {
      shown.push(HIDDEN);
    }
  }

  if (commandCount === 0) {
    return refused();
  }

  // Une ligne entierement composee de segments inconnus n'a rien a montrer : un
  // `...` solitaire n'apprendrait rien de plus que le libelle generique.
  const readable = shown.some((segment) => segment !== HIDDEN);

  return {
    display: readable ? shown.join(" && ") : null,
    validations,
    commandCount,
  };
}

/**
 * Decoupe une ligne sur les `&&` de premier niveau.
 *
 * Retourne `null` lorsqu'un guillemet reste ouvert : une ligne dont on ne sait
 * pas ou finissent les chaines ne peut pas etre decoupee sans risque.
 *
 * Le decoupage naif — `command.split("&&")` — suffisait tant que le moindre
 * guillemet faisait renoncer a la ligne entiere. Il ne suffit plus : depuis que
 * les validations sont reconnues au milieu de segments inconnus, un `echo
 * "&& npm run test &&"` produirait un segment `npm run test` qui n'a jamais
 * tourne.
 */
function splitChaining(command: string): string[] | null {
  const pieces: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";

    // Un antislash protege le caractere suivant, sauf entre apostrophes ou il
    // est litteral. Les deux caracteres sont conserves tels quels : ce module
    // decoupe, il ne reecrit rien.
    if (character === "\\" && quote !== "'") {
      const next = command[index + 1];
      if (next === undefined) {
        return null;
      }
      current += character + next;
      index += 1;
      continue;
    }

    if (quote !== null) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "&" && command[index + 1] === "&") {
      pieces.push(current);
      current = "";
      index += 1;
      continue;
    }

    current += character;
  }

  if (quote !== null) {
    return null;
  }

  pieces.push(current);
  return pieces;
}

/**
 * Ce segment est-il une commande Git en lecture seule ?
 *
 * Affichable, mais sans verdict : `git status --short` decrit le repository, il
 * ne dit rien de la qualite du code. Il ne devient une validation que si la
 * tache l'a enregistre comme telle.
 */
function isReadOnlyGit(segment: string): boolean {
  return CLAUDE_GIT_READ_ONLY_COMMANDS.some(
    (git) => segment === git || segment.startsWith(`${git} `),
  );
}
