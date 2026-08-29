/**
 * Identite canonique d'un repository, pour l'exclusion d'execution.
 *
 * ## Le probleme que ce module resout
 *
 * Depuis TASK-031, deux repositories differents peuvent executer Claude Code en
 * meme temps. Ce qui reste interdit, c'est **deux executions actives sur le meme
 * repository** : elles se marcheraient dessus des la premiere ecriture, et
 * aucune relecture ne serait possible ensuite.
 *
 * La question n'est donc plus « y a-t-il une execution quelque part ? » mais
 * « y a-t-il une execution *ici* ? ». Et « ici » ne peut pas etre un identifiant
 * de projet : deux projets peuvent viser le meme dossier — normalement pas, mais
 * une base modifiee a la main ou une course de creation le rendent possible, et
 * la securite d'execution ne doit pas dependre d'un invariant applicatif.
 *
 * ## Ce que ce module est, et ce qu'il n'est pas
 *
 * C'est une **cle de comparaison**, pas un chemin. Elle ne sert jamais a ouvrir
 * un fichier, jamais a lancer un processus, jamais a etre affichee : uniquement
 * a repondre « ces deux chemins designent-ils le meme repository ? ».
 *
 * Ce n'est pas un moteur de systeme de fichiers, et ce n'est pas la seule
 * defense. La canonisation reelle — celle qui suit les liens et retablit la
 * casse veritable — appartient au runner, seul composant qui voit le disque :
 * `resolveRepository` a la creation du projet, `resolveRepositoryRoot` a chaque
 * execution. Les chemins qui arrivent ici en sortent deja. Ce module ferme ce
 * qu'une comparaison de chaines laisserait passer malgre tout : un separateur
 * final, un separateur inverse, un segment `.` ou `..` residuel, une difference
 * de casse sous Windows.
 *
 * ## Pourquoi ici, et sans Node
 *
 * Parce que les deux cotes en ont besoin : le web pour refuser une seconde
 * execution en base, le runner pour refuser un second processus. Une seule
 * implementation, exactement comme pour l'empreinte du dossier de travail.
 * `packages/shared` ne peut importer ni `node:path`, ni quoi que ce soit
 * d'autre : la normalisation ci-dessous est donc purement textuelle, ce qui la
 * rend aussi identique sur les deux plateformes.
 */

/** Antislash, ecrit par son code : une constante ne peut pas etre mal echappee. */
const BACKSLASH = String.fromCharCode(92);

/** Un chemin est-il ecrit a la maniere de Windows ? */
function isWindowsStyle(value: string): boolean {
  // Une lettre de lecteur suivie d'un separateur, ou un prefixe UNC.
  const separator = `[${BACKSLASH}${BACKSLASH}/]`;
  const drive = new RegExp(`^[A-Za-z]:${separator}`, "u");
  const unc = new RegExp(`^${separator}{2}[^${BACKSLASH}${BACKSLASH}/]`, "u");
  return drive.test(value) || unc.test(value);
}

/**
 * Reduit `.` et `..` sans jamais remonter au-dessus de la racine.
 *
 * Les chemins recus sont deja resolus par le systeme ; ce passage existe pour
 * qu'une valeur qui aurait echappe a cette resolution ne produise pas une cle
 * differente d'un chemin equivalent.
 */
function collapseSegments(segments: readonly string[]): string[] {
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack;
}

function windowsKey(value: string): string {
  const unified = value.split("/").join(BACKSLASH);

  // Prefixe UNC : les deux premiers separateurs font partie de la racine, et les
  // reduire ferait d'un partage reseau un chemin absolu ordinaire.
  const unc = unified.startsWith(BACKSLASH + BACKSLASH);
  const body = unc ? unified.slice(2) : unified;
  const parts = body.split(BACKSLASH).filter((segment) => segment !== "");

  // La racine est mise de cote **avant** la reduction. Sans cela, un `..` de
  // trop mangerait la lettre de lecteur : `D:\..\..\x` et `C:\..\..\x`
  // rendraient la meme cle, et deux repositories differents partageraient un
  // seul verrou.
  const rootLength = unc ? 2 : 1;
  const root = parts.slice(0, rootLength);
  const segments = collapseSegments(parts.slice(rootLength));

  // La casse ne distingue rien sous Windows : `D:\Repo` et `d:\repo` sont le
  // meme dossier, et deux cles differentes y autoriseraient deux executions.
  const joined = [...root, ...segments].join(BACKSLASH).toLowerCase();
  return unc ? BACKSLASH + BACKSLASH + joined : joined;
}

function posixKey(value: string): string {
  const segments = collapseSegments(value.split("/"));
  // La casse est conservee : sur un systeme sensible a la casse, `/srv/Repo` et
  // `/srv/repo` sont deux dossiers, et les confondre bloquerait a tort le second.
  return `/${segments.join("/")}`;
}

/**
 * Cle de comparaison d'un repository.
 *
 * Deux chemins qui designent le meme repository rendent la meme cle ; deux
 * repositories distincts rendent deux cles distinctes. La valeur retournee n'est
 * **pas** un chemin utilisable : ne jamais s'en servir pour lire, ecrire ou
 * lancer quoi que ce soit.
 *
 * Une valeur vide rend une cle vide. C'est volontaire : l'appelant ne doit pas
 * avoir a distinguer un cas d'erreur, et une cle vide ne peut correspondre qu'a
 * une autre cle vide — jamais a un repository reel.
 */
export function repositoryLockKey(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed === "") {
    return "";
  }
  return isWindowsStyle(trimmed) ? windowsKey(trimmed) : posixKey(trimmed);
}

/**
 * Ces deux chemins designent-ils le meme repository ?
 *
 * Deux chemins vides ne sont **pas** consideres comme le meme repository : sans
 * chemin, il n'y a pas de repository a partager, et repondre `true` ferait de
 * deux absences une exclusion mutuelle.
 */
export function sameRepository(left: string, right: string): boolean {
  const key = repositoryLockKey(left);
  return key !== "" && key === repositoryLockKey(right);
}
