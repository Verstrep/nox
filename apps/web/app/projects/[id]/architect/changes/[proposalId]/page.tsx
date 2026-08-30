import {
  PROJECT_UPDATE_FIELD_KIND,
  REPLAN_CHANGE,
  REPLAN_PROPOSAL_STATUS,
  type ProjectUpdateReviewField,
  type ProjectUpdateReviewSection,
} from "@nox/shared";
import { getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { architectUrl } from "@/lib/architect/display";
import { formatIsoDateTime } from "@/lib/format";
import { planFieldLabel, planUrl, writePlanList } from "@/lib/plan-display";
import { loadStructuredState } from "@/lib/project-plan";
import { loadProject } from "@/lib/projects";
import { loadReplanChange } from "@/lib/replan/change";
import {
  REPLAN_NO_CHANGE_MESSAGE,
  REPLAN_STALE_MESSAGE,
  projectChangeInspectUrl,
  projectChangesUrl,
  replanChangeLabel,
  replanFieldLabel,
  replanLockLabel,
  replanStatusLabel,
  replanSummaryLines,
} from "@/lib/replan/display";
import type { ReplanDiffEntry } from "@/lib/replan/diff";
import { loadReplanProposal } from "@/lib/replan/service";
import { taskToReviewItem } from "@/lib/replan/target";
import { taskUrl } from "@/lib/task-display";

import { EMPTY_BRIEF_FORM_VALUES, EMPTY_V1_PLAN_FORM_VALUES } from "../../../plan/form-state";
import { DismissChangeButton } from "./DismissChangeButton";
import { ProjectChangeReview } from "./ProjectChangeReview";

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

/** Comparaison d'une section du projet, champ par champ. */
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
                field.changed ? "border-teal-400/30 bg-teal-400/5" : "border-zinc-800 bg-zinc-950/40"
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

/** Le sort d'une tache, resume en une ligne. */
function TaskChange({ entry }: { entry: ReplanDiffEntry }) {
  const tone =
    entry.change === REPLAN_CHANGE.REMOVE
      ? "border-amber-500/30 bg-amber-500/5"
      : entry.change === REPLAN_CHANGE.ADD
        ? "border-emerald-500/30 bg-emerald-500/5"
        : entry.change === REPLAN_CHANGE.UPDATE
          ? "border-teal-400/30 bg-teal-400/5"
          : "border-zinc-800 bg-zinc-950/40";

  return (
    <li className={`rounded-md border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-zinc-500">{entry.code ?? "New task"}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{entry.title}</span>
        <span className="text-xs text-zinc-400">{replanChangeLabel(entry.change)}</span>
      </div>

      {entry.previousTitle === null ? null : (
        <p className="mt-1 text-xs text-zinc-600">Titre actuel : {entry.previousTitle}</p>
      )}

      {entry.changedFields.length === 0 ? null : (
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          Champs modifies : {entry.changedFields.map(replanFieldLabel).join(", ")}
        </p>
      )}

      {entry.dependencyChanged ? (
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          Dependency changes :{" "}
          {entry.dependenciesBefore.length === 0 ? "aucune" : entry.dependenciesBefore.join(", ")}{" "}
          &rarr;{" "}
          {entry.dependenciesAfter.length === 0 ? "aucune" : entry.dependenciesAfter.join(", ")}
        </p>
      ) : null}

      {entry.reordered && entry.previousPosition !== null && entry.position !== null ? (
        <p className="mt-1.5 text-xs text-zinc-500">
          Reordered : position {entry.previousPosition + 1} &rarr; {entry.position + 1}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Revue combinee d'un changement de projet.
 *
 * ## Une intention, une page, un bouton
 *
 * Le plan produit et les taches futures se relisent ensemble, et s'appliquent
 * ensemble. Deux pages et deux `Apply` auraient rendu possible l'etat que
 * TASK-032 existe pour empecher : un Project Plan qui decrit un produit, et un
 * backlog qui en construit un autre.
 *
 * ## Elle n'appelle personne
 *
 * Ouvrir cette page, la relire, editer, reordonner, retirer, restaurer,
 * appliquer ou ecarter : aucun appel a OpenAI, aucune execution de Claude Code,
 * aucune requete au runner au rendu, aucune commande Git. Tout vient de SQLite.
 *
 * ## Un changement perime reste lisible
 *
 * Il n'est ni ecarte d'office, ni fusionne. NOX dit ce qui a change et laisse
 * l'utilisateur decider : il n'existe aucun bouton « fusionner », aucun
 * « appliquer quand meme », et aucun chemin de code allant d'un conflit vers un
 * nouvel appel.
 */
export default async function ProjectChangeReviewPage({
  params,
}: {
  params: Promise<{ id: string; proposalId: string }>;
}) {
  const { id, proposalId } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const db = getDatabaseClient();

  // L'appartenance au projet est verifiee ici : un changement d'un autre projet
  // est introuvable, jamais « refuse » — distinguer les deux confirmerait son
  // existence.
  const proposal = await loadReplanProposal(db, project.id, proposalId);
  if (proposal === null) {
    notFound();
  }

  const state = await loadStructuredState(db, project);
  const change = await loadReplanChange(db, project, proposal, state);

  const pending = proposal.status === REPLAN_PROPOSAL_STATUS.PENDING;
  const proposedBrief = change.update?.proposed.brief.value ?? null;
  const proposedPlan = change.update?.proposed.plan.value ?? null;

  const restorable = change.editable.flatMap((task, index) => {
    const item = taskToReviewItem(task, `r${String(index)}`);
    return item === null ? [] : [item];
  });

  const lockedCandidates = change.locked.map((task) => ({
    id: task.classified.id,
    code: task.classified.code,
    title: task.title,
    locked: true,
  }));

  const backHref = architectUrl(project.id);
  const summary = replanSummaryLines({
    added: change.diff.summary.added,
    updated: change.diff.summary.updated,
    removed: change.diff.summary.removed,
    dependencyChanged: change.diff.summary.dependencyChanged,
    orderChanged: change.diff.orderChanged,
  });

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
          <Link
            href={projectChangesUrl(project.id)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Project changes
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-50">Proposed project change</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
          </div>
          <StatusBadge
            tone={
              proposal.status === REPLAN_PROPOSAL_STATUS.APPLIED
                ? "accent"
                : proposal.status === REPLAN_PROPOSAL_STATUS.DISMISSED
                  ? "neutral"
                  : "muted"
            }
          >
            {replanStatusLabel(proposal.status)}
          </StatusBadge>
        </div>

        <div>
          <h2 className="text-xs uppercase tracking-wider text-zinc-600">
            Pourquoi l&apos;Architecte propose ce changement
          </h2>
          <p className="mt-1.5 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
            {proposal.rationale}
          </p>
        </div>

        <p className="text-xs text-zinc-600">
          Proposee le {formatIsoDateTime(proposal.createdAt.toISOString()) ?? "-"}
        </p>
      </header>

      <main className="flex flex-col gap-8">
        {change.stale.any && pending ? (
          <div
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            <p className="font-medium">{REPLAN_STALE_MESSAGE}</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
              {change.stale.brief ? <li>Le Project Brief a change depuis.</li> : null}
              {change.stale.plan ? <li>Le Living V1 Plan a change depuis.</li> : null}
              {change.stale.planning ? (
                <li>
                  Le plan des taches futures a change depuis : une tache editee, ajoutee, retiree,
                  inscrite en file, lancee, ou simplement deplacee.
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {proposal.status === REPLAN_PROPOSAL_STATUS.APPLIED ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm leading-relaxed text-emerald-200">
            <p>
              <span aria-hidden="true">✓ </span>
              {"Project change applied"}
            </p>
            <p className="mt-2 text-emerald-200/80">
              Le projet et son plan de travail refletent la version que vous avez validee. La
              proposition d&apos;origine reste conservee telle que l&apos;Architecte l&apos;avait
              rendue.
            </p>
          </div>
        ) : null}

        {proposal.status === REPLAN_PROPOSAL_STATUS.DISMISSED ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm leading-relaxed text-zinc-400">
            {"Project change dismissed"}. Ni le projet, ni ses taches n&apos;ont ete modifies.
          </div>
        ) : null}

        <SectionCard
          title="Resume"
          description="Ce que ce changement ferait au projet, avant toute edition de votre part."
        >
          <dl className="flex flex-col gap-3">
            {change.update === null ? null : (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-sm text-zinc-300">Project Plan</dt>
                <dd className="text-sm text-zinc-400">
                  {change.updateReview === null
                    ? "aucun changement"
                    : `${String(
                        change.updateReview.brief.fields.filter((field) => field.changed).length +
                          change.updateReview.plan.fields.filter((field) => field.changed).length,
                      )} champ(s) modifie(s)`}
                </dd>
              </div>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-sm text-zinc-300">Future tasks</dt>
              <dd className="text-sm text-zinc-400">
                {summary.length === 0 ? "aucun changement" : summary.join(" · ")}
              </dd>
            </div>
          </dl>
          {change.diff.unchanged && pending ? (
            <p className="mt-4 text-sm leading-relaxed text-zinc-500">
              {REPLAN_NO_CHANGE_MESSAGE}
            </p>
          ) : null}
        </SectionCard>

        {change.updateReview === null ? null : (
          <>
            {change.changesBrief ? (
              <SectionCard
                title="Project Brief"
                description="Ce que le changement modifierait, champ par champ."
              >
                <Comparison section={change.updateReview.brief} />
              </SectionCard>
            ) : null}
            {change.changesPlan ? (
              <SectionCard
                title="Living V1 Plan"
                description="Ce que le changement modifierait, champ par champ."
              >
                <Comparison section={change.updateReview.plan} />
              </SectionCard>
            ) : null}
          </>
        )}

        <SectionCard
          title="Future task changes"
          description="Derive par NOX en comparant le plan actuel et l'etat cible propose. L'Architecte ne pose jamais ces etiquettes lui-meme."
        >
          {change.diff.entries.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Cette proposition ne porte aucune tache future exploitable.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {change.diff.entries.map((entry) => (
                <TaskChange key={`${entry.taskId ?? entry.tempId ?? ""}-${entry.change}`} entry={entry} />
              ))}
            </ul>
          )}
        </SectionCard>

        {change.locked.length === 0 ? null : (
          <details className="rounded-lg border border-zinc-800">
            <summary className="cursor-pointer px-5 py-3 text-sm text-zinc-300 hover:text-zinc-100">
              Historical / already started
              <span className="ml-2 text-xs text-zinc-600">
                {String(change.locked.length)} tache(s) que ce changement ne peut pas reecrire
              </span>
            </summary>
            <div className="border-t border-zinc-800 px-5 py-4">
              <p className="mb-3 text-xs leading-relaxed text-zinc-600">
                Le passe est immuable : une tache commencee, executee, inscrite en file ou
                d&apos;amorcage n&apos;est jamais reecrite. Une tache future peut en revanche
                continuer a les attendre.
              </p>
              <ul className="flex flex-col gap-1.5">
                {change.locked.map((task) => (
                  <li key={task.classified.id} className="flex flex-wrap items-baseline gap-3">
                    <Link
                      href={taskUrl(project.id, task.classified.id)}
                      className="font-mono text-xs text-zinc-500 underline hover:text-zinc-300"
                    >
                      {task.classified.code}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                      {task.title}
                    </span>
                    <span className="text-xs text-zinc-600">
                      Locked
                      {task.classified.lockReason === null
                        ? ""
                        : ` · ${replanLockLabel(task.classified.lockReason)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}

        {pending ? (
          <>
            <SectionCard
              title="Appliquer"
              description="Corrigez ce que l'Architecte a propose avant d'enregistrer. C'est votre version qui sera appliquee."
            >
              <ProjectChangeReview
                projectId={project.id}
                proposalId={proposal.id}
                changesBrief={change.changesBrief}
                changesPlan={change.changesPlan}
                initialItems={change.items}
                initialBrief={
                  proposedBrief === null
                    ? EMPTY_BRIEF_FORM_VALUES
                    : {
                        summary: proposedBrief.summary,
                        problem: proposedBrief.problem,
                        targetUsers: proposedBrief.targetUsers,
                        desiredOutcome: proposedBrief.desiredOutcome,
                        goals: writePlanList(proposedBrief.goals),
                        nonGoals: writePlanList(proposedBrief.nonGoals),
                      }
                }
                initialPlan={
                  proposedPlan === null
                    ? EMPTY_V1_PLAN_FORM_VALUES
                    : {
                        goal: proposedPlan.goal,
                        inScope: writePlanList(proposedPlan.inScope),
                        outOfScope: writePlanList(proposedPlan.outOfScope),
                        technicalDirection: proposedPlan.technicalDirection,
                        milestones: writePlanList(proposedPlan.milestones),
                      }
                }
                restorable={restorable}
                lockedCandidates={lockedCandidates}
                cancelHref={backHref}
                blocked={change.stale.any}
              />
            </SectionCard>

            <div className="border-t border-zinc-800 pt-6">
              <DismissChangeButton projectId={project.id} proposalId={proposal.id} />
            </div>
          </>
        ) : null}

        <p className="text-xs text-zinc-600">
          <Link
            href={projectChangeInspectUrl(project.id, proposal.id)}
            className="underline hover:text-zinc-400"
          >
            Inspect
          </Link>{" "}
          — versions, empreintes, payload du fournisseur et cible appliquee.
        </p>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Un changement propose par l&apos;Architecte ne modifie jamais le projet tout seul. Seule une
        application explicite le fait, et elle n&apos;ecrit que dans la base locale de NOX et dans
        les documents Markdown des taches concernees : aucun commit, aucun push, aucune execution
        de Claude Code, aucun demarrage de file.
      </footer>
    </div>
  );
}
