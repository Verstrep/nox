"use client";

import { CLAUDE_RUN_EVENT_KIND, isClaudeRunEvent, type ClaudeRunEvent } from "@nox/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatEventTime } from "@/lib/run-display";
import { runEventKindLabel } from "@/lib/labels";

type RunTimelineProps = {
  /** Route Handler SSE de Next.js ; jamais l'URL du runner. */
  endpoint: string;
  /** Evenements deja persistes, rendus cote serveur. */
  initialEvents: ClaudeRunEvent[];
  /** Faux des le premier rendu si l'execution est deja terminee. */
  active: boolean;
};

type ConnectionState = "idle" | "open" | "lost" | "closed";

/**
 * Timeline d'une execution.
 *
 * ## L'historique arrive par le serveur, le direct par SSE
 *
 * `initialEvents` est rendu cote serveur : la timeline est complete des le
 * premier octet de HTML, y compris sans JavaScript et y compris pour une
 * execution terminee il y a trois jours. Le flux ne sert qu'a la suite, et
 * reprend exactement apres le dernier evenement affiche.
 *
 * ## Aucun doublon, meme apres une reconnexion
 *
 * Chaque evenement porte un `sequence` strictement croissant. L'insertion
 * ignore tout numero deja present : une reconnexion qui rejouerait un lot, deux
 * onglets, un `Last-Event-ID` mal aligne — aucun de ces cas ne peut dupliquer une
 * ligne.
 *
 * ## Le defilement suit, mais ne prend jamais la main
 *
 * Tant que l'utilisateur est en bas de la liste, elle defile toute seule. Des
 * qu'il remonte pour relire un evenement passe, le defilement automatique
 * s'arrete — et il reprend s'il redescend. Rien n'est plus agacant qu'une liste
 * qui vous ramene en bas pendant que vous lisez.
 */
