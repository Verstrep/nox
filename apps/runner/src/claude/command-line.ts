/**
 * Construction de la ligne de commande Windows, en un seul endroit.
 *
 * ## Pourquoi ce module existe
 *
 * Sous Windows, un `npm`, un `npx` ou un `gradlew` n'est pas un executable :
 * c'est un script `.cmd` que seul `cmd.exe` sait lancer. Depuis la correction de
 * CVE-2024-27980, Node **refuse** de lancer un `.cmd` sans shell : `spawn` leve
 * `EINVAL`. Passer par `cmd.exe` n'est donc pas un contournement de confort,
 * c'est la seule primitive correcte — et elle a une syntaxe qu'il faut respecter
 * exactement.
 *
 * ## Pourquoi `shell: true` reste exclu
 *
 * `shell: true` demande a Node de **fabriquer** une ligne de commande a partir
 * de chaines, sans que NOX voie ni ne controle le resultat. Ici, c'est l'inverse :
 * NOX ecrit lui-meme la ligne, caractere par caractere, apres avoir verifie
 * chaque jeton. `cmd.exe` est invoque comme n'importe quel programme, avec un
 * argument que ce module a produit.
 *
 * ## Pourquoi la ligne est ecrite a la main plutot que laissee a Node
 *
 * Parce que l'echappement de Node vise le decoupage `argv` du programme cible,
 * pas l'analyseur de `cmd.exe`. Les deux ne coincident pas, et le premier pilote
 * reel l'a montre : avec `/s`, `cmd.exe` retire la premiere et la derniere
 * guillemet de ce qui suit `/c`. Une ligne quottee par Node argument par
 * argument perd donc sa protection, et
 *
 * ```text
 * cmd.exe /d /s /c "C:\Program Files\nodejs\npm.cmd" test
 * ```
 *
 * devient une tentative de lancer `C:\Program`. C'est exactement l'erreur
 * observee. L'idiome correct ajoute une paire exterieure, que `/s` consomme :
 *
 * ```text
 * cmd.exe /d /s /c ""C:\Program Files\nodejs\npm.cmd" "test""
 * ```
 *
 * Cette ligne part en `windowsVerbatimArguments`, c'est-a-dire telle quelle.
 *
 * ## Ce qui rend l'operation sure
 *
 * Deux barrieres, et la seconde ne fait pas confiance a la premiere.
 *
 * 1. Une commande de validation a deja traverse `checkValidationCommand`, dont
 *    l'alphabet — `[A-Za-z0-9 ._-/:=@+]` — ne contient **aucun** metacaractere
 *    de `cmd.exe` : ni `&`, ni `|`, ni `<`, ni `>`, ni `^`, ni `%`, ni
 *    guillemet, ni meme d'antislash.
 * 2. Ce module revalide malgre tout chaque jeton, et **refuse de construire**
 *    une ligne qu'il ne saurait pas rendre inerte. Un refus produit une erreur
 *    d'infrastructure nommee ; il ne produit jamais une ligne approximative.
 *
 * Le seul jeton qui echappe au premier filtre est le chemin de l'executable,
 * que NOX a resolu lui-meme : il peut contenir des espaces
 * (`C:\Program Files\…`) et meme une esperluette (`C:\Claude & Co\…`). Entoure
 * de guillemets, `cmd.exe` le traite litteralement.
 *
 * `%` fait exception et reste refuse : `cmd.exe` developpe `%VAR%` **y compris**
 * a l'interieur des guillemets. C'est le seul caractere qu'une paire de
 * guillemets ne neutralise pas.
 */

/** Guillemet double, seul caractere de citation que `cmd.exe` comprend. */
const QUOTE = '"';

/**
 * Caracteres qu'aucun jeton ne peut porter.
 *
 * - le guillemet romprait la citation ;
 * - `%` serait developpe malgre la citation ;
 * - un caractere de controle ou une fin de ligne couperait la commande.
 */
// eslint-disable-next-line no-control-regex -- ce sont precisement eux qu'on refuse.
const REFUSED_IN_TOKEN = /["%\u0000-\u001F\u007F]/u;

/**
 * Un jeton peut-il figurer dans une ligne `cmd.exe` sans risque ?
 *
 * Un antislash final est refuse : place devant la guillemet fermante, il serait
 * lu comme un echappement par l'analyseur d'arguments du programme cible, et la
 * citation se refermerait un caractere trop loin. Aucun chemin d'executable ne
 * finit par un separateur, et l'alphabet des commandes ne contient pas
 * d'antislash : le refus ne coute rien et ferme le cas.
 */
export function isSafeWindowsToken(token: string): boolean {
  return token !== "" && !REFUSED_IN_TOKEN.test(token) && !token.endsWith("\\");
}

/**
 * Construit la ligne passee a `cmd.exe /d /s /c`, ou `null`.
 *
 * `null` signifie « NOX ne sait pas rendre cette ligne inerte » — un refus
 * explicite, jamais une ligne partiellement echappee. Tous les jetons sont
 * cites, y compris ceux qui n'en auraient pas besoin : une regle uniforme se
 * verifie, une regle conditionnelle s'oublie.
 */
export function buildWindowsCommandLine(
  program: string,
  args: readonly string[],
): string | null {
  const tokens = [program, ...args];
  if (!tokens.every(isSafeWindowsToken)) {
    return null;
  }

  const quoted = tokens.map((token) => `${QUOTE}${token}${QUOTE}`).join(" ");

  // La paire exterieure est celle que `/s` retire. Sans elle, `cmd.exe`
  // retirerait la premiere et la derniere guillemet **utiles**.
  return `${QUOTE}${quoted}${QUOTE}`;
}
