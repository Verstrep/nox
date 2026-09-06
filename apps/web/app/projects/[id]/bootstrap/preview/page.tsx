import { getDatabaseClient } from "@nox/database";
import { BOOTSTRAP_TASK_CODE, REPOSITORY_SHAPE } from "@nox/shared";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { loadBootstrapInput } from "@/lib/bootstrap";
import { bootstrapBlockerMessage, bootstrapUrl } from "@/lib/bootstrap/display";
import { prepareBootstrapPreview } from "@/lib/bootstrap/service";
import { taskPriorityLabel } from "@/lib/labels";
import { loadProject } from "@/lib/projects";

import { CreateBootstrapButton } from "../CreateBootstrapButton";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

function shapeLabel(shape: string): string {
  switch (shape) {
    case REPOSITORY_SHAPE.APPLICATION:
      return "Existing application";
    case REPOSITORY_SHAPE.MINIMAL:
      return "Minimal repository";
    default:
      return "Empty repository";
  }
}

/**
 * Apercu de `TASK-000`, et inspection de son contexte.
 *
 * ## Une seule page pour les deux
 *
 * L'apercu **est** l'inspection : il montre le brief, le plan, la memoire, les
 * taches a venir, l'etat du repository, l'empreinte, et le texte exact de la
 * tache qui sera creee. Une seconde page ne dirait rien de plus.
 *
 * ## Ce qu'elle coute
 *
 * Zero appel a OpenAI, zero execution de Claude Code. Une lecture du
 * repository, en lecture seule — parce que son etat decide du contenu de la
 * tache, et qu'affirmer sans regarder serait pire.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle n'ecrit rien, ne cree aucune tache et ne lance rien. La creation demande
 * un second geste, et l'empreinte affichee ici est ce qui garantit que la tache
 * creee sera celle qui a ete lue.
 */
export default async function BootstrapPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const input = await loadBootstrapInput(getDatabaseClient(), project);
  if (input.existingTask !== null) {
    // La tache existe deja : il n'y a plus rien a prevoir.
    redirect(bootstrapUrl(project.id));
  }

  const preview = await prepareBootstrapPreview(input);

  if (!preview.ok) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
        <header className="flex flex-col gap-2">
          <Link href={bootstrapUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
            ← Project Bootstrap
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-100">Bootstrap task preview</h1>
        </header>

        <SectionCard title="Preparation impossible" description="Une precondition manque.">
          <ul className="flex flex-col gap-2">
            {preview.blockers.map((blocker) => (
              <li
                key={blocker}
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
              >
                {bootstrapBlockerMessage(blocker)}
              </li>
            ))}
          </ul>

          {preview.sourceRefusal === undefined ? null : (
            <p className="mt-4 text-sm leading-relaxed text-zinc-400">
              <span className="font-mono text-xs text-zinc-300">
                {preview.sourceRefusal.field}
              </span>{" "}
              — {preview.sourceRefusal.message}
            </p>
          )}
        </SectionCard>
      </main>
    );
  }

  const { context } = preview;
  const { spec, inspection } = context;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link href={bootstrapUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Project Bootstrap
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">Bootstrap task preview</h1>
        <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
          Voici exactement la tache qui sera creee. Elle est construite a partir de l&apos;etat du
          projet, sans aucun appel a une IA.
        </p>
      </header>

      <SectionCard
        title={BOOTSTRAP_TASK_CODE}
        description={spec.title}
        action={<StatusBadge tone="accent">{shapeLabel(spec.shape)}</StatusBadge>}
      >
        <div className="flex flex-col gap-5">
          <Field label="Priorite">
            <p className="text-sm text-zinc-200">{taskPriorityLabel(spec.priority)}</p>
          </Field>

          <Field label="Objectif">
            <p className="text-sm leading-relaxed text-zinc-300">{spec.objective}</p>
          </Field>

          <Field label={`Criteres d'acceptation (${String(spec.acceptanceCriteria.length)})`}>
            <ul className="flex flex-col gap-1.5">
              {spec.acceptanceCriteria.map((criterion) => (
                <li key={criterion} className="text-sm leading-relaxed text-zinc-300">
                  · {criterion}
                </li>
              ))}
            </ul>
          </Field>

          <Field label="Hors perimetre">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">
              {spec.outOfScope}
            </pre>
          </Field>

          <Field label="Documents a lire">
            {spec.documentReferences.length === 0 ? (
              <p className="text-sm leading-relaxed text-zinc-500">
                Aucun : les documents fondamentaux n&apos;existent pas encore. Ils sont des
                livrables de cette tache, decrits dans ses criteres — NOX ne reference jamais un
                fichier absent.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {spec.documentReferences.map((path) => (
                  <li key={path} className="font-mono text-xs text-zinc-400">
                    {path}
                  </li>
                ))}
              </ul>
            )}
          </Field>

          <Field label={`Contexte transmis (${String(spec.context.length)} caracteres)`}>
            <p className="mb-2 text-xs leading-relaxed text-zinc-500">
              Le brief, le plan de V1 et la memoire active y figurent <em>entiers</em>. C&apos;est ce
              texte exact que la tache portera, et que Claude Code recevra.
            </p>
            <pre className="max-h-96 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-300">
              {spec.context}
            </pre>
          </Field>

          <Field label="Commandes de validation">
            <p className="text-sm leading-relaxed text-zinc-500">
              Aucune. NOX ne peut pas connaitre les commandes d&apos;un projet dont la pile sera
              choisie pendant l&apos;execution ; en inventer produirait des commandes fausses.
              Ajoutez-en depuis la tache une fois qu&apos;elles existent.
            </p>
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Contexte utilise"
        description="Tout ce qui entre dans la tache, et rien d'autre."
      >
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-500">Project Brief</dt>
            <dd className="mt-1 font-mono text-xs text-zinc-400">
              {context.briefRevision ?? "absent"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-500">Living V1 Plan</dt>
            <dd className="mt-1 font-mono text-xs text-zinc-400">
              {context.planRevision ?? "absent"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-500">Project Memory</dt>
            <dd className="mt-1 text-zinc-300">
              {context.memories.length === 0
                ? "Aucune entree active"
                : `${String(context.memories.length)} entree(s) active(s)`}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-500">Taches a venir</dt>
            <dd className="mt-1 text-zinc-300">
              {context.upcomingTasks.length === 0
                ? "Aucune"
                : context.upcomingTasks.map((task) => task.code).join(", ")}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-500">Repository</dt>
            <dd className="mt-1 text-zinc-300">
              {shapeLabel(spec.shape)} · {String(inspection.rootEntryCount)} entree(s) a la racine ·{" "}
              {inspection.manifests.length === 0
                ? "aucun manifeste reconnu"
                : `manifestes : ${inspection.manifests.join(", ")}`}{" "}
              ·{" "}
              {inspection.sourceDirectories.length === 0
                ? "aucun dossier de code reconnu"
                : `code : ${inspection.sourceDirectories.join(", ")}`}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-500">
              Documents fondamentaux presents
            </dt>
            <dd className="mt-1 font-mono text-xs text-zinc-400">
              {inspection.foundationalDocuments.length === 0
                ? "aucun"
                : inspection.foundationalDocuments.join(" · ")}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-500">Bootstrap fingerprint</dt>
            <dd className="mt-1 break-all font-mono text-xs text-zinc-500">
              {context.fingerprint}
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard
        title="Creer la tache"
        description="Elle sera creee en DRAFT. Aucune execution n'est lancee."
      >
        <CreateBootstrapButton projectId={project.id} fingerprint={context.fingerprint} />
      </SectionCard>
    </main>
  );
}
