/**
 * Empreinte deterministe du contexte d'amorcage.
 *
 * ## Ce qu'elle protege
 *
 * Une seule chose : que la tache creee soit celle qui a ete relue. L'apercu
 * montre un texte, la creation en produit un — s'ils differaient, l'apercu
 * n'aurait servi a rien, et l'utilisateur aurait valide autre chose que ce
 * qu'il a lu.
 *
 * ## Ce qu'elle n'est pas
 *
 * Pas une primitive de securite. SHA-256 nu, comme l'empreinte de contexte de
 * l'Architecte et celle de planification — contrairement a l'empreinte de
 * dossier de travail, qui est un HMAC parce qu'elle decide d'une execution. Ne
 * jamais confondre les deux.
 *
 * ## Pourquoi elle couvre le repository
 *
 * Parce que l'amorcage en depend vraiment. Un repository vide et un repository
 * qui vient de recevoir une application ne produisent pas la meme tache : la
 * consigne passe de « choisis une pile minimale » a « preserve celle qui est
 * la ». Creer la premiere sur un repository devenu la seconde serait dangereux.
 *
 * Elle ne couvre que ce que l'inspection **constate**. Un fichier quelconque
 * ajoute dans un sous-dossier ne rend rien perime : la severite gratuite finit
 * par ne plus rien signaler.
 */

import type { ArchitectPromptMemory, RepositoryInspection } from "@nox/shared";
import { createHash, type Hash } from "node:crypto";

/** Version de l'algorithme, incluse dans chaque empreinte. */
export const BOOTSTRAP_FINGERPRINT_VERSION = "bootstrap-context/1";

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
 * Revision de ce que le runner a constate du repository.
 *
 * Le nombre d'entrees a la racine y figure : il distingue un repository vide
 * d'un repository qui vient d'en recevoir une premiere poignee, ce qui change
 * la consigne de preservation.
 */
export function repositoryInspectionRevision(inspection: RepositoryInspection): string {
  const hash = createHash("sha256");
  field(hash, "bootstrap-repository/1");
  fieldList(hash, inspection.manifests);
  fieldList(hash, inspection.sourceDirectories);
  fieldList(hash, inspection.foundationalDocuments);
  field(hash, inspection.hasCommits ? "commits" : "no-commits");
  field(hash, String(inspection.rootEntryCount));
  field(hash, inspection.rootEntryCountTruncated ? "truncated" : "exact");
  return hash.digest("hex");
}

/**
 * Revision de la memoire active transmise.
 *
 * Les revisions individuelles viennent de la memoire elle-meme : elle n'a
 * qu'une facon d'etre hachee dans NOX, et un second calcul finirait par decrire
 * un autre texte que celui qui part reellement.
 */
export function bootstrapMemoryRevision(
  memories: readonly ArchitectPromptMemory[],
): string {
  const hash = createHash("sha256");
  field(hash, "bootstrap-memory/1");
  fieldList(hash, memories.map((memory) => memory.revision));
  return hash.digest("hex");
}

/**
 * Revision de l'inventaire des taches produit deja enregistrees.
 *
 * Le statut y figure, comme pour la planification : une tache passee de `DRAFT`
 * a `COMPLETED` change ce que les fondations doivent porter.
 */
export function bootstrapTaskInventoryRevision(
  tasks: readonly { code: string; title: string; status: string; priority: string; objective: string }[],
): string {
  const hash = createHash("sha256");
  field(hash, "bootstrap-inventory/1");
  hash.update(String(tasks.length));
  hash.update(" ");
  for (const task of tasks) {
    field(hash, task.code);
    field(hash, task.title);
    field(hash, task.status);
    field(hash, task.priority);
    field(hash, task.objective);
  }
  return hash.digest("hex");
}

/** Ce sur quoi l'empreinte d'amorcage porte. */
export type BootstrapFingerprintInput = {
  briefRevision: string | null;
  planRevision: string | null;
  memoryRevision: string;
  taskInventoryRevision: string;
  inspectionRevision: string;
  /** Version du constructeur de specification : un texte change est un contexte change. */
  specVersion: string;
};

/**
 * Empreinte du contexte reellement utilise pour construire `TASK-000`.
 *
 * Une absence est distinguee d'une valeur vide : « pas de brief » et « un brief
 * qui ne dit rien » ne produisent pas la meme tache, et ne doivent donc pas
 * produire la meme empreinte.
 */
export function bootstrapFingerprint(input: BootstrapFingerprintInput): string {
  const hash = createHash("sha256");
  field(hash, BOOTSTRAP_FINGERPRINT_VERSION);
  field(hash, input.specVersion);
  field(hash, input.briefRevision ?? "no-brief");
  field(hash, input.planRevision ?? "no-plan");
  field(hash, input.memoryRevision);
  field(hash, input.taskInventoryRevision);
  field(hash, input.inspectionRevision);
  return hash.digest("hex");
}
