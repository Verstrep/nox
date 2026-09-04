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

  // --- Suppression d'un document ---------------------------------------------
  // La suppression partage le controle de revision de l'edition, mais pas ses
  // suites : une ecriture refusee laisse un texte a reporter, une suppression
  // refusee ne laisse rien du tout. Les deux conflits meritent donc des messages
  // differents, et un code se traduit par un seul message.

  /** Ce document est gere par une tache : la route generique refuse d'y toucher. */
  DOCUMENT_PROTECTED: "DOCUMENT_PROTECTED",
  /** Le fichier a change depuis son affichage : suppression refusee. */
  DOCUMENT_DELETE_CONFLICT: "DOCUMENT_DELETE_CONFLICT",
  /** La suppression a echoue, ou le fichier est toujours la ensuite. */
  DOCUMENT_DELETE_FAILED: "DOCUMENT_DELETE_FAILED",

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
  /**
   * Un document occupe `tasks/<code>.md`, mais NOX ne connait pas sa revision.
   *
   * Distinct d'un conflit : il n'y a rien a comparer. La tache n'a jamais ete
   * synchronisee, un fichier est pourtant apparu, et NOX ne peut pas affirmer
   * qu'il lui appartient. Supprimer sur cette base reviendrait a deviner.
   */
  TASK_DOCUMENT_REVISION_UNKNOWN: "TASK_DOCUMENT_REVISION_UNKNOWN",

  // --- Preflight Git avant execution ----------------------------------------
  // Ces refus protegent la relecture du travail de Claude Code : sans un
  // repository propre et synchronise au depart, il devient impossible de dire
  // ce que l'agent a change et ce qui trainait deja.

  /** L'executable Claude Code est introuvable ou ne repond pas. */
  CLAUDE_NOT_AVAILABLE: "CLAUDE_NOT_AVAILABLE",
  /** Le repository contient des modifications non commitees. */
  REPOSITORY_DIRTY: "REPOSITORY_DIRTY",
  /** `HEAD` est detache : aucune branche courante. */
  GIT_DETACHED_HEAD: "GIT_DETACHED_HEAD",
  /** La branche courante n'a pas d'upstream configure. */
  GIT_UPSTREAM_MISSING: "GIT_UPSTREAM_MISSING",
  /** La branche locale est en avance ou en retard sur son upstream connu. */
  GIT_NOT_SYNCHRONIZED: "GIT_NOT_SYNCHRONIZED",
  /** Une commande Git du preflight a echoue ou expire. */
  GIT_PREFLIGHT_FAILED: "GIT_PREFLIGHT_FAILED",

  // --- Execution de Claude Code ---------------------------------------------

  /** Une execution Claude est deja active : la V1 n'en autorise qu'une. */
  /**
   * Code historique : il signifiait « une execution est active quelque part
   * dans NOX ». Le runner ne l'emet plus depuis TASK-031, ou l'exclusion est
   * devenue repository par repository. Il reste declare parce que des
   * executions anterieures le portent encore dans leur `errorCode`, et qu'une
   * page qui les affiche doit continuer a savoir le traduire.
   */
  CLAUDE_RUN_ALREADY_ACTIVE: "CLAUDE_RUN_ALREADY_ACTIVE",
  /**
   * Une execution est deja active **sur ce repository**.
   *
   * Deux repositories differents peuvent executer Claude Code en meme temps ;
   * un meme repository, jamais. Le refus nomme donc ce qui le motive, au lieu
   * de laisser croire que NOX est occupe ailleurs.
   */
  REPOSITORY_CLAUDE_RUN_ALREADY_ACTIVE: "REPOSITORY_CLAUDE_RUN_ALREADY_ACTIVE",
  /** Le runner ne connait pas cette execution — souvent apres un redemarrage. */
  CLAUDE_RUN_NOT_FOUND: "CLAUDE_RUN_NOT_FOUND",
  /** L'identifiant d'execution n'a pas la forme attendue. */
  CLAUDE_RUN_ID_INVALID: "CLAUDE_RUN_ID_INVALID",
  /** Le prompt est vide, trop volumineux, ou contient un octet interdit. */
  CLAUDE_PROMPT_INVALID: "CLAUDE_PROMPT_INVALID",
  /** Une commande de validation ne peut pas etre autorisee sans risque. */
  CLAUDE_COMMAND_NOT_ALLOWED: "CLAUDE_COMMAND_NOT_ALLOWED",
  /** Le processus Claude Code n'a pas pu etre lance. */
  CLAUDE_START_FAILED: "CLAUDE_START_FAILED",
  /** Le processus s'est termine anormalement. */
  CLAUDE_PROCESS_FAILED: "CLAUDE_PROCESS_FAILED",
  /** La sortie de Claude Code n'est pas le JSON attendu. */
  CLAUDE_OUTPUT_INVALID: "CLAUDE_OUTPUT_INVALID",
  /** L'execution a depasse le delai maximal et a ete arretee. */
  CLAUDE_TIMEOUT: "CLAUDE_TIMEOUT",
  /** Une limite d'utilisation Claude a ete detectee avec une confiance suffisante. */
  CLAUDE_LIMIT_REACHED: "CLAUDE_LIMIT_REACHED",
  /** `HEAD` a change entre le preflight et le lancement. */
  GIT_HEAD_CHANGED: "GIT_HEAD_CHANGED",
  /**
   * La branche courante n'est plus celle de l'execution relue.
   *
   * Distinct de `GIT_HEAD_CHANGED` : un changement de branche se corrige d'un
   * `git switch`, un commit non. Deux causes, deux messages.
   */
  GIT_BRANCH_CHANGED: "GIT_BRANCH_CHANGED",
  /** L'execution a viole les regles Git : commit, changement de branche, sortie du perimetre. */
  GIT_POLICY_VIOLATION: "GIT_POLICY_VIOLATION",

  // --- Annulation d'une execution -------------------------------------------

  /**
   * L'execution a deja atteint un etat final : il n'y a plus rien a arreter.
   *
   * C'est le cas d'une annulation qui arrive trop tard, et il merite un code a
   * lui : l'utilisateur doit comprendre que son clic n'a rien casse, simplement
   * qu'il est arrive apres la fin.
   */
  CLAUDE_RUN_ALREADY_FINISHED: "CLAUDE_RUN_ALREADY_FINISHED",
  /** Une annulation est deja engagee : le second clic ne relance pas l'arret. */
  CLAUDE_RUN_CANCELLING: "CLAUDE_RUN_CANCELLING",
  /**
   * L'arret a ete demande mais NOX n'a pas pu constater la mort du processus.
   *
   * Distinct d'un arret reussi : ici le processus peut encore ecrire dans le
   * repository, et NOX ne peut rien affirmer de son etat.
   */
  CLAUDE_CANCEL_FAILED: "CLAUDE_CANCEL_FAILED",

  // --- Review d'une execution ------------------------------------------------

  /**
   * L'execution n'a pas encore atteint d'etat final : il n'y a rien a relire.
   *
   * La review est un instantane pris **au moment de la finalisation**. Tant que
   * le processus tourne, le repository bouge encore, et capturer maintenant
   * produirait une photo qui ne correspondrait a aucun etat conserve.
   */
  CLAUDE_REVIEW_NOT_READY: "CLAUDE_REVIEW_NOT_READY",
  /**
   * La capture detaillee a echoue : Git indisponible, delai depasse, sortie
   * illisible.
   *
   * Distinct d'un echec d'execution : le resultat de Claude Code, lui, reste
   * valide. Ce code dit seulement que le detail du diff manque.
   */
  CLAUDE_REVIEW_FAILED: "CLAUDE_REVIEW_FAILED",

  // --- Correction ciblee -----------------------------------------------------

  /**
   * Le texte du feedback ne peut pas etre accepte : vide, blanc, trop long, ou
   * porteur d'un octet nul.
   */
  REVIEW_FEEDBACK_INVALID: "REVIEW_FEEDBACK_INVALID",
  /**
   * Ce feedback a deja servi a lancer une correction.
   *
   * Un feedback vaut pour **une** reprise : c'est ce qui rend l'historique
   * lisible — un texte, une correction — et ce qui empeche un double clic de
   * lancer deux fois la meme session.
   */
  REVIEW_FEEDBACK_ALREADY_USED: "REVIEW_FEEDBACK_ALREADY_USED",
  /**
   * Cette execution ne peut pas etre reprise.
   *
   * Statut non final, echec, annulation, absence de session Claude, absence de
   * review, violation Git : autant de raisons, un seul code. Le message affiche
   * precise laquelle.
   */
  REVIEW_NOT_RESUMABLE: "REVIEW_NOT_RESUMABLE",
  /**
   * Le dossier de travail n'est plus celui qui a ete relu.
   *
   * Le refus est volontairement sans echappatoire : reprendre une session sur un
   * etat different attribuerait a la correction des changements dont l'origine
   * serait devenue indeterminable.
   */
  REVIEW_WORKTREE_CHANGED: "REVIEW_WORKTREE_CHANGED",
  /**
   * L'empreinte du dossier de travail n'a pas pu etre calculee ou verifiee.
   *
   * Trop de fichiers, trop d'octets, une entree que NOX ne sait pas representer
   * surement, ou un jeton de runner qui a change depuis la capture. Dans tous
   * les cas, NOX prefere dire qu'il ne sait pas plutot que d'accepter une
   * comparaison partielle.
   */
  WORKSPACE_FINGERPRINT_UNAVAILABLE: "WORKSPACE_FINGERPRINT_UNAVAILABLE",

  // --- Validation autonome ---------------------------------------------------

  /**
   * La commande recue ne peut pas etre executee sans surveillance.
   *
   * Le runner refait la verification que le web a deja faite. Ce n'est pas une
   * redondance : c'est la frontiere qui execute reellement, et elle ne fait
   * confiance a personne — pas meme au serveur web de NOX.
   */
  VALIDATION_COMMAND_REFUSED: "VALIDATION_COMMAND_REFUSED",
  /**
   * La commande n'a pas pu demarrer.
   *
   * Programme introuvable, droits insuffisants, `spawn` refuse. Distinct d'un
   * code de sortie non nul : ici, aucune preuve n'a ete obtenue.
   */
  VALIDATION_SPAWN_FAILED: "VALIDATION_SPAWN_FAILED",

  // --- Livraison Git ---------------------------------------------------------
  //
  // Ces codes couvrent les seules ecritures Git que NOX sait faire : preparer
  // des chemins exacts, creer un commit, pousser vers l'upstream deja
  // configure. Il n'existe aucun code de restauration, de nettoyage ou de
  // changement de branche — parce qu'il n'existe aucune commande de ce genre.

  /**
   * Le repository ne correspond plus au candidat valide.
   *
   * Empreinte, branche, `HEAD` : l'un des trois a bouge depuis la validation.
   * Le refus est sans echappatoire — livrer un etat different reviendrait a
   * commiter du code que personne n'a relu.
   */
  DELIVERY_REPOSITORY_CHANGED: "DELIVERY_REPOSITORY_CHANGED",
  /** L'index porte deja des changements prepares a la main. */
  DELIVERY_INDEX_NOT_EMPTY: "DELIVERY_INDEX_NOT_EMPTY",
  /** Git ne connait ni nom, ni adresse : NOX n'en configure aucun. */
  DELIVERY_IDENTITY_MISSING: "DELIVERY_IDENTITY_MISSING",
  /** La preparation des chemins exacts a echoue. */
  DELIVERY_STAGING_FAILED: "DELIVERY_STAGING_FAILED",
  /**
   * Ce qui a ete prepare ne correspond pas au candidat.
   *
   * Distinct d'un echec de preparation : ici Git a repondu, et ce qu'il a mis
   * dans l'index n'est pas ce que la livraison decrivait. Aucun commit n'est
   * cree sur cette base.
   */
  DELIVERY_STAGED_MISMATCH: "DELIVERY_STAGED_MISMATCH",
  /** `git commit` a echoue : hook en echec, signature refusee, erreur Git. */
  DELIVERY_COMMIT_FAILED: "DELIVERY_COMMIT_FAILED",
  /**
   * Le commit existe, mais l'etat obtenu n'est pas celui attendu.
   *
   * NOX ne pretend pas que la livraison a reussi, et ne defait rien : le commit
   * reste, et un humain decide. Un `reset` automatique detruirait justement ce
   * qu'il faut relire.
   */
  DELIVERY_TREE_MISMATCH: "DELIVERY_TREE_MISMATCH",
  /**
   * Le serveur distant a refuse le push : l'historique a diverge.
   *
   * NOX ne force jamais, ne tire jamais, ne fusionne jamais et ne rebase
   * jamais. Reconcilier deux histoires est une decision humaine.
   */
  DELIVERY_PUSH_REJECTED: "DELIVERY_PUSH_REJECTED",
  /** Le push a echoue pour une autre raison : reseau, authentification, delai. */
  DELIVERY_PUSH_FAILED: "DELIVERY_PUSH_FAILED",

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

