"use client";

import { PROJECT_PLAN_LIMITS } from "@nox/shared";
import Link from "next/link";
import { useActionState, useState } from "react";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";

import { savePlanAction } from "./actions";
import { PlanFormError, PlanListField, PlanTextField } from "./PlanFields";
import {
  INITIAL_V1_PLAN_FORM_STATE,
  type V1PlanFormState,
  type V1PlanFormValues,
} from "./form-state";

/**
 * Formulaire du plan de V1.
 *
 * Memes garanties que celui du brief : il aide a saisir, il n'autorise rien. Le
 * serveur revalide tout, et les deux objets partagent un seul budget — un plan
 * accepte isolement peut donc etre refuse a cause du brief.
 */
export function V1PlanForm({
  projectId,
  expectedRevision,
  initialValues,
  cancelHref,
}: {
  projectId: string;
  expectedRevision: string | null;
  initialValues: V1PlanFormValues;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<V1PlanFormState, FormData>(savePlanAction, {
    ...INITIAL_V1_PLAN_FORM_STATE,
    values: initialValues,
  });

  const [values, setValues] = useState<V1PlanFormValues>(state.values);
  const dirty = (Object.keys(initialValues) as (keyof V1PlanFormValues)[]).some(
    (field) => values[field] !== initialValues[field],
  );

  useUnsavedChanges(dirty && !pending);

  const set = (field: keyof V1PlanFormValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="expectedRevision" value={expectedRevision ?? ""} />

      <PlanFormError error={state.error} />

      <PlanTextField
        name="goal"
        label="Objectif de la V1"
        hint="Ce que la premiere version doit accomplir, en une ou deux phrases."
        limit={PROJECT_PLAN_LIMITS.goal}
        rows={4}
        value={values.goal}
        onChange={set("goal")}
      />

      <PlanListField
        name="inScope"
        label="Dans le perimetre"
        hint="Ce que la V1 comprend."
        value={values.inScope}
        onChange={set("inScope")}
      />

      <PlanListField
        name="outOfScope"
        label="Hors perimetre"
        hint="Ce qui attendra. C'est cette liste qui empeche une V1 de grossir sans fin."
        value={values.outOfScope}
        onChange={set("outOfScope")}
      />

      <PlanTextField
        name="technicalDirection"
        label="Direction technique"
        hint="Les choix structurants deja faits. Pas une architecture detaillee."
        limit={PROJECT_PLAN_LIMITS.technicalDirection}
        rows={5}
        value={values.technicalDirection}
        onChange={set("technicalDirection")}
      />

      <PlanListField
        name="milestones"
        label="Etapes"
        hint="Une capacite atteinte — « le planning hebdomadaire est utilisable » —, jamais un travail a faire. Leur ordre est conserve."
        value={values.milestones}
        onChange={set("milestones")}
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Enregistrement…" : "Save V1 plan"}
        </button>
        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Enregistrer ne declenche aucun appel a l&apos;Architecte, aucune execution de Claude Code,
        et n&apos;ecrit aucun fichier dans le repository.
      </p>
    </form>
  );
}
