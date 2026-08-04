"use client";

import { useActionState } from "react";

import { createProjectAction } from "./actions";
import { INITIAL_CREATE_PROJECT_STATE } from "./form-state";

const FIELD_CLASSES =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 " +
  "disabled:opacity-60";

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p id={id} className="mt-2 text-sm text-red-400">
      {message}
    </p>
  );
}

export function CreateProjectForm() {
  const [state, formAction, pending] = useActionState(
    createProjectAction,
    INITIAL_CREATE_PROJECT_STATE,
  );
  const { errors, values } = state;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {errors.form === null ? null : (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {errors.form}
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-zinc-200">
          Nom du projet
        </label>
        <p className="mt-1 text-xs text-zinc-500">Le nom affiche dans le tableau de bord NOX.</p>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={80}
          defaultValue={values.name}
          disabled={pending}
          aria-invalid={errors.name !== null}
          aria-describedby={errors.name === null ? undefined : "name-error"}
          placeholder="NOX"
          className={`mt-2 ${FIELD_CLASSES}`}
        />
        <FieldError id="name-error" message={errors.name} />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-zinc-200">
          Description <span className="font-normal text-zinc-500">(facultative)</span>
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Quelques mots sur ce que fait le projet. Modifiable plus tard.
        </p>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={values.description}
          disabled={pending}
          aria-invalid={errors.description !== null}
          aria-describedby={errors.description === null ? undefined : "description-error"}
          className={`mt-2 resize-y ${FIELD_CLASSES}`}
        />
        <FieldError id="description-error" message={errors.description} />
      </div>

      <div>
        <label htmlFor="repositoryPath" className="block text-sm font-medium text-zinc-200">
          Chemin du repository local
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Chemin <strong className="font-medium text-zinc-400">absolu</strong> vers un repository
          Git deja present sur cette machine. Un sous-dossier est accepte : le runner renverra la
          racine du repository, qui sera enregistree.
        </p>
        <input
          id="repositoryPath"
          name="repositoryPath"
          type="text"
          required
          spellCheck={false}
          autoComplete="off"
          defaultValue={values.repositoryPath}
          disabled={pending}
          aria-invalid={errors.repositoryPath !== null}
          aria-describedby={errors.repositoryPath === null ? undefined : "repositoryPath-error"}
          placeholder="D:\\Projets\\mon-projet"
          className={`mt-2 font-mono ${FIELD_CLASSES}`}
        />
        <FieldError id="repositoryPath-error" message={errors.repositoryPath} />
      </div>

      <div className="flex items-center gap-3 border-t border-zinc-800 pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {pending ? "Verification du repository..." : "Creer le projet"}
        </button>
        {pending ? (
          <span aria-live="polite" className="text-xs text-zinc-500">
            Le runner local interroge Git pour determiner la racine du repository.
          </span>
        ) : null}
      </div>
    </form>
  );
}
