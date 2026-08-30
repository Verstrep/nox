"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";

import { PROJECT_PLAN_LIMITS, TASK_PRIORITIES, VERIFICATION_MODE } from "@nox/shared";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import { VerificationPlanFields } from "@/components/VerificationPlanFields";
import { moveBacklogItem, removeBacklogItem } from "@/lib/backlog/display";
import { taskPriorityLabel } from "@/lib/labels";
import { REPLAN_STALE_MESSAGE } from "@/lib/replan/display";
import type { ReplanReviewItem } from "@/lib/replan/target";
import {
  emptyCommandRow,
  emptyCriterionRow,
  type TaskEditCommandRow,
  type TaskEditCriterionRow,
} from "@/lib/verification-fields";

import { PlanFormError, PlanListField, PlanTextField } from "../../../plan/PlanFields";
import type { BriefFormValues, V1PlanFormValues } from "../../../plan/form-state";
import { applyProjectChangeAction } from "./actions";
import type { ProjectChangeApplyState } from "./form-state";

const FIELD_CLASSES =
  "w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-zinc-600";

const CONTROL_CLASSES =
  "rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40";

/** Une tache que le plan peut attendre, sans pouvoir la reecrire. */
export type ChangeDependencyCandidate = {
  id: string;
  code: string;
  title: string;
  /** Verrouillee : deja commencee, en file, ou d'amorcage. */
  locked: boolean;
};

/** Un champ de texte libre, borne par le serveur et non par cette saisie. */
function Field({
  name,
  label,
  hint,
  rows,
  value,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  rows: number;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      {hint === undefined ? null : <span className="text-xs text-zinc-600">{hint}</span>}
      <textarea
        name={name}
        rows={rows}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={`${FIELD_CLASSES} resize-y font-sans leading-relaxed`}
      />
    </label>
  );
}

function planSummary(values: ReplanReviewItem["values"]): string {
  const automated = values.criteria.filter(
    (row) => row.verificationMode === VERIFICATION_MODE.AUTOMATED,
  ).length;
  return `${String(automated)} automatise(s) · ${String(values.criteria.length - automated)} humain(s)`;
}

/**
 * Revue d'un changement de projet : le plan, puis les taches futures.
 *
 * ## Un formulaire, une intention
 *
 * Le Project Brief, le Living V1 Plan et l'etat cible des taches futures vivent
 * dans le meme `<form>` et partent au meme `Apply`. Deux formulaires auraient
 * laisse exister l'etat « le plan est a jour, le backlog non » — celui que
 * TASK-032 existe pour empecher.
 *
 * ## Ce que le navigateur decide, et ce qu'il ne decide pas
 *
 * Il decide de ce qui est propose : les textes, l'ordre, les dependances, ce
 * qu'on garde et ce qu'on retire. Il ne decide jamais qu'une tache est
 * modifiable, qu'un code peut etre reutilise, ni qu'une peremption peut etre
 * ignoree. Ces reponses-la sont relues en base au moment d'ecrire, et aucun
 * champ de ce formulaire ne peut les influencer.
 *
 * ## Retirer n'est pas definitif tant qu'on n'a pas applique
 *
 * Une tache retiree de la cible reste restaurable d'un clic : un retrait
 * accidentel ne doit pas obliger a redemander un tour a l'architecte.
 *
 * ## Aucun brouillon n'est persiste
 *
 * Une edition non appliquee vit dans ce formulaire, et nulle part ailleurs. Un
 * brouillon enregistre serait une fonctionnalite de plus, avec son cycle de vie
 * et ses conflits ; rien ne la demande aujourd'hui.
 */
