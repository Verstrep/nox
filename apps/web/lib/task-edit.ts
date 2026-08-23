/**
 * Edition d'une tache future, cote `apps/web`.
 *
 * Deux choses ici, et rien d'autre : la **revision** d'un contrat de tache, et
 * la traduction entre le formulaire et la specification enregistrable.
 *
 * ## Pourquoi une revision de contenu plutot que `updatedAt`
 *
 * `updatedAt` change pour des raisons qui n'ont rien a voir avec le contrat :
 * une resynchronisation du document Markdown le touche, une transition de statut
 * aussi. Deux onglets ouverts se seraient donc perimes mutuellement sans que
 * personne n'ait rien modifie — et l'utilisateur aurait appris a ignorer le
 * message.
 *
 * L'empreinte porte donc exactement ce que l'editeur peut changer : le titre, la
 * priorite, l'objectif, le contexte, le hors perimetre, les trois listes, et
 * l'ensemble des dependances. Le statut n'y figure pas : il est **derive** de
 * l'edition, pas une entree de celle-ci.
 *
 * ## Ce que cette empreinte n'est pas
 *
 * Une primitive de securite. SHA-256 nu, comme l'empreinte de contexte de
 * l'Architecte, et pour la meme raison : elle sert a detecter une divergence,
 * pas a autoriser une ecriture. L'empreinte du dossier de travail, elle, decide
 * d'une execution — c'est pour cela qu'elle est un HMAC. Ne pas confondre les
 * deux.
 */

import type { TaskEditInput, TaskEditSnapshot } from "@nox/database";
import {
  TASK_EDIT_ERROR,
  normalizeDependencyIds,
  type DevelopmentTaskDetail,
  type TaskEditErrorCode,
} from "@nox/shared";
import { createHash } from "node:crypto";

import { TASK_QUEUED_MESSAGE } from "./queue-display.ts";
import { readTaskSubmission, type TaskFormValues, type TaskInputResult } from "./task-input.ts";

/** Version de l'empreinte, pour qu'un changement de forme ne passe pas inapercu. */
export const TASK_EDIT_REVISION_VERSION = "task-contract/1";

/**
 * Serialise un champ avec sa longueur.
 *
 * Le prefixe de longueur empeche deux contenus differents de produire la meme
 * chaine — « ab » + « c » et « a » + « bc » se distinguent. C'est la meme
 * precaution que pour les autres empreintes de NOX.
 */
function field(value: string): string {
  return `${String(value.length)}:${value}`;
}

function list(entries: readonly string[]): string {
  return `${String(entries.length)}[${entries.map(field).join("")}]`;
}

/**
 * Empreinte du contrat d'une tache.
 *
 * Deterministe et sensible a l'ordre des listes — l'ordre fait partie de la
 * specification, un agent les lira dans cet ordre. Les dependances font
 * exception : elles sont triees avant d'entrer dans l'empreinte, parce que leur
 * ordre ne signifie rien.
 */
export function taskEditRevision(snapshot: TaskEditSnapshot): string {
  const payload = [
    TASK_EDIT_REVISION_VERSION,
    field(snapshot.title),
    field(snapshot.priority),
    field(snapshot.objective),
    field(snapshot.context ?? ""),
    field(snapshot.outOfScope ?? ""),
    list(snapshot.acceptanceCriteria),
    list(snapshot.documentReferences),
    list(snapshot.validationCommands),
    list([...snapshot.dependsOnTaskIds].sort((left, right) => left.localeCompare(right))),
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Empreinte d'une tache relue, accompagnee de ses dependances actuelles. */
export function taskRevisionOf(
  task: DevelopmentTaskDetail,
  dependsOnTaskIds: readonly string[],
): string {
  return taskEditRevision({
    title: task.title,
    objective: task.objective,
    context: task.context,
    outOfScope: task.outOfScope,
    priority: task.priority,
    acceptanceCriteria: task.acceptanceCriteria,
    documentReferences: task.documentReferences,
    validationCommands: task.validationCommands,
    dependsOnTaskIds,
  });
}

/** Valeurs du formulaire d'edition : celles de la creation, plus les dependances. */
export type TaskEditFormValues = TaskFormValues & {
  /** Identifiants coches, dans l'ordre d'affichage. */
  dependsOnTaskIds: readonly string[];
};

/** Prefill du formulaire a partir de la tache enregistree. */
export function taskEditFormValues(
  task: DevelopmentTaskDetail,
  dependsOnTaskIds: readonly string[],
): TaskEditFormValues {
  return {
    title: task.title,
    priority: task.priority,
    objective: task.objective,
    context: task.context ?? "",
    outOfScope: task.outOfScope ?? "",
    documents: task.documentReferences.join("\n"),
    criteria: task.acceptanceCriteria.join("\n"),
    commands: task.validationCommands.join("\n"),
    dependsOnTaskIds: [...dependsOnTaskIds],
  };
}

export type TaskEditSubmission =
  | { ok: true; input: TaskEditInput }
  | { ok: false; message: string };

/**
 * Valide une soumission d'edition.
 *
 * Le contrat passe **exactement** par le validateur de la creation : memes
 * bornes, meme filtrage des chemins de documents, meme refus des commandes
 * chainees. Un second format de tache aurait fini par diverger, et l'un des deux
 * aurait ete le moins verifie.
 *
 * Les identifiants de dependances ne sont ici que **normalises** : leur
 * existence, leur projet, leur nature et les cycles se verifient en base, avec
 * l'etat courant sous les yeux. Le navigateur n'a aucune autorite sur ce point.
 */
export function readTaskEditSubmission(values: TaskEditFormValues): TaskEditSubmission {
  const submission: TaskInputResult = readTaskSubmission(values);
  if (!submission.ok) {
    return { ok: false, message: submission.message };
  }
  return {
    ok: true,
    input: {
      ...submission.input,
      dependsOnTaskIds: normalizeDependencyIds(values.dependsOnTaskIds),
    },
  };
}

/** Message d'un refus d'edition. */
export function taskEditRefusalMessage(code: TaskEditErrorCode): string {
  switch (code) {
    case TASK_EDIT_ERROR.UNKNOWN_TASK:
      return "Cette tache n'existe pas dans ce projet. Revenez au backlog et rouvrez-la.";
    case TASK_EDIT_ERROR.FROZEN:
      return (
        "Cette tache possede un historique d'execution : sa specification est figee. " +
        "Une demande de correction — « Request changes » — reste la facon de faire evoluer " +
        "un travail deja produit."
      );
    case TASK_EDIT_ERROR.STATUS_NOT_EDITABLE:
      return (
        "Seule une tache en brouillon ou en file peut etre modifiee ici. " +
        "Ramenez-la dans l'un de ces deux etats avant de reessayer."
      );
    case TASK_EDIT_ERROR.STALE:
      return (
        "Cette tache a change depuis l'ouverture du formulaire. Rechargez la page avant " +
        "d'enregistrer : NOX n'ecrase pas une modification qu'il n'a pas su vous montrer."
      );
    case TASK_EDIT_ERROR.QUEUED:
      return TASK_QUEUED_MESSAGE;
  }
}
