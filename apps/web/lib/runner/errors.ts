/**
 * Traduction des echecs du runner en messages destines a l'utilisateur.
 *
 * Le runner ne renvoie que des codes ; toute la formulation vit ici. Aucun
 * message ne contient l'URL du runner, le jeton, ni un detail technique.
 */

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

export type RunnerFailure =
  /** Ni `NOX_RUNNER_TOKEN` ni configuration exploitable cote web. */
  | { kind: "not_configured" }
  /** Aucune connexion possible : runner arrete, port different, pare-feu. */
  | { kind: "unreachable" }
  /** Le runner n'a pas repondu dans le delai imparti. */
  | { kind: "timeout" }
  /** Le runner a refuse le jeton : les deux processus n'ont pas la meme valeur. */
  | { kind: "unauthorized" }
  /** Reponse illisible ou ne respectant pas le contrat partage. */
  | { kind: "invalid_response" }
  /** Echec metier remonte par le runner, avec son code stable. */
  | { kind: "runner_error"; code: RunnerErrorCode };

export type RunnerResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; failure: RunnerFailure };

const RUNNER_UNAVAILABLE_MESSAGE =
  "Le runner local ne repond pas. Demarrez-le dans un autre terminal avec « npm run dev:runner », puis reessayez.";

const GENERIC_RUNNER_ERROR_MESSAGE =
  "Le runner a refuse la demande. Consultez les logs du runner pour le detail.";

const CODE_MESSAGES: Record<RunnerErrorCode, string> = {
  [RUNNER_ERROR.PATH_REQUIRED]: "Indiquez le chemin du repository Git local.",
  [RUNNER_ERROR.PATH_NOT_ABSOLUTE]:
    "Le chemin doit etre absolu (par exemple D:\\Projets\\mon-projet).",
  [RUNNER_ERROR.PATH_NOT_FOUND]: "Ce chemin n'existe pas sur cette machine.",
  [RUNNER_ERROR.PATH_NOT_DIRECTORY]: "Ce chemin pointe vers un fichier : indiquez un dossier.",
  [RUNNER_ERROR.NOT_A_GIT_REPOSITORY]: "Ce dossier n'appartient a aucun repository Git.",
  [RUNNER_ERROR.GIT_NOT_AVAILABLE]:
    "Git est introuvable sur cette machine. Installez Git et verifiez qu'il est dans le PATH.",
  [RUNNER_ERROR.GIT_TIMEOUT]: "Git n'a pas repondu dans le delai imparti.",

  // --- Documents ------------------------------------------------------------
  [RUNNER_ERROR.REPOSITORY_NOT_FOUND]:
    "Le repository de ce projet est introuvable. Il a peut-etre ete deplace ou supprime depuis son enregistrement.",
  [RUNNER_ERROR.REPOSITORY_NOT_DIRECTORY]:
    "Le chemin enregistre pour ce projet ne designe plus un dossier.",
  [RUNNER_ERROR.DOCUMENT_NOT_FOUND]:
    "Ce document n'existe plus dans le repository. Il a peut-etre ete supprime ou renomme.",
  [RUNNER_ERROR.DOCUMENT_NOT_FILE]: "Cet emplacement designe un dossier, pas un document.",
  [RUNNER_ERROR.DOCUMENT_NOT_MARKDOWN]: "Seuls les fichiers Markdown (.md) peuvent etre ouverts.",
  [RUNNER_ERROR.DOCUMENT_NOT_ALLOWED]:
    "Ce document se trouve hors des emplacements inspectes par NOX (racine, docs/, decisions/, plans/, tasks/).",
  [RUNNER_ERROR.DOCUMENT_TOO_LARGE]:
    "Ce document depasse la taille maximale lisible (1 Mio). Ouvrez-le dans votre editeur.",
  [RUNNER_ERROR.DOCUMENT_NOT_UTF8]:
    "Ce fichier n'est pas du texte UTF-8 valide. NOX ne tente pas de deviner son encodage.",
  [RUNNER_ERROR.DOCUMENT_READ_FAILED]:
    "La lecture de ce document a echoue. Verifiez qu'il n'est pas verrouille par un autre programme.",
  [RUNNER_ERROR.TOO_MANY_DOCUMENTS]:
    "Ce repository contient trop de documents Markdown pour etre inventorie (limite : 500).",

  // Ces codes traduisent un desaccord de contrat entre le web et le runner :
  // l'utilisateur ne peut rien y faire, seul le message generique a du sens.
  [RUNNER_ERROR.UNAUTHORIZED]:
    "Le runner a refuse l'authentification. Verifiez que NOX_RUNNER_TOKEN est identique pour le runner et pour l'application web.",
  [RUNNER_ERROR.INVALID_JSON]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.INVALID_REQUEST]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.PAYLOAD_TOO_LARGE]: "Le chemin transmis est trop long.",
  [RUNNER_ERROR.UNSUPPORTED_MEDIA_TYPE]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.ROUTE_NOT_FOUND]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.METHOD_NOT_ALLOWED]: GENERIC_RUNNER_ERROR_MESSAGE,
  // Ces trois codes signalent une demande que l'interface n'aurait pas du
  // emettre : l'utilisateur ne peut rien y faire.
  [RUNNER_ERROR.REPOSITORY_PATH_REQUIRED]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.DOCUMENT_PATH_REQUIRED]: "Aucun document selectionne.",
  [RUNNER_ERROR.DOCUMENT_PATH_INVALID]: "Ce chemin de document n'est pas valide.",
  [RUNNER_ERROR.DOCUMENT_OUTSIDE_REPOSITORY]:
    "Ce document se trouve hors du repository du projet : NOX refuse de le lire.",
  [RUNNER_ERROR.INTERNAL_ERROR]:
    "Le runner a rencontre une erreur interne. Consultez ses logs pour le detail.",
};

/** Message affichable pour un echec, sans aucune information sensible. */
export function describeRunnerFailure(failure: RunnerFailure): string {
  switch (failure.kind) {
    case "not_configured":
      return (
        "Le runner n'est pas configure : definissez NOX_RUNNER_TOKEN dans le fichier .env " +
        "a la racine du projet, avec la meme valeur pour le runner et pour l'application web."
      );
    case "unreachable":
      return RUNNER_UNAVAILABLE_MESSAGE;
    case "timeout":
      return "Le runner n'a pas repondu dans le delai imparti. Verifiez qu'il fonctionne toujours.";
    case "unauthorized":
      return CODE_MESSAGES[RUNNER_ERROR.UNAUTHORIZED];
    case "invalid_response":
      return "Le runner a renvoye une reponse inattendue. Verifiez que le runner et l'application web sont a la meme version.";
    case "runner_error":
      return CODE_MESSAGES[failure.code];
  }
}

/**
 * Indique si l'echec traduit une indisponibilite du runner plutot qu'un
 * probleme de saisie. Sert a choisir ou afficher le message dans le formulaire.
 */
export function isRunnerUnavailable(failure: RunnerFailure): boolean {
  return (
    failure.kind === "not_configured" ||
    failure.kind === "unreachable" ||
    failure.kind === "timeout" ||
    failure.kind === "unauthorized" ||
    failure.kind === "invalid_response"
  );
}
