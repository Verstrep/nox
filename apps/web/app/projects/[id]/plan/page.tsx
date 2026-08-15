import type { ProjectBrief, ProjectV1Plan } from "@nox/shared";
import { getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { architectUrl } from "@/lib/architect/display";
import { formatIsoDateTime } from "@/lib/format";
import {
  briefSectionState,
  editBriefUrl,
  editPlanUrl,
  formatPlanSize,
  planSectionState,
  type PlanSectionState,
} from "@/lib/plan-display";
import { loadStructuredState } from "@/lib/project-plan";
import { loadProject } from "@/lib/projects";

/** Un champ de texte, ou la mention explicite qu'il n'est pas renseigne. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-zinc-600">{label}</h3>
      {value === "" ? (
        <p className="mt-1.5 text-sm italic text-zinc-600">Non renseigne.</p>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{value}</p>
      )}
    </div>
  );
}

/**
 * Une liste, numerotee ou non.
 *
 * Les etapes sont numerotees parce que leur ordre porte une progression ; les
 * autres listes ne le sont pas, parce que le leur n'en porte aucune.
 */
function List({
  label,
  values,
  ordered = false,
}: {
  label: string;
  values: readonly string[];
  ordered?: boolean;
}) {
  const items = values.map((value, index) => (
    <li key={`${String(index)}-${value}`} className="text-sm leading-relaxed text-zinc-300">
      {value}
    </li>
  ));

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-zinc-600">{label}</h3>
      {values.length === 0 ? (
        <p className="mt-1.5 text-sm italic text-zinc-600">Aucun.</p>
      ) : ordered ? (
        <ol className="mt-1.5 list-decimal space-y-1 pl-5 marker:text-zinc-600">{items}</ol>
      ) : (
        <ul className="mt-1.5 list-disc space-y-1 pl-5 marker:text-zinc-600">{items}</ul>
      )}
    </div>
  );
}

/** Invitation a definir une section qui n'existe pas encore. */
function NotDefined({ children, href, label }: { children: ReactNode; href: string; label: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm leading-relaxed text-zinc-500">{children}</p>
      <Link
        href={href}
        className="self-start rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
      >
        {label}
      </Link>
    </div>
  );
}

function EditLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
    >
      {label}
    </Link>
  );
}

/** Ligne discrete de metadonnees : quand, et combien de place. */
function Meta({ updatedAt, chars }: { updatedAt: string; chars: number }) {
  return (
    <p className="mt-6 border-t border-zinc-800/60 pt-4 text-xs text-zinc-600">
      Modifie le {formatIsoDateTime(updatedAt) ?? "-"} · {formatPlanSize(chars)} transmis a
      l&apos;Architecte
    </p>
  );
}

function stateBadge(state: PlanSectionState): ReactNode {
  if (state === "defined") {
    return <StatusBadge tone="accent">Defined</StatusBadge>;
  }
  if (state === "empty") {
    return <StatusBadge tone="muted">Defined, empty</StatusBadge>;
  }
  return <StatusBadge tone="neutral">Not defined</StatusBadge>;
}

function BriefBody({ brief, projectId }: { brief: ProjectBrief; projectId: string }) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Resume" value={brief.summary} />
      <Field label="Probleme" value={brief.problem} />
      <Field label="Utilisateurs vises" value={brief.targetUsers} />
      <Field label="Resultat vise" value={brief.desiredOutcome} />
      <List label="Objectifs" values={brief.goals} />
      <List label="Hors objectifs" values={brief.nonGoals} />
      <div>
        <EditLink href={editBriefUrl(projectId)} label="Edit brief" />
      </div>
    </div>
  );
}

function PlanBody({ plan, projectId }: { plan: ProjectV1Plan; projectId: string }) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Objectif de la V1" value={plan.goal} />
      <List label="Dans le perimetre" values={plan.inScope} />
      <List label="Hors perimetre" values={plan.outOfScope} />
      <Field label="Direction technique" value={plan.technicalDirection} />
      <List label="Etapes" values={plan.milestones} ordered />
      <div>
        <EditLink href={editPlanUrl(projectId)} label="Edit V1 plan" />
      </div>
    </div>
  );
}

/**
 * Etat structure d'un projet : son brief produit et son plan de V1.
 *
 * ## Cette page ne declenche rien
 *
 * Ouvrir, lire, revenir : aucun appel a OpenAI, aucun lancement de Claude Code,
 * aucune requete au runner, aucune commande Git. Tout vient de SQLite, et la
 * page fonctionne runner arrete et sans configuration OpenAI.
 *
 * ## Elle ne cree aucune ligne
 *
 * Un projet neuf n'a ni brief ni plan, et cette page ne les invente pas : elle
 * propose de les definir. Une ligne creee par un simple affichage rendrait
 * impossible de distinguer « jamais defini » de « defini et vide », et cette
 * distinction decide de ce que l'Architecte lit.
 *
 * ## Elle n'ecrit pas dans le repository
 *
 * Le brief structure de NOX n'est pas `docs/PROJECT_BRIEF.md`. Les deux
 * coexistent, aucun n'est genere depuis l'autre, et aucune synchronisation
 * n'existe.
 */
export default async function ProjectPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const db = getDatabaseClient();
  const state = await loadStructuredState(db, project);

  const brief = state.brief.stored;
  const plan = state.plan.stored;
  const briefState = briefSectionState(state.brief.present, brief);
  const planState = planSectionState(state.plan.present, plan);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={`/projects/${project.id}`}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            &larr; Retour au projet
          </Link>
          <Link href={architectUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
            Back to Project Architect
          </Link>
        </div>

        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-50">Project plan</h1>
          <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
        </div>

        <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
          L&apos;intention produit actuelle de ce projet, telle que vous l&apos;avez validee. Elle
          accompagne chaque conversation Architecte, et prime sur la documentation du repository,
          qui peut avoir pris du retard.
        </p>
      </header>

      <main className="flex flex-col gap-8">
        <SectionCard
          title="Project brief"
          description="Ce qu'on construit, pour qui, contre quel probleme. Il bouge peu."
          action={stateBadge(briefState)}
        >
          {brief === null ? (
            <NotDefined href={editBriefUrl(project.id)} label="Define project brief">
              Not defined yet. Decrivez le produit une fois : l&apos;Architecte n&apos;aura plus a
              le redemander a chaque conversation.
            </NotDefined>
          ) : (
            <>
              <BriefBody brief={brief} projectId={project.id} />
              <Meta updatedAt={brief.updatedAt} chars={state.brief.chars} />
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Living V1 plan"
          description="Ce que la premiere version doit accomplir. Il bouge souvent."
          action={stateBadge(planState)}
        >
          {plan === null ? (
            <NotDefined href={editPlanUrl(project.id)} label="Define V1 plan">
              Not defined yet. Une etape decrit une capacite atteinte — « le planning hebdomadaire
              est utilisable » —, jamais un travail a faire.
            </NotDefined>
          ) : (
            <>
              <PlanBody plan={plan} projectId={project.id} />
              <Meta updatedAt={plan.updatedAt} chars={state.plan.chars} />
            </>
          )}
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Cet etat vit dans la base locale de NOX, jamais dans le repository. Aucun fichier
        n&apos;est ecrit, aucun commit n&apos;est cree, et{" "}
        <code className="font-mono">docs/PROJECT_BRIEF.md</code> reste un document distinct que NOX
        ne genere pas.
      </footer>
    </div>
  );
}
