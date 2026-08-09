/**
 * Contrat metier de la review d'une execution.
 *
 * Une review NOX repond a deux questions, et seulement a celles-la :
 *
 * 1. **Qu'est-ce que cette execution a change dans le repository ?**
 * 2. **Quelles validations ont reellement tourne, et avec quel resultat ?**
 *
 * ## Un instantane, pas une vue
 *
 * Ce que decrit `RunReviewSnapshot` a ete constate **au moment ou l'execution est
 * devenue finale**, jamais recalcule depuis. C'est la difference entre une review
 * et un `git diff` : le second raconte le present, la premiere raconte ce que
 * l'agent avait produit. Si l'utilisateur edite ensuite un fichier dans son
 * editeur, la review historique ne bouge pas — sinon elle deviendrait un temoignage
 * faux, et un temoignage faux est pire que pas de temoignage.
 *
 * ## Ce qui n'est jamais stocke
 *
 * Aucun blob binaire, aucun fichier entier hors d'un patch borne, aucun contenu de
 * fichier sensible. Un patch est une **trace de relecture**, pas une sauvegarde :
 * le repository, lui, est deja sur le disque de l'utilisateur.
 *
 * Aucune dependance a Prisma, Node ou React : les memes types servent au runner,
 * a la base, au web et aux tests.
 */

import {
  isRunWorkspaceFingerprint,
  type RunWorkspaceFingerprint,
} from "./corrections.js";

/**
 * Nature d'un changement de fichier.
 *
 * Ensemble ferme. `UNTRACKED` merite sa propre valeur plutot que d'etre confondu
 * avec `ADDED` : un fichier ajoute a l'index et un fichier simplement pose dans
 * le dossier de travail ne demandent pas la meme action a la relecture, et NOX
 * ne lance jamais `git add` pour effacer la difference.
 */
export const RUN_CHANGE_TYPE = {
  ADDED: "ADDED",
  MODIFIED: "MODIFIED",
  DELETED: "DELETED",
  RENAMED: "RENAMED",
  COPIED: "COPIED",
  TYPE_CHANGED: "TYPE_CHANGED",
  UNTRACKED: "UNTRACKED",
} as const;

export type RunChangeType = (typeof RUN_CHANGE_TYPE)[keyof typeof RUN_CHANGE_TYPE];

export const RUN_CHANGE_TYPES: readonly RunChangeType[] = Object.values(RUN_CHANGE_TYPE);

/**
 * Etat d'une commande de validation attendue par la tache.
 *
 * `NOT_RUN` est une **information**, pas une absence de donnee : savoir qu'une
 * commande n'a jamais ete lancee vaut autant que de savoir qu'elle a echoue.
 * `UNKNOWN` couvre le cas ou la commande a demarre sans qu'un resultat exploitable
 * soit arrive — flux interrompu, execution annulee, resultat illisible. NOX ne
 * transforme jamais une incertitude en verdict.
 */
export const RUN_VALIDATION_STATUS = {
  NOT_RUN: "NOT_RUN",
  RUNNING: "RUNNING",
  PASSED: "PASSED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
} as const;

export type RunValidationStatus =
  (typeof RUN_VALIDATION_STATUS)[keyof typeof RUN_VALIDATION_STATUS];

export const RUN_VALIDATION_STATUSES: readonly RunValidationStatus[] =
  Object.values(RUN_VALIDATION_STATUS);

/** Etat global derive de l'ensemble des validations d'une execution. */
export const RUN_VALIDATION_SUMMARY = {
  NONE: "NONE",
  PASSED: "PASSED",
  FAILED: "FAILED",
  INCOMPLETE: "INCOMPLETE",
  UNKNOWN: "UNKNOWN",
} as const;

export type RunValidationSummary =
  (typeof RUN_VALIDATION_SUMMARY)[keyof typeof RUN_VALIDATION_SUMMARY];

