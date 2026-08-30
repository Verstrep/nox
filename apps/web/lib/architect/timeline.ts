/**
 * Fil affiche d'une conversation Architecte.
 *
 * ## Ce qui circule ici ne part jamais
 *
 * Ce module melange deux choses de natures differentes : les **messages**, qui
 * forment la conversation et partent au fournisseur, et les **evenements**, qui
 * decrivent ce que NOX a fait localement et ne partent nulle part.
 *
 * Une tache creee est un evenement. Elle est derivee de
 * `ArchitectGeneration.appliedTaskId` — la relation qui existait deja — et
 * n'entre ni dans le transcript, ni dans le prompt, ni dans le decompte de
 * jetons. Ecrire « TASK-001 creee » comme un message d'architecte serait lui
 * faire dire une phrase qu'il n'a jamais ecrite, et la lui relire au tour
 * suivant. La tache se signalera d'elle-meme, par la liste des taches recentes.
 *
 * Une proposition de mise a jour du projet suit exactement la meme regle. Elle
 * est derivee d'`ArchitectProjectUpdate`, et son statut vient de la base : un
 * rafraichissement rend donc la meme carte, sans qu'aucun etat de navigateur
 * soit conserve. Aucun `ArchitectMessage` n'est ecrit pour elle.
 *
 * ## Ou se place un evenement
 *
 * Juste apres le dernier message de la generation qui l'a produit. Une
 * conversation projet cree plusieurs taches au fil des mois : reunies en bas de
 * page, elles seraient impossibles a relier a la discussion qui les a fait
 * naitre.
 *
 * Le module est pur : ni base, ni reseau, ni React.
 */

import type { ArchitectMessageRole, ArchitectProjectUpdateStatus } from "@nox/shared";

import type { TimelineProjectChange } from "../replan/change.ts";

export type TimelineMessage = {
  id: string;
  role: ArchitectMessageRole;
  content: string;
  createdAt: string;
  /** Tour qui a produit ce message, ou `null` pour un message sans generation. */
  generationId: string | null;
};

export type TimelineTask = {
  generationId: string;
  taskId: string;
  code: string;
  title: string;
};

/** Une proposition de mise a jour du projet, telle que le fil l'affiche. */
export type TimelineProjectUpdate = {
  generationId: string;
  updateId: string;
  status: ArchitectProjectUpdateStatus;
  /** Nombre de champs que la proposition modifie, section par section. */
  briefChanges: number;
  planChanges: number;
};

export type ArchitectTimelineEntry =
  | ({ kind: "message" } & TimelineMessage)
  | ({ kind: "task"; id: string } & TimelineTask)
  | ({ kind: "update"; id: string } & TimelineProjectUpdate)
  | ({ kind: "change"; id: string } & TimelineProjectChange);

/**
 * Entrelace les messages et les taches creees.
 *
 * Une tache est rendue apres le **dernier** message de sa generation, donc apres
 * la reponse de l'architecte qui portait la proposition. La placer avant
 * donnerait a lire une consequence avant sa cause.
 *
 * Une tache dont la generation n'a laisse aucun message est ajoutee en fin de
 * fil plutot que perdue : mal placee, elle reste visible ; supprimee, elle
 * disparaitrait sans que rien ne le dise.
 */
export function buildArchitectTimeline(
  messages: readonly TimelineMessage[],
  tasks: readonly TimelineTask[],
  updates: readonly TimelineProjectUpdate[] = [],
  changes: readonly TimelineProjectChange[] = [],
): ArchitectTimelineEntry[] {
  const byGeneration = new Map<string, TimelineTask[]>();
  for (const task of tasks) {
    const existing = byGeneration.get(task.generationId);
    if (existing === undefined) {
      byGeneration.set(task.generationId, [task]);
    } else {
      existing.push(task);
    }
  }

  const updatesByGeneration = new Map<string, TimelineProjectUpdate[]>();
  for (const update of updates) {
    const existing = updatesByGeneration.get(update.generationId);
    if (existing === undefined) {
      updatesByGeneration.set(update.generationId, [update]);
    } else {
      existing.push(update);
    }
  }

  // Un changement de projet est une carte a lui seul, meme lorsqu'il porte une
  // mise a jour du projet : c'est **une** intention, et l'afficher en deux
  // cartes inviterait a la trancher en deux fois.
  const changesByGeneration = new Map<string, TimelineProjectChange[]>();
  for (const change of changes) {
    const existing = changesByGeneration.get(change.generationId);
    if (existing === undefined) {
      changesByGeneration.set(change.generationId, [change]);
    } else {
      existing.push(change);
    }
  }

  // Position du dernier message de chaque generation : c'est la seule apres
  // laquelle un evenement peut se placer sans couper un tour en deux.
  const lastMessageOf = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.generationId !== null) {
      lastMessageOf.set(message.generationId, index);
    }
  });

  const entries: ArchitectTimelineEntry[] = [];
  const placed = new Set<string>();
  const placedUpdates = new Set<string>();
  const placedChanges = new Set<string>();

  messages.forEach((message, index) => {
    entries.push({ kind: "message", ...message });

    const generationId = message.generationId;
    if (generationId === null || lastMessageOf.get(generationId) !== index) {
      return;
    }

    // La proposition de mise a jour precede la tache creee : la premiere est ce
    // que l'architecte a propose a ce tour, la seconde ce que l'utilisateur en a
    // fait ensuite. Lire la consequence avant la proposition serait deroutant.
    for (const change of changesByGeneration.get(generationId) ?? []) {
      entries.push({ kind: "change", id: `change:${change.proposalId}`, ...change });
      placedChanges.add(change.proposalId);
    }
    for (const update of updatesByGeneration.get(generationId) ?? []) {
      entries.push({ kind: "update", id: `update:${update.updateId}`, ...update });
      placedUpdates.add(update.updateId);
    }
    for (const task of byGeneration.get(generationId) ?? []) {
      entries.push({ kind: "task", id: `task:${task.taskId}`, ...task });
      placed.add(task.taskId);
    }
  });

  for (const change of changes) {
    if (!placedChanges.has(change.proposalId)) {
      entries.push({ kind: "change", id: `change:${change.proposalId}`, ...change });
    }
  }

  for (const update of updates) {
    if (!placedUpdates.has(update.updateId)) {
      entries.push({ kind: "update", id: `update:${update.updateId}`, ...update });
    }
  }

  for (const task of tasks) {
    if (!placed.has(task.taskId)) {
      entries.push({ kind: "task", id: `task:${task.taskId}`, ...task });
    }
  }

  return entries;
}
