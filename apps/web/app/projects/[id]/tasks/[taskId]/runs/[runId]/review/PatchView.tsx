import type { RunFileChange } from "@nox/shared";

import { missingPatchMessage, missingPatchReason, toPatchLines } from "@/lib/review-display";

/**
 * Couleurs d'une ligne de diff.
 *
 * Elles **completent** le signe `+` ou `-`, elles ne le remplacent pas : la
 * couleur disparait a l'impression, ne se prononce pas, et un daltonien ne la
 * distingue pas. Le caractere que Git a mis en debut de ligne reste dans le
 * texte.
 */
const LINE_CLASSES: Record<string, string> = {
  addition: "bg-teal-400/10 text-teal-200",
  deletion: "bg-red-500/10 text-red-300",
  hunk: "bg-zinc-800/60 text-zinc-400",
  meta: "text-zinc-600",
  context: "text-zinc-400",
};

/**
 * Affichage d'un diff unifie.
 *
 * ## Le patch est du texte, et rien d'autre
 *
 * Ce contenu vient du repository : il peut contenir du HTML, du Markdown, des
 * sequences ANSI, une balise `<script>`. Il est rendu comme du **texte** par
 * React, qui echappe tout ce qu'il interpole. Aucun
 * `dangerouslySetInnerHTML`, aucun rendu Markdown, aucune interpretation ANSI,
 * aucune image, aucun lien automatique. Un fichier hostile s'affiche
 * litteralement — c'est exactement ce qu'un relecteur veut voir.
 *
 * ## Pas de coloration syntaxique
 *
 * Elle demanderait une dependance lourde, et un analyseur de plus a qui faire
 * confiance pour du contenu potentiellement hostile. Un diff lisible en
 * monospace, avec les ajouts et les suppressions distingues, suffit a relire.
 */
export function PatchView({ file }: { file: RunFileChange }) {
  const reason = missingPatchReason(file);

  if (reason !== null) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-4 py-6 text-center">
        <p className="text-sm text-zinc-400">{missingPatchMessage(reason)}</p>
        {reason === "sensitive" ? (
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-zinc-600">
            NOX n&apos;affiche jamais le contenu d&apos;un fichier de secrets. Son chemin, son type
            de changement et ses statistiques restent visibles.
          </p>
        ) : null}
      </div>
    );
  }

  const lines = toPatchLines(file.patch ?? "");

  return (
    <div>
      {file.isTruncated ? (
        <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Diff truncated — ce fichier depasse la limite conservee par NOX. Relisez-le entierement
          avec <code className="font-mono">git diff</code>.
        </p>
      ) : null}

      {/* Le defilement horizontal appartient au bloc, jamais a la page : une
          ligne de 400 caracteres ne doit pas elargir toute l'interface. */}
      <div className="max-h-[60vh] overflow-auto rounded-md border border-zinc-800 bg-zinc-950">
        <pre className="min-w-full font-mono text-xs leading-relaxed">
          {lines.map((line) => (
            <div
              key={line.index}
              className={`whitespace-pre px-4 ${LINE_CLASSES[line.kind] ?? "text-zinc-400"}`}
            >
              {line.text === "" ? " " : line.text}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
