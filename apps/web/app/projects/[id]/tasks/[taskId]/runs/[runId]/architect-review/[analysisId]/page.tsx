import {
  ARCHITECT_REVIEW_SEVERITY,
  ARCHITECT_REVIEW_STATUS,
  ARCHITECT_REVIEW_VERDICT,
  architectCriterionLabel,
  type ArchitectReviewFinding,
  type ArchitectReviewVerdict,
} from "@nox/shared";
import { getArchitectRunReview, getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge, type BadgeTone } from "@/components/StatusBadge";
import { describeArchitectError } from "@/lib/architect/errors";
import { architectReviewUrl } from "@/lib/architect/review-display";
import { requestChangesUrl } from "@/lib/correction-display";
import { formatIsoDateTime } from "@/lib/format";
import {
  architectReviewBlockerLabel,
  architectReviewSeverityLabel,
  architectReviewStatusLabel,
  architectReviewVerdictLabel,
} from "@/lib/labels";
import { loadProject } from "@/lib/projects";
import { reviewUrl } from "@/lib/review-display";
import { loadRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";

const VERDICT_TONE: Record<ArchitectReviewVerdict, BadgeTone> = {
  [ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED]: "accent",
  [ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED]: "neutral",
  [ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED]: "muted",
};

const SEVERITY_CLASSES: Record<string, string> = {
  [ARCHITECT_REVIEW_SEVERITY.BLOCKER]: "text-red-300",
  [ARCHITECT_REVIEW_SEVERITY.MAJOR]: "text-amber-200",
  [ARCHITECT_REVIEW_SEVERITY.MINOR]: "text-zinc-300",
  [ARCHITECT_REVIEW_SEVERITY.NOTE]: "text-zinc-500",
};

/**
 * Une observation.
 *
 * Le texte est rendu tel quel : `whitespace-pre-wrap`, aucun `dangerouslySetInnerHTML`,
 * aucun Markdown, aucun lien automatique. Il vient d'un modele qui a lu des
 * patches, et un patch peut contenir n'importe quoi.
 */
function Finding({ finding }: { finding: ArchitectReviewFinding }) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-zinc-800/60 py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-3">
        <span
          className={`w-16 shrink-0 text-xs font-medium uppercase tracking-wider ${
            SEVERITY_CLASSES[finding.severity] ?? "text-zinc-400"
          }`}
        >
          {architectReviewSeverityLabel(finding.severity)}
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium text-zinc-100">{finding.title}</p>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-zinc-600 sm:pl-[4.75rem]">
        {finding.filePath === null ? null : (
          <code className="break-all font-mono">{finding.filePath}</code>
        )}
        {finding.acceptanceCriterionIndex === null ? null : (
          <span>{architectCriterionLabel(finding.acceptanceCriterionIndex)}</span>
        )}
      </div>

      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-400 sm:pl-[4.75rem]">
        {finding.detail}
      </p>
    </li>
  );
}

