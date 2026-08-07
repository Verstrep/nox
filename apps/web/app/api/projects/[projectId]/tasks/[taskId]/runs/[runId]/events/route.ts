/**
 * Flux d'evenements d'une execution, en SSE.
 *
 * Le navigateur ne parle **jamais** au runner : le jeton partage ne doit pas
 * quitter le serveur. Ce Route Handler est l'intermediaire — il interroge le
 * runner cote serveur, persiste ce qu'il apprend, et ne pousse au navigateur que
 * des evenements deja normalises et nettoyes.
 *
 * ## Pourquoi SSE plutot qu'un WebSocket
 *
 * Le flux est a sens unique : le serveur envoie, le navigateur ecoute. Un
 * WebSocket apporterait un canal montant dont on n'a aucun usage, une poignee de
 * main a gerer, et un protocole de plus a securiser. SSE tient dans un `GET`,
 * traverse les memes controles d'acces que le reste, et se reconnecte tout seul.
 *
 * ## Pourquoi une boucle d'interrogation derriere le flux
 *
 * Le runner ne pousse rien : son registre est interroge. La boucle ci-dessous
 * transforme cette interrogation en flux — c'est du polling cote serveur, mais
 * le navigateur, lui, recoit bien du temps reel, sans ouvrir une requete par
 * seconde. L'ecart de complexite avec un vrai canal pousse ne se justifierait pas
 * pour un outil local a une seule execution active.
 *
 * ## Ce qui arrete la boucle
 *
 * Trois choses, et rien d'autre : l'execution atteint un etat final, le
 * navigateur ferme la connexion (`AbortSignal`), ou la duree maximale du flux est
 * atteinte. Aucune boucle ne survit a la fermeture d'un onglet.
 */

import { getDatabaseClient, getTaskById } from "@nox/database";
import type { ClaudeRunEvent } from "@nox/shared";

import { loadLastEventSequence, loadPersistedRunEvents, syncRunEvents } from "@/lib/run-events";
import { loadRun, reconcileRun } from "@/lib/runs";

/** Intervalle entre deux interrogations du runner. */
const POLL_INTERVAL_MS = 1_000;

/** Intervalle entre deux battements de coeur, en l'absence d'evenement. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Duree maximale d'un flux.
 *
 * Au-dela, le flux se ferme proprement et le navigateur se reconnecte avec son
 * curseur. Une connexion qui vivrait indefiniment finirait par etre coupee par
 * un intermediaire, au moment le moins choisi, et sans que rien ne l'anticipe.
 */
const MAX_STREAM_MS = 10 * 60 * 1_000;

function encodeEvent(name: string, data: unknown, id?: number): string {
  const identifier = id === undefined ? "" : `id: ${String(id)}\n`;
  return `${identifier}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Curseur de depart de la connexion.
 *
 * `Last-Event-ID` est envoye automatiquement par le navigateur lors d'une
 * reconnexion : c'est lui qui garantit qu'aucun evenement n'est saute ni
 * redonne. Le parametre `afterSequence` sert au premier appel, quand la page
 * connait deja son historique.
 */
function readCursor(request: Request): number {
  const header = request.headers.get("last-event-id");
  const fromHeader = header === null ? Number.NaN : Number.parseInt(header, 10);
  if (Number.isInteger(fromHeader) && fromHeader >= 0) {
    return fromHeader;
  }

  const parameter = new URL(request.url).searchParams.get("afterSequence");
  const fromQuery = parameter === null ? Number.NaN : Number.parseInt(parameter, 10);
  return Number.isInteger(fromQuery) && fromQuery >= 0 ? fromQuery : 0;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; taskId: string; runId: string }> },
) {
  const { projectId, taskId, runId } = await params;

  const run = await loadRun(runId);
  if (run === null || run.taskId !== taskId) {
    return new Response(null, { status: 404 });
  }

  // La chaine projet → tache → execution est verifiee entierement : un
  // identifiant devine ne doit rien reveler d'un autre projet.
  const task = await getTaskById(getDatabaseClient(), taskId);
  if (task === null || task.projectId !== projectId) {
    return new Response(null, { status: 404 });
  }

  const requestedCursor = readCursor(request);
  const persistedCursor = await loadLastEventSequence(runId);

  // Le navigateur peut demander plus loin que la base ne va — page rouverte,
  // curseur d'une autre execution. On ne remonte jamais avant ce qu'il dit avoir
  // vu, mais on ne saute pas non plus ce que la base connait deja.
  const backlog: ClaudeRunEvent[] =
    requestedCursor < persistedCursor
      ? (await loadPersistedRunEvents(runId)).filter(
          (event) => event.sequence > requestedCursor,
        )
      : [];

  const runnerRunId = run.runnerRunId;
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let cursor = requestedCursor;
      let lastBeat = Date.now();

      const send = (chunk: string): boolean => {
        if (closed) {
          return false;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          // Le navigateur est parti entre deux ecritures : ce n'est pas une
          // erreur, c'est la fin normale d'un flux.
          closed = true;
          return false;
        }
      };

      const finish = (): void => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          controller.close();
        } catch {
          // Deja ferme par l'abandon du client.
        }
      };

      // La fermeture de l'onglet doit arreter la boucle, pas seulement cesser
      // d'ecrire : sans cela, le serveur continuerait d'interroger le runner
      // pour un lecteur qui n'existe plus.
      request.signal.addEventListener("abort", finish);

      // 1. L'historique deja connu part immediatement : la timeline est complete
      //    des la premiere seconde, sans attendre le premier tour de boucle.
      for (const event of backlog) {
        if (!send(encodeEvent("run-event", event, event.sequence))) {
          return;
        }
        cursor = event.sequence;
      }

      // 2. Puis la boucle du direct.
      for (;;) {
        if (closed || request.signal.aborted) {
          finish();
          return;
        }

        if (Date.now() - startedAt > MAX_STREAM_MS) {
          send(encodeEvent("run-closed", { reason: "timeout", nextSequence: cursor }));
          finish();
          return;
        }

        const view = await syncRunEvents(runId, runnerRunId, cursor);

        for (const event of view.events) {
          if (!send(encodeEvent("run-event", event, event.sequence))) {
            return;
          }
          lastBeat = Date.now();
        }
        cursor = Math.max(cursor, view.nextSequence);

        if (view.unreachable !== null) {
          // Le runner ne repond pas : on le dit, et on continue d'essayer. Une
          // execution en cours ne se conclut pas sur un silence.
          send(encodeEvent("run-unreachable", { message: view.unreachable }));
        } else {
          send(
            encodeEvent("run-status", {
              status: view.status,
              final: view.isFinal,
              truncated: view.truncated,
              nextSequence: cursor,
            }),
          );
        }

        if (view.isFinal) {
          // Le resultat complet est persiste avant de fermer : le navigateur
          // rafraichira la page et trouvera tout en place.
          await reconcileRun(run).catch(() => undefined);
          send(encodeEvent("run-closed", { reason: "final", nextSequence: cursor }));
          finish();
          return;
        }

        if (Date.now() - lastBeat > HEARTBEAT_INTERVAL_MS) {
          lastBeat = Date.now();
          if (!send(encodeEvent("heartbeat", {}))) {
            return;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      // Desactive la mise en tampon des proxys qui la pratiquent : un flux
      // bufferise arrive d'un bloc a la fin, ce qui annule tout l'interet.
      "x-accel-buffering": "no",
    },
  });
}
