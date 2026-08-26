/**
 * Contrat web <-> runner pour l'execution d'une validation autonome.
 *
 * ## Ce que le corps transporte, et ce qu'il ne transporte pas
 *
 * Un chemin de repository et une commande. **Pas** de vecteur d'arguments deja
 * decoupe — le runner le refait lui-meme —, pas d'environnement, pas de shell,
 * pas de delai negociable. Le delai est une constante partagee, pas une valeur
 * recue : une borne de securite qu'un appelant peut desserrer n'en est plus une.
 *
 * ## Le navigateur n'appelle jamais cette route
 *
 * Comme toutes les routes du runner. Le serveur web relit la tache, relit son
 * plan, en deduit les commandes, et les envoie une par une. Un client forge ne
 * peut donc pas transformer « npm test » en autre chose : il n'a aucun moyen de
 * faire parvenir une commande jusqu'ici.
 *
 * ## La double validation est voulue
 *
 * Le web verifie la politique avant d'appeler ; le runner la reverifie avant
 * d'executer. C'est la meme discipline que pour les permissions de Claude Code :
 * la frontiere qui touche reellement la machine ne fait confiance a personne.
 */

import { AUTONOMOUS_VALIDATION_OUTPUT_LIMIT } from "./verification.js";

/** Corps de `POST /repositories/validations/run`. */
export type RunValidationRequest = {
  /** Chemin du repository, relu en base par le serveur web. */
  repositoryPath: string;
  /** Commande exacte, deja validee cote web et revalidee ici. */
  command: string;
};

/**
 * Ce qu'une commande a rendu.
 *
 * `timedOut` est un champ a part plutot qu'un code de sortie conventionnel :
 * un processus tue n'a pas de code de sortie qui veuille dire quelque chose, et
 * en inventer un ferait passer une interruption pour un resultat.
 */
export type RunValidationSuccess = {
  ok: true;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stdoutTruncated: boolean;
  stderr: string;
  stderrTruncated: boolean;
};

/** Limite de taille appliquee a chaque flux, avant transport. */
export const VALIDATION_OUTPUT_LIMIT = AUTONOMOUS_VALIDATION_OUTPUT_LIMIT;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valide le corps recu par `POST /repositories/validations/run`.
 *
 * Deux chaines, et rien d'autre. Un `cwd`, un `env`, un `timeout` ou un `shell`
 * glisses dans la requete n'ont aucune facon d'atteindre la suite du programme :
 * ils ne sont pas lus.
 */
export function parseRunValidationRequest(value: unknown): RunValidationRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const repositoryPath: unknown = value["repositoryPath"];
  const command: unknown = value["command"];
  if (typeof repositoryPath !== "string" || typeof command !== "string") {
    return null;
  }
  if (repositoryPath.trim() === "" || command.trim() === "") {
    return null;
  }
  return { repositoryPath, command };
}

/** Verifie qu'une reponse JSON est une execution de validation reussie. */
export function isRunValidationSuccess(value: unknown): value is RunValidationSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  const exitCode: unknown = value["exitCode"];
  return (
    (exitCode === null || (typeof exitCode === "number" && Number.isInteger(exitCode))) &&
    typeof value["timedOut"] === "boolean" &&
    typeof value["durationMs"] === "number" &&
    typeof value["stdout"] === "string" &&
    typeof value["stdoutTruncated"] === "boolean" &&
    typeof value["stderr"] === "string" &&
    typeof value["stderrTruncated"] === "boolean"
  );
}

/**
 * Borne un flux, et dit qu'il l'a fait.
 *
 * La troncature n'est jamais silencieuse : la sortie gardee est suivie de sa
 * marque, et le drapeau accompagne le resultat jusqu'a l'ecran. Une sortie
 * coupee sans le dire ferait chercher une erreur dans les lignes manquantes.
 */
export function boundOutput(
  text: string,
  limit: number = VALIDATION_OUTPUT_LIMIT,
): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  // La fin est conservee plutot que le debut : c'est la ou un outil de test
  // ecrit son resume et ses echecs.
  return { text: text.slice(text.length - limit), truncated: true };
}

/** Corps de `POST /repositories/validations/state`. */
export type TrackedStateRequest = { repositoryPath: string };

/** Chemins nommes au plus dans une reponse d'etat suivi. */
export const TRACKED_STATE_FILE_LIMIT = 200;

/**
 * Empreinte de l'etat suivi d'un repository, et les chemins qui la composent.
 *
 * L'empreinte repond a la question binaire — quelque chose de suivi a-t-il
 * bouge ? — et c'est elle seule qui decide d'une completion automatique.
 *
 * `files` repond a une autre question, posee par TASK-028 : **quoi**. Elle sert
 * a nommer, dans un contexte de correction, les fichiers qu'une validation
 * aurait modifies pendant qu'elle evaluait le travail. Ce sont des chemins
 * **relatifs** au repository, comme partout ailleurs — un chemin absolu ne sort
 * jamais du runner — et la liste est bornee : elle informe, elle ne remplace pas
 * la review Git.
 *
 * Elle reste facultative. Un runner anterieur n'en renvoie pas, et « NOX ne sait
 * pas quels fichiers » est un etat parfaitement descriptible : il ne doit ni
 * bloquer une lecture, ni etre confondu avec « aucun fichier ».
 */
export type TrackedStateSuccess = {
  ok: true;
  digest: string;
  files?: readonly string[];
};

/** Valide le corps recu par `POST /repositories/validations/state`. */
export function parseTrackedStateRequest(value: unknown): TrackedStateRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const repositoryPath: unknown = value["repositoryPath"];
  if (typeof repositoryPath !== "string" || repositoryPath.trim() === "") {
    return null;
  }
  return { repositoryPath };
}

/** Verifie qu'une reponse JSON est une empreinte d'etat suivi. */
export function isTrackedStateSuccess(value: unknown): value is TrackedStateSuccess {
  if (!isRecord(value) || value["ok"] !== true || typeof value["digest"] !== "string") {
    return false;
  }
  const files: unknown = value["files"];
  if (files === undefined) {
    return true;
  }
  return Array.isArray(files) && files.every((entry) => typeof entry === "string");
}
