import type { ProjectDocumentSummary } from "@nox/shared";
import Link from "next/link";

import { describeCategory } from "@/lib/documents";
import { formatBytes, formatIsoDateTime } from "@/lib/format";

import { StatusBadge } from "./StatusBadge";

type DocumentListProps = {
  projectId: string;
  documents: ProjectDocumentSummary[];
  /** Chemin relatif du document ouvert, s'il y en a un. */
  selectedPath: string | null;
};

/**
 * La selection passe par l'URL plutot que par un etat React : le lien reste
 * partageable, le bouton « precedent » fonctionne, et un rechargement conserve
 * le document ouvert.
 */
function documentHref(projectId: string, documentPath: string): string {
  return `/projects/${projectId}/documents?path=${encodeURIComponent(documentPath)}`;
}

export function DocumentList({ projectId, documents, selectedPath }: DocumentListProps) {
  return (
    <ul className="flex flex-col gap-2">
      {documents.map((document) => {
        const isSelected = document.path === selectedPath;
        const updatedAt = formatIsoDateTime(document.updatedAt);

        return (
          <li key={document.path}>
            <Link
              href={documentHref(projectId, document.path)}
              aria-current={isSelected ? "page" : undefined}
              className={`block rounded-lg border px-4 py-3 transition-colors ${
                isSelected
                  ? "border-teal-400/40 bg-teal-400/10"
                  : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span
                  className={`truncate text-sm font-medium ${
                    isSelected ? "text-teal-100" : "text-zinc-200"
                  }`}
                >
                  {document.name}
                </span>
                <StatusBadge tone={isSelected ? "accent" : "muted"}>
                  {describeCategory(document.category)}
                </StatusBadge>
              </div>

              <p className="mt-1 truncate font-mono text-xs text-zinc-500" title={document.path}>
                {document.path}
              </p>

              <p className="mt-2 text-xs text-zinc-600">
                {formatBytes(document.size)}
                {updatedAt === null ? null : ` · modifie le ${updatedAt}`}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
