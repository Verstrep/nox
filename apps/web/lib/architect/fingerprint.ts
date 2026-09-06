/**
 * Empreintes deterministes du contexte de l'Architecte.
 *
 * ## Ce que ces empreintes sont, et ce qu'elles ne sont pas
 *
 * Elles repondent a **une** question : le contexte actuel est-il exactement
 * celui que l'utilisateur a prévisualisé ? Rien de plus.
 *
 * Ce ne sont pas des primitives de securite. L'empreinte de dossier de travail
 * de TASK-012 en est une — elle est authentifiee par HMAC, parce qu'elle decide
 * si Claude Code peut reprendre une session, et qu'un attaquant capable de la
 * forger obtiendrait une execution. Ici, rien de tel : ce qui est protege est la
 * coherence entre un ecran et un envoi, et le seul acteur capable de « tricher »
 * serait l'utilisateur lui-meme, contre son propre apercu.
 *
 * Un SHA-256 nu convient donc, et le dire evite qu'on prenne un jour cette
 * fonction pour une garantie qu'elle n'offre pas.
 *
 * ## Pourquoi le contenu, et pas seulement les revisions
 *
 * Une revision decrit les octets d'un fichier **avant** sanitation et
 * troncature. Deux etats differents du repository peuvent produire le meme texte
 * envoye, et — plus genant — un meme fichier peut etre coupe differemment si le
 * budget change. L'empreinte porte donc sur ce qui part reellement.
 *
 * ## Pourquoi chaque champ est precede de sa longueur
 *
 * Sans cela, deux entrees differentes pourraient produire la meme empreinte par
 * simple deplacement d'une frontiere : `["ab", "c"]` et `["a", "bc"]` se
 * concatenent en `abc`.
 */

import type {
  ArchitectPromptBrief,
  ArchitectPromptDocument,
  ArchitectPromptMemory,
  ArchitectPromptMessage,
  ArchitectPromptTask,
  ArchitectPromptV1Plan,
} from "@nox/shared";
import { createHash, type Hash } from "node:crypto";

import type { ArchitectContextBundle } from "./context.ts";

/** Version de l'algorithme, incluse dans chaque empreinte. */
export const ARCHITECT_CONTEXT_FINGERPRINT_VERSION = "architect-context/1";

/** Ajoute un champ precede de sa longueur. */
function field(hash: Hash, value: string): void {
  hash.update(String(value.length));
  hash.update(" ");
  hash.update(value, "utf8");
  hash.update(" ");
}

/** Ajoute une liste, precedee de son nombre d'entrees. */
function fieldList(hash: Hash, values: readonly string[]): void {
  hash.update(String(values.length));
  hash.update(" ");
  for (const value of values) {
    field(hash, value);
  }
}

/**
 * Revision d'une tache, calculee sur ce qui est reellement envoye.
 *
 * `updatedAt` n'y figure pas, et ce n'est pas un oubli : un horodatage dit quand
 * une ligne a ete touchee, pas ce qu'elle contient. Deux specifications
 * differentes doivent porter deux revisions, meme si une fixture ou une
 * restauration leur donne la meme date — et une simple reecriture a l'identique
 * ne doit pas se signaler comme un changement de contexte.
 *
 * Le document Markdown de la tache n'y figure pas non plus : il n'est pas
 * transmis a l'architecte, donc il ne fait pas partie de ce contexte.
 */
export function architectTaskRevision(task: ArchitectPromptTask): string {
  const hash = createHash("sha256");
  field(hash, "task");
  field(hash, task.code);
  field(hash, task.title);
  field(hash, task.status);
  field(hash, task.objective);
  field(hash, task.outOfScope ?? "");
  fieldList(hash, task.acceptanceCriteria);
  fieldList(hash, task.documentReferences);
  fieldList(hash, task.validationCommands);
  return hash.digest("hex");
}