export function ProjectChangeReview({
  projectId,
  proposalId,
  changesBrief,
  changesPlan,
  initialItems,
  initialBrief,
  initialPlan,
  restorable,
  lockedCandidates,
  cancelHref,
  blocked,
}: {
  projectId: string;
  proposalId: string;
  changesBrief: boolean;
  changesPlan: boolean;
  initialItems: ReplanReviewItem[];
  initialBrief: BriefFormValues;
  initialPlan: V1PlanFormValues;
  /** Taches futures modifiables du projet, pour restaurer une suppression. */
  restorable: ReplanReviewItem[];
  /** Taches verrouillees, qu'une tache future peut encore attendre. */
  lockedCandidates: ChangeDependencyCandidate[];
  cancelHref: string;
  /** Proposition perimee ou deja traitee : l'application est impossible. */
  blocked: boolean;
}) {
  const [state, formAction, pending] = useActionState<ProjectChangeApplyState, FormData>(
    applyProjectChangeAction,
    { items: initialItems, brief: initialBrief, plan: initialPlan, error: null, stale: false },
  );

  const [items, setItems] = useState(() => state.items);
  const [brief, setBrief] = useState(state.brief);
  const [plan, setPlan] = useState(state.plan);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Un compteur, pas la longueur d'une liste : supprimer puis ajouter ne doit
  // jamais reattribuer une cle deja vue, sous peine de melanger deux lignes.
  const nextKey = useRef(0);
  const makeKey = (): string => {
    nextKey.current += 1;
    return `n${String(nextKey.current)}`;
  };

  const stopped = blocked || state.stale;
  const dirty =
    JSON.stringify({ items, brief, plan }) !==
    JSON.stringify({ items: initialItems, brief: initialBrief, plan: initialPlan });

  useUnsavedChanges(dirty && !pending && !stopped);

  const present = new Set(
    items.map((item) => item.existingTaskId).filter((id): id is string => id !== null),
  );
  const missing = restorable.filter((item) => !present.has(item.existingTaskId ?? ""));

  const setBriefField = (field: keyof BriefFormValues) => (value: string) => {
    setBrief((current) => ({ ...current, [field]: value }));
  };
  const setPlanField = (field: keyof V1PlanFormValues) => (value: string) => {
    setPlan((current) => ({ ...current, [field]: value }));
  };

  const patch = (
    index: number,
    transform: (item: ReplanReviewItem) => ReplanReviewItem,
  ): void => {
    setItems((current) =>
      current.map((item, position) => (position === index ? transform(item) : item)),
    );
  };

  const setField =
    (index: number, field: "title" | "priority" | "objective" | "context" | "outOfScope" | "documents") =>
    (next: string): void => {
      patch(index, (item) => ({ ...item, values: { ...item.values, [field]: next } }));
    };

  const addTask = (): void => {
    const used = new Set(items.map((item) => item.tempId));
    let index = 1;
    while (used.has(`N${String(index)}`)) {
      index += 1;
    }
    const tempId = `N${String(index)}`;
    setItems((current) => [
      ...current,
      {
        uid: `replan-new-${tempId}-${makeKey()}`,
        existingTaskId: null,
        tempId,
        code: null,
        values: {
          title: "",
          priority: "MEDIUM",
          objective: "",
          context: "",
          outOfScope: "",
          documents: "",
          criteria: [emptyCriterionRow(makeKey())],
          commands: [],
          dependsOnTaskIds: [],
        },
        dependsOn: [],
      },
    ]);
  };

  /** Les sept gestes du plan de verification, rattaches a un element precis. */
  const planHandlers = (index: number) => ({
    updateCriterion: (key: string, changes: Partial<TaskEditCriterionRow>): void => {
      patch(index, (item) => ({
        ...item,
        values: {
          ...item.values,
          criteria: item.values.criteria.map((row) =>
            row.key === key ? { ...row, ...changes } : row,
          ),
        },
      }));
    },
    updateCommand: (key: string, changes: Partial<TaskEditCommandRow>): void => {
      patch(index, (item) => ({
        ...item,
        values: {
          ...item.values,
          commands: item.values.commands.map((row) =>
            row.key === key ? { ...row, ...changes } : row,
          ),
        },
      }));
    },
    toggleProof: (criterionKey: string, commandKey: string): void => {
      patch(index, (item) => ({
        ...item,
        values: {
          ...item.values,
          criteria: item.values.criteria.map((row) =>
            row.key === criterionKey
              ? {
                  ...row,
                  commandKeys: row.commandKeys.includes(commandKey)
                    ? row.commandKeys.filter((entry) => entry !== commandKey)
                    : [...row.commandKeys, commandKey],
                }
              : row,
          ),
        },
      }));
    },
    addCriterion: (): void => {
      patch(index, (item) => ({
        ...item,
        values: { ...item.values, criteria: [...item.values.criteria, emptyCriterionRow(makeKey())] },
      }));
    },
    removeCriterion: (key: string): void => {
      patch(index, (item) => ({
        ...item,
        values: {
          ...item.values,
          criteria: item.values.criteria.filter((row) => row.key !== key),
        },
      }));
    },
    addCommand: (): void => {
      patch(index, (item) => ({
        ...item,
        values: { ...item.values, commands: [...item.values.commands, emptyCommandRow(makeKey())] },
      }));
    },
    // Retirer une commande retire aussi les preuves qui la designaient : un lien
    // vers une ligne disparue ne veut plus rien dire.
    removeCommand: (key: string): void => {
      patch(index, (item) => ({
        ...item,
        values: {
          ...item.values,
          commands: item.values.commands.filter((row) => row.key !== key),
          criteria: item.values.criteria.map((row) => ({
            ...row,
            commandKeys: row.commandKeys.filter((entry) => entry !== key),
          })),
        },
      }));
    },
  });

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="itemCount" value={String(items.length)} />

      {state.stale ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {REPLAN_STALE_MESSAGE}
        </p>
      ) : null}

      <PlanFormError error={state.error} />

      {changesBrief || changesPlan ? (
        <section className="flex flex-col gap-6">
          <h2 className="text-sm font-medium text-zinc-200">Project Plan changes</h2>

          {changesBrief ? (
            <fieldset className="flex flex-col gap-6" disabled={stopped}>
              <legend className="text-xs uppercase tracking-wider text-zinc-500">
                Project Brief
              </legend>
              <PlanTextField
                name="summary"
                label="Resume"
                hint="Corrigez ce que l'Architecte a propose avant d'appliquer."
                limit={PROJECT_PLAN_LIMITS.summary}
                rows={4}
                value={brief.summary}
                onChange={setBriefField("summary")}
              />
              <PlanTextField
                name="problem"
                label="Probleme"
                hint="Le probleme que le produit resout."
                limit={PROJECT_PLAN_LIMITS.problem}
                rows={4}
                value={brief.problem}
                onChange={setBriefField("problem")}
              />
              <PlanTextField
                name="targetUsers"
                label="Utilisateurs vises"
                hint="A qui le produit s'adresse."
                limit={PROJECT_PLAN_LIMITS.targetUsers}
                rows={3}
                value={brief.targetUsers}
                onChange={setBriefField("targetUsers")}
              />
              <PlanTextField
                name="desiredOutcome"
                label="Resultat vise"
                hint="Ce qui aura change quand le produit servira."
                limit={PROJECT_PLAN_LIMITS.desiredOutcome}
                rows={3}
                value={brief.desiredOutcome}
                onChange={setBriefField("desiredOutcome")}
              />
              <PlanListField
                name="goals"
                label="Objectifs"
                hint="Ce que le produit doit permettre."
                value={brief.goals}
                onChange={setBriefField("goals")}
              />
              <PlanListField
                name="nonGoals"
                label="Hors objectifs"
                hint="Ce qu'il ne cherche pas a faire."
                value={brief.nonGoals}
                onChange={setBriefField("nonGoals")}
              />
            </fieldset>
          ) : null}

          {changesPlan ? (
            <fieldset className="flex flex-col gap-6" disabled={stopped}>
              <legend className="text-xs uppercase tracking-wider text-zinc-500">
                Living V1 Plan
              </legend>
              <PlanTextField
                name="goal"
                label="Objectif de la V1"
                hint="Ce que la premiere version doit accomplir."
                limit={PROJECT_PLAN_LIMITS.goal}
                rows={4}
                value={plan.goal}
                onChange={setPlanField("goal")}
              />
              <PlanListField
                name="inScope"
                label="Dans le perimetre"
                hint="Ce que la V1 comprend."
                value={plan.inScope}
                onChange={setPlanField("inScope")}
              />
              <PlanListField
                name="outOfScope"
                label="Hors perimetre"
                hint="Ce qui attendra."
                value={plan.outOfScope}
                onChange={setPlanField("outOfScope")}
              />
              <PlanTextField
                name="technicalDirection"
                label="Direction technique"
                hint="Les choix structurants deja faits."
                limit={PROJECT_PLAN_LIMITS.technicalDirection}
                rows={4}
                value={plan.technicalDirection}
                onChange={setPlanField("technicalDirection")}
              />
              <PlanListField
                name="milestones"
                label="Etapes"
                hint="Une capacite atteinte, jamais un travail a faire."
                value={plan.milestones}
                onChange={setPlanField("milestones")}
              />
            </fieldset>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-zinc-200">Future tasks</h2>
          <span className="text-xs text-zinc-600">
            L&apos;ordre affiche est l&apos;ordre applique.
          </span>
        </div>

        {items.length === 0 ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm leading-relaxed text-zinc-500">
            Le plan futur serait vide. C&apos;est permis — un projet peut n&apos;avoir plus rien a
            faire — mais verifiez que c&apos;est bien ce que vous voulez.
          </p>
        ) : null}

        <ol className="flex flex-col gap-4">
          {items.map((item, index) => {
            const prefix = `items.${String(index)}.`;
            const at = (field: string): string => `${prefix}${field}`;
            const open = expanded === item.uid;
            const values = item.values;
            const candidates: ChangeDependencyCandidate[] = [
              ...lockedCandidates,
              ...items.flatMap((other, position) =>
                position === index
                  ? []
                  : [
                      {
                        id: other.existingTaskId ?? other.tempId ?? "",
                        code: other.code ?? `nouvelle · ${other.tempId ?? ""}`,
                        title: other.values.title,
                        locked: false,
                      },
                    ],
              ),
            ];

            return (
              <li key={item.uid} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                <input type="hidden" name={at("existingTaskId")} value={item.existingTaskId ?? ""} />
                <input type="hidden" name={at("tempId")} value={item.tempId ?? ""} />
                <input type="hidden" name={at("code")} value={item.code ?? ""} />

                <div className="flex flex-wrap items-start gap-3">
                  <span className="mt-2 w-16 shrink-0 text-right font-mono text-xs text-zinc-600">
                    {item.code ?? "nouvelle"}
                  </span>

                  <div className="min-w-0 flex-1 flex-col gap-2">
                    <input
                      type="text"
                      name={at("title")}
                      value={values.title}
                      onChange={(event) => {
                        setField(index, "title")(event.target.value);
                      }}
                      disabled={stopped}
                      aria-label={`Titre de ${item.code ?? `la tache ${String(index + 1)}`}`}
                      className={`${FIELD_CLASSES} font-medium`}
                    />
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                      {values.objective}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      Verification : {planSummary(values)} ·{" "}
                      {item.dependsOn.length === 0
                        ? "aucune dependance"
                        : `${String(item.dependsOn.length)} dependance(s)`}
                    </p>
                  </div>

                  <select
                    name={at("priority")}
                    value={values.priority}
                    onChange={(event) => {
                      setField(index, "priority")(event.target.value);
                    }}
                    disabled={stopped}
                    aria-label={`Priorite de ${item.code ?? `la tache ${String(index + 1)}`}`}
                    className={`${FIELD_CLASSES} w-auto`}
                  >
                    {TASK_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {taskPriorityLabel(priority)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(open ? null : item.uid);
                    }}
                    className={CONTROL_CLASSES}
                  >
                    {open ? "Close" : "Edit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItems((current) => moveBacklogItem(current, index, index - 1));
                    }}
                    disabled={stopped || index === 0}
                    className={CONTROL_CLASSES}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItems((current) => moveBacklogItem(current, index, index + 1));
                    }}
                    disabled={stopped || index === items.length - 1}
                    className={CONTROL_CLASSES}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItems((current) => removeBacklogItem(current, index));
                    }}
                    disabled={stopped}
                    className={CONTROL_CLASSES}
                  >
                    Remove
                  </button>
                </div>

                {/*
                  Les champs replies restent dans le formulaire, en `hidden` : un
                  champ demonte perdrait sa valeur, et l'application enverrait un
                  contrat ampute de tout ce que l'utilisateur n'a pas deplie.
                */}
                {open ? (
                  <div className="mt-4 flex flex-col gap-4 border-t border-zinc-800 pt-4">
                    <Field
                      name={at("objective")}
                      label="Objectif"
                      hint="Le resultat observable attendu."
                      rows={3}
                      value={values.objective}
                      onChange={setField(index, "objective")}
                    />
                    <Field
                      name={at("context")}
                      label="Contexte"
                      rows={3}
                      value={values.context}
                      onChange={setField(index, "context")}
                    />
                    <Field
                      name={at("outOfScope")}
                      label="Hors perimetre"
                      rows={3}
                      value={values.outOfScope}
                      onChange={setField(index, "outOfScope")}
                    />
                    <Field
                      name={at("documents")}
                      label="Documents a lire"
                      hint="Un chemin par ligne, issu du repository."
                      rows={3}
                      value={values.documents}
                      onChange={setField(index, "documents")}
                    />

                    <fieldset className="flex flex-col gap-2" disabled={stopped}>
                      <legend className="text-xs uppercase tracking-wider text-zinc-500">
                        Attend
                      </legend>
                      <p className="text-xs text-zinc-600">
                        Seul <span className="font-mono">COMPLETED</span> satisfait une dependance.
                        Une tache deja terminee reste une dependance valable.
                      </p>
                      {candidates.length === 0 ? (
                        <p className="text-xs italic text-zinc-600">Aucune autre tache.</p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {candidates.map((candidate) => (
                            <li key={candidate.id}>
                              <label className="flex items-baseline gap-2 text-sm text-zinc-300">
                                <input
                                  type="checkbox"
                                  name={at("dependsOn")}
                                  value={candidate.id}
                                  checked={item.dependsOn.includes(candidate.id)}
                                  onChange={() => {
                                    patch(index, (entry) => ({
                                      ...entry,
                                      dependsOn: entry.dependsOn.includes(candidate.id)
                                        ? entry.dependsOn.filter((id) => id !== candidate.id)
                                        : [...entry.dependsOn, candidate.id],
                                    }));
                                  }}
                                />
                                <span className="font-mono text-xs text-zinc-500">
                                  {candidate.code}
                                </span>
                                <span className="truncate">{candidate.title}</span>
                                {candidate.locked ? (
                                  <span className="text-xs text-zinc-600">· historique</span>
                                ) : null}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </fieldset>

                    <VerificationPlanFields
                      prefix={prefix}
                      rows={{ criteria: values.criteria, commands: values.commands }}
                      handlers={planHandlers(index)}
                      disabled={stopped}
                    />
                  </div>
                ) : (
                  <>
                    <input type="hidden" name={at("objective")} value={values.objective} />
                    <input type="hidden" name={at("context")} value={values.context} />
                    <input type="hidden" name={at("outOfScope")} value={values.outOfScope} />
                    <input type="hidden" name={at("documents")} value={values.documents} />
                    {item.dependsOn.map((dependency) => (
                      <input
                        key={dependency}
                        type="hidden"
                        name={at("dependsOn")}
                        value={dependency}
                      />
                    ))}
                    <VerificationPlanFields
                      prefix={prefix}
                      rows={{ criteria: values.criteria, commands: values.commands }}
                      handlers={planHandlers(index)}
                      disabled={stopped}
                      hidden
                    />
                  </>
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={addTask} disabled={stopped} className={CONTROL_CLASSES}>
            Add task
          </button>
          <span className="text-xs text-zinc-600">
            Une tache ajoutee ici recoit son code a l&apos;application, jamais avant.
          </span>
        </div>

        {missing.length === 0 ? null : (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3">
            <h3 className="text-xs uppercase tracking-wider text-zinc-500">
              Retirees du plan futur
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">
              Appliquer ce changement les supprimerait. Tant que rien n&apos;est applique, elles se
              restaurent d&apos;un clic.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {missing.map((item) => (
                <li key={item.uid} className="flex flex-wrap items-baseline gap-3">
                  <span className="font-mono text-xs text-zinc-500">{item.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                    {item.values.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setItems((current) => [...current, { ...item, uid: `${item.uid}-${makeKey()}` }]);
                    }}
                    disabled={stopped}
                    className={CONTROL_CLASSES}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-5">
        <button
          type="submit"
          disabled={pending || stopped}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Application…" : "Apply project change"}
        </button>
        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Appliquer ne rappelle pas l&apos;Architecte : aucun appel au fournisseur, aucune execution
        de Claude Code, aucune validation, aucun commit, aucun push, aucun demarrage de file. Les
        taches nouvelles sont creees en <span className="font-mono">DRAFT</span>, hors file. Une
        tache prete dont le contrat change redevient un brouillon.
      </p>
    </form>
  );
}
