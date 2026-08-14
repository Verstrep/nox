import {
  guidedActionCallsOpenAI,
  guidedActionStartsClaude,
  type GuidedAction,
  type GuidedWorkflowState,
} from "@nox/shared";
import Link from "next/link";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import type { ArchitectTaskOrigin } from "@nox/database";

import { architectOriginLabel, architectOriginUrl } from "@/lib/architect/display";
import { guidedActionHref, guidedProgressMark } from "@/lib/guided-workflow-display";
import {
  architectReviewBlockerLabel,
  guidedActionLabel,
  guidedBlockerLabel,
  guidedProgressStepLabel,
  guidedStageLabel,
} from "@/lib/labels";

/**
 * Avertissement affiche a cote d'une action qui engage une IA.
 *
 * Le texte est en anglais comme les libelles d'action, et il est **explicite** :
 * « This action will call OpenAI » ne laisse pas deviner qu'un appel facture va
 * partir. Il n'apparait que sur les deux actions concernees — un avertissement
 * pose partout n'avertirait plus de rien.
 */
function checkpointNotice(action: GuidedAction): string | null {
  if (guidedActionCallsOpenAI(action.kind)) {
    return "This action will call OpenAI";
  }
  if (guidedActionStartsClaude(action.kind)) {
    return "This action will start Claude Code";
  }
  return null;
}

const PRIMARY_CLASSES =
  "inline-flex items-center rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const SECONDARY_CLASSES =
  "inline-flex items-center rounded-md border border-zinc-700 bg-zinc-800/70 px-3.5 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400";

/**
 * Bande de progression.
 *
 * Cinq etapes fixes, jamais une par execution : elle repond a « ou en
 * sommes-nous », pas a « qu'a-t-on fait ». L'historique detaille des executions
 * a deja sa section, et la timeline d'un run a deja sa page.
 *
 * Chaque etape porte un mot **et** un signe : une progression qui ne se lirait
 * qu'a la couleur ne se lirait pas du tout pour une partie des lecteurs.
 */
