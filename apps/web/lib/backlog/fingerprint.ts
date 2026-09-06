/**
 * Empreintes deterministes du contexte de planification.
 *
 * ## Ce qu'elles sont, et ce qu'elles ne sont pas
 *
 * Elles repondent a **une** question : le projet est-il encore exactement celui
 * a partir duquel ce backlog a ete concu ? Rien de plus.
 *
 * Ce ne sont pas des primitives de securite. L'empreinte de dossier de travail
 * de TASK-012 en est une — elle est authentifiee par HMAC, parce qu'elle decide
 * si Claude Code peut reprendre une session, et qu'un attaquant capable de la
 * forger obtiendrait une execution. Ici, rien de tel : ce qui est protege est la
 * coherence entre un backlog et l'etat qui l'a produit, et le seul acteur
 * capable de « tricher » serait l'utilisateur lui-meme, contre son propre plan.
 *
 * Un SHA-256 nu convient donc, comme pour l'empreinte de contexte de
 * l'Architecte. Ne jamais confondre les deux.
 *
 * ## Pourquoi le contenu, et pas seulement les revisions
 *
 * Une revision de document decrit ses octets **avant** sanitation et troncature.
 * Un meme fichier peut etre coupe differemment si le budget change, et deux
 * etats differents du repository peuvent produire le meme texte envoye.
 * L'empreinte porte donc sur ce qui part reellement.
 *
 * ## Pourquoi chaque champ est precede de sa longueur
 *
 * Sans cela, deux entrees differentes pourraient produire la meme empreinte par
 * simple deplacement d'une frontiere : `["ab", "c"]` et `["a", "bc"]` se
 * concatenent en `abc`.
 */

import type {
  ArchitectPromptDocument,
  ArchitectPromptMemory,
  BacklogInventoryTask,
} from "@nox/shared";
import { createHash, type Hash } from "node:crypto";

import { projectMemorySetRevision } from "../architect/fingerprint.ts";

/** Version de l'algorithme, incluse dans chaque empreinte. */
export const BACKLOG_FINGERPRINT_VERSION = "backlog-context/1";

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
 * Revision d'une tache de l'inventaire, calculee sur ce qui est envoye.
 *
 * `updatedAt` n'y figure pas : un horodatage dit quand une ligne a ete touchee,
 * pas ce qu'elle contient. Une reecriture a l'identique ne doit pas se signaler
 * comme un changement de contexte.
 *
 * Le statut, en revanche, **y figure** — a la difference de la memoire, ou
 * l'archivage se lit deja comme une absence. Ici il porte du sens : une tache
 * passee de `DRAFT` a `COMPLETED` change ce qu'il reste a planifier, meme si sa
 * specification n'a pas bouge d'une lettre.
 */
export function backlogTaskRevision(task: Omit<BacklogInventoryTask, "revision">): string {
  const hash = createHash("sha256");
  field(hash, "backlog-task/1");
  field(hash, task.code);
  field(hash, task.title);
  field(hash, task.status);
  field(hash, task.priority);
  field(hash, task.objective);
  return hash.digest("hex");
}

/**
 * Revision de l'inventaire entier.
 *
 * Elle change des qu'une tache est ajoutee, retiree, renommee, reformulee ou
 * change de statut. C'est elle qui rend detectable le scenario le plus
 * previsible de tous : un backlog genere, une tache creee a la main dans
 * l'intervalle, et une application qui produirait un doublon.
 *
 * Le nombre d'entrees precede la liste : sans lui, retirer une tache et en
 * ajouter une identique ailleurs passerait inapercu.
 */
export function backlogTaskInventoryRevision(
  tasks: readonly BacklogInventoryTask[],
): string {
  const hash = createHash("sha256");
  field(hash, "backlog-inventory/1");
  fieldList(hash, tasks.map((task) => task.revision));
  return hash.digest("hex");
}

/**
 * Revision de la memoire active transmise.
 *
 * Les revisions individuelles viennent de `projectMemoryRevision`, celle de
 * TASK-017 : la memoire n'a qu'une facon d'etre hachee, et un second calcul
 * finirait par decrire un autre texte que celui qui part reellement.
 */
export function backlogMemoryRevision(
  memories: readonly ArchitectPromptMemory[],
): string {
  const hash = createHash("sha256");
  field(hash, "backlog-memory/1");
  // Delegue depuis HOTFIX-005 : la mise a jour de projet avait besoin de la
  // meme question — « la memoire a-t-elle change ? » — et deux calculs
  // paralleles auraient fini par repondre differemment. L'etiquette locale
  // reste, pour que les empreintes de planification deja enregistrees gardent
  // leur valeur.
  field(hash, projectMemorySetRevision(memories));
  return hash.digest("hex");
}

function fieldDocument(hash: Hash, document: ArchitectPromptDocument): void {
  field(hash, document.path);
  field(hash, document.revision ?? "");
  field(hash, document.truncated ? "truncated" : "complete");
  field(hash, document.content);
}

/** Ce sur quoi l'empreinte de planification porte. */
export type BacklogFingerprintInput = {
  briefRevision: string | null;
  planRevision: string | null;
  memoryRevision: string;
  taskInventoryRevision: string;
  instructionDocuments: readonly ArchitectPromptDocument[];
  contextDocuments: readonly ArchitectPromptDocument[];
  availableDocuments: readonly string[];
  missingDocuments: readonly string[];
};

/**
 * Empreinte du contexte de planification reellement prepare.
 *
 * Elle couvre les cinq sources qui decident d'un backlog : le brief, le plan, la
 * memoire active, l'inventaire des taches et les documents **inclus**. Un
 * fichier du repository qui ne fait pas partie de la liste fermee n'y entre
 * pas, et ne rend donc rien perime — ce serait de la severite gratuite.
 *
 * L'ordre compte autant que le contenu : deux memes documents presentes dans
 * l'ordre inverse ne produisent pas le meme prompt.
 *
 * Une absence est distinguee d'un objet vide. « Pas de brief » et « un brief qui
 * ne dit rien » ne disent pas la meme chose au fournisseur, et ne doivent donc
 * pas produire la meme empreinte.
 */
export function backlogPlanningFingerprint(input: BacklogFingerprintInput): string {
  const hash = createHash("sha256");
  field(hash, BACKLOG_FINGERPRINT_VERSION);

  field(hash, input.briefRevision ?? "no-brief");
  field(hash, input.planRevision ?? "no-plan");
  field(hash, input.memoryRevision);
  field(hash, input.taskInventoryRevision);

  hash.update(String(input.instructionDocuments.length));
  hash.update(" ");
  for (const document of input.instructionDocuments) {
    fieldDocument(hash, document);
  }

  hash.update(String(input.contextDocuments.length));
  hash.update(" ");
  for (const document of input.contextDocuments) {
    fieldDocument(hash, document);
  }

  fieldList(hash, input.availableDocuments);
  fieldList(hash, input.missingDocuments);

  return hash.digest("hex");
}
