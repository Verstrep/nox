/**
 * Autorisations d'outils transmises a Claude Code.
 *
 * C'est la partie la plus sensible de TASK-008 : elle decide de ce que l'agent
 * a le droit de faire dans le repository. Elle vit dans `@nox/shared` pour une
 * raison precise — le runner s'en sert pour construire les arguments du
 * processus, et le web pour **montrer a l'utilisateur** ce qui sera autorise
 * avant qu'il ne lance quoi que ce soit. Deux implementations divergeraient, et
 * l'interface finirait par annoncer autre chose que ce qui est reellement passe.
 *
 * ## Le principe
 *
 * Rien n'est autorise par defaut. Une commande de validation n'est autorisee que
 * si elle a ete **enregistree avec la tache** et si elle peut etre representee
 * exactement, sans interpretation. Une commande qui ne satisfait pas les deux
 * conditions **bloque le lancement** — elle n'est jamais transformee en une
 * commande voisine qui, elle, passerait.
 *
 * ## Pourquoi une liste de caracteres autorises plutot qu'une liste d'interdits
 *
 * Une liste d'interdits se contourne : il suffit d'un operateur auquel personne
 * n'a pense. Une liste d'autorises se trompe dans l'autre sens — elle refuse une
 * commande legitime — et ce sens-la est reparable par l'utilisateur, en une
 * seconde, sans consequence.
 *
 * ## Verifie contre la version installee ?
 *
 * Non. La syntaxe des regles ci-dessous suit la forme documentee de Claude Code
 * (`Outil`, `Bash(commande)`, `Bash(prefixe:*)`), mais aucune verification n'a pu
 * etre faite contre un binaire local : `claude` n'est pas installe sur la
 * machine de developpement. C'est la raison d'etre de `formatBashRule` — si la
 * syntaxe differe, une seule fonction est a corriger.
 */

/**
 * Outils toujours autorises.
 *
 * Le strict necessaire pour implementer une tache : lire, chercher, modifier,
 * creer. Ni execution, ni reseau — ceux-la passent par des regles `Bash`
 * nominatives.
 */
export const CLAUDE_BASE_ALLOWED_TOOLS: readonly string[] = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
];

/**
 * Commandes Git autorisees, toutes en lecture seule.
 *
 * L'agent doit pouvoir constater l'etat du repository — c'est meme demande par
 * le prompt d'execution. Aucune de ces quatre commandes ne modifie quoi que ce
 * soit.
 */
export const CLAUDE_GIT_READ_ONLY_COMMANDS: readonly string[] = [
  "git status",
  "git diff",
  "git log",
  "git show",
];

/**
 * Refus explicites, en defense supplementaire.
 *
 * Ces commandes seraient de toute facon refusees, puisque rien n'est autorise
 * par defaut. Les nommer sert a deux choses : rendre l'intention lisible dans la
 * ligne de commande reellement lancee, et couvrir le cas ou une version de
 * Claude Code elargirait ses autorisations par defaut.
 */
export const CLAUDE_DENIED_COMMANDS: readonly string[] = [
  "git commit",
  "git push",
  "git reset",
  "git checkout",
  "git switch",
  "git clean",
  "git restore",
  "git rebase",
  "git merge",
  "git stash",
  "rm",
  "rmdir",
  "del",
  "Remove-Item",
  "curl",
  "wget",
];

/** Longueur maximale d'une commande de validation. */
export const MAX_VALIDATION_COMMAND_LENGTH = 200;

/**
 * Caracteres acceptes dans une commande de validation.
 *
 * Couvre ce qu'on rencontre reellement — `npm run test`, `npx tsc --noEmit`,
 * `python -m pytest`, `./gradlew build`, `cargo test --all-features` — et rien
 * de plus. Sont exclus, entre autres : les operateurs de chainage et de
 * redirection, les guillemets, la substitution de commande, et la virgule, qui
 * separe les regles dans la liste transmise au processus.
 */
const ALLOWED_COMMAND_CHARACTERS = /^[A-Za-z0-9 ._\-/:=@+]+$/;

