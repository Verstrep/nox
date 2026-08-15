"use client";

import { PROJECT_PLAN_LIMITS } from "@nox/shared";
import Link from "next/link";
import { useActionState, useState } from "react";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";

import { saveBriefAction } from "./actions";
import { PlanFormError, PlanListField, PlanTextField } from "./PlanFields";
import { INITIAL_BRIEF_FORM_STATE, type BriefFormState, type BriefFormValues } from "./form-state";

/**
 * Formulaire du brief produit.
 *
 * ## Il ne valide rien
 *
 * Les compteurs aident a la saisie ; ils n'autorisent pas. Bornes, normalisation,
 * sanitation, budget commun et revision attendue sont verifies par le serveur,
 * dans la transaction d'ecriture. Reimplémenter ces regles ici en produirait une
 * seconde version, et celle qui aurait tort serait celle qui accepte.
 *
 * ## `expectedRevision`
 *
 * Rendue en champ cache, telle qu'elle etait a l'ouverture de la page. Une
 * chaine vide signifie « aucun brief n'existait ». Ce jeton ne peut qu'obtenir
 * un refus : le serveur relit la revision courante lui-meme pour la comparer.
 */
export function BriefForm({
  projectId,
  expectedRevision,
  initialValues,
  cancelHref,
}: {
  projectId: string;
  expectedRevision: string | null;
  initialValues: BriefFormValues;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<BriefFormState, FormData>(saveBriefAction, {
    ...INITIAL_BRIEF_FORM_STATE,
    values: initialValues,
  });

  // Les valeurs renvoyees par la Server Action reprennent la main apres un
  // refus : le texte saisi n'est jamais perdu, meme quand le budget refuse.
  const [values, setValues] = useState<BriefFormValues>(state.values);
  const dirty = (Object.keys(initialValues) as (keyof BriefFormValues)[]).some(
    (field) => values[field] !== initialValues[field],
  );

  useUnsavedChanges(dirty && !pending);

  const set = (field: keyof BriefFormValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="expectedRevision" value={expectedRevision ?? ""} />

      <PlanFormError error={state.error} />

      <PlanTextField
        name="summary"
        label="Resume"
        hint="Le projet en quelques phrases. C'est la premiere chose que l'Architecte lit."
        limit={PROJECT_PLAN_LIMITS.summary}
        rows={4}
        value={values.summary}
        onChange={set("summary")}
      />

      <PlanTextField
        name="problem"
        label="Probleme"
        hint="Ce que le produit resout. Un probleme reel, pas une liste de fonctionnalites."
        limit={PROJECT_PLAN_LIMITS.problem}
        rows={5}
        value={values.problem}
        onChange={set("problem")}
      />

      <PlanTextField
        name="targetUsers"
        label="Utilisateurs vises"
        hint="A qui le produit s'adresse. « Moi seul » est une reponse parfaitement valable."
        limit={PROJECT_PLAN_LIMITS.targetUsers}
        rows={3}
        value={values.targetUsers}
        onChange={set("targetUsers")}
      />

      <PlanTextField
        name="desiredOutcome"
        label="Resultat vise"
        hint="Ce qui aura change quand le produit servira. Un resultat, pas une etape."
        limit={PROJECT_PLAN_LIMITS.desiredOutcome}
        rows={3}
        value={values.desiredOutcome}
        onChange={set("desiredOutcome")}
      />

      <PlanListField
        name="goals"
        label="Objectifs"
        hint="Ce que le produit doit permettre."
        value={values.goals}
        onChange={set("goals")}
      />

      <PlanListField
        name="nonGoals"
        label="Hors objectifs"
        hint="Ce qu'il ne cherche pas a faire. Aussi utile que la liste precedente."
        value={values.nonGoals}
        onChange={set("nonGoals")}
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Enregistrement…" : "Save brief"}
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
        et n&apos;ecrit aucun fichier dans le repository. Le nouvel etat partira avec votre prochain
        message.
      </p>
    </form>
  );
}
