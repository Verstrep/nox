/**
 * Empreinte deterministe de l'etat de planification.
 *
 * ## La question a laquelle elle repond
 *
 * Une seule : le plan de travail est-il encore exactement celui a partir duquel
 * cette replanification a ete concue ? Rien de plus.
 *
 * Ce n'est **pas** une primitive de securite. L'empreinte de dossier de travail
 * de TASK-012 en est une — HMAC, parce qu'elle decide si Claude Code peut
 * reprendre une session. Ici, ce qui est protege est la coherence entre une
 * cible et l'etat qui l'a produite, et le seul acteur capable de « tricher »
 * serait l'utilisateur lui-meme, contre son propre plan. Un SHA-256 nu suffit,
 * comme pour l'empreinte de contexte de l'Architecte et celle du backlog. Ne
 * jamais confondre les deux familles.
 *
 * ## Ce qu'elle couvre, et pourquoi chaque element compte
 *
 * - Le **contrat** de chaque tache modifiable, par la revision de TASK-024. Pas
 *   une seconde definition : la meme, importee. Deux notions concurrentes de
 *   « cette tache a change » finiraient par se contredire.
 * - Le **verrouillage** de chaque tache. Une tache inscrite en file passe de
 *   modifiable a verrouillee sans que son contrat bouge d'une lettre : sans ce
 *   champ, la proposition la croirait encore modifiable a l'application.
 * - L'**ordre de planification**, parce qu'un replan le change et qu'un onglet
 *   ouvert sur l'ancien ordre proposerait un reordonnancement fantome.
 * - Les **dependances**, triees : leur ordre ne signifie rien, leur presence si.
 * - Les **revisions du brief et du plan**, parce qu'un plan cible se concoit
 *   contre une intention produit.
 *
 * ## Ce qu'elle ne couvre pas
 *
 * L'ordre rendu par SQLite. L'etat est trie avant d'arriver ici, par ordre de
 * planification puis par code — deux lectures du meme etat produisent donc la
 * meme empreinte, quelle que soit la facon dont la base les a rendues.
 */

import type { ReplanStateTask } from "@nox/database";
import { createHash, type Hash } from "node:crypto";

import { taskEditRevision } from "../task-edit.ts";

/** Version de l'algorithme, incluse dans chaque empreinte. */
export const REPLAN_FINGERPRINT_VERSION = "replan-planning/1";

function field(hash: Hash, value: string): void {
  hash.update(String(value.length));
  hash.update(" ");
  hash.update(value, "utf8");
  hash.update(" ");
}

function fieldList(hash: Hash, values: readonly string[]): void {
  hash.update(String(values.length));
  hash.update(" ");
  for (const value of values) {
    field(hash, value);
  }
}

/**
 * Revision d'une tache, telle que la planification la voit.
 *
 * Le contrat quand il existe — donc pour une tache modifiable —, et sinon les
 * faits qui la decrivent. Une tache verrouillee n'a pas de contrat transmis :
 * ce qui compte d'elle est qu'elle existe, ou en est son travail, et ce qu'elle
 * attend.
 */
export function replanTaskRevision(task: ReplanStateTask): string {
  const hash = createHash("sha256");
  field(hash, "replan-task/1");
  field(hash, task.classified.code);
  field(hash, task.classified.id);
  field(hash, task.classified.kind);
  field(hash, task.classified.status);
  field(hash, task.classified.editable ? "editable" : `locked:${task.classified.lockReason}`);
  field(hash, String(task.classified.runCount));
  field(hash, task.classified.queued ? "queued" : "free");
  field(hash, task.planningOrder === null ? "no-order" : String(task.planningOrder));
  fieldList(hash, [...task.dependsOnTaskIds].sort((left, right) => left.localeCompare(right)));

  if (task.contract === null) {
    // Une tache verrouillee : son titre et son objectif suffisent a dire qu'elle
    // a change de sens, et son contrat complet n'a de toute facon pas ete
    // transmis au fournisseur.
    field(hash, "no-contract");
    field(hash, task.title);
    field(hash, task.objective);
  } else {
    field(hash, "contract");
    field(hash, taskEditRevision(task.contract));
  }

  return hash.digest("hex");
}

export type ReplanFingerprintInput = {
  briefRevision: string | null;
  planRevision: string | null;
  /** Taches du projet, deja triees dans l'ordre du plan. */
  tasks: readonly ReplanStateTask[];
};

/**
 * Empreinte de l'etat de planification reellement transmis.
 *
 * Le nombre de taches precede la liste : sans lui, retirer une tache et en
 * ajouter une identique ailleurs passerait inapercu.
 */
export function replanPlanningFingerprint(input: ReplanFingerprintInput): string {
  const hash = createHash("sha256");
  field(hash, REPLAN_FINGERPRINT_VERSION);
  field(hash, input.briefRevision ?? "no-brief");
  field(hash, input.planRevision ?? "no-plan");
  fieldList(hash, input.tasks.map(replanTaskRevision));
  return hash.digest("hex");
}
