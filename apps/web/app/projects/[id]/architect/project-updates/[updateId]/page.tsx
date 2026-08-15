import {
  ARCHITECT_PROJECT_UPDATE_STATUS,
  PROJECT_UPDATE_ACTION,
  PROJECT_UPDATE_FIELD_KIND,
  type ProjectUpdateReviewField,
  type ProjectUpdateReviewSection,
} from "@nox/shared";
import { getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { architectUrl } from "@/lib/architect/display";
import { loadProjectUpdate, projectUpdateReview } from "@/lib/architect/project-update";
import { formatIsoDateTime } from "@/lib/format";
import { planFieldLabel, planUrl, writePlanList } from "@/lib/plan-display";
import { loadStructuredState } from "@/lib/project-plan";
import { loadProject } from "@/lib/projects";

import { EMPTY_BRIEF_FORM_VALUES, EMPTY_V1_PLAN_FORM_VALUES } from "../../../plan/form-state";
import { DismissButton } from "./DismissButton";
import { ProjectUpdateForm } from "./ProjectUpdateForm";
import type { ProjectUpdateReviewValues } from "./form-state";

/** Une valeur, texte ou liste, telle que la comparaison l'affiche. */
function Value({ field, side }: { field: ProjectUpdateReviewField; side: "current" | "proposed" }) {
  if (field.kind === PROJECT_UPDATE_FIELD_KIND.LIST) {
    const values = side === "current" ? field.currentList : field.proposedList;
    if (values.length === 0) {
      return <p className="text-sm italic text-zinc-600">Aucun.</p>;
    }
    return (
      <ul className="list-disc space-y-1 pl-5 marker:text-zinc-700">
        {values.map((value, index) => (
          <li key={`${String(index)}-${value}`} className="text-sm leading-relaxed text-zinc-300">
            {value}
          </li>
        ))}
      </ul>
    );
  }

  const value = side === "current" ? field.currentText : field.proposedText;
  if (value === "") {
    return <p className="text-sm italic text-zinc-600">Non renseigne.</p>;
  }
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{value}</p>;
}

/**
 * Comparaison d'une section, champ par champ.
 *
 * Elle rend le modele de revue construit par `@nox/shared`, sans rien
 * recalculer : reconstruire une seconde comparaison ici la ferait diverger de
 * celle que le serveur utilise pour compter les changements.
 *
 * Pas de diff caractere par caractere : l'utilisateur relit une proposition pour
 * decider si la nouvelle valeur est la bonne, pas pour savoir quelles lettres
 * ont bouge.
 */
function Comparison({ section }: { section: ProjectUpdateReviewSection }) {
  return (
    <dl className="flex flex-col gap-5">
      {section.fields.map((field) => (
        <div key={field.field}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-600">
              {planFieldLabel(field.field)}
            </dt>
            <span className={`text-xs ${field.changed ? "text-teal-300" : "text-zinc-700"}`}>
              {field.changed ? "Changed" : "Unchanged"}
            </span>
          </div>
          <dd className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="mb-1.5 text-xs text-zinc-600">Current</p>
              <Value field={field} side="current" />
            </div>
            <div
              className={`rounded-md border p-3 ${
                field.changed
                  ? "border-teal-400/30 bg-teal-400/5"
                  : "border-zinc-800 bg-zinc-950/40"
              }`}
            >
              <p className="mb-1.5 text-xs text-zinc-600">Proposed</p>
              <Value field={field} side="proposed" />
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Revue d'une proposition de mise a jour du projet.
 *
 * ## Elle n'appelle personne
 *
 * Ouvrir cette page, la relire, appliquer ou ecarter : aucun appel a OpenAI,
 * aucune execution de Claude Code, aucune requete au runner, aucune commande
 * Git. Tout vient de SQLite.
 *
 * ## Une proposition perimee reste lisible
 *
 * Elle n'est ni ecartee d'office, ni fusionnee. NOX dit ce qui s'est passe et
 * laisse l'utilisateur decider : il n'existe aucun bouton « fusionner », et
 * aucun chemin de code allant d'un conflit vers un nouvel appel.
 */
export default async function ProjectUpdateReviewPage({
  params,
}: {
  params: Promise<{ id: string; updateId: string }>;
}) {
  const { id, updateId } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const db = getDatabaseClient();

  // L'appartenance au projet est verifiee ici : une proposition d'un autre
  // projet est introuvable, jamais « refusee » — distinguer les deux
  // confirmerait son existence.
  const update = await loadProjectUpdate(db, project.id, updateId);
  if (update === null) {
    notFound();
  }

  const state = await loadStructuredState(db, project);
  const review = projectUpdateReview(state, update.proposed);

  const stale =
    update.baseBriefRevision !== state.brief.revision ||
    update.basePlanRevision !== state.plan.revision;
  const pending = update.status === ARCHITECT_PROJECT_UPDATE_STATUS.PENDING;
  const changesBrief = update.proposed.brief.action === PROJECT_UPDATE_ACTION.SET;
  const changesPlan = update.proposed.plan.action === PROJECT_UPDATE_ACTION.SET;

  const proposedBrief = update.proposed.brief.value;
  const proposedPlan = update.proposed.plan.value;

  // Le formulaire part de ce que le fournisseur a propose. L'utilisateur le
  // corrige avant d'appliquer ; `proposedJson` n'est jamais touche.
  const initialValues: ProjectUpdateReviewValues = {
    brief:
      proposedBrief === null
        ? EMPTY_BRIEF_FORM_VALUES
        : {
            summary: proposedBrief.summary,
            problem: proposedBrief.problem,
            targetUsers: proposedBrief.targetUsers,
            desiredOutcome: proposedBrief.desiredOutcome,
            goals: writePlanList(proposedBrief.goals),
            nonGoals: writePlanList(proposedBrief.nonGoals),
          },
    plan:
      proposedPlan === null
        ? EMPTY_V1_PLAN_FORM_VALUES
        : {
            goal: proposedPlan.goal,
            inScope: writePlanList(proposedPlan.inScope),
            outOfScope: writePlanList(proposedPlan.outOfScope),
            technicalDirection: proposedPlan.technicalDirection,
            milestones: writePlanList(proposedPlan.milestones),
          },
  };

  const backHref = architectUrl(project.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={backHref} className="text-xs text-zinc-500 hover:text-zinc-300">
            &larr; Back to Project Architect
          </Link>
          <Link href={planUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
            Project plan
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-50">Proposed project update</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
          </div>
          {update.status === ARCHITECT_PROJECT_UPDATE_STATUS.APPLIED ? (
            <StatusBadge tone="accent">Applied</StatusBadge>
          ) : update.status === ARCHITECT_PROJECT_UPDATE_STATUS.DISMISSED ? (
            <StatusBadge tone="neutral">Dismissed</StatusBadge>
          ) : (
            <StatusBadge tone="muted">Pending</StatusBadge>
          )}
        </div>

        <div>
          <h2 className="text-xs uppercase tracking-wider text-zinc-600">
            Pourquoi l&apos;Architecte propose ce changement
          </h2>
          <p className="mt-1.5 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
            {review.reason}
          </p>
        </div>

        <p className="text-xs text-zinc-600">
          Proposee le {formatIsoDateTime(update.createdAt) ?? "-"}
        </p>
      </header>

      <main className="flex flex-col gap-8">
        {stale && pending ? (
          <div
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            <p className="font-medium">
              Cette proposition a ete construite a partir d&apos;un Project Plan plus ancien.
            </p>
            <p className="mt-2">
              Le Project Plan a change depuis que cette suggestion a ete generee. Relisez
              l&apos;etat actuel, et demandez une nouvelle proposition a l&apos;Architecte si elle
              reste utile. NOX ne fusionne jamais deux etats tout seul.
            </p>
          </div>
        ) : null}

        {update.status === ARCHITECT_PROJECT_UPDATE_STATUS.APPLIED ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm leading-relaxed text-emerald-200">
            <p>
              <span aria-hidden="true">✓ </span>
              {"Project update applied"}
            </p>
            <p className="mt-2 text-emerald-200/80">
              Le Project Plan reflete la version que vous avez validee. La proposition
              d&apos;origine reste conservee telle que l&apos;Architecte l&apos;avait rendue.
            </p>
            <Link
              href={planUrl(project.id)}
              className="mt-3 inline-block rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50"
            >
              Open Project Plan
            </Link>
          </div>
        ) : null}

        {update.status === ARCHITECT_PROJECT_UPDATE_STATUS.DISMISSED ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm leading-relaxed text-zinc-400">
            {"Project update dismissed"}. Le projet n&apos;a pas ete modifie.
          </div>
        ) : null}

        <SectionCard
          title="Project Brief"
          description={
            changesBrief
              ? "Ce que la proposition changerait, champ par champ."
              : undefined
          }
        >
          {changesBrief ? (
            <Comparison section={review.brief} />
          ) : (
            <p className="text-sm text-zinc-500">No proposed change</p>
          )}
        </SectionCard>

        <SectionCard
          title="Living V1 Plan"
          description={changesPlan ? "Ce que la proposition changerait, champ par champ." : undefined}
        >
          {changesPlan ? (
            <Comparison section={review.plan} />
          ) : (
            <p className="text-sm text-zinc-500">No proposed change</p>
          )}
        </SectionCard>

        {pending ? (
          <>
            <SectionCard
              title="Appliquer"
              description="Corrigez ce que l'Architecte a propose avant de l'enregistrer. C'est votre version qui sera appliquee."
            >
              <ProjectUpdateForm
                projectId={project.id}
                updateId={update.id}
                changesBrief={changesBrief}
                changesPlan={changesPlan}
                initialValues={initialValues}
                cancelHref={backHref}
                blocked={stale}
              />
            </SectionCard>

            <div className="border-t border-zinc-800 pt-6">
              <DismissButton projectId={project.id} updateId={update.id} />
            </div>
          </>
        ) : null}
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Une proposition de l&apos;Architecte ne modifie jamais le projet toute seule. Seule une
        application explicite le fait, et elle n&apos;ecrit que dans la base locale de NOX : aucun
        fichier du repository, aucun commit, aucune execution de Claude Code.
      </footer>
    </div>
  );
}
