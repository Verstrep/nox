/**
 * Evenements publics d'une execution Claude Code.
 *
 * ## Le point structurant : rien de brut ne sort du runner
 *
 * Claude Code emet, en `stream-json`, des lignes qui contiennent tout ce qu'il
 * manipule : le contenu integral des fichiers lus, les entrees et sorties de
 * chaque outil, ses raisonnements intermediaires, et les chemins absolus de la
 * machine. Aucune de ces lignes ne doit atteindre le navigateur — ni telle
 * quelle, ni resumee, ni « au cas ou ».
 *
 * Ce module definit donc la **seule** forme qui circule : un evenement court,
 * borne, deja nettoye, et dont chaque champ a ete decide par NOX. Un type unique
 * et ferme rend la regle verifiable — il n'existe aucun champ « libre » par
 * lequel un fragment brut pourrait passer.
 *
 * ## Le raisonnement interne n'est pas represente
 *
 * Il n'y a volontairement aucun `ClaudeRunEventKind` pour le raisonnement du
 * modele. Ce n'est pas un oubli : un bloc `thinking` n'est ni stocke, ni
 * journalise, ni resume, ni compte. Il est ignore avant meme d'avoir une forme.
 * Ajouter un type pour le representer reviendrait a ouvrir la porte qu'on
 * cherche a fermer.
 *
 * Aucune dependance : ces types servent au runner, au web, a la base et aux
 * tests.
 */

/**
 * Nature d'un evenement public.
 *
 * Volontairement peu de valeurs : la timeline doit se lire d'un coup d'oeil, et
 * chaque type supplementaire est une decision d'affichage de plus a prendre.
 */
export const CLAUDE_RUN_EVENT_KIND = {
  /** Debut, fin, demande d'annulation : le fil de l'execution elle-meme. */
  STATUS: "STATUS",
  /** Texte public produit par Claude — jamais son raisonnement. */
  ASSISTANT_MESSAGE: "ASSISTANT_MESSAGE",
  /** Un outil vient d'etre appele. */
  TOOL_STARTED: "TOOL_STARTED",
  /** Un outil a rendu la main ; seul son etat est conserve. */
  TOOL_COMPLETED: "TOOL_COMPLETED",
  /** Une commande de validation autorisee a rendu son verdict. */
  VALIDATION: "VALIDATION",
  /** Anomalie non bloquante constatee par NOX, jamais par Claude. */
  WARNING: "WARNING",
  /** Erreur rapportee par un outil ou par le processus. */
  ERROR: "ERROR",
  /** Compte rendu final. */
  RESULT: "RESULT",
  /** Marque unique signalant que des evenements ont ete abandonnes. */
  TRUNCATED: "TRUNCATED",
} as const;

export type ClaudeRunEventKind =
  (typeof CLAUDE_RUN_EVENT_KIND)[keyof typeof CLAUDE_RUN_EVENT_KIND];

export const CLAUDE_RUN_EVENT_KINDS: readonly ClaudeRunEventKind[] =
  Object.values(CLAUDE_RUN_EVENT_KIND);

export function isClaudeRunEventKind(value: unknown): value is ClaudeRunEventKind {
  return typeof value === "string" && (CLAUDE_RUN_EVENT_KINDS as string[]).includes(value);
}

/**
 * Un evenement tel qu'il circule jusqu'au navigateur.
 *
 * - `sequence` est attribue par le runner, strictement croissant par execution.
 *   Il n'est **jamais** repris d'un champ de Claude Code : un numero venu du
 *   processus observe pourrait reculer, se repeter, ou etre choisi.
 * - `occurredAt` est une date ISO produite par le runner. Meme raison.
 * - `label` est court et se suffit a lui-meme dans une liste.
 * - `detail` est facultatif, borne, et ne contient jamais de JSON.
 */
export type ClaudeRunEvent = {
  sequence: number;
  kind: ClaudeRunEventKind;
  /** Date ISO 8601 produite par le runner. */
  occurredAt: string;
  label: string;
  detail: string | null;
  /** Nom de l'outil concerne, lorsque l'evenement en designe un. */
  toolName: string | null;
  isError: boolean;
};