export default async function ArchitectAnalysisPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string; runId: string; analysisId: string }>;
}) {
  const { id, taskId, runId, analysisId } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const task = await loadTask(taskId);
  if (task === null || task.projectId !== project.id) {
    notFound();
  }

  const run = await loadRun(runId);
  if (run === null || run.taskId !== task.id) {
    notFound();
  }

  const analysis = await getArchitectRunReview(getDatabaseClient(), analysisId);
  // Le rattachement est verifie entierement : une analyse d'une autre execution
  // est introuvable, pas « refusee ».
  if (analysis === null || analysis.runId !== run.id) {
    notFound();
  }

  const back = reviewUrl(project.id, task.id, run.id);
  const preparation = architectReviewUrl(project.id, task.id, run.id);
  const verdict = analysis.finalVerdict;
  const providerVerdict = analysis.providerVerdict;
  // NOX n'ecrase pas ce que le modele avait propose : quand les deux verdicts
  // different, la page le dit plutot que de reecrire l'histoire en silence.
  const downgraded = providerVerdict !== null && verdict !== null && providerVerdict !== verdict;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour a la review
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-500">
              {task.code} · {run.code} · {analysis.code}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-zinc-50">Analyse de l&apos;Architecte</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">
              {task.title} · {project.name}
            </p>
          </div>
          {verdict === null ? (
            <StatusBadge tone="neutral">{architectReviewStatusLabel(analysis.status)}</StatusBadge>
          ) : (
            <StatusBadge tone={VERDICT_TONE[verdict]}>
              {architectReviewVerdictLabel(verdict)}
            </StatusBadge>
          )}
        </div>
      </header>

      <main className="flex flex-col gap-6">
        {analysis.status === ARCHITECT_REVIEW_STATUS.COMPLETED ? null : (
          <SectionCard title="Analyse non aboutie">
            <p role="alert" className="text-sm leading-relaxed text-amber-200">
              {analysis.errorCode === null
                ? "Cette analyse n'a produit aucun resultat exploitable."
                : describeArchitectError(analysis.errorCode)}
            </p>
            <p className="mt-4 text-xs leading-relaxed text-zinc-600">
              Elle reste dans l&apos;historique : elle a consomme un appel, et son numero n&apos;est
              pas reattribue.
            </p>
          </SectionCard>
        )}

        {analysis.summary === null ? null : (
          <SectionCard title="Summary" description="Ce que l'architecte a retenu.">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-300">
              {analysis.summary}
            </p>
          </SectionCard>
        )}

        {downgraded ? (
          <SectionCard
            title="NOX requires human review"
            description="Le verdict retenu differe de celui propose par l'architecte."
          >
            <p className="text-sm leading-relaxed text-zinc-400">
              L&apos;architecte avait propose{" "}
              <strong className="text-zinc-200">
                {providerVerdict === null ? "-" : architectReviewVerdictLabel(providerVerdict)}
              </strong>
              . NOX ne le retient pas : une partie de la review ne lui etait pas accessible, et une
              approbation ne peut pas se fonder sur ce que personne n&apos;a lu.
            </p>
            <ul className="mt-4 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-zinc-400">
              {analysis.blockers.map((blocker) => (
                <li key={blocker}>{architectReviewBlockerLabel(blocker)}</li>
              ))}
            </ul>
          </SectionCard>
        ) : analysis.blockers.length === 0 ? null : (
          <SectionCard title="Ce que l'architecte n'a pas pu voir">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-zinc-400">
              {analysis.blockers.map((blocker) => (
                <li key={blocker}>{architectReviewBlockerLabel(blocker)}</li>
              ))}
            </ul>
          </SectionCard>
        )}

        {analysis.findings.length === 0 ? null : (
          <SectionCard
            title="Findings"
            description="Dans l'ordre rendu par l'architecte. Chacune renvoie a un fait de la review."
          >
            <ul className="flex flex-col">
              {analysis.findings.map((finding, index) => (
                <Finding key={`${String(index)}-${finding.title}`} finding={finding} />
              ))}
            </ul>
          </SectionCard>
        )}

        {analysis.feedback === null ? null : (
          <SectionCard
            title="Suggested feedback"
            description="Un texte propose, jamais transmis : vous le relirez et le modifierez."
          >
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-sm leading-relaxed text-zinc-300">
              {analysis.feedback}
            </pre>
          </SectionCard>
        )}

        <SectionCard title="Actions" description="L'architecte recommande ; vous decidez.">
          <div className="flex flex-wrap items-center gap-3">
            {verdict === ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED &&
            analysis.feedback !== null ? (
              <Link
                href={`${requestChangesUrl(project.id, task.id, run.id)}?analysis=${encodeURIComponent(analysis.id)}`}
                className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
              >
                Use as feedback
              </Link>
            ) : null}

            <Link
              href={back}
              className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            >
              Back to review
            </Link>

            <Link
              href={preparation}
              className="text-xs text-zinc-500 underline hover:text-zinc-300"
            >
              Analyze again
            </Link>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-zinc-600">
            {verdict === ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED
              ? "Cette analyse n'a rien approuve et n'a change aucun statut. Le bouton Approve reste sur la review, et c'est un clic distinct."
              : verdict === ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED
                ? "Ce bouton ne lance rien : il ouvre le formulaire de correction avec ce texte prerempli, que vous pourrez modifier ou supprimer."
                : "NOX ne recommande rien ici : les informations manquantes sont listees ci-dessus. Les actions humaines de la review restent disponibles."}
          </p>
        </SectionCard>

        <SectionCard title="Detail technique" description="Ce que cette analyse a consomme.">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <Field label="Modele">{analysis.model}</Field>
            <Field label="Prompt">{analysis.promptVersion}</Field>
            <Field label="Analysee le">{formatIsoDateTime(analysis.createdAt) ?? "-"}</Field>
            <Field label="Jetons entree">{analysis.usage.inputTokens ?? "non fourni"}</Field>
            <Field label="Jetons sortie">{analysis.usage.outputTokens ?? "non fourni"}</Field>
            <Field label="Jetons total">{analysis.usage.totalTokens ?? "non fourni"}</Field>
          </dl>

          {analysis.manifest === null ? null : (
            <p className="mt-5 text-xs leading-relaxed text-zinc-600">
              {analysis.manifest.fileCountIncluded} fichiers sur{" "}
              {analysis.manifest.fileCountAvailable} transmis,{" "}
              {analysis.manifest.validationCount} validations,{" "}
              {analysis.manifest.truncated
                ? "bundle tronque"
                : "bundle complet"}
              .
            </p>
          )}
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Cette analyse porte sur la review enregistree a la fin de l&apos;execution. Elle n&apos;a lu
        ni votre dossier de travail, ni le compte rendu de Claude Code.
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-zinc-300">{children}</dd>
    </div>
  );
}
