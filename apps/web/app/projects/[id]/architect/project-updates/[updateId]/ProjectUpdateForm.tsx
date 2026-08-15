"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { PROJECT_PLAN_LIMITS } from "@nox/shared";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";

import { PlanFormError, PlanListField, PlanTextField } from "../../../plan/PlanFields";
import type { BriefFormValues, V1PlanFormValues } from "../../../plan/form-state";
import { applyProjectUpdateAction } from "./actions";
import type { ProjectUpdateReviewState, ProjectUpdateReviewValues } from "./form-state";

/**
 * Formulaire d'application d'une proposition.
 *
 * ## Il est prerempli avec ce que le fournisseur a propose
 *
 * C'est un point de depart, pas une valeur imposee : l'utilisateur corrige ce
 * qu'il veut avant d'appliquer. Ce qu'il enregistre devient l'etat applique, et
 * la proposition d'origine reste conservee telle quelle — les deux repondent a
 * deux questions differentes.
 *
 * ## Aucun brouillon n'est persiste
 *
 * Une edition non appliquee vit dans le formulaire, et nulle part ailleurs.
 * Ajouter un brouillon enregistre serait une fonctionnalite de plus, avec son
 * cycle de vie et ses conflits ; rien ne la demande aujourd'hui.
 *
 * ## Il ne declare pas quelles sections changent
 *
 * Seuls les champs des sections `SET` sont rendus, et le serveur relit la
 * proposition pour savoir lesquelles ecrire. Le navigateur ne porte pas la
 * semantique du payload du fournisseur.
 */
export function ProjectUpdateForm({
  projectId,
  updateId,
  changesBrief,
  changesPlan,
  initialValues,
  cancelHref,
  blocked,
}: {
  projectId: string;
  updateId: string;
  changesBrief: boolean;
  changesPlan: boolean;
  initialValues: ProjectUpdateReviewValues;
  cancelHref: string;
  /** Proposition perimee ou deja traitee : l'application est impossible. */
  blocked: boolean;
}) {
  const [state, formAction, pending] = useActionState<ProjectUpdateReviewState, FormData>(
    applyProjectUpdateAction,
    { values: initialValues, error: null },
  );

  const [values, setValues] = useState<ProjectUpdateReviewValues>(state.values);
  const dirty =
    JSON.stringify(values) !== JSON.stringify(initialValues);

  useUnsavedChanges(dirty && !pending && !blocked);

  const setBrief = (field: keyof BriefFormValues) => (value: string) => {
    setValues((current) => ({ ...current, brief: { ...current.brief, [field]: value } }));
  };
  const setPlan = (field: keyof V1PlanFormValues) => (value: string) => {
    setValues((current) => ({ ...current, plan: { ...current.plan, [field]: value } }));
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="updateId" value={updateId} />

      <PlanFormError error={state.error} />

      {changesBrief ? (
        <fieldset className="flex flex-col gap-6" disabled={blocked}>
          <legend className="text-sm font-medium text-zinc-200">
            Project Brief — valeur a appliquer
          </legend>

          <PlanTextField
            name="summary"
            label="Resume"
            hint="Corrigez ce que l'Architecte a propose avant d'appliquer."
            limit={PROJECT_PLAN_LIMITS.summary}
            rows={4}
            value={values.brief.summary}
            onChange={setBrief("summary")}
          />
          <PlanTextField
            name="problem"
            label="Probleme"
            hint="Le probleme que le produit resout."
            limit={PROJECT_PLAN_LIMITS.problem}
            rows={4}
            value={values.brief.problem}
            onChange={setBrief("problem")}
          />
          <PlanTextField
            name="targetUsers"
            label="Utilisateurs vises"
            hint="A qui le produit s'adresse."
            limit={PROJECT_PLAN_LIMITS.targetUsers}
            rows={3}
            value={values.brief.targetUsers}
            onChange={setBrief("targetUsers")}
          />
          <PlanTextField
            name="desiredOutcome"
            label="Resultat vise"
            hint="Ce qui aura change quand le produit servira."
            limit={PROJECT_PLAN_LIMITS.desiredOutcome}
            rows={3}
            value={values.brief.desiredOutcome}
            onChange={setBrief("desiredOutcome")}
          />
          <PlanListField
            name="goals"
            label="Objectifs"
            hint="Ce que le produit doit permettre."
            value={values.brief.goals}
            onChange={setBrief("goals")}
          />
          <PlanListField
            name="nonGoals"
            label="Hors objectifs"
            hint="Ce qu'il ne cherche pas a faire."
            value={values.brief.nonGoals}
            onChange={setBrief("nonGoals")}
          />
        </fieldset>
      ) : null}

      {changesPlan ? (
        <fieldset className="flex flex-col gap-6" disabled={blocked}>
          <legend className="text-sm font-medium text-zinc-200">
            Living V1 Plan — valeur a appliquer
          </legend>

          <PlanTextField
            name="goal"
            label="Objectif de la V1"
            hint="Ce que la premiere version doit accomplir."
            limit={PROJECT_PLAN_LIMITS.goal}
            rows={4}
            value={values.plan.goal}
            onChange={setPlan("goal")}
          />
          <PlanListField
            name="inScope"
            label="Dans le perimetre"
            hint="Ce que la V1 comprend."
            value={values.plan.inScope}
            onChange={setPlan("inScope")}
          />
          <PlanListField
            name="outOfScope"
            label="Hors perimetre"
            hint="Ce qui attendra."
            value={values.plan.outOfScope}
            onChange={setPlan("outOfScope")}
          />
          <PlanTextField
            name="technicalDirection"
            label="Direction technique"
            hint="Les choix structurants deja faits."
            limit={PROJECT_PLAN_LIMITS.technicalDirection}
            rows={4}
            value={values.plan.technicalDirection}
            onChange={setPlan("technicalDirection")}
          />
          <PlanListField
            name="milestones"
            label="Etapes"
            hint="Une capacite atteinte, jamais un travail a faire."
            value={values.plan.milestones}
            onChange={setPlan("milestones")}
          />
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-5">
        <button
          type="submit"
          disabled={pending || blocked}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Application…" : "Apply changes"}
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
        de Claude Code, aucune ecriture dans le repository. C&apos;est votre version qui est
        enregistree, et elle partira avec votre prochain message.
      </p>
    </form>
  );
}