/**
 * Bornes de la capture de review.
 *
 * Constantes, comme les bornes d'evenements de TASK-010 et pour la meme raison :
 * une limite de securite qu'une variable d'environnement peut desserrer n'en est
 * plus une. Elles ne sont pas la pour economiser du disque — elles sont la pour
 * qu'une execution qui reecrirait un `node_modules/` entier ne remplisse ni la
 * base, ni la memoire du runner, ni la page.
 */
export const REVIEW_LIMITS = {
  /** Fichiers decrits dans la review. Au-dela, seuls les noms manquent. */
  maxFiles: 200,
  /** Patch d'un fichier, en caracteres. */
  patchPerFile: 262_144,
  /** Somme des patches d'une execution, en caracteres. */
  patchTotal: 4_194_304,
  /** Lignes de diff conservees, toutes fichiers confondus. */
  diffLines: 20_000,
  /** Resume de la sortie d'une validation. */
  validationSummary: 8_192,
  /** Chemin relatif d'un fichier. */
  path: 1_024,
  /** Texte d'une commande de validation. */
  command: 500,
} as const;

/** Marque ajoutee a la fin d'un patch coupe. */
export const PATCH_TRUNCATION_NOTICE = "\n[…] Diff tronque par NOX.";

/**
 * Fichiers dont le contenu n'est jamais affiche.
 *
 * ## Ce que cette liste est, et ce qu'elle n'est pas
 *
 * C'est un garde-fou contre la fuite **evidente** : le `.env` qu'un agent aura
 * modifie sans y penser, une cle privee deposee a la racine. Ce n'est pas un
 * scanner de secrets, et NOX n'analyse pas le contenu des fichiers pour deviner
 * ce qu'ils cachent — un tel scanner produirait surtout des faux positifs, et
 * donnerait l'illusion d'une protection qu'il ne peut pas tenir.
 *
 * Le chemin, le type de changement et les statistiques d'un fichier sensible
 * restent visibles : savoir que `.env` a ete modifie est precisement ce qu'il
 * faut apprendre. Seul son contenu disparait.
 */
const SENSITIVE_BASENAMES: readonly string[] = [
  "id_rsa",
  "id_ed25519",
  "credentials.json",
  "secrets.json",
];

/** Extensions dont le contenu est toujours masque. */
const SENSITIVE_EXTENSIONS: readonly string[] = [".pem", ".key"];

/**
 * Exceptions explicites.
 *
 * Un `.env.example` est fait pour etre lu : c'est le seul document qui explique
 * quelles variables existent, et il ne contient par construction aucune valeur.
 * L'exception est nommee, jamais deduite d'un motif.
 */
const SENSITIVE_EXCEPTIONS: readonly string[] = [".env.example", ".env.sample"];

/**
 * Le contenu de ce fichier doit-il rester masque ?
 *
 * La comparaison est insensible a la casse : `.ENV` designe le meme fichier que
 * `.env` sous Windows, et un masquage qu'on contourne en changeant une majuscule
 * ne masque rien.
 */
export function isSensitiveRepositoryPath(path: string): boolean {
  const normalized = path.replace(/\\/gu, "/").trim().toLowerCase();
  if (normalized === "") {
    return false;
  }

  const basename = normalized.split("/").at(-1) ?? normalized;

  if (SENSITIVE_EXCEPTIONS.includes(basename)) {
    return false;
  }
  if (SENSITIVE_BASENAMES.includes(basename)) {
    return true;
  }
  if (basename === ".env" || basename.startsWith(".env.")) {
    return true;
  }
  return SENSITIVE_EXTENSIONS.some((extension) => basename.endsWith(extension));
}

/** Un fichier change, tel que la review le conserve. */
export type RunFileChange = {
  /** Rang stable dans la review, attribue a la capture. */
  position: number;
  /** Chemin relatif au repository, separateurs `/`. Jamais absolu. */
  path: string;
  /** Chemin d'origine, uniquement pour un renommage ou une copie. */
  previousPath: string | null;
  changeType: RunChangeType;
  /** Lignes ajoutees, ou `null` lorsque Git ne les compte pas (binaire). */
  additions: number | null;
  deletions: number | null;
  isBinary: boolean;
  isSensitive: boolean;
  /** Vrai lorsque le patch a ete coupe, ou n'a pas pu etre conserve entier. */
  isTruncated: boolean;
  /** Diff unifie, ou `null` : binaire, sensible, trop volumineux. */
  patch: string | null;
};

