import {
  ARCHITECT_PROMPT_VERSION_V5,
  ARCHITECT_TURN_SCHEMA_VERSION_V4,
  REPLAN_PROMPT_VERSION,
  REPLAN_SCHEMA_VERSION,
} from "@nox/shared";
import { getDatabaseClient, listReplanCreatedTasks } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { formatIsoDateTime } from "@/lib/format";
import { REPLAN_FINGERPRINT_VERSION } from "@/lib/replan/fingerprint";
import { loadProject } from "@/lib/projects";
import { projectChangeUrl, replanStatusLabel } from "@/lib/replan/display";
import { loadReplanProposal } from "@/lib/replan/service";
import { taskUrl } from "@/lib/task-display";

/** Une ligne technique : un nom, une valeur, jamais interpretee. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 py-2">
      <dt className="text-xs uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-xs text-zinc-400">{value}</dd>
    </div>
  );
}

/** Un payload JSON, rendu tel quel, sans coloration ni interpretation. */
function Payload({ title, json }: { title: string; json: string | null }) {
  return (
    <details className="rounded-md border border-zinc-800">
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-zinc-300 hover:text-zinc-100">
        {title}
      </summary>
      <div className="border-t border-zinc-800 px-4 py-3">
        {json === null ? (
          <p className="text-sm italic text-zinc-600">Aucune valeur enregistree.</p>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-zinc-400">
            {pretty(json)}
          </pre>
        )}
      </div>
    </details>
  );
}

/** Reindente un payload, ou le rend tel quel s'il n'est pas lisible. */
function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

/**
 * Inspection technique d'un changement de projet.
 *
 * ## Pourquoi une page a part
 *
 * Parce que les versions, les empreintes et les payloads ne servent pas au
 * workflow : ils servent a comprendre ce qui s'est passe quand quelque chose
 * cloche. Les afficher sur la revue les mettrait entre l'utilisateur et sa
 * decision. Ils sont **deplaces**, jamais supprimes — a un clic.
 *
 * ## Ce qui est visible ici
 *
 * Ce que le fournisseur a rendu, et ce que l'humain a applique. Les deux restent
 * distincts et le resteront : `providerJson` n'est jamais reecrit, et
 * `appliedJson` porte ce qui a ete retenu, suppressions comprises.
 */
export default async function ProjectChangeInspectPage({
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
  const proposal = await loadReplanProposal(db, project.id, proposalId);
  if (proposal === null) {
    notFound();
  }

  const generation = await db.architectGeneration.findUnique({
    where: { id: proposal.generationId },
    select: { id: true, sequence: true, model: true, promptVersion: true, sessionId: true },
  });
  const created = await listReplanCreatedTasks(db, proposal.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link
          href={projectChangeUrl(project.id, proposal.id)}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Back to project change
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-50">Inspect project change</h1>
        <p className="truncate text-sm text-zinc-600">{project.name}</p>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard title="Contrat">
          <dl className="flex flex-col divide-y divide-zinc-800/80">
            <Row label="Statut" value={replanStatusLabel(proposal.status)} />
            <Row label="Proposition" value={proposal.id} />
            <Row label="Tour" value={generation === null ? "introuvable" : generation.id} />
            <Row
              label="Prompt"
              value={generation?.promptVersion ?? ARCHITECT_PROMPT_VERSION_V5}
            />
            <Row label="Modele" value={generation?.model ?? "non enregistre"} />
            <Row label="Contrat de tour" value={String(ARCHITECT_TURN_SCHEMA_VERSION_V4)} />
            <Row
              label="Contrat de replanification"
              value={`${REPLAN_PROMPT_VERSION} · schema ${String(REPLAN_SCHEMA_VERSION)}`}
            />
            <Row
              label="Mise a jour du projet liee"
              value={proposal.projectUpdateId ?? "aucune"}
            />
          </dl>
        </SectionCard>

        <SectionCard
          title="Etat vu par le fournisseur"
          description="Capture a la preparation du tour, jamais relu apres l'appel. C'est ce qui rend la peremption verifiable."
        >
          <dl className="flex flex-col divide-y divide-zinc-800/80">
            <Row label="Revision du brief" value={proposal.baseBriefRevision ?? "non defini"} />
            <Row label="Revision du plan" value={proposal.basePlanRevision ?? "non defini"} />
            <Row label="Empreinte de planification" value={proposal.planningFingerprint} />
            <Row label="Version de l'empreinte" value={REPLAN_FINGERPRINT_VERSION} />
            <Row label="Taches cible" value={String(proposal.targetCount)} />
            <Row label="Taches nouvelles" value={String(proposal.newCount)} />
          </dl>
        </SectionCard>

        <SectionCard title="Dates">
          <dl className="flex flex-col divide-y divide-zinc-800/80">
            <Row
              label="Proposee"
              value={formatIsoDateTime(proposal.createdAt.toISOString()) ?? "-"}
            />
            <Row
              label="Appliquee"
              value={
                proposal.appliedAt === null
                  ? "jamais"
                  : (formatIsoDateTime(proposal.appliedAt.toISOString()) ?? "-")
              }
            />
            <Row
              label="Ecartee"
              value={
                proposal.dismissedAt === null
                  ? "jamais"
                  : (formatIsoDateTime(proposal.dismissedAt.toISOString()) ?? "-")
              }
            />
          </dl>
        </SectionCard>

        <SectionCard
          title="Taches nees de ce changement"
          description="Une tache existante modifiee par un replan conserve sa provenance d'origine : seule une tache creee ici apparait."
        >
          {created.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune tache creee.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {created.map((task) => (
                <li key={task.id} className="flex flex-wrap items-baseline gap-3">
                  <Link
                    href={taskUrl(project.id, task.id)}
                    className="font-mono text-xs text-zinc-400 underline hover:text-zinc-200"
                  >
                    {task.code}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                    {task.title}
                  </span>
                  <span className="font-mono text-xs text-zinc-600">{task.status}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Payloads"
          description="La proposition du fournisseur est immuable ; la cible appliquee est ce que l'humain a retenu. Les deux restent distinctes."
        >
          <div className="flex flex-col gap-3">
            <Payload title="providerJson — ce que l'Architecte a rendu" json={proposal.providerJson} />
            <Payload title="appliedJson — ce qui a ete applique" json={proposal.appliedJson} />
          </div>
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Cette page lit SQLite et rien d&apos;autre. Aucune valeur n&apos;y est recalculee, aucun
        fournisseur n&apos;est appele, et aucun secret n&apos;y figure.
      </footer>
    </div>
  );
}
