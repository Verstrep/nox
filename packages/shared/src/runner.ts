/**
 * Contrat HTTP entre l'application web et le runner local.
 *
 * Ce fichier est la seule source de verite des codes d'erreur et des formes de
 * messages echangees. Le runner les produit, le web les consomme : aucun des
 * deux ne redeclare la liste.
 *
 * Les codes sont volontairement **independants des messages affiches** : le
 * runner ne renvoie jamais de texte destine a l'utilisateur, c'est le web qui
 * traduit chaque code en phrase comprehensible.
 */

import { createStatusGuard } from "./statuses.js";

/** Nom de service annonce par le runner. */
export const RUNNER_SERVICE_NAME = "nox-runner";

/** Codes d'erreur stables du runner. */
export const RUNNER_ERROR = {
  /** Le corps de la requete n'est pas du JSON valide. */
  INVALID_JSON: "INVALID_JSON",
  /** Le corps est du JSON valide mais ne respecte pas la forme attendue. */
  INVALID_REQUEST: "INVALID_REQUEST",
  /** Le corps depasse la taille maximale acceptee. */
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  /** `Content-Type` absent ou different de `application/json`. */
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  /** Route inconnue. */
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  /** Route connue, methode HTTP non supportee. */
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  /** Jeton absent, mal forme ou incorrect. */
  UNAUTHORIZED: "UNAUTHORIZED",

  /** Chemin absent ou vide. */
  PATH_REQUIRED: "PATH_REQUIRED",
  /** Chemin relatif. */
  PATH_NOT_ABSOLUTE: "PATH_NOT_ABSOLUTE",
  /** Chemin inexistant sur la machine du runner. */
  PATH_NOT_FOUND: "PATH_NOT_FOUND",
  /** Chemin pointant vers un fichier et non un dossier. */
  PATH_NOT_DIRECTORY: "PATH_NOT_DIRECTORY",
  /** Dossier n'appartenant a aucun repository Git. */
  NOT_A_GIT_REPOSITORY: "NOT_A_GIT_REPOSITORY",
  /** Binaire Git introuvable sur la machine du runner. */
  GIT_NOT_AVAILABLE: "GIT_NOT_AVAILABLE",
  /** Git n'a pas repondu dans le delai imparti. */
  GIT_TIMEOUT: "GIT_TIMEOUT",

  // --- Documents Markdown ---------------------------------------------------
  // Les codes `REPOSITORY_*` doublent en apparence les codes `PATH_*` ci-dessus,
  // mais ils repondent a une question differente : `PATH_*` concerne un chemin
  // que l'utilisateur vient de saisir, `REPOSITORY_*` un repository deja
  // enregistre qui a depuis ete deplace ou supprime. Les messages affiches n'ont
  // rien a voir, d'ou deux familles distinctes.

  /** Le chemin du repository est absent du corps de la requete. */
  REPOSITORY_PATH_REQUIRED: "REPOSITORY_PATH_REQUIRED",
  /** Le repository enregistre n'existe plus a l'emplacement connu. */
  REPOSITORY_NOT_FOUND: "REPOSITORY_NOT_FOUND",
  /** Le chemin enregistre ne designe plus un dossier. */
  REPOSITORY_NOT_DIRECTORY: "REPOSITORY_NOT_DIRECTORY",

  /** Le chemin de document est absent ou vide. */
  DOCUMENT_PATH_REQUIRED: "DOCUMENT_PATH_REQUIRED",
  /** Chemin mal forme : absolu, URL, ou contenant une remontee `..`. */
  DOCUMENT_PATH_INVALID: "DOCUMENT_PATH_INVALID",
  /** Apres resolution reelle, le fichier sort de la racine du repository. */
  DOCUMENT_OUTSIDE_REPOSITORY: "DOCUMENT_OUTSIDE_REPOSITORY",
  /** Chemin valide mais hors des emplacements inspectes par NOX. */
  DOCUMENT_NOT_ALLOWED: "DOCUMENT_NOT_ALLOWED",
  /** Aucun fichier a cet emplacement. */
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  /** L'emplacement designe un dossier, pas un fichier. */
  DOCUMENT_NOT_FILE: "DOCUMENT_NOT_FILE",
  /** L'extension n'est pas `.md`. */
  DOCUMENT_NOT_MARKDOWN: "DOCUMENT_NOT_MARKDOWN",
  /** Le fichier depasse la taille maximale lisible. */
  DOCUMENT_TOO_LARGE: "DOCUMENT_TOO_LARGE",
  /** Le contenu n'est pas de l'UTF-8 valide. */
  DOCUMENT_NOT_UTF8: "DOCUMENT_NOT_UTF8",
  /** Lecture impossible : droits insuffisants, verrou, erreur disque. */
  DOCUMENT_READ_FAILED: "DOCUMENT_READ_FAILED",
  /** L'inventaire depasse le nombre maximal de documents. */
  TOO_MANY_DOCUMENTS: "TOO_MANY_DOCUMENTS",

  // --- Ecriture d'un document ------------------------------------------------
  // L'edition n'ajoute pas seulement une operation : elle ajoute une classe
  // d'echecs absente de la lecture, ou l'etat du disque a change entre le moment
  // ou l'utilisateur a ouvert le document et celui ou il l'enregistre.

  /** La revision attendue est absente du corps de la requete. */
  DOCUMENT_REVISION_REQUIRED: "DOCUMENT_REVISION_REQUIRED",
  /** La revision attendue n'a pas la forme d'une empreinte SHA-256. */
  DOCUMENT_REVISION_INVALID: "DOCUMENT_REVISION_INVALID",
  /** Le fichier a change sur le disque depuis sa lecture : ecriture refusee. */
  DOCUMENT_CONFLICT: "DOCUMENT_CONFLICT",
  /** Le contenu soumis ne peut pas etre encode en UTF-8 valide. */
  DOCUMENT_CONTENT_INVALID: "DOCUMENT_CONTENT_INVALID",
  /** La cible de l'ecriture est un lien symbolique : NOX refuse de la suivre. */
  DOCUMENT_SYMLINK_NOT_WRITABLE: "DOCUMENT_SYMLINK_NOT_WRITABLE",
  /** Le fichier temporaire n'a pas pu etre ecrit : le document est inchange. */
  DOCUMENT_TEMPORARY_FILE_FAILED: "DOCUMENT_TEMPORARY_FILE_FAILED",
  /** Le remplacement du document a echoue : verrou, droits, erreur disque. */
  DOCUMENT_WRITE_FAILED: "DOCUMENT_WRITE_FAILED",

  // --- Creation d'un document ------------------------------------------------
  // La creation ne partage pas les risques de l'edition. Son enjeu n'est pas la
  // concurrence sur un contenu, mais l'existence : un fichier deja present ne
  // doit jamais disparaitre sous une creation, et aucun dossier ne doit
  // apparaitre sans qu'on l'ait demande.

  /** Un fichier occupe deja cet emplacement : la creation est refusee. */
  DOCUMENT_ALREADY_EXISTS: "DOCUMENT_ALREADY_EXISTS",
  /** Un dossier parent du chemin demande n'existe pas ; NOX n'en cree aucun. */
  DOCUMENT_PARENT_NOT_FOUND: "DOCUMENT_PARENT_NOT_FOUND",
  /** Un parent existe mais n'est pas un dossier. */
  DOCUMENT_PARENT_NOT_DIRECTORY: "DOCUMENT_PARENT_NOT_DIRECTORY",
  /** Un parent est un lien : NOX refuse d'ecrire a travers un lien de dossier. */
  DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED: "DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED",
  /** Le nom demande ne serait pas portable entre systemes de fichiers. */
  DOCUMENT_NAME_NOT_PORTABLE: "DOCUMENT_NAME_NOT_PORTABLE",
  /** La creation a echoue : droits, disque plein, erreur systeme. */
  DOCUMENT_CREATION_FAILED: "DOCUMENT_CREATION_FAILED",

  // --- Document d'une tache --------------------------------------------------
  // Seule famille d'erreurs liee a une route qui a le droit de creer un dossier.
  // Ce droit est limite a `tasks/`, a la racine du repository, et il s'accompagne
  // de trois refus explicites : le nom peut etre pris par un fichier, par un
  // lien, ou la creation peut simplement echouer.

  /** `taskCode` ne respecte pas la forme `TASK-` suivi d'au moins trois chiffres. */
  TASK_CODE_INVALID: "TASK_CODE_INVALID",
  /** `tasks` existe mais designe un fichier : NOX ne le remplace pas. */
  TASKS_DIRECTORY_NOT_DIRECTORY: "TASKS_DIRECTORY_NOT_DIRECTORY",
  /** `tasks` est un lien ou une jonction : NOX n'ecrit pas au travers. */
  TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED: "TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED",
  /** La creation du dossier `tasks/` a echoue : droits, disque, erreur systeme. */
  TASKS_DIRECTORY_CREATION_FAILED: "TASKS_DIRECTORY_CREATION_FAILED",

  /** Defaillance non prevue du runner. */
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type RunnerErrorCode = (typeof RUNNER_ERROR)[keyof typeof RUNNER_ERROR];

export const RUNNER_ERROR_CODES: readonly RunnerErrorCode[] = Object.values(RUNNER_ERROR);

export const isRunnerErrorCode = createStatusGuard(RUNNER_ERROR_CODES);

/** Reponse de `GET /health`. */
export type RunnerHealthResponse = {
  service: typeof RUNNER_SERVICE_NAME;
  status: "ok";
  version: string;
};

/** Corps attendu par `POST /repositories/resolve`. */
export type ResolveRepositoryRequest = {
  repositoryPath: string;
};

/** Reponse de `POST /repositories/resolve` en cas de succes. */
export type ResolveRepositorySuccess = {
  ok: true;
  repository: {
    canonicalPath: string;
  };
};

/** Reponse d'echec commune a toutes les routes du runner. */
export type RunnerErrorResponse = {
  ok: false;
  error: { code: RunnerErrorCode };
};

export type ResolveRepositoryResponse = ResolveRepositorySuccess | RunnerErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Valide le corps recu par `POST /repositories/resolve`.
 * Retourne `null` si la forme n'est pas celle attendue.
 */
export function parseResolveRepositoryRequest(value: unknown): ResolveRepositoryRequest | null {
  if (!isRecord(value) || typeof value["repositoryPath"] !== "string") {
    return null;
  }
  return { repositoryPath: value["repositoryPath"] };
}

/** Verifie qu'une reponse JSON est bien une reponse de sante du runner. */
export function isRunnerHealthResponse(value: unknown): value is RunnerHealthResponse {
  return (
    isRecord(value) &&
    value["service"] === RUNNER_SERVICE_NAME &&
    value["status"] === "ok" &&
    typeof value["version"] === "string"
  );
}

/** Verifie qu'une reponse JSON est une erreur structuree du runner. */
export function isRunnerErrorResponse(value: unknown): value is RunnerErrorResponse {
  if (!isRecord(value) || value["ok"] !== false) {
    return false;
  }
  const error: unknown = value["error"];
  return isRecord(error) && isRunnerErrorCode(error["code"]);
}

/** Verifie qu'une reponse JSON est une resolution de repository reussie. */
export function isResolveRepositorySuccess(value: unknown): value is ResolveRepositorySuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  const repository: unknown = value["repository"];
  return isRecord(repository) && typeof repository["canonicalPath"] === "string";
}
