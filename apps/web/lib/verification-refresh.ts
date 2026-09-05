/**
 * Rafraichissement des plans de verification, cote serveur.
 *
 * ## Ce que ce module fait
 *
 * Il relit ce dont un rafraichissement a besoin — configuration, projet — puis
 * delegue au service. Rien d'autre. C'est le meme decoupage que pour le backlog :
 * l'assemblage ici, la decision et l'appel dans `verification-refresh/service.ts`.
 *
 * ## Ce qu'il ne fait jamais
 *
 * Rien au rendu d'une page. Le seul appelant est la transition d'une tache
 * d'amorcage vers `COMPLETED`, et cette transition est un evenement applicatif :
 * elle a lieu une fois, quand un humain accepte le travail. Ouvrir vingt fois la
 * page d'un projet n'appelle personne.
 *
 * ## L'Architecte non configure n'est pas une panne
 *
 * Un projet sans `NOX_OPENAI_API_KEY` accepte son amorcage exactement comme
 * avant : le rafraichissement est simplement refuse, avec sa raison, et les
 * plans de verification restent ceux d'avant. C'est une amelioration
 * facultative, pas une etape obligatoire du cycle de vie.
 */

import { getDatabaseClient, type DatabaseClient } from "@nox/database";
import process from "node:process";

import { loadArchitectConfig } from "./architect/config.ts";
import { OpenAIArchitectProvider } from "./architect/openai.ts";
import { VERIFICATION_REFRESH_REFUSAL } from "@nox/shared";
import { synchronizeRefreshedDocuments } from "./verification-refresh/document-sync.ts";
import {
  maybeRefreshVerificationPlans,
  type MaybeRefreshResult,
  type RefreshProject,
} from "./verification-refresh/service.ts";

/**
 * Rafraichit les plans de verification apres l'acceptation d'un amorcage.
 *
 * Le fournisseur reel est construit ici, et seulement ici — apres que le service
 * a constate qu'un appel a lieu d'etre. Un projet dont rien n'est a ameliorer
 * n'instancie meme pas de client.
 */
export async function refreshVerificationPlansForProject(
  db: DatabaseClient,
  project: RefreshProject,
  taskId: string,
): Promise<MaybeRefreshResult> {
  const config = loadArchitectConfig(process.env);
  if (!config.ok) {
    return { attempted: false, code: VERIFICATION_REFRESH_REFUSAL.NOT_CONFIGURED };
  }

  return maybeRefreshVerificationPlans(db, {
    project,
    taskId,
    provider: new OpenAIArchitectProvider({ apiKey: config.config.apiKey }),
    model: config.config.model,
    environment: process.env,
    syncDocuments: synchronizeRefreshedDocuments,
  });
}

/** Variante qui prend le client par defaut, pour les Server Actions. */
export function refreshVerificationPlansWithDefaultClient(
  project: RefreshProject,
  taskId: string,
): Promise<MaybeRefreshResult> {
  return refreshVerificationPlansForProject(getDatabaseClient(), project, taskId);
}
