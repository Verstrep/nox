/**
 * Evenements d'une execution, cote serveur.
 *
 * Deux sources, une seule verite affichee :
 *
 * - **SQLite** possede tout ce qui a deja ete observe. C'est la memoire longue :
 *   elle survit a la fermeture du navigateur, au redemarrage du runner, et a la
 *   fin de l'execution.
 * - **Le registre du runner** possede le direct. C'est la seule source des
 *   evenements qui n'ont pas encore ete vus, et elle disparait a son
 *   redemarrage.
 *
 * Ce module fait la jonction : il lit le neuf chez le runner, l'ecrit en base, et
 * rend le tout. Un evenement observe une fois est definitivement acquis — c'est
 * ce qui permet de fermer l'onglet sans rien perdre.
 *
 * ## Une panne du runner ne conclut rien
 *
 * Si le runner ne repond pas, ce module retourne ce que la base contient et le
 * **dit**. Il ne marque pas l'execution en echec, ne vide pas la timeline, et ne
 * pretend pas que le silence signifie la fin. L'execution continue peut-etre.
 */

import {
  appendRunEvents,
  getDatabaseClient,
  getLastRunEventSequence,
  listRunEvents,
} from "@nox/database";
import { RUN_EVENT_LIMITS, type ClaudeRunEvent, type RunStatus } from "@nox/shared";
import { connection } from "next/server";

import { fetchClaudeRunEvents } from "./runner/client.ts";
import { describeRunnerFailure, type RunnerFailure } from "./runner/errors.ts";

/** Etat des evenements a un instant donne. */
export type RunEventsView = {
  /** Evenements nouveaux depuis le curseur demande. */
  events: ClaudeRunEvent[];
  /** Curseur a presenter au prochain appel. */
  nextSequence: number;
  /** Statut vu par le runner, ou `null` s'il n'a pas repondu. */
  status: RunStatus | null;
  isFinal: boolean;
  truncated: boolean;
  /** Renseigne lorsque le runner n'a pas pu etre interroge. */
  unreachable: string | null;
};

/** Evenements deja persistes, dans l'ordre. */
export async function loadPersistedRunEvents(runId: string): Promise<ClaudeRunEvent[]> {
  await connection();
  return listRunEvents(getDatabaseClient(), runId);
}

/** Dernier numero connu en base : le point de reprise d'un onglet rouvert. */
export async function loadLastEventSequence(runId: string): Promise<number> {
  await connection();
  return getLastRunEventSequence(getDatabaseClient(), runId);
}

/**
 * Recupere les evenements nouveaux et les persiste.
 *
 * L'ecriture precede l'envoi au navigateur, et pas l'inverse : un evenement
 * affiche mais non enregistre disparaitrait au premier rafraichissement, et
 * l'utilisateur croirait avoir mal lu. L'insertion est idempotente — le couple
 * `runId + sequence` est unique en base —, donc rejouer un lot ne coute qu'une
 * requete sans effet.
 */
export async function syncRunEvents(
  runId: string,
  runnerRunId: string,
  afterSequence: number,
): Promise<RunEventsView> {
  await connection();

  const result = await fetchClaudeRunEvents(
    runnerRunId,
    afterSequence,
    RUN_EVENT_LIMITS.maxBatch,
  );

  if (!result.ok) {
    return unreachableView(afterSequence, result.failure);
  }

  const page = result.value;

  if (page.events.length > 0) {
    await appendRunEvents(getDatabaseClient(), runId, page.events);
  }

  return {
    events: page.events,
    nextSequence: Math.max(page.nextSequence, afterSequence),
    status: page.status,
    isFinal: page.isFinal,
    truncated: page.truncated,
    unreachable: null,
  };
}

/**
 * Nombre maximal d'allers-retours pour rattraper un retard.
 *
 * Le registre borne deja les evenements d'une execution ; ce plafond ne fait
 * qu'empecher une boucle infinie si le runner renvoyait indefiniment des lots
 * non vides. Genereux d'un facteur deux sur le pire cas reel.
 */
const MAX_CATCH_UP_ROUNDS =
  Math.ceil(
    (RUN_EVENT_LIMITS.maxEvents + RUN_EVENT_LIMITS.reservedEvents) / RUN_EVENT_LIMITS.maxBatch,
  ) * 2;

/**
 * Rattrape tout ce que le runner sait et que la base ignore.
 *
 * ## Pourquoi ce rattrapage existe
 *
 * Le flux SSE persiste au fil de l'eau, mais il ne tourne que tant qu'un onglet
 * est ouvert. Fermer la page pendant une execution — ce que NOX encourage
 * explicitement — laisse le runner produire des dizaines d'evenements que
 * personne ne lit. Sans ce rattrapage, rouvrir la page apres coup afficherait
 * une timeline qui s'arrete au milieu, alors que le runner, lui, a tout garde
 * pendant vingt-quatre heures.
 *
 * Appele au rendu de la page, y compris pour une execution **terminee** : c'est
 * justement le cas ou le flux ne se rouvrira jamais.
 *
 * Un runner injoignable interrompt simplement le rattrapage : ce qui est en base
 * reste affiche, et rien n'est conclu du silence.
 */
export async function catchUpRunEvents(runId: string, runnerRunId: string): Promise<number> {
  await connection();

  let cursor = await getLastRunEventSequence(getDatabaseClient(), runId);
  let recovered = 0;

  for (let round = 0; round < MAX_CATCH_UP_ROUNDS; round += 1) {
    const view = await syncRunEvents(runId, runnerRunId, cursor);

    if (view.unreachable !== null || view.events.length === 0) {
      return recovered;
    }

    recovered += view.events.length;
    cursor = view.nextSequence;
  }

  return recovered;
}

function unreachableView(afterSequence: number, failure: RunnerFailure): RunEventsView {
  return {
    events: [],
    nextSequence: afterSequence,
    // `null` et non un statut invente : NOX ne sait pas, et le dit.
    status: null,
    isFinal: false,
    truncated: false,
    unreachable: describeRunnerFailure(failure),
  };
}
