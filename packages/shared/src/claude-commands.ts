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
 * ## L'exception de l'amorcage
 *
 * Une tache de nature `BOOTSTRAP` fait exception, et une seule fois : elle choisit
 * sa pile technique **pendant** son execution, donc ses commandes d'installation
 * ne peuvent pas etre enregistrees avant. Elle recoit une liste fermee de
 * programmes d'ecosysteme, doublee de refus supplementaires. Ce n'est pas une
 * permission de shell : tout ce qui n'est pas nomme reste refuse, et l'agent doit
 * signaler le refus au lieu de le contourner.
 *
 * Cette exception ne change rien pour une tache `NORMAL` — pas une regle de plus,
 * pas une de moins.
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

import { TASK_KIND, type TaskKind } from "./tasks.js";

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

/**
 * Programmes autorises pendant une execution de nature `BOOTSTRAP`, et eux seuls.
 *
 * ## Pourquoi cette liste existe
 *
 * Une tache d'amorcage **choisit ou constate** sa pile technique pendant son
 * execution. Ses commandes d'installation ne peuvent donc pas etre enregistrees
 * avant le lancement : au moment ou l'utilisateur clique, personne — ni lui, ni
 * NOX — ne sait encore s'il faudra `npm install`, `cargo fetch` ou
 * `bundle install`. Sans cette liste, TASK-000 produit un repository non
 * installe, sans fichier de verrouillage, dont rien n'a pu etre verifie.
 *
 * ## Ce que la liste nomme
 *
 * Des **programmes**, pas des commandes completes : le gestionnaire de paquets,
 * l'outil de build et le runtime de chaque ecosysteme courant. NOX ne peut pas
 * deviner la sous-commande — `npm run build` ou `npm run compile`, `go test ./...`
 * ou `go build ./cmd/...` — sans se tromper sur la moitie des piles.
 *
 * C'est une liste **fermee** : ce qui n'y figure pas reste refuse, et le refus
 * est signale dans le compte rendu plutot que contourne. Aucun ecosysteme n'y est
 * privilegie ; `npm` n'y a pas plus de droits que `cargo`.
 *
 * ## Ce que cette liste ne pretend pas garantir
 *
 * Elle ne rend pas l'execution inoffensive. `npm install` execute les scripts de
 * cycle de vie des dependances, et `npm run` execute un script que l'agent vient
 * lui-meme d'ecrire : autoriser l'installation d'un ecosysteme, c'est autoriser
 * du code tiers a s'executer. Ce que NOX borne, c'est **ou** cela s'execute et
 * **ce qui reste interdit** — le processus tourne avec le repository pour dossier
 * courant, sans variable `NOX_*`, sans `--dangerously-skip-permissions`, et
 * `CLAUDE_BOOTSTRAP_DENIED_COMMANDS` continue de refuser la publication, le
 * deploiement, l'escalade et l'acces distant.
 */
export const CLAUDE_BOOTSTRAP_SETUP_PROGRAMS: readonly string[] = [
  // JavaScript et TypeScript.
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "corepack",
  // Python.
  "python",
  "python3",
  "pip",
  "pip3",
  "uv",
  "poetry",
  "pytest",
  // Rust.
  "cargo",
  // Go.
  "go",
  // JVM.
  "java",
  "mvn",
  "gradle",
  "./gradlew",
  // Ruby.
  "ruby",
  "bundle",
  "rake",
  // PHP.
  "php",
  "composer",
  // .NET.
  "dotnet",
  // Generique.
  "make",
];

/**
 * Refus supplementaires appliques pendant une execution de nature `BOOTSTRAP`.
 *
 * Ils n'ajoutent rien a une execution ordinaire, ou aucune de ces commandes n'est
 * autorisee de toute facon. Ils comptent ici, et seulement ici, parce que
 * l'amorcage est le seul cas ou NOX ouvre une famille de programmes plutot que
 * des commandes nommees : une regle `Bash(npm:*)` couvrirait `npm publish` si
 * personne ne le retirait.
 *
 * Un refus l'emporte toujours sur une autorisation — c'est la raison pour
 * laquelle ces entrees peuvent etre plus precises que les autorisations qu'elles
 * decoupent.
 *
 * La derniere famille merite d'etre lue pour ce qu'elle est : une **defense en
 * profondeur**, pas une garantie. Retirer `cat` empeche de lire un `.env` a la
 * main ; cela n'empeche pas un script installe de le lire. Aucune liste de
 * permissions ne le pourrait, et pretendre le contraire serait la pire des
 * garanties.
 */
