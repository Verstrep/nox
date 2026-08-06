/**
 * Etat d'une execution, pour le navigateur.
 *
 * Le navigateur ne parle **jamais** au runner : le jeton partage ne doit pas
 * quitter le serveur. Ce Route Handler est l'intermediaire — il interroge le
 * runner cote serveur, persiste ce qu'il apprend, et ne renvoie au navigateur
 * que des donnees publiques.
 *
 * Il est idempotent : deux appels rapproches, ou deux onglets ouverts, ne
 * produisent pas deux resultats differents. Toute ecriture passe par
 * `reconcileRun`, ou le premier etat final gagne.
 */

import { getDatabaseClient, getTaskById } from "@nox/database";
import { isFinalRunStatus } from "@nox/shared";
import { NextResponse } from "next/server";

import { loadRun, reconcileRun } from "@/lib/runs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; taskId: string; runId: string }> },
) {
  const { projectId, taskId, runId } = await params;

  const run = await loadRun(runId);
  if (run === null || run.taskId !== taskId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // La chaine projet → tache → execution est verifiee entierement : un
  // identifiant d'execution devine ne doit rien reveler d'un autre projet.
  const task = await getTaskById(getDatabaseClient(), taskId);
  if (task === null || task.projectId !== projectId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const reconciled = await reconcileRun(run);

  // Ni prompt, ni compte rendu, ni sortie d'erreur : le navigateur n'a besoin
  // que de savoir s'il doit continuer a interroger. Le contenu, lui, arrive au
  // prochain rendu de la page, cote serveur.
  return NextResponse.json(
    {
      ok: true,
      run: {
        id: reconciled.id,
        code: reconciled.code,
        status: reconciled.status,
        final: isFinalRunStatus(reconciled.status),
        startedAt: reconciled.startedAt,
        finishedAt: reconciled.finishedAt,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
