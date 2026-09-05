/**
 * La planification de backlog en vol : la regarder, et l'arreter.
 *
 * Meme forme et memes raisons que son equivalent de conversation : un Route
 * Handler parce qu'une Server Action ne peut pas en interrompre une autre, la
 * base conclue avant le reseau parce que c'est cet ordre qui ferme la course, et
 * un corps de reponse volontairement pauvre.
 *
 * C'est la surface sur laquelle le second pilote reel a perdu deux appels : la
 * generation du backlog de V1 a depasse le delai deux fois de suite, sans que
 * rien a l'ecran ne dise depuis combien de temps elle travaillait ni comment
 * reprendre la main.
 */

import { cancelBacklogGeneration, getActiveBacklogGeneration, getDatabaseClient } from "@nox/database";
import { NextResponse } from "next/server";

import { abortArchitectCall } from "@/lib/architect/cancellation";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Le projet existe-t-il ? Un identifiant devine ne revele rien. */
async function projectExists(projectId: string): Promise<boolean> {
  const project = await getDatabaseClient().project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  return project !== null;
}

/** Y a-t-il une planification en vol, et depuis quand ? */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!(await projectExists(projectId))) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const active = await getActiveBacklogGeneration(getDatabaseClient(), projectId);

  return NextResponse.json(
    { ok: true, active: active === null ? null : { startedAt: active.startedAt } },
    { headers: NO_STORE },
  );
}

/** Arrete la planification en vol. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!(await projectExists(projectId))) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const cancelled = await cancelBacklogGeneration(getDatabaseClient(), { projectId });
  if (!cancelled.ok) {
    return NextResponse.json({ ok: true, stopped: false, aborted: false }, { headers: NO_STORE });
  }

  const aborted = abortArchitectCall(cancelled.generation.id);

  return NextResponse.json({ ok: true, stopped: true, aborted }, { headers: NO_STORE });
}