/**
 * Bornes appliquees aux evenements.
 *
 * Une execution de deux minutes produit deja des centaines de lignes ; une
 * execution qui part en boucle en produit des centaines de milliers. Ces bornes
 * ne sont pas des reglages de confort : elles protegent la memoire du runner, la
 * base, et le temps de rendu de la page. Elles sont **constantes** et non
 * configurables — une limite de securite qu'on peut desserrer par variable
 * d'environnement n'en est plus une.
 */
export const RUN_EVENT_LIMITS = {
  /** Evenements ordinaires conservees par execution. */
  maxEvents: 2_000,
  /**
   * Marge reservee, au-dela de `maxEvents`, aux evenements qui doivent survivre
   * a une troncature : statuts, erreurs, resultat final.
   */
  reservedEvents: 64,
  /** Longueur maximale d'un `detail`. */
  detail: 4_096,
  /** Longueur maximale d'un `label`. */
  label: 200,
  /** Longueur maximale d'un nom d'outil conserve. */
  toolName: 64,
  /** Volume total de texte normalise conserve par execution. */
  totalCharacters: 2_097_152,
  /** Longueur maximale d'une ligne NDJSON acceptee. Au-dela, la ligne est jetee. */
  maxLineLength: 1_048_576,
  /** Nombre maximal d'evenements retournes par un appel. */
  maxBatch: 200,
} as const;

/** Texte de l'unique evenement de troncature. */
export const TRUNCATION_EVENT_LABEL = "TRUNCATED";

export const TRUNCATION_EVENT_DETAIL =
  "Certains evenements intermediaires n'ont pas ete conserves.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Verifie qu'une valeur inconnue est un evenement public valide.
 *
 * Utilise a chaque frontiere : reponse du runner lue par le web, ligne relue en
 * base, corps recu par le flux SSE. Un evenement mal forme est rejete plutot que
 * corrige — une correction silencieuse masquerait justement la fuite qu'on
 * cherche a rendre impossible.
 */
export function isClaudeRunEvent(value: unknown): value is ClaudeRunEvent {
  return (
    isRecord(value) &&
    typeof value["sequence"] === "number" &&
    Number.isInteger(value["sequence"]) &&
    value["sequence"] >= 1 &&
    isClaudeRunEventKind(value["kind"]) &&
    typeof value["occurredAt"] === "string" &&
    typeof value["label"] === "string" &&
    (value["detail"] === null || typeof value["detail"] === "string") &&
    (value["toolName"] === null || typeof value["toolName"] === "string") &&
    typeof value["isError"] === "boolean"
  );
}

/**
 * Evenement avant numerotation.
 *
 * Le normaliseur produit cette forme ; c'est le registre qui attribue `sequence`
 * et `occurredAt`. La separation n'est pas cosmetique : elle rend structurellement
 * impossible qu'un numero vienne d'ailleurs que du compteur du runner.
 */
export type ClaudeRunEventDraft = Omit<ClaudeRunEvent, "sequence" | "occurredAt"> & {
  /** Date proposee par le producteur ; validee, jamais crue sur parole. */
  occurredAt?: string;
};

/**
 * Types d'evenements conserves malgre une troncature.
 *
 * Ce qui compte apres coup n'est pas la centieme lecture de fichier : c'est de
 * savoir que l'execution a demarre, ce qui a echoue, et ce qu'elle a rendu.
 */
export const ESSENTIAL_EVENT_KINDS: readonly ClaudeRunEventKind[] = [
  CLAUDE_RUN_EVENT_KIND.STATUS,
  CLAUDE_RUN_EVENT_KIND.ERROR,
  CLAUDE_RUN_EVENT_KIND.RESULT,
  CLAUDE_RUN_EVENT_KIND.TRUNCATED,
];

export function isEssentialEventKind(kind: ClaudeRunEventKind): boolean {
  return ESSENTIAL_EVENT_KINDS.includes(kind);
}