export const CLAUDE_BOOTSTRAP_DENIED_COMMANDS: readonly string[] = [
  // Escalade de privileges et permissions du systeme de fichiers.
  "sudo",
  "su",
  "doas",
  "chmod",
  "chown",
  // Machines distantes : rien de l'amorcage ne sort de cette machine.
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "nc",
  "netcat",
  "telnet",
  "ftp",
  // Deploiement et infrastructure.
  "docker",
  "podman",
  "kubectl",
  "helm",
  "terraform",
  "pulumi",
  "serverless",
  "aws",
  "gcloud",
  "az",
  "gh",
  "vercel",
  "netlify",
  "heroku",
  "flyctl",
  "railway",
  // Publication de paquets : amorcer un repository n'est pas le publier.
  "npm publish",
  "npm login",
  "npm adduser",
  "npm token",
  "pnpm publish",
  "yarn publish",
  "cargo publish",
  "poetry publish",
  "gem push",
  "twine",
  "mvn deploy",
  "gradle publish",
  "dotnet nuget",
  // Lecture de fichiers hors de l'outil `Read` : c'est par la que passerait un
  // `.env` lu a la main.
  "cat",
  "more",
  "less",
  "head",
  "tail",
  "Get-Content",
  "printenv",
  "env",
  "base64",
  "xxd",
  "strings",
  "od",
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
  const denied = matchDeniedCommand(command, CLAUDE_DENIED_COMMANDS);
  if (denied !== null) {
    return `« ${denied} » ne peut jamais etre autorisee : NOX ne laisse pas un agent modifier Git ni supprimer des fichiers.`;
  }

  return null;
}

/**
 * Retrouve l'entree refusee qui couvre une commande, ou `null`.
 *
 * Une entree couvre la commande exacte et ses arguments — `git commit` couvre
 * `git commit -m x` — mais jamais un programme dont elle serait le prefixe :
 * `env` ne couvre pas `envsubst`. La comparaison se fait sur la commande
 * minusculisee, parce que `Remove-Item` et `remove-item` designent le meme
 * programme.
 */
function matchDeniedCommand(command: string, entries: readonly string[]): string | null {
  const lowered = command.toLowerCase();
  return (
    entries.find(
      (entry) =>
        lowered === entry.toLowerCase() || lowered.startsWith(`${entry.toLowerCase()} `),
    ) ?? null
  );
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
  /**
   * Programmes d'amorcage autorises, pour affichage. Vide hors `BOOTSTRAP`.
   *
   * Distinct de `authorizedCommands` a dessein : une commande de validation est
   * une chose que l'utilisateur a enregistree et que NOX attend ; un programme
   * d'amorcage est une famille ouverte pour la duree d'une execution. Les
   * confondre dans un seul champ ferait afficher « validations configurees » la
   * ou rien n'a ete configure.
   */
  setupPrograms: readonly string[];
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
 *
 * `taskKind` est **exige**, pas devine. Un parametre facultatif se serait oublie
 * dans un appel, et l'oubli n'aurait produit aucune erreur — seulement une
 * execution d'amorcage a nouveau incapable d'installer quoi que ce soit. La
 * nature d'une tache est declaree partout ailleurs dans NOX ; elle l'est ici
 * aussi.
 */
export function buildClaudeToolPolicy(
  validationCommands: readonly string[],
  taskKind: TaskKind,
): ClaudeToolPolicyResult {
  const bootstrap = taskKind === TASK_KIND.BOOTSTRAP;

  // Les refus d'amorcage decoupent les autorisations d'amorcage : les appliquer
  // sans les autorisations correspondantes n'aurait aucun sens, et les appliquer
  // aux commandes enregistrees d'une tache ordinaire changerait un comportement
  // que ce correctif n'a pas a toucher.
  const deniedCommands = bootstrap
    ? [...CLAUDE_DENIED_COMMANDS, ...CLAUDE_BOOTSTRAP_DENIED_COMMANDS]
    : CLAUDE_DENIED_COMMANDS;

  const authorizedCommands: string[] = [];

  for (const command of validationCommands) {
    const reason = checkValidationCommand(command);
    if (reason !== null) {
      return { ok: false, refusal: { command, reason } };
    }

    // Une commande enregistree qui tomberait dans les refus d'amorcage serait
    // autorisee et refusee a la fois. Plutot que de laisser Claude Code trancher
    // au milieu de l'execution, NOX refuse le lancement : une autorisation que la
    // politique contredit n'en est pas une.
    if (bootstrap) {
      const conflict = matchDeniedCommand(command, CLAUDE_BOOTSTRAP_DENIED_COMMANDS);
      if (conflict !== null) {
        return {
          ok: false,
          refusal: {
            command,
            reason:
              `« ${conflict} » ne peut pas etre autorisee pendant un amorcage : NOX ne laisse pas ` +
              "une tache d'amorcage publier, deployer, elever ses privileges ni lire un fichier " +
              "hors de l'outil de lecture.",
          },
        };
      }
    }

    // Les doublons ne sont pas une erreur : ils produiraient simplement une
    // regle repetee, ce qui n'a aucun effet.
    if (!authorizedCommands.includes(command)) {
      authorizedCommands.push(command);
    }
  }

  const setupPrograms = bootstrap ? [...CLAUDE_BOOTSTRAP_SETUP_PROGRAMS] : [];

  const allowed = [
    ...CLAUDE_BASE_ALLOWED_TOOLS,
    ...CLAUDE_GIT_READ_ONLY_COMMANDS.map((command) => formatBashRule(command, true)),
    ...setupPrograms.map((program) => formatBashRule(program, true)),
    ...authorizedCommands.map((command) => formatBashRule(command)),
  ];

  const disallowed = deniedCommands.map((command) => formatBashRule(command, true));

  return { ok: true, policy: { allowed, disallowed, authorizedCommands, setupPrograms } };
}