/** Une commande de validation attendue, et ce qu'elle est devenue. */
export type RunValidationResultView = {
  position: number;
  /** Texte exact recopie a la creation de l'execution. */
  command: string;
  status: RunValidationStatus;
  /** Code de sortie **rapporte**, jamais deduit. */
  exitCode: number | null;
  /** Resume borne et nettoye de la sortie, lorsqu'il y en a un. */
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

/**
 * Instantane de review d'une execution.
 *
 * `capturedAt` non nul signifie « la capture a eu lieu », y compris lorsqu'elle
 * n'a trouve aucun changement. Une review vide et une review absente sont deux
 * choses differentes, et les confondre inventerait une precision qui n'existe pas.
 */
export type RunReviewSnapshot = {
  capturedAt: string;
  /** Commit de reference : l'etat de depart valide par l'utilisateur. */
  headBefore: string | null;
  /**
   * Vrai lorsque l'etat Git a ete modifie d'une facon interdite pendant
   * l'execution. Le contenu reste affiche, mais il ne decrit plus « ce que
   * l'agent a produit depuis un etat propre ».
   */
  unreliable: boolean;
  files: RunFileChange[];
  /** Fichiers changes mais non decrits, faute de place. */
  omittedFiles: number;
  validations: RunValidationResultView[];
  /**
   * Empreinte opaque du dossier de travail, prise au meme instant.
   *
   * Elle voyage avec la review parce qu'elle decrit **le meme instant** : ce qui
   * a ete relu et ce qui pourra etre repris sont, par construction, le meme etat.
   * Les separer autoriserait un decalage entre les deux, et c'est precisement le
   * decalage que TASK-012 doit rendre impossible.
   *
   * Elle ne quitte jamais le serveur : aucune page, aucun formulaire, aucune
   * reponse d'API ne la rend au navigateur.
   */
  workspace: RunWorkspaceFingerprint;
};

/**
 * Etat global des validations d'une execution.
 *
 * L'ordre des regles est celui de la gravite : un echec eclipse une incertitude,
 * une incertitude eclipse une reussite. Afficher « Passed » alors qu'une commande
 * n'a jamais tourne serait le seul resultat vraiment dangereux de cette fonction.
 */
export function summarizeRunValidations(
  results: readonly { status: RunValidationStatus }[],
): RunValidationSummary {
  if (results.length === 0) {
    return RUN_VALIDATION_SUMMARY.NONE;
  }

  if (results.some((entry) => entry.status === RUN_VALIDATION_STATUS.FAILED)) {
    return RUN_VALIDATION_SUMMARY.FAILED;
  }

  if (
    results.some(
      (entry) =>
        entry.status === RUN_VALIDATION_STATUS.NOT_RUN ||
        entry.status === RUN_VALIDATION_STATUS.RUNNING,
    )
  ) {
    return RUN_VALIDATION_SUMMARY.INCOMPLETE;
  }

  if (results.some((entry) => entry.status === RUN_VALIDATION_STATUS.UNKNOWN)) {
    return RUN_VALIDATION_SUMMARY.UNKNOWN;
  }

  return RUN_VALIDATION_SUMMARY.PASSED;
}

/** Totaux affiches en tete de review. Derives, jamais stockes. */
export type RunReviewTotals = {
  files: number;
  additions: number;
  deletions: number;
  sensitive: number;
  binary: number;
  truncated: number;
};

/**
 * Compte ce que la review contient.
 *
 * Derive a l'affichage plutot que stocke : un compteur denormalise finirait par
 * diverger des lignes qu'il pretend decrire, exactement comme le
 * `lastEventSequence` ecarte par TASK-010.
 */
export function totalRunReview(files: readonly RunFileChange[]): RunReviewTotals {
  let additions = 0;
  let deletions = 0;
  let sensitive = 0;
  let binary = 0;
  let truncated = 0;

  for (const file of files) {
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
    if (file.isSensitive) sensitive += 1;
    if (file.isBinary) binary += 1;
    if (file.isTruncated) truncated += 1;
  }

  return { files: files.length, additions, deletions, sensitive, binary, truncated };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isNullableInteger(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isInteger(value));
}

/**
 * Verifie qu'un objet inconnu est bien un changement de fichier du contrat.
 *
 * Severe volontairement : c'est la derniere barriere avant que du contenu venu
 * d'un processus exterieur n'atteigne la base puis le navigateur. Un chemin
 * absolu est refuse ici, pas corrige — corriger masquerait le fait que le runner
 * a laisse passer quelque chose qu'il ne devait pas produire.
 */
export function isRunFileChange(value: unknown): value is RunFileChange {
  if (!isRecord(value)) {
    return false;
  }

  const path: unknown = value["path"];
  if (typeof path !== "string" || path === "" || path.length > REVIEW_LIMITS.path) {
    return false;
  }
  if (isAbsoluteLikePath(path)) {
    return false;
  }

  const previousPath: unknown = value["previousPath"];
  if (!isNullableString(previousPath)) {
    return false;
  }
  if (typeof previousPath === "string" && isAbsoluteLikePath(previousPath)) {
    return false;
  }

  const changeType: unknown = value["changeType"];
  if (typeof changeType !== "string" || !(RUN_CHANGE_TYPES as string[]).includes(changeType)) {
    return false;
  }

  return (
    typeof value["position"] === "number" &&
    Number.isInteger(value["position"]) &&
    isNullableInteger(value["additions"]) &&
    isNullableInteger(value["deletions"]) &&
    typeof value["isBinary"] === "boolean" &&
    typeof value["isSensitive"] === "boolean" &&
    typeof value["isTruncated"] === "boolean" &&
    isNullableString(value["patch"])
  );
}

/**
 * Un chemin ressemble-t-il a un chemin absolu ou echappant au repository ?
 *
 * Le test porte sur la forme, pas sur le disque : ce module ne connait aucun
 * systeme de fichiers. Il refuse ce qu'un chemin relatif de repository ne peut
 * pas etre — racine POSIX, lettre de lecteur, UNC, ou remontee `..`.
 */
export function isAbsoluteLikePath(path: string): boolean {
  const normalized = path.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || normalized.startsWith("//")) {
    return true;
  }
  if (/^[A-Za-z]:/u.test(normalized)) {
    return true;
  }
  return normalized.split("/").includes("..");
}