/** Longueur maximale d'un detail d'erreur du runner. */
export const RUNNER_ERROR_DETAIL_LIMIT = 300;

/**
 * Reponse d'echec commune a toutes les routes du runner.
 *
 * ## Le detail, et ce qu'il ne peut pas etre
 *
 * `code` reste l'autorite : stable, ferme, et seul a decider de quoi que ce
 * soit. `detail` ne fait que **nommer** ce que le code laisse ambigu — un
 * programme introuvable et un lancement refuse par le systeme partagent le meme
 * code, et l'un se corrige en installant un outil, l'autre pas.
 *
 * Il est facultatif, et il l'est pour de bon : une reponse sans detail est une
 * reponse normale, et l'interface doit rester lisible sans lui. Il ne porte
 * jamais de chemin absolu, de variable d'environnement, de trace d'exception ni
 * de fragment de jeton — les routes qui en produisent un l'ecrivent elles-memes,
 * elles ne recopient pas un message du systeme.
 */
export type RunnerErrorResponse = {
  ok: false;
  error: { code: RunnerErrorCode; detail?: string };
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
  if (!isRecord(error) || !isRunnerErrorCode(error["code"])) {
    return false;
  }
  // Un detail present doit etre une chaine ; un detail d'une autre forme rend la
  // reponse invalide plutot que d'etre ignore en silence.
  const detail: unknown = error["detail"];
  return detail === undefined || typeof detail === "string";
}

/**
 * Detail d'erreur, borne et debarrasse de ses caracteres de controle.
 *
 * Applique a l'ecriture comme a la lecture : ce qui traverse le reseau est deja
 * ce qui peut etre affiche, et aucune couche n'a a s'en souvenir.
 */
export function boundErrorDetail(detail: string): string | null {
  const cleaned = detail
    // eslint-disable-next-line no-control-regex -- c'est precisement ce qu'on retire.
    .replace(/[\u0000-\u001F\u007F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") {
    return null;
  }
  return cleaned.length <= RUNNER_ERROR_DETAIL_LIMIT
    ? cleaned
    : `${cleaned.slice(0, RUNNER_ERROR_DETAIL_LIMIT - 2).trim()} …`;
}

/** Verifie qu'une reponse JSON est une resolution de repository reussie. */
export function isResolveRepositorySuccess(value: unknown): value is ResolveRepositorySuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  const repository: unknown = value["repository"];
  return isRecord(repository) && typeof repository["canonicalPath"] === "string";
}
