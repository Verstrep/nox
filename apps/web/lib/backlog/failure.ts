/**
 * L'echec d'une planification, dit a l'utilisateur.
 *
 * ## Pourquoi ce module est separe de `display.ts`
 *
 * Parce qu'il traduit un code d'erreur de l'Architecte, et importe donc
 * `architect/errors.ts` — un module cote serveur. `display.ts`, lui, est importe
 * par un Client Component : y placer cette traduction ferait entrer toute la
 * configuration de l'Architecte dans le paquet du navigateur. Rien de secret n'y
 * vit aujourd'hui, et c'est precisement pourquoi il ne faut pas commencer.
 *
 * Ce module n'est utilise que par la page Backlog et sa Server Action.
 *
 * ## Ce qu'il ne recoit pas
 *
 * Ni la reponse du fournisseur, ni le prompt, ni une exception. Un chemin de
 * champ produit par NOX et une phrase ecrite pour l'utilisateur : la surete ne
 * vient pas d'un filtre, elle vient de ce qui n'entre pas.
 */

import {
  ARCHITECT_BACKLOG_FAILURE,
  describeBacklogDiagnosticField,
  isArchitectErrorCode,
  type ArchitectBacklogDiagnostic,
} from "@nox/shared";

import { describeArchitectError } from "../architect/errors.ts";

/**
 * Un echec de planification, decompose pour l'affichage.
 *
 * Quatre morceaux, parce que deux surfaces les assemblent differemment : une
 * banniere de formulaire veut une chaine, l'historique veut un bloc ou le chemin
 * technique tient sur sa propre ligne. Les fusionner en une seule phrase aurait
 * oblige l'une des deux a la redecouper.
 */
export type BacklogFailureDisplay = {
  /** Ce qui s'est passe, en une phrase. */
  headline: string;
  /** Designation lisible du champ refuse. `null` si NOX n'en a pas. */
  field: string | null;
  /** Chemin technique exact, tel que le validateur l'a nomme. */
  path: string | null;
  /** Phrase du validateur. `null` pour une generation sans diagnostic. */
  detail: string | null;
};

/** Ce que l'utilisateur lit quand la cause d'un echec n'a pas ete enregistree. */
export const BACKLOG_NO_DIAGNOSTIC_MESSAGE =
  "Cette generation est anterieure a l'enregistrement des causes de refus : NOX n'a pas conserve le detail.";

/** Rappel affiche sous chaque echec : rien n'a ete cree, rien n'a ete relance. */
export const BACKLOG_FAILURE_FOOTER =
  "Aucune tache n'a ete creee. NOX ne relance jamais un appel tout seul.";

/** Separateur de paragraphes d'un message aplati. */
const PARAGRAPH_SEPARATOR = "\n\n";

/**
 * Decrit l'echec d'une planification.
 *
 * ## Une panne n'est pas un critere invalide
 *
 * `PROVIDER_ERROR` garde le message de son code : delai depasse, quota, cle
 * refusee. Presenter une panne reseau avec le vocabulaire d'un champ refuse
 * enverrait relire un backlog qui n'a jamais existe.
 *
 * `OUTPUT_INVALID` dit ce que NOX a refuse, quand il l'a enregistre. Un chemin
 * que ce module ne sait pas traduire est affiche tel quel : il reste exact, et
 * c'est deja infiniment plus qu'« une erreur de format ».
 */
export function describeBacklogFailure(
  errorCode: string | null,
  diagnostic: ArchitectBacklogDiagnostic | null,
): BacklogFailureDisplay {
  const generic = isArchitectErrorCode(errorCode)
    ? describeArchitectError(errorCode)
    : "La planification a echoue. Aucune tache n'a ete creee.";

  if (diagnostic === null || diagnostic.category !== ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID) {
    return { headline: generic, field: null, path: null, detail: null };
  }

  if (diagnostic.field === null && diagnostic.message === null) {
    return {
      headline: "La proposition de backlog a ete refusee par NOX.",
      field: null,
      path: null,
      detail: BACKLOG_NO_DIAGNOSTIC_MESSAGE,
    };
  }

  return {
    headline: "La proposition de backlog a ete refusee par NOX.",
    field: diagnostic.field === null ? null : describeBacklogDiagnosticField(diagnostic.field),
    path: diagnostic.field,
    detail: diagnostic.message,
  };
}

/**
 * Le meme echec, aplati en une chaine.
 *
 * Pour les surfaces qui ne portent qu'un message — l'etat d'un formulaire. Le
 * chemin technique n'y figure pas : la designation lisible suffit a savoir ou
 * regarder, et le chemin reste visible dans l'historique.
 */
export function backlogFailureMessage(
  errorCode: string | null,
  diagnostic: ArchitectBacklogDiagnostic | null,
): string {
  const failure = describeBacklogFailure(errorCode, diagnostic);
  const lines = [failure.headline];

  const designation = failure.field ?? failure.path;
  if (failure.detail !== null) {
    lines.push(designation === null ? failure.detail : `${designation} : ${failure.detail}`);
  } else if (designation !== null) {
    lines.push(designation);
  }

  if (lines.length > 1) {
    lines.push(BACKLOG_FAILURE_FOOTER);
  }

  return lines.join(PARAGRAPH_SEPARATOR);
}
