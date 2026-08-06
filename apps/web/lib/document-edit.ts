/**
 * Logique du formulaire d'edition d'un document.
 *
 * Volontairement separee de la Server Action : ce module n'importe ni Prisma, ni
 * Next.js, ni React. Il est donc testable directement, la ou une Server Action
 * ne l'est pas sans demarrer l'application.
 *
 * Aucune de ces fonctions ne touche au disque ni au reseau. Le web ne valide ici
 * que la forme de ce que le navigateur a envoye ; tout ce qui concerne le
 * fichier reel — existence, confinement, revision, taille — reste au runner.
 */

import { describeRunnerFailure, isDocumentConflict, type RunnerFailure } from "./runner/errors.ts";

export type DocumentEditFields = {
  documentPath: string;
  content: string;
  expectedRevision: string;
};

export type DocumentEditSubmission =
  | { ok: true; fields: DocumentEditFields }
  | { ok: false; message: string };

const MISSING_DOCUMENT_MESSAGE =
  "Aucun document a enregistrer. Rouvrez le document depuis la liste, puis reessayez.";

const STALE_FORM_MESSAGE =
  "Cette page d'edition n'est plus a jour. Rechargez le document avant de l'enregistrer.";

/**
 * Ramene les fins de ligne du contenu soumis a LF.
 *
 * La specification HTML impose au navigateur de soumettre le contenu d'un
 * `<textarea>` avec des fins de ligne CRLF, meme lorsque le texte affiche
 * n'en comportait pas. Sans cette normalisation, chaque enregistrement
 * reecrirait integralement un fichier ecrit en LF.
 *
 * Le runner reappliquera ensuite la convention du fichier existant : c'est lui
 * qui voit le disque, pas le web.
 */
export function normalizeSubmittedContent(raw: string): string {
  return raw.replace(/\r\n?/g, "\n");
}

/**
 * Valide les champs du formulaire d'edition.
 *
 * Le contenu n'est pas valide ici : une chaine vide est un document vide, ce qui
 * est parfaitement legitime.
 */
export function readDocumentEditSubmission(fields: DocumentEditFields): DocumentEditSubmission {
  if (fields.documentPath.trim() === "") {
    return { ok: false, message: MISSING_DOCUMENT_MESSAGE };
  }

  if (fields.expectedRevision.trim() === "") {
    return { ok: false, message: STALE_FORM_MESSAGE };
  }

  return {
    ok: true,
    fields: {
      documentPath: fields.documentPath,
      content: normalizeSubmittedContent(fields.content),
      expectedRevision: fields.expectedRevision,
    },
  };
}

/**
 * Traduit un echec d'ecriture pour le formulaire.
 *
 * Le conflit est distingue des autres echecs : il n'appelle pas « reessayez »
 * mais « rechargez d'abord », et l'interface doit offrir ce rechargement.
 */
export function describeUpdateFailure(failure: RunnerFailure): {
  message: string;
  conflict: boolean;
} {
  return {
    message: describeRunnerFailure(failure),
    conflict: isDocumentConflict(failure),
  };
}

/**
 * URL d'un document, en mode lecture ou en mode edition.
 *
 * Seul endroit ou une URL de document est construite : lecture, edition,
 * retour apres enregistrement et retour apres creation passent tous par ici.
 */
export function documentUrl(
  projectId: string,
  documentPath: string,
  options: { edit?: boolean; saved?: boolean; created?: boolean } = {},
): string {
  const query = new URLSearchParams({ path: documentPath });
  if (options.edit === true) {
    query.set("edit", "1");
  }
  if (options.saved === true) {
    query.set("saved", "1");
  }
  if (options.created === true) {
    query.set("created", "1");
  }
  return `/projects/${projectId}/documents?${query.toString()}`;
}
