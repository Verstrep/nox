import type { ProjectDocumentContent } from "@nox/shared";

import { describeCategory } from "@/lib/documents";
import { formatBytes, formatIsoDateTime } from "@/lib/format";

import { StatusBadge } from "./StatusBadge";

/**
 * Lecteur de document.
 *
 * Le contenu est affiche **brut**, dans un `<pre>`. Aucun rendu HTML du
 * Markdown, aucune interpretation de balise, aucun `dangerouslySetInnerHTML` :
 * le texte vient d'un fichier du disque, le traiter comme du balisage
 * ouvrirait une injection HTML dans l'interface. React echappe tout ce qu'il
 * insere comme texte, ce qui rend l'affichage sur.
 */
export function DocumentViewer({ document }: { document: ProjectDocumentContent }) {
  const updatedAt = formatIsoDateTime(document.updatedAt);

  return (
    <article className="flex min-h-0 flex-col rounded-xl border border-zinc-800 bg-nox-surface/80">
      <header className="flex flex-col gap-3 border-b border-zinc-800 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-100">{document.name}</h2>
          <StatusBadge tone="neutral">{describeCategory(document.category)}</StatusBadge>
        </div>

        <p className="break-all font-mono text-xs text-zinc-500">{document.path}</p>

        <p className="text-xs text-zinc-600">
          {formatBytes(document.size)}
          {updatedAt === null ? null : ` · modifie le ${updatedAt}`}
          {" · lecture seule"}
        </p>
      </header>

      {document.content === "" ? (
        <p className="p-5 text-sm italic text-zinc-600">Ce document est vide.</p>
      ) : (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed text-zinc-300">
          {document.content}
        </pre>
      )}
    </article>
  );
}
