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
 * ## Un modele par defaut, et une seule autorite
 *
 * `DEFAULT_ARCHITECT_MODEL` est le modele que NOX choisit lui-meme pour ses
 * decisions d'architecture. C'est un revirement assume de TASK-013, ou l'absence
 * de valeur etait un refus explicite : le premier pilote reel a montre que le
 * defaut de fait n'etait pas « aucun modele », mais « le modele que
 * l'utilisateur avait recopie depuis un exemple » — et qu'une decision qui
 * structure tout un produit se prenait ainsi sur un petit modele.
 *
 * `NOX_ARCHITECT_MODEL` reste lue, et reste prioritaire : configurer un modele
 * explicitement est une decision, et NOX ne la reprend pas. Ce qui disparait est
 * uniquement le refus de fonctionner sans elle.
 *
 * Le nom de ce modele n'est ecrit **qu'ici**. Le disperser dans les trois
 * surfaces qui appellent le fournisseur garantirait qu'un jour l'une des trois
 * resterait en arriere.
 *
 * ## Pourquoi l'effort de raisonnement se derive du modele
 *
 * `reasoning.effort` n'est accepte que par les modeles de raisonnement. NOX ne
 * connait les capacites que du modele qu'il choisit lui-meme : quand un
 * utilisateur en configure un autre, NOX n'en demande aucun plutot que de
 * risquer un `400` sur un parametre que ce modele ne comprend pas.
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

/**
 * Le modele des decisions d'architecture de NOX.
 *
 * **Autorite unique.** Conversation projet, planification de backlog,
 * replanification et analyse de review partent tous d'ici : aucune de ces
 * surfaces ne nomme un modele.
 */
export const DEFAULT_ARCHITECT_MODEL = "gpt-5.6-sol";

/**
 * Effort de raisonnement demande au modele par defaut.
 *
 * Ces appels sont rares, explicites et structurants : un backlog de V1 se lit
 * pendant des semaines, et le temps de reflexion coute moins cher que la
 * relecture d'un decoupage rate.
 */
export const DEFAULT_ARCHITECT_REASONING_EFFORT = "high";

/**
 * Effort de raisonnement, tel que NOX le demande.
 *
 * Une seule valeur : NOX n'expose pas un reglage, il assume un choix.
 */
export type ArchitectReasoningEffort = typeof DEFAULT_ARCHITECT_REASONING_EFFORT;

/** Noms des variables necessaires, dans l'ordre d'affichage. */
export const ARCHITECT_ENVIRONMENT_VARIABLES: readonly string[] = ["NOX_OPENAI_API_KEY"];

/**
 * Noms des variables facultatives, pour l'affichage seul.
 *
 * Leur absence n'empeche rien : elle laisse NOX choisir. Les nommer separement
 * evite qu'un ecran annonce « manquante » ce qui est simplement « non impose ».
 */
export const ARCHITECT_OPTIONAL_ENVIRONMENT_VARIABLES: readonly string[] = [
  "NOX_ARCHITECT_MODEL",
];

export type ArchitectConfig = {
  apiKey: string;
  model: string;
  /**
   * Effort demande, ou `null` quand NOX ne connait pas les capacites du modele.
   */
  reasoningEffort: ArchitectReasoningEffort | null;
};

/**
 * Effort de raisonnement applicable a un modele.
 *
 * Derive du seul modele, et nulle part ailleurs : c'est ce qui garantit que les
 * quatre surfaces obtiennent la meme reponse sans avoir a se transmettre un
 * parametre de plus. Un modele configure a la main n'en recoit aucun — NOX ne
 * sait pas s'il en accepte un, et un refus du fournisseur pour un parametre
 * inconnu serait un echec que personne n'a demande.
 */
export function architectReasoningEffort(model: string): ArchitectReasoningEffort | null {
  return model === DEFAULT_ARCHITECT_MODEL ? DEFAULT_ARCHITECT_REASONING_EFFORT : null;
}

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
 *
 * Une seule variable est necessaire : la cle. Le modele a un defaut, et
 * `NOX_ARCHITECT_MODEL` ne sert qu'a en imposer un autre.
 */
export function loadArchitectConfig(
  environment: Record<string, string | undefined>,
): ArchitectConfigResult {
  assertServerOnly();

  const apiKey = environment["NOX_OPENAI_API_KEY"]?.trim() ?? "";
  const configured = environment["NOX_ARCHITECT_MODEL"]?.trim() ?? "";
  const model = configured === "" ? DEFAULT_ARCHITECT_MODEL : configured;

  if (apiKey === "") {
    return { ok: false, missing: ["NOX_OPENAI_API_KEY"] };
  }

  return {
    ok: true,
    config: { apiKey, model, reasoningEffort: architectReasoningEffort(model) },
  };
}