/**
 * Revision d'une entree de memoire, calculee sur ce qui est reellement envoye.
 *
 * ## Pourquoi le texte sanitise, et non la ligne en base
 *
 * La revision doit decrire ce que le fournisseur a **recu**. Un contenu dont la
 * sanitation a masque une valeur `NOX_*` part different de ce qui est stocke ;
 * hacher le texte brut ferait croire a l'historique qu'un autre texte avait ete
 * transmis.
 *
 * ## Pourquoi le statut n'y figure pas
 *
 * `ARCHIVED` signifie simplement « absente du contexte ». Une entree archivee ne
 * produit aucune source dans le manifest : sa disparition se lit deja comme un
 * retrait, et faire varier la revision avec le statut ajouterait un changement
 * la ou il y a une absence.
 *
 * `updatedAt` n'y figure pas non plus : un horodatage dit quand une ligne a ete
 * touchee, pas ce qu'elle contient. Une reecriture a l'identique ne doit pas se
 * signaler comme un changement de contexte.
 */
export function projectMemoryRevision(memory: ArchitectPromptMemory): string {
  const hash = createHash("sha256");
  field(hash, "memory");
  field(hash, memory.code);
  field(hash, memory.category);
  field(hash, memory.title);
  field(hash, memory.content);
  field(hash, memory.rationale ?? "");
  return hash.digest("hex");
}

/**
 * Revision de **l'ensemble** de la memoire active transmise.
 *
 * Les revisions individuelles viennent de `projectMemoryRevision` juste
 * au-dessus : la memoire n'a qu'une facon d'etre hachee, et un second calcul
 * finirait par decrire un autre texte que celui qui part reellement.
 *
 * ## A quoi elle sert
 *
 * A repondre « la memoire a-t-elle change depuis ? » en une seule comparaison.
 * Depuis HOTFIX-005, une proposition de mise a jour peut poser des regles
 * durables, et doit etre refusee si l'utilisateur a reecrit la memoire
 * entre-temps — exactement comme elle l'est quand il a reecrit le plan.
 *
 * L'ordre compte : les entrees partent dans l'ordre de leurs codes, et deux
 * memoires identiques dans un ordre different ne sont pas le meme contexte.
 */
export function projectMemorySetRevision(
  memories: readonly ArchitectPromptMemory[],
): string {
  const hash = createHash("sha256");
  field(hash, "memory-set/1");
  fieldList(hash, memories.map((memory) => memory.revision));
  return hash.digest("hex");
}

/**
 * Revision du brief produit, calculee sur le texte reellement envoye.
 *
 * ## Pourquoi le texte sanitise
 *
 * Meme raison que la memoire : la revision doit decrire ce que le fournisseur a
 * **recu**. Un brief dont la sanitation a masque une valeur `NOX_*` part
 * different de ce qui est stocke, et hacher la saisie brute ferait croire a
 * l'historique qu'un autre texte avait ete transmis.
 *
 * ## Pourquoi l'ordre des listes compte
 *
 * Deux objectifs intervertis ne se lisent pas pareil, donc ne produisent pas le
 * meme prompt. Chaque champ est precede de sa longueur, et chaque liste de son
 * nombre d'entrees : sans cela, deplacer une frontiere entre deux champs
 * produirait la meme empreinte pour deux briefs differents.
 *
 * `id`, `createdAt` et `updatedAt` n'y figurent pas. Un horodatage dit quand une
 * ligne a ete touchee, pas ce qu'elle contient — et une reecriture a l'identique
 * ne doit pas se signaler comme un changement.
 */
export function projectBriefRevision(brief: ArchitectPromptBrief): string {
  const hash = createHash("sha256");
  field(hash, "project-brief/1");
  field(hash, brief.summary);
  field(hash, brief.problem);
  field(hash, brief.targetUsers);
  field(hash, brief.desiredOutcome);
  fieldList(hash, brief.goals);
  fieldList(hash, brief.nonGoals);
  return hash.digest("hex");
}

/** Revision du plan de V1. Memes regles que le brief. */
export function projectV1PlanRevision(plan: ArchitectPromptV1Plan): string {
  const hash = createHash("sha256");
  field(hash, "project-v1-plan/1");
  field(hash, plan.goal);
  field(hash, plan.technicalDirection);
  fieldList(hash, plan.inScope);
  fieldList(hash, plan.outOfScope);
  fieldList(hash, plan.milestones);
  return hash.digest("hex");
}

