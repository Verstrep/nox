/**
 * Logique de la suppression d'un document, hors Server Action.
 *
 * Meme principe que `document-edit.ts` : ce module n'importe ni Prisma, ni
 * Next.js, ni React, et reste donc directement testable.
 *
 * Il ne valide ici que la **forme** de ce que le navigateur a envoye. Tout ce
 * qui concerne le fichier reel — existence, confinement, nature, revision —
 * reste au runner, qui seul voit le disque.
 */

import { isManagedTaskDocumentPath } from "@nox/shared";

import { describeRunnerFailure, isDocumentDeleteConflict, type RunnerFailure } from "./runner/errors.ts";

export type DocumentDeleteFields = {
  documentPath: string;
  expectedRevision: string;
};

export type DocumentDeleteSubmission =
  | { ok: true; fields: DocumentDeleteFields }
  | { ok: false; message: string };

const MISSING_DOCUMENT_MESSAGE =
  "Aucun document a supprimer. Rouvrez le document depuis la liste, puis reessayez.";

const STALE_FORM_MESSAGE =
  "Cette page n'est plus a jour. Rechargez le document avant de le supprimer.";

/**
 * Message affiche lorsque le chemin vise est celui d'un document de tache.
 *
 * Le runner refuse deja ces chemins, et c'est lui qui fait autorite. Ce
 * controle-ci evite simplement un aller-retour reseau pour un refus certain, et
 * permet de formuler la suite — « passez par Delete task » — sans dependre du
 * code renvoye.
 */
const PROTECTED_DOCUMENT_MESSAGE =
  "Ce document appartient a une tache NOX. Le supprimer ici laisserait la tache sans son " +
  "fichier : passez par « Delete task » sur la page de la tache, qui supprime les deux ensemble.";

/**
 * Valide les champs du formulaire de suppression.
 *
 * La revision est exigee ici comme elle l'est a l'ecriture : sans elle, le
 * runner ne pourrait pas verifier que le fichier supprime est bien celui que
 * l'utilisateur a vu.
 */
export function readDocumentDeleteSubmission(
  fields: DocumentDeleteFields,
): DocumentDeleteSubmission {
  const documentPath = fields.documentPath.trim();

  if (documentPath === "") {
    return { ok: false, message: MISSING_DOCUMENT_MESSAGE };
  }

  if (fields.expectedRevision.trim() === "") {
    return { ok: false, message: STALE_FORM_MESSAGE };
  }

  if (isManagedTaskDocumentPath(documentPath)) {
    return { ok: false, message: PROTECTED_DOCUMENT_MESSAGE };
  }

  return {
    ok: true,
    fields: { documentPath, expectedRevision: fields.expectedRevision },
  };
}

/**
 * Traduit un echec de suppression pour le formulaire.
 *
 * Le conflit est distingue des autres echecs : il n'appelle pas « reessayez »
 * mais « rechargez d'abord », et l'interface doit offrir ce rechargement.
 */
export function describeDeleteFailure(failure: RunnerFailure): {
  message: string;
  conflict: boolean;
} {
  return {
    message: describeRunnerFailure(failure),
    conflict: isDocumentDeleteConflict(failure),
  };
}