/** Verifie qu'un objet inconnu est bien un resultat de validation du contrat. */
export function isRunValidationResultView(value: unknown): value is RunValidationResultView {
  if (!isRecord(value)) {
    return false;
  }

  const status: unknown = value["status"];
  if (
    typeof status !== "string" ||
    !(RUN_VALIDATION_STATUSES as string[]).includes(status)
  ) {
    return false;
  }

  return (
    typeof value["position"] === "number" &&
    Number.isInteger(value["position"]) &&
    typeof value["command"] === "string" &&
    isNullableInteger(value["exitCode"]) &&
    isNullableString(value["summary"]) &&
    isNullableString(value["startedAt"]) &&
    isNullableString(value["finishedAt"])
  );
}

/** Verifie qu'un objet inconnu est bien un instantane de review du contrat. */
export function isRunReviewSnapshot(value: unknown): value is RunReviewSnapshot {
  if (!isRecord(value) || typeof value["capturedAt"] !== "string") {
    return false;
  }

  const files: unknown = value["files"];
  if (!Array.isArray(files) || !files.every(isRunFileChange)) {
    return false;
  }

  const validations: unknown = value["validations"];
  if (!Array.isArray(validations) || !validations.every(isRunValidationResultView)) {
    return false;
  }

  return (
    isNullableString(value["headBefore"]) &&
    typeof value["unreliable"] === "boolean" &&
    typeof value["omittedFiles"] === "number" &&
    Number.isInteger(value["omittedFiles"]) &&
    isRunWorkspaceFingerprint(value["workspace"])
  );
}
