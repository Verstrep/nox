/**
 * Diagnostic sur d'un echec de planification.
 *
 * ## Pourquoi ce module existe
 *
 * Le validateur de `backlog/2` sait exactement ce qu'il refuse : « le troisieme
 * critere de la tache 1 est vide ». Jusqu'a HOTFIX-001, cette phrase partait
 * dans `console.error` et l'utilisateur lisait « la reponse ne respecte pas le
 * format attendu ». Il ne lui restait qu'a recliquer `Generate` — c'est-a-dire a
 * payer un second appel pour reapprendre ce que NOX savait deja.
 *
 * ## Ce qui est sur, et ce qui ne l'est pas
 *
 * Ne sortent d'ici que deux choses : le **chemin** du champ fautif, produit par
 * NOX et jamais par le fournisseur, et la **phrase** du validateur, ecrite pour
 * l'utilisateur. Le JSON brut de la reponse, le prompt, la trace d'exception et
 * les details du SDK ne traversent jamais cette frontiere — ils ne sont pas
 * filtres ici, ils n'y entrent pas.
 *
 * Quelques phrases citent une valeur proposee — une commande refusee, un
 * document inexistant. C'est precisement ce qui les rend actionnables, et ces
 * valeurs sont deja bornees par le contrat. Elles passent quand meme par
 * `sanitizeBacklogDiagnosticText` : bornees ne veut pas dire propres.
 *
 * Pur et sans dependance : ni base, ni React, ni reseau.
 */

import { ARCHITECT_ERROR } from "./architect.js";

/**
 * Nature d'un echec de planification.
 *
 * Deux valeurs, et elles ne se confondent pas : une panne du fournisseur n'est
 * pas un critere d'acceptation invalide. Presenter la premiere avec le
 * vocabulaire de la seconde enverrait chercher au mauvais endroit.
 */
export const ARCHITECT_BACKLOG_FAILURE = {
  /** Une reponse a ete recue, et NOX l'a refusee. */
  OUTPUT_INVALID: "OUTPUT_INVALID",
  /** Aucune reponse exploitable n'a ete recue : reseau, quota, delai, refus. */
  PROVIDER_ERROR: "PROVIDER_ERROR",
} as const;

export type ArchitectBacklogFailureCategory =
  (typeof ARCHITECT_BACKLOG_FAILURE)[keyof typeof ARCHITECT_BACKLOG_FAILURE];

/**
 * Ce que NOX conserve d'un echec, et rien de plus.
 *
 * `field` et `message` valent `null` pour une panne du fournisseur — il n'y a
 * pas de champ fautif — et pour toute generation anterieure a HOTFIX-001, dont
 * la cause n'a jamais ete enregistree. « Pas de diagnostic » est un etat, pas
 * une occasion d'en inventer un.
 */
export type ArchitectBacklogDiagnostic = {
  category: ArchitectBacklogFailureCategory;
  /** Chemin technique du champ refuse, tel que le validateur l'a nomme. */
  field: string | null;
  /** Phrase francaise, deja destinee a l'utilisateur. */
  message: string | null;
};

/** Bornes de stockage et d'affichage d'un diagnostic. */
export const ARCHITECT_BACKLOG_DIAGNOSTIC_LIMITS = {
  field: 120,
  message: 600,
} as const;

/** Marqueur de troncature : une phrase coupee doit dire qu'elle l'a ete. */
const TRUNCATION_MARKER = " […]";

/**
 * Nettoie un texte de diagnostic avant qu'il n'atteigne la base ou l'ecran.
 *
 * Caracteres de controle retires, blancs ecrases, longueur bornee et troncature
 * annoncee. Un texte vide apres nettoyage rend `null` : mieux vaut « cause non
 * enregistree » qu'une ligne vide qui ressemble a une information.
 */
export function sanitizeBacklogDiagnosticText(value: string, max: number): string | null {
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- c'est precisement ce qu'on retire.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") {
    return null;
  }
  return cleaned.length <= max
    ? cleaned
    : `${cleaned.slice(0, max - TRUNCATION_MARKER.length).trim()}${TRUNCATION_MARKER}`;
}

/**
 * Nature d'un echec, derivee de son code.
 *
 * Aucune colonne supplementaire : `errorCode` porte deja l'information, et la
 * dupliquer garantirait qu'un jour les deux se contredisent.
 */
export function architectBacklogFailureCategory(
  errorCode: string | null,
): ArchitectBacklogFailureCategory {
  return errorCode === ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID
    ? ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID
    : ARCHITECT_BACKLOG_FAILURE.PROVIDER_ERROR;
}

/** Libelles des champs du contrat de planification. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: "Titre",
  priority: "Priorite",
  objective: "Objectif",
  context: "Contexte",
  acceptanceCriteria: "Criteres d'acceptation",
  outOfScope: "Hors perimetre",
  documentReferences: "Documents references",
  validationCommands: "Commandes de validation",
};

/** Libelles des champs de premier niveau. */
const ROOT_LABELS: Readonly<Record<string, string>> = {
  backlog: "Reponse de planification",
  schemaVersion: "Version du schema",
  message: "Resume de la proposition",
  tasks: "Liste des taches",
};

/**
 * Traduit un chemin technique en une designation lisible.
 *
 * `tasks.0.acceptanceCriteria` devient `Tache 1 · Criteres d'acceptation` : le
 * chemin est l'indice, la designation est ce qu'un humain relit. Un chemin
 * inconnu rend `null` plutot qu'une traduction approximative — l'appelant
 * affiche alors le chemin tel quel, qui reste exact.
 */
export function describeBacklogDiagnosticField(field: string): string | null {
  const root = ROOT_LABELS[field];
  if (root !== undefined) {
    return root;
  }

  const match = /^tasks\.(\d{1,3})(?:\.([A-Za-z]+))?$/u.exec(field);
  if (match === null) {
    return null;
  }

  const position = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isInteger(position)) {
    return null;
  }
  // Le chemin est indexe a zero, l'ecran compte a partir de un : c'est la
  // numerotation que le validateur emploie deja dans ses phrases.
  const task = `Tache ${String(position + 1)}`;

  const leaf = match[2];
  if (leaf === undefined) {
    return task;
  }
  const label = FIELD_LABELS[leaf];
  return label === undefined ? null : `${task} · ${label}`;
}
