import { ARCHITECT_LIMITS, isProjectMemoryCategory } from "@nox/shared";

import { StatusBadge } from "@/components/StatusBadge";
import { formatChars, manifestRows, manifestTaskCount, memoryRows } from "@/lib/architect/display";
import type { PreparedTurn } from "@/lib/architect/service";
import { describeStoredTurns, describeTranscriptWindow } from "@/lib/architect/window-display";
import { architectContextChangeLabel, architectSourceStatusLabel, projectMemoryCategoryLabel } from "@/lib/labels";

/**
 * Ce qui quittera la machine, et rien d'autre.
 *
 * ## Pourquoi ce panneau existe encore
 *
 * Depuis que l'envoi est direct, le relire n'est plus obligatoire. Il reste
 * indispensable : c'est le seul endroit ou l'on voit quels documents partent,
 * lesquels manquent, quelle part de la conversation est transmise, ce que la
 * memoire du projet ajoute, et le **texte exact** de ce qui sera envoye.
 *
 * Le rendre facultatif etait une decision d'interface. Le supprimer aurait ete
 * une perte de transparence, et NOX n'en fait pas.
 *
 * L'afficher ne coute **aucun appel au fournisseur** : il est assemble par le
 * meme code que l'envoi, a partir du repository et de la base.
 */
export function ContextPanel({
  turn,
  model,
  pendingMessage,
  staleNotice,
}: {
  turn: PreparedTurn;
  model: string;
  /** Message deja prepare, quand la conversation suit le parcours en deux clics. */
  pendingMessage: string | null;
  /** Vrai quand le contexte a bouge depuis l'apercu enregistre. */
  staleNotice: boolean;
}) {
  const manifest = turn.prepared.manifest;
  const memory = memoryRows(manifest);

  return (
    <>
      {pendingMessage === null ? null : (
        <div className="mb-5">
          <h3 className="text-xs font-medium text-zinc-400">Message</h3>
          <p className="mt-2 whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-relaxed text-zinc-200">
            {pendingMessage}
          </p>
        </div>
      )}

      <h3 className="text-xs font-medium text-zinc-400">Project context</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-300">
        {!turn.comparable
          ? "Premier tour : il n'y a rien a comparer."
          : turn.changes.length === 0
            ? "Project context unchanged"
            : "Project context changed since previous turn"}
      </p>

      {turn.changes.length === 0 ? null : (
        <ul className="mt-3 flex flex-col divide-y divide-zinc-800/80 font-mono text-xs">
          {turn.changes.map((change) => (
            <li
              key={`${change.kind}:${change.identifier}`}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <span className="text-zinc-300">{change.identifier}</span>
              <span className="flex items-center gap-3 text-zinc-600">
                {change.previousRevision === null || change.currentRevision === null ? null : (
                  <span>
                    {change.previousRevision} &rarr; {change.currentRevision}
                  </span>
                )}
                <StatusBadge>{architectContextChangeLabel(change.kind)}</StatusBadge>
              </span>
            </li>
          ))}
        </ul>
      )}

      {staleNotice ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          Le contexte du projet a change depuis votre apercu. Relisez le contexte mis a jour avant
          de l&apos;envoyer : l&apos;envoi sera refuse tant que ce ne sera pas fait.
        </p>
      ) : null}

      {memory.length === 0 ? null : (
        <>
          <h3 className="mt-5 text-xs font-medium text-zinc-400">Project memory</h3>
          <p className="my-2 max-w-prose text-sm leading-relaxed text-zinc-400">
            Entrees actives de la memoire de ce projet, dans l&apos;ordre des codes. Les entrees
            archivees ne figurent pas ici : elles ne quittent jamais cette machine.
          </p>
          <ul className="flex flex-col divide-y divide-zinc-800/80 text-xs">
            {memory.map((row) => (
              <li key={row.code} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-zinc-300">{row.code}</span>
                  <span className="text-zinc-500">
                    {isProjectMemoryCategory(row.category)
                      ? projectMemoryCategoryLabel(row.category)
                      : row.category}
                  </span>
                </span>
                <span className="flex items-center gap-3 font-mono text-zinc-600">
                  {row.revision === null ? null : <span>{row.revision}</span>}
                  <span>{formatChars(row.chars)}</span>
                  <StatusBadge>Included</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-5 text-xs font-medium text-zinc-400">Sources</h3>
      <p className="my-2 max-w-prose text-sm leading-relaxed text-zinc-400">
        Les elements listes ci-dessous seront envoyes au fournisseur OpenAI. Aucun fichier de code,
        diff Git, sortie Claude ou fichier{" "}
        <code className="font-mono text-xs text-zinc-300">.env</code> n&apos;est inclus.
      </p>

      <ul className="flex flex-col divide-y divide-zinc-800/80 font-mono text-xs">
        {manifestRows(manifest).map((row) => (
          <li
            key={`${row.kind}:${row.identifier}`}
            className="flex flex-wrap items-center justify-between gap-3 py-2"
          >
            <span className="text-zinc-300">{row.identifier}</span>
            <span className="flex items-center gap-3 text-zinc-600">
              {row.revision === null ? null : <span>{row.revision}</span>}
              {row.chars === 0 ? null : <span>{formatChars(row.chars)}</span>}
              <StatusBadge>{architectSourceStatusLabel(row.status)}</StatusBadge>
            </span>
          </li>
        ))}
      </ul>

      <dl className="mt-4 flex flex-col gap-1 text-xs text-zinc-500">
        <div className="flex gap-2">
          <dt>Taches recentes incluses :</dt>
          <dd>{String(manifestTaskCount(manifest))}</dd>
        </div>
        <div className="flex gap-2">
          <dt>Conversation transmise :</dt>
          <dd>
            {describeTranscriptWindow(turn.prepared.window)} ·{" "}
            {formatChars(turn.prepared.transcriptChars)} sur {formatChars(ARCHITECT_LIMITS.transcript)}
          </dd>
        </div>
        {turn.prepared.window.omittedTurns === 0 ? null : (
          <div className="flex gap-2">
            <dt>Conservee en base :</dt>
            <dd>{describeStoredTurns(turn.prepared.window)} — lisible ci-dessus, non transmise</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt>Contexte total :</dt>
          <dd>{formatChars(manifest.totalChars)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>Provider :</dt>
          <dd className="font-mono">{model}</dd>
        </div>
      </dl>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
          Voir le texte exact envoye
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <h4 className="text-xs font-medium text-zinc-400">Instructions</h4>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-400">
              {turn.prepared.prompt.instructions}
            </pre>
          </div>
          <div>
            <h4 className="text-xs font-medium text-zinc-400">Contexte et conversation</h4>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-400">
              {turn.prepared.prompt.input}
            </pre>
          </div>
        </div>
      </details>
    </>
  );
}