export function RunTimeline({ endpoint, initialEvents, active }: RunTimelineProps) {
  const [events, setEvents] = useState<ClaudeRunEvent[]>(initialEvents);
  const [connection, setConnection] = useState<ConnectionState>(active ? "idle" : "closed");
  const [truncated, setTruncated] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const listRef = useRef<HTMLOListElement | null>(null);
  const stickToBottom = useRef(true);

  // Le curseur vit dans une reference : il change a chaque evenement recu, et
  // le relire dans l'effet ne doit pas rouvrir la connexion.
  const cursor = useRef(initialEvents.at(-1)?.sequence ?? 0);

  const append = useCallback((incoming: ClaudeRunEvent) => {
    cursor.current = Math.max(cursor.current, incoming.sequence);
    setEvents((previous) => {
      if (previous.some((event) => event.sequence === incoming.sequence)) {
        return previous;
      }
      return [...previous, incoming].sort((a, b) => a.sequence - b.sequence);
    });
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    const url = `${endpoint.split("?")[0] ?? endpoint}?afterSequence=${String(cursor.current)}`;
    const source = new EventSource(url);
    let closed = false;

    const close = (): void => {
      closed = true;
      source.close();
    };

    source.addEventListener("open", () => {
      setConnection("open");
    });

    source.addEventListener("run-event", (message) => {
      try {
        const parsed: unknown = JSON.parse((message as MessageEvent<string>).data);
        // Le contrat partage valide l'evenement avant qu'il n'atteigne le rendu :
        // une reponse hors contrat est ignoree plutot qu'affichee de travers.
        if (isClaudeRunEvent(parsed)) {
          append(parsed);
        }
      } catch {
        // Une charge illisible ne doit pas casser le flux.
      }
    });

    source.addEventListener("run-status", (message) => {
      try {
        const parsed = JSON.parse((message as MessageEvent<string>).data) as {
          truncated?: boolean;
        };
        setConnection("open");
        if (parsed.truncated === true) {
          setTruncated(true);
        }
      } catch {
        // Idem.
      }
    });

    source.addEventListener("run-unreachable", () => {
      setConnection("lost");
    });

    source.addEventListener("run-closed", () => {
      setConnection("closed");
      close();
      // La page est re-rendue cote serveur : le resultat complet, l'etat Git et
      // le statut final y sont deja persistes.
      window.location.reload();
    });

    source.addEventListener("error", () => {
      if (!closed) {
        setConnection("lost");
      }
    });

    return () => {
      close();
    };
    // `attempt` force une reconnexion manuelle sans dupliquer la logique.
  }, [endpoint, active, append, attempt]);

  useEffect(() => {
    const list = listRef.current;
    if (list !== null && stickToBottom.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [events]);

  const onScroll = (): void => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    // Une marge de quelques pixels : un defilement inertiel s'arrete rarement
    // au pixel exact, et exiger l'egalite stricte desactiverait le suivi sans
    // que l'utilisateur ait rien demande.
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    stickToBottom.current = distance < 24;
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Activite Claude Code</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Actions et messages publics, au fil de l&apos;execution. Le raisonnement interne du
            modele n&apos;est jamais affiche.
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          <span className="font-mono text-zinc-300">{events.length}</span>{" "}
          {events.length > 1 ? "evenements" : "evenement"}
        </p>
      </header>

      {active ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-5 py-3 text-xs"
        >
          {connection === "lost" ? (
            <>
              <span className="text-amber-200/90">
                Le flux en direct est interrompu. Les evenements deja recus restent affiches ;
                l&apos;execution, elle, continue.
              </span>
              <button
                type="button"
                onClick={() => { setAttempt((value) => value + 1); }}
                className="rounded-md border border-zinc-700 px-3 py-1 font-medium text-zinc-200 transition-colors hover:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
              >
                Reconnect
              </button>
            </>
          ) : (
            <span className="flex items-center gap-2 text-teal-200/90">
              <span
                aria-hidden="true"
                className="size-1.5 animate-pulse rounded-full bg-teal-300"
              />
              Suivi en direct. Vous pouvez fermer cet onglet : Claude Code continue.
            </span>
          )}
        </div>
      ) : null}

      {truncated ? (
        <p className="border-b border-zinc-800 px-5 py-3 text-xs text-amber-200/90">
          Cette execution a produit trop d&apos;evenements pour qu&apos;ils soient tous conserves.
          Les statuts, les erreurs et le resultat final le sont toujours.
        </p>
      ) : null}

      {events.length === 0 ? (
        <p className="px-5 py-6 text-sm text-zinc-500">
          Aucun evenement enregistre pour cette execution.
        </p>
      ) : (
        <ol
          ref={listRef}
          onScroll={onScroll}
          tabIndex={0}
          aria-label="Evenements de l'execution"
          className="max-h-[28rem] overflow-y-auto px-2 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
        >
          {events.map((event) => (
            <TimelineRow key={event.sequence} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Teintes par nature d'evenement.
 *
 * La couleur ne porte jamais l'information seule : chaque ligne affiche aussi le
 * type en toutes lettres, et une erreur est annoncee par `role="alert"`.
 */
const KIND_CLASSES: Record<string, string> = {
  [CLAUDE_RUN_EVENT_KIND.STATUS]: "text-teal-200/90",
  [CLAUDE_RUN_EVENT_KIND.ASSISTANT_MESSAGE]: "text-zinc-200",
  [CLAUDE_RUN_EVENT_KIND.TOOL_STARTED]: "text-zinc-300",
  [CLAUDE_RUN_EVENT_KIND.TOOL_COMPLETED]: "text-zinc-500",
  [CLAUDE_RUN_EVENT_KIND.VALIDATION]: "text-sky-200/90",
  [CLAUDE_RUN_EVENT_KIND.WARNING]: "text-amber-200/90",
  [CLAUDE_RUN_EVENT_KIND.ERROR]: "text-red-300",
  [CLAUDE_RUN_EVENT_KIND.RESULT]: "text-teal-200",
  [CLAUDE_RUN_EVENT_KIND.TRUNCATED]: "text-amber-200/90",
};

function TimelineRow({ event }: { event: ClaudeRunEvent }) {
  return (
    <li
      // Chaque ligne est atteignable au clavier : une timeline qu'on ne peut
      // parcourir qu'a la souris exclut une partie des lecteurs.
      tabIndex={0}
      className="flex gap-3 rounded-md px-3 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-500 hover:bg-zinc-800/40"
    >
      <time className="shrink-0 font-mono text-xs leading-6 text-zinc-600">
        {formatEventTime(event.occurredAt)}
      </time>

      <div className="min-w-0 flex-1">
        <p
          {...(event.isError ? { role: "alert" as const } : {})}
          className={`text-sm leading-6 ${KIND_CLASSES[event.kind] ?? "text-zinc-300"}`}
        >
          {/* Espacement anglais : le reste de l'interface l'est aussi, et ce
              texte est lu par les lecteurs d'ecran comme copie avec la page. */}
          <span className="sr-only">{runEventKindLabel(event.kind)}: </span>
          {event.label}
        </p>
        {event.detail === null ? null : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-500">
            {event.detail}
          </p>
        )}
      </div>
    </li>
  );
}