/** Ajoute un document, contenu et sort de troncature compris. */
function fieldDocument(hash: Hash, document: ArchitectPromptDocument): void {
  field(hash, document.path);
  field(hash, document.revision ?? "");
  field(hash, document.truncated ? "truncated" : "complete");
  field(hash, document.content);
}

/**
 * Empreinte du contexte projet reellement prepare.
 *
 * Couvre l'ordre autant que le contenu : deux memes documents presentes dans
 * l'ordre inverse ne produisent pas le meme prompt, donc pas la meme empreinte.
 *
 * Ne couvre **pas** la conversation ni le modele. Le contexte projet et la
 * discussion evoluent independamment : melanger les deux ferait dire « le projet
 * a change » a chaque message, ce qui reviendrait a ne plus rien signaler.
 */
export function architectContextFingerprint(bundle: ArchitectContextBundle): string {
  const hash = createHash("sha256");
  field(hash, ARCHITECT_CONTEXT_FINGERPRINT_VERSION);

  // L'etat structure entre dans l'empreinte : modifier un resume, reordonner
  // une etape ou definir un plan change ce qui part, donc doit se signaler.
  // Une absence est distinguee d'un objet vide — les deux ne disent pas la meme
  // chose au fournisseur.
  field(hash, bundle.projectBrief === null ? "no-brief" : bundle.projectBrief.revision);
  field(hash, bundle.projectV1Plan === null ? "no-plan" : bundle.projectV1Plan.revision);

  hash.update(String(bundle.instructionDocuments.length));
  hash.update(" ");
  for (const document of bundle.instructionDocuments) {
    fieldDocument(hash, document);
  }

  hash.update(String(bundle.contextDocuments.length));
  hash.update(" ");
  for (const document of bundle.contextDocuments) {
    fieldDocument(hash, document);
  }

  // La memoire entre dans l'empreinte : archiver, modifier ou ajouter une
  // entree active change le contexte, et doit donc se signaler comme tel.
  // L'ordre compte autant que le contenu — il est celui des codes.
  hash.update(String(bundle.projectMemory.length));
  hash.update(" ");
  for (const memory of bundle.projectMemory) {
    field(hash, memory.revision);
  }

  hash.update(String(bundle.recentTasks.length));
  hash.update(" ");
  for (const task of bundle.recentTasks) {
    field(hash, architectTaskRevision(task));
  }

  fieldList(hash, bundle.availableDocuments);
  fieldList(hash, bundle.manifest.missing);

  return hash.digest("hex");
}

/**
 * Empreinte de **tout** ce que le tour transmettra.
 *
 * ## Pourquoi elle a fallu en TASK-020
 *
 * L'empreinte de contexte ne couvre pas la conversation, et c'est voulu : sans
 * cela, chaque message ferait dire « le projet a change ». Tant qu'une session
 * servait a concevoir une tache, cela suffisait.
 *
 * Une conversation projet est ouverte longtemps, et parfois dans deux onglets.
 * Le scenario devient concret : l'onglet A prepare son envoi, l'onglet B envoie
 * un message, l'onglet A envoie a son tour. Le contexte projet n'a pas bouge —
 * mais le transcript, si, et A repondrait a une conversation qui n'existe plus.
 *
 * Cette empreinte-ci couvre donc les trois : le contexte, les messages
 * **retenus** par la fenetre, et le message en attente. C'est elle qui est
 * enregistree a l'apercu et recomparee juste avant l'envoi.
 *
 * Comme celle du contexte, ce n'est pas une primitive de securite : SHA-256 nu,
 * contrairement a l'empreinte de dossier de travail de TASK-012, qui est un HMAC
 * parce qu'elle decide d'une execution.
 */
export function architectTurnFingerprint(parts: {
  contextFingerprint: string;
  transcript: readonly ArchitectPromptMessage[];
  newMessage: string;
}): string {
  const hash = createHash("sha256");
  field(hash, ARCHITECT_CONTEXT_FINGERPRINT_VERSION);
  field(hash, parts.contextFingerprint);

  hash.update(String(parts.transcript.length));
  hash.update(" ");
  for (const message of parts.transcript) {
    field(hash, message.role);
    field(hash, message.content);
  }

  field(hash, parts.newMessage);

  return hash.digest("hex");
}
