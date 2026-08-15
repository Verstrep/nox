"use client";

import { PROJECT_PLAN_LIMITS } from "@nox/shared";

const FIELD_CLASSES =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 " +
  "disabled:opacity-60";

/**
 * Compteur de caracteres.
 *
 * Affiche en permanence plutot qu'a l'approche de la limite, comme celui de la
 * memoire : une borne qui n'apparait qu'une fois depassee se decouvre au moment
 * ou il est trop tard pour l'anticiper.
 */
function Counter({ value, limit }: { value: string; limit: number }) {
  const over = value.length > limit;
  return (
    <span className={`text-xs ${over ? "text-amber-300" : "text-zinc-600"}`}>
      {value.length} / {limit} caracteres
    </span>
  );
}

/** Un champ de texte borne, avec son aide et son compteur. */
export function PlanTextField({
  name,
  label,
  hint,
  limit,
  rows,
  value,
  onChange,
}: {
  name: string;
  label: string;
  hint: string;
  limit: number;
  rows: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-zinc-200">
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        rows={rows}
        className={`mt-2 resize-y ${FIELD_CLASSES}`}
      />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="max-w-prose text-xs text-zinc-600">{hint}</p>
        <Counter value={value} limit={limit} />
      </div>
    </div>
  );
}

/**
 * Une liste, saisie a raison d'un element par ligne.
 *
 * Pas de glisser-deposer, pas d'editeur riche, pas de champs ajoutes un a un :
 * une liste de cinq idees se tape et se recolle plus vite dans un bloc de texte
 * que dans cinq champs, et l'ordre s'y reorganise sans souris.
 *
 * Le decoupage est refait cote serveur : ce composant n'a aucune autorite sur ce
 * qui sera enregistre.
 */
export function PlanListField({
  name,
  label,
  hint,
  value,
  onChange,
}: {
  name: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const count = value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "").length;
  const tooMany = count > PROJECT_PLAN_LIMITS.items;

  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-zinc-200">
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        rows={5}
        className={`mt-2 resize-y font-mono ${FIELD_CLASSES}`}
        placeholder={"Un element par ligne"}
      />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="max-w-prose text-xs text-zinc-600">
          Un element par ligne. {hint}
        </p>
        <span className={`text-xs ${tooMany ? "text-amber-300" : "text-zinc-600"}`}>
          {count} / {PROJECT_PLAN_LIMITS.items} elements
        </span>
      </div>
    </div>
  );
}

/** Bandeau de refus, rendu par les deux formulaires. */
export function PlanFormError({ error }: { error: string | null }) {
  if (error === null) {
    return null;
  }
  return (
    <p
      role="alert"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
    >
      {error}
    </p>
  );
}
