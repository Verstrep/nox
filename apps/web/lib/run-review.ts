/**
 * Review d'une execution, cote serveur.
 *
 * ## Le runner est interroge une fois, et une seule
 *
 * Le runner possede l'instantane capture a la fin de l'execution ; SQLite le
 * conserve. Ce module transfere le premier vers le second **exactement une
 * fois** — ensuite, la base fait foi et le runner n'est plus jamais appele pour
 * cette execution.
 *
 * Ce n'est pas une economie de requetes, c'est la definition meme d'une review :
 * ce qui est affiche doit etre ce qui a ete capture ce jour-la. Un second
 * transfert ne pourrait qu'ecraser l'original par quelque chose de plus recent,
 * donc de faux.
 *
 * La garantie ne repose pas sur la discipline de ce fichier : `saveRunReview`
 * refuse d'ecrire si `reviewCapturedAt` est deja renseigne. Le controle prealable
 * ci-dessous evite seulement un aller-retour HTTP inutile.
 *
 * ## Une panne du runner ne conclut rien
 *
 * Un runner injoignable ne produit ni review vide, ni erreur enregistree : la
 * page affiche ce que la base contient, et le transfert sera retente a la
 * prochaine ouverture. Seul un refus **explicite** du runner — capture ratee —
 * est enregistre comme tel.
 */

import {
  getDatabaseClient,
  getRunReview,
  hasRunReview,
  markRunReviewFailed,
  saveRunReview,
  seedRunValidations,
  type RunReview,
} from "@nox/database";
import { RUNNER_ERROR, isFinalRunStatus, type RunStatus } from "@nox/shared";
import { connection } from "next/server";

import { fetchClaudeRunReview } from "./runner/client.ts";

/** Review d'une execution, telle que la page la lit. */
export async function loadRunReview(runId: string): Promise<RunReview | null> {
  await connection();
  return getRunReview(getDatabaseClient(), runId);
}

/**
 * Recopie les commandes de validation attendues au lancement d'une execution.
 *
 * Appelee a la creation du run, avant tout demarrage : une commande que l'agent
 * ne lancera jamais doit quand meme figurer dans la review, et elle ne le
 * pourrait pas si la table se remplissait au fil de l'execution.
 */
export async function snapshotRunValidations(
  runId: string,
  commands: readonly string[],
): Promise<void> {
  await connection();
  await seedRunValidations(getDatabaseClient(), runId, commands);
}

/**
 * Transfere l'instantane du runner vers la base, si ce n'est pas deja fait.
 *
 * Retourne `true` lorsqu'une review vient d'etre enregistree. Ne leve jamais :
 * une review absente est un defaut d'affichage, pas une raison de faire tomber
 * la page d'une execution.
 */
export async function syncRunReview(
  runId: string,
  runnerRunId: string,
  status: RunStatus,
): Promise<boolean> {
  await connection();

  // Une execution active n'a pas encore de review : le repository bouge encore,
  // et capturer maintenant photographierait un etat qui n'existera plus.
  if (!isFinalRunStatus(status)) {
    return false;
  }

  const db = getDatabaseClient();

  // Le controle qui rend l'instantane immuable en pratique : une review deja
  // enregistree n'est jamais redemandee, donc jamais remplacee.
  if (await hasRunReview(db, runId)) {
    return false;
  }

  const result = await fetchClaudeRunReview(runnerRunId);

  if (result.ok) {
    return saveRunReview(db, runId, result.value);
  }

  // Le runner a bien repondu, et sa reponse est un refus definitif : la capture
  // a echoue, ou l'execution a disparu de son registre. Dans les deux cas, il
  // n'y aura pas de review — le dire vaut mieux que reessayer eternellement.
  if (result.failure.kind === "runner_error") {
    const definitive =
      result.failure.code === RUNNER_ERROR.CLAUDE_REVIEW_FAILED ||
      result.failure.code === RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND;

    if (definitive) {
      await markRunReviewFailed(db, runId, result.failure.code);
    }
    return false;
  }

  // Runner arrete, delai depasse, reponse illisible : rien n'est conclu, et la
  // prochaine ouverture de page retentera.
  return false;
}
