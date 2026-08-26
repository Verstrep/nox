import {
  COMMAND_EXECUTION_MODE,
  TASK_KIND,
  VERIFICATION_MODE,
  checkVerificationPlan,
  type TaskKind,
  type VerificationPlan,
} from "@nox/shared";

import { StatusBadge } from "@/components/StatusBadge";
import { planIsFullyAutomated } from "@/lib/verification-review";
import { verificationModeLabel } from "@/lib/verification-display";

import { SectionCard } from "./SectionCard";

/**
 * Le plan de verification d'une tache, avant son execution.
 *
 * ## Pourquoi il s'affiche **avant**
 *
 * Parce que c'est le moment ou l'utilisateur decide de rendre la tache prete.
 * Apprendre apres coup que NOX avait le droit de la terminer tout seul serait
 * exactement l'inverse d'un contrat : la classification appartient a la
 * specification, pas au resultat.
 *
 * ## Aucun resultat ici
 *
 * Ni pastille verte, ni code de sortie, ni duree. Cette carte decrit ce qui
 * **sera** verifie ; ce qui a ete verifie appartient a la review d'une
 * execution. Les melanger ferait lire un contrat comme une preuve.
 */
export function VerificationPlanSummary({
  plan,
  taskKind,
}: {
  plan: VerificationPlan;
  taskKind: TaskKind;
}) {
  const automated = plan.criteria.filter(
    (criterion) => criterion.verificationMode === VERIFICATION_MODE.AUTOMATED,
  );
  const human = plan.criteria.filter(
    (criterion) => criterion.verificationMode === VERIFICATION_MODE.HUMAN,
  );
  const autonomousCommands = plan.commands.filter(
    (command) => command.executionMode === COMMAND_EXECUTION_MODE.AUTONOMOUS,
  );

  const check = checkVerificationPlan(plan);
  const eligible = planIsFullyAutomated(plan, taskKind);
  const commandById = new Map(plan.commands.map((command) => [command.id, command]));

  return (
    <SectionCard
      title="Verification plan"
      description="Comment chaque critere sera verifie, et par qui. Decide avant l'execution, jamais apres."
      action={
        <StatusBadge tone={eligible ? "accent" : "muted"}>
          {eligible ? "Auto-completion: Yes" : "Auto-completion: No"}
        </StatusBadge>
      }
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-600">Automated</dt>
          <dd className="mt-1 text-2xl font-semibold text-zinc-200">{automated.length}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-600">Human</dt>
          <dd className="mt-1 text-2xl font-semibold text-zinc-200">{human.length}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-600">
            Commandes autonomes
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-zinc-200">
            {autonomousCommands.length}
          </dd>
        </div>
      </dl>

      <p className="mt-5 max-w-prose text-sm leading-relaxed text-zinc-400">
        {eligible
          ? "Tous les criteres de cette tache sont automatises. Si toutes les validations que NOX executera lui-meme passent, la tache sera marquee Done sans intervention humaine."
          : taskKind === TASK_KIND.BOOTSTRAP
            ? "Un amorcage ne se termine jamais seul. Son resultat passe toujours par une review humaine, quelle que soit la classification de ses criteres."
            : "Cette tache demandera une review humaine : au moins un critere ne peut pas etre prouve par une commande."}
      </p>

      {check.ok ? null : (
        <div className="mt-5 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm leading-relaxed text-amber-200">
            Ce plan est incomplet : la tache ne pourra pas passer en file tant qu&apos;il le
            restera. Un brouillon a le droit d&apos;etre incomplet, pas une tache prete.
          </p>
          <ul className="mt-3 ml-5 flex list-disc flex-col gap-1 text-xs leading-relaxed text-amber-200/80">
            {check.issues.map((issue) => (
              <li key={`${issue.code}-${issue.criterionId ?? ""}-${issue.commandId ?? ""}`}>
                {issue.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.criteria.length === 0 ? null : (
        <ul className="mt-5 flex flex-col gap-3 border-t border-zinc-800 pt-5">
          {plan.criteria.map((criterion) => {
            const proofs = criterion.commandIds
              .map((id) => commandById.get(id))
              .filter((command) => command !== undefined);

            return (
              <li key={criterion.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="min-w-0 flex-1 text-sm text-zinc-300">{criterion.text}</span>
                  <StatusBadge tone="muted">
                    {verificationModeLabel(criterion.verificationMode)}
                  </StatusBadge>
                </div>
                <p className="text-xs leading-relaxed text-zinc-600">
                  {criterion.verificationMode === VERIFICATION_MODE.AUTOMATED
                    ? proofs.length === 0
                      ? "Aucune commande ne prouve ce critere."
                      : `Sera prouve par ${proofs.map((command) => command.command).join(" · ")}`
                    : (criterion.humanInstructions ??
                      "Aucune instruction n'accompagne ce critere humain.")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
