import { getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { planUrl, writePlanList } from "@/lib/plan-display";
import { loadStructuredState } from "@/lib/project-plan";
import { loadProject } from "@/lib/projects";

import { V1PlanForm } from "../V1PlanForm";
import { EMPTY_V1_PLAN_FORM_VALUES, type V1PlanFormValues } from "../form-state";

/**
 * Edition du plan de V1.
 *
 * Memes garanties que l'edition du brief : rien n'est cree en s'ouvrant, aucun
 * appel n'est declenche, et `expectedRevision` decrit ce que cette page a lu.
 */
export default async function EditProjectV1PlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const db = getDatabaseClient();
  const state = await loadStructuredState(db, project);
  const plan = state.plan.stored;

  const initialValues: V1PlanFormValues =
    plan === null
      ? EMPTY_V1_PLAN_FORM_VALUES
      : {
          goal: plan.goal,
          inScope: writePlanList(plan.inScope),
          outOfScope: writePlanList(plan.outOfScope),
          technicalDirection: plan.technicalDirection,
          milestones: writePlanList(plan.milestones),
        };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <Link href={planUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour au plan
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-50">
            {plan === null ? "Define V1 plan" : "Edit V1 plan"}
          </h1>
          <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
          Ce que la premiere version doit accomplir, et ce qu&apos;elle laisse de cote. Ce
          n&apos;est pas un backlog : aucune tache, aucun critere d&apos;acceptation, aucune
          commande n&apos;a sa place ici.
        </p>
      </header>

      <main>
        <V1PlanForm
          projectId={project.id}
          expectedRevision={state.plan.revision}
          initialValues={initialValues}
          cancelHref={planUrl(project.id)}
        />
      </main>
    </div>
  );
}
