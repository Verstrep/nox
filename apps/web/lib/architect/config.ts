/**
 * Configuration de l'Architecte, cote serveur uniquement.
 *
 * ## Pourquoi `NOX_OPENAI_API_KEY` plutot que `OPENAI_API_KEY`
 *
 * Le runner retire de l'environnement du processus Claude Code **toutes** les
 * variables commencant par `NOX_`. Nommer la cle ainsi la place donc, par
 * construction, hors de portee de l'agent : aucune regle supplementaire n'a a
 * etre ecrite, et aucune ne peut etre oubliee.
 *
 * `OPENAI_API_KEY`, en revanche, serait transmise telle quelle — et un agent qui
 * peut lire une cle peut appeler le fournisseur pour son propre compte.
 *
 * ## Aucun modele par defaut
 *
 * `NOX_ARCHITECT_MODEL` est obligatoire. Choisir un modele en silence
 * reviendrait a choisir un cout et une disponibilite a la place de
 * l'utilisateur, et a rendre une facture surprenante. L'absence de valeur est un
 * refus explicite, pas une occasion d'improviser.
 *
 * ## Aucune URL de base configurable
 *
 * Il n'existe volontairement aucune variable `NOX_OPENAI_BASE_URL`. NOX envoie du
 * contexte projet : permettre de rediriger cet envoi vers une adresse arbitraire
 * transformerait une variable d'environnement en canal d'exfiltration. Les tests
 * injectent un faux fournisseur ; ils ne detournent pas le vrai.
 */

/** Delai maximal accorde a une generation. */
export const ARCHITECT_REQUEST_TIMEOUT_MS = 90_000;

/** Noms des variables necessaires, dans l'ordre d'affichage. */
export const ARCHITECT_ENVIRONMENT_VARIABLES: readonly string[] = [
  "NOX_OPENAI_API_KEY",
  "NOX_ARCHITECT_MODEL",
];

export type ArchitectConfig = {
  apiKey: string;
  model: string;
};

export type ArchitectConfigResult =
  | { ok: true; config: ArchitectConfig }
  | { ok: false; missing: string[] };

/**
 * Garde-fou : si ce module se retrouvait dans un bundle navigateur, l'erreur
 * serait immediate et explicite plutot que silencieuse.
 */
function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("La configuration de l'Architecte NOX ne peut pas etre lue cote navigateur.");
  }
}

/**
 * Lit la configuration de l'Architecte.
 *
 * Retourne les **noms** des variables manquantes, jamais leurs valeurs ni un
 * fragment : l'interface doit pouvoir dire quoi renseigner sans rien reveler de
 * ce qui est deja la.
 */
export function loadArchitectConfig(
  environment: Record<string, string | undefined>,
): ArchitectConfigResult {
  assertServerOnly();

  const apiKey = environment["NOX_OPENAI_API_KEY"]?.trim() ?? "";
  const model = environment["NOX_ARCHITECT_MODEL"]?.trim() ?? "";

  const missing: string[] = [];
  if (apiKey === "") {
    missing.push("NOX_OPENAI_API_KEY");
  }
  if (model === "") {
    missing.push("NOX_ARCHITECT_MODEL");
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, config: { apiKey, model } };
}
