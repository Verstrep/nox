import { getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { planUrl, writePlanList } from "@/lib/plan-display";
import { loadStructuredState } from "@/lib/project-plan";
import { loadProject } from "@/lib/projects";

import { BriefForm } from "../BriefForm";
import { EMPTY_BRIEF_FORM_VALUES, type BriefFormValues } from "../form-state";

/**
 * Edition du brief produit.
 *
 * ## Elle ne cree rien en s'ouvrant
 *
 * Un projet sans brief affiche un formulaire vide et `expectedRevision` a
 * `null` — « je crois qu'aucun brief n'existe ». Si quelqu'un en cree un
 * entre-temps, l'enregistrement sera refuse comme perime plutot que d'ecraser.
 *
 * ## Aucun appel
 *
 * Ouvrir cette page lit une ligne SQLite, et rien d'autre.
 */
export default async function EditProjectBriefPage({
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
  const brief = state.brief.stored;

  const initialValues: BriefFormValues =
    brief === null
      ? EMPTY_BRIEF_FORM_VALUES
      : {
          summary: brief.summary,
          problem: brief.problem,
          targetUsers: brief.targetUsers,
          desiredOutcome: brief.desiredOutcome,
          goals: writePlanList(brief.goals),
          nonGoals: writePlanList(brief.nonGoals),
        };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <Link href={planUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour au plan
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-50">
            {brief === null ? "Define project brief" : "Edit project brief"}
          </h1>
          <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
          Ce que ce projet construit, pour qui, contre quel probleme. Aucun champ n&apos;est
          obligatoire : un brief partiel est un etat legitime, on connait souvent le probleme avant
          de savoir nommer la cible.
        </p>
      </header>

      <main>
        <BriefForm
          projectId={project.id}
          expectedRevision={state.brief.revision}
          initialValues={initialValues}
          cancelHref={planUrl(project.id)}
        />
      </main>
    </div>
  );
}