export type CommandRefusal = { command: string; reason: string };

/**
 * Verifie qu'une commande peut etre autorisee telle quelle.
 *
 * Retourne la raison du refus, ou `null` si la commande est acceptable.
 */
export function checkValidationCommand(command: string): string | null {
  if (command === "") {
    return "La commande est vide.";
  }

  if (command !== command.trim()) {
    return "La commande commence ou finit par une espace.";
  }

  if (command.length > MAX_VALIDATION_COMMAND_LENGTH) {
    return `La commande depasse ${String(MAX_VALIDATION_COMMAND_LENGTH)} caracteres.`;
  }

  if (command.includes("\0")) {
    return "La commande contient un octet nul.";
  }

  if (/[\r\n]/.test(command)) {
    return "La commande tient sur plusieurs lignes.";
  }

  if (command.includes("  ")) {
    return "La commande contient plusieurs espaces consecutives.";
  }

  if (!ALLOWED_COMMAND_CHARACTERS.test(command)) {
    return (
      "La commande contient un caractere que NOX ne sait pas autoriser sans risque " +
      "(operateur de chainage, redirection, guillemet, virgule ou caractere de controle)."
    );
  }

  if (command.startsWith("-")) {
    return "La commande commence par un tiret : ce n'est pas un programme.";
  }

  // Un refus nominatif reste plus clair qu'un refus par absence d'autorisation,
  // meme si le resultat serait identique.
  const lowered = command.toLowerCase();
  const denied = CLAUDE_DENIED_COMMANDS.find(
    (entry) => lowered === entry.toLowerCase() || lowered.startsWith(`${entry.toLowerCase()} `),
  );
  if (denied !== undefined) {
    return `« ${denied} » ne peut jamais etre autorisee : NOX ne laisse pas un agent modifier Git ni supprimer des fichiers.`;
  }

  return null;
}

/**
 * Met une commande en forme de regle d'outil Bash.
 *
 * Isolee volontairement : c'est le seul endroit a corriger si la syntaxe des
 * regles de la version installee de Claude Code differe de la forme documentee.
 */
export function formatBashRule(command: string, prefix = false): string {
  return prefix ? `Bash(${command}:*)` : `Bash(${command})`;
}

export type ClaudeToolPolicy = {
  /** Regles transmises a `--allowedTools`, dans l'ordre. */
  allowed: readonly string[];
  /** Regles transmises a `--disallowedTools`, dans l'ordre. */
  disallowed: readonly string[];
  /** Commandes de validation effectivement autorisees, pour affichage. */
  authorizedCommands: readonly string[];
};

export type ClaudeToolPolicyResult =
  | { ok: true; policy: ClaudeToolPolicy }
  | { ok: false; refusal: CommandRefusal };

/**
 * Construit la politique d'outils d'une execution.
 *
 * Echoue des qu'une seule commande ne peut pas etre representee exactement :
 * elargir les permissions pour faire passer une commande douteuse reviendrait a
 * autoriser tout ce qui lui ressemble.
 */
export function buildClaudeToolPolicy(
  validationCommands: readonly string[],
): ClaudeToolPolicyResult {
  const authorizedCommands: string[] = [];

  for (const command of validationCommands) {
    const reason = checkValidationCommand(command);
    if (reason !== null) {
      return { ok: false, refusal: { command, reason } };
    }
    // Les doublons ne sont pas une erreur : ils produiraient simplement une
    // regle repetee, ce qui n'a aucun effet.
    if (!authorizedCommands.includes(command)) {
      authorizedCommands.push(command);
    }
  }

  const allowed = [
    ...CLAUDE_BASE_ALLOWED_TOOLS,
    ...CLAUDE_GIT_READ_ONLY_COMMANDS.map((command) => formatBashRule(command, true)),
    ...authorizedCommands.map((command) => formatBashRule(command)),
  ];

  const disallowed = CLAUDE_DENIED_COMMANDS.map((command) => formatBashRule(command, true));

  return { ok: true, policy: { allowed, disallowed, authorizedCommands } };
}