function Progress({ state }: { state: GuidedWorkflowState }) {
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
      {state.progress.map((entry) => {
        const tone =
          entry.state === "current"
            ? "text-teal-200"
            : entry.state === "done"
              ? "text-zinc-400"
              : "text-zinc-600";
        return (
          <li key={entry.step} className={`flex items-baseline gap-2 text-sm ${tone}`}>
            <span aria-hidden="true" className="font-mono">
              {guidedProgressMark(entry.state)}
            </span>
            <span>{guidedProgressStepLabel(entry.step)}</span>
            <span className="text-xs text-zinc-600">
              {entry.state === "current" ? "Current" : entry.state === "done" ? "Done" : "—"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ActionLink({
  projectId,
  taskId,
  action,
  primary,
}: {
  projectId: string;
  taskId: string;
  action: GuidedAction;
  primary: boolean;
}) {
  const href = guidedActionHref(projectId, taskId, action);
  if (href === null) {
    return null;
  }

  return (
    <Link href={href} className={primary ? PRIMARY_CLASSES : SECONDARY_CLASSES}>
      {guidedActionLabel(action.kind)}
    </Link>
  );
}

/**
 * Le point d'entree du workflow, sur la page d'une tache.
 *
 * ## Ce que cette section n'est pas
 *
 * Ce n'est pas un tableau de bord, et ce n'est surtout pas un second jeu de
 * boutons. Chaque action mene a la surface ou la decision se prend deja :
 * `Mark ready` descend a la section Statut de cette page, `Analyze with
 * Architect` ouvre la preparation de TASK-015, `Resume Claude Code` ouvre la
 * preparation de TASK-012. Aucune Server Action n'est appelee depuis ici.
 *
 * ## Recommander n'est pas decider
 *
 * NOX dit ce qui a du sens maintenant. Il ne clique pas. Aucune des
 * recommandations ci-dessous ne se declenche seule, ni au chargement, ni apres
 * un delai, ni parce que l'etape precedente vient de se terminer.
 */
export function GuidedWorkflow({
  projectId,
  taskId,
  state,
  architectSession,
  pendingFeedbackExcerpt,
  anchorId,
}: {
  projectId: string;
  taskId: string;
  state: GuidedWorkflowState;
  architectSession: ArchitectTaskOrigin | null;
  pendingFeedbackExcerpt: string | null;
  anchorId: string;
}) {
  const recommended = state.recommendedAction;
  const notice = recommended === null ? null : checkpointNotice(recommended);

  return (
    <section id={anchorId} className="scroll-mt-6">
      <SectionCard
        title="Development workflow"
        description="Ou en est cette tache, et quelle etape a du sens maintenant. NOX propose ; vous decidez."
        action={<StatusBadge tone="neutral">{guidedStageLabel(state.stage)}</StatusBadge>}
      >
        <div className="flex flex-col gap-6">
          <Progress state={state} />

          <div className="border-t border-zinc-800 pt-5">
            <p className="text-xs uppercase tracking-wider text-zinc-600">Current</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-300">{state.summary}</p>
            {state.currentRunCode === null ? null : (
              <p className="mt-1 font-mono text-xs text-zinc-600">
                {state.currentRunCode}
                {state.currentRunKind === "CORRECTION" ? " · Correction" : " · Initial"}
              </p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-600">
              {recommended === null ? "Aucune etape recommandee" : "Recommended next step"}
            </p>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-zinc-400">{state.reason}</p>

            {recommended === null ? null : (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <ActionLink
                  projectId={projectId}
                  taskId={taskId}
                  action={recommended}
                  primary
                />
                {notice === null ? null : (
                  <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
                    {notice}
                  </span>
                )}
              </div>
            )}
          </div>

          {state.blockers.length === 0 && state.architectBlockers.length === 0 ? null : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-amber-200/80">
                Ce qui bloque la suite
              </p>
              <ul className="mt-2 flex flex-col gap-2 text-sm leading-relaxed text-amber-200/90">
                {state.blockers.map((entry) => (
                  <li key={entry.code}>
                    {guidedBlockerLabel(entry.code)}
                    {entry.detail === null ? null : (
                      <span className="mt-1 block text-xs text-amber-200/70">{entry.detail}</span>
                    )}
                  </li>
                ))}
                {state.architectBlockers.map((code) => (
                  <li key={code}>{architectReviewBlockerLabel(code)}</li>
                ))}
              </ul>
            </div>
          )}

          {pendingFeedbackExcerpt === null ? null : (
            <div>
              <p className="text-xs uppercase tracking-wider text-zinc-600">Feedback en attente</p>
              {/* Du texte, jamais du HTML : ce contenu vient d'un champ libre. */}
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                {pendingFeedbackExcerpt}
              </p>
            </div>
          )}

          {state.alternativeActions.length === 0 ? null : (
            <div>
              <p className="text-xs uppercase tracking-wider text-zinc-600">Other options</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {state.alternativeActions.map((entry) => (
                  <ActionLink
                    key={`${entry.kind}-${entry.runId ?? ""}-${entry.analysisId ?? ""}`}
                    projectId={projectId}
                    taskId={taskId}
                    action={entry}
                    primary={false}
                  />
                ))}
              </div>
              {state.alternativeActions.some((entry) => guidedActionCallsOpenAI(entry.kind)) ? (
                <p className="mt-3 text-xs text-amber-200/80">This action will call OpenAI</p>
              ) : null}
            </div>
          )}

          {architectSession === null ? null : (
            <p className="border-t border-zinc-800 pt-4 text-xs text-zinc-600">
              Designed with Architect ·{" "}
              <Link
                href={architectOriginUrl(projectId, architectSession)}
                className="font-mono text-zinc-500 underline hover:text-zinc-300"
              >
                {architectOriginLabel(architectSession)}
              </Link>
            </p>
          )}

          <p className="text-xs leading-relaxed text-zinc-600">
            Aucune de ces etapes ne se declenche toute seule. NOX n&apos;appelle jamais OpenAI et ne
            lance jamais Claude Code sans un clic, et une recommandation n&apos;autorise rien :
            l&apos;action reelle revalide tout au moment ou vous la demandez.
          </p>
        </div>
      </SectionCard>
    </section>
  );
}
