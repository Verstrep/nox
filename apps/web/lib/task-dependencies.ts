/**
 * Ce qu'un refus de dependance dit a l'utilisateur.
 *
 * La decision — « cette dependance est-elle satisfaite ? » — vit dans
 * `@nox/shared`, ou elle est pure. Ce module **traduit** : il transforme un
 * resume derive et un code de refus en phrases destinees a un humain, et n'en
 * decide jamais autrement.
 *
 * Volontairement sans acces a la base ni a Next.js : les lectures vivent dans
 * `lib/tasks.ts` avec toutes les autres. Cette separation rend ce module
 * directement testable, et rend verifiable sur sa source qu'aucun fournisseur,
 * aucun Claude Code et aucun appel Git ne s'y cache.
 */

import {
  TASK_DEPENDENCY_ERROR,
  type TaskDependencyErrorCode,
  type TaskDependencyLink,
} from "@nox/shared";

import { taskStatusLabel } from "./labels.ts";

/**
 * Nomme les taches qui manquent, avec leur statut.
 *
 * Le statut compte autant que le code : « TASK-001 · Brouillon » dit ou aller,
 * « TASK-001 » seul oblige a chercher.
 */
export function describeWaitingDependencies(
  waiting: readonly TaskDependencyLink[],
): string {
  return waiting
    .map((entry) => `${entry.code} — ${entry.title} · ${taskStatusLabel(entry.status)}`)
    .join(" ; ");
}

/**
 * Message du refus de lancement.
 *
 * Il dit **ce qui manque**, pas seulement qu'il manque quelque chose : une
 * dependance non satisfaite se corrige en terminant une autre tache, et sans son
 * nom personne ne sait laquelle.
 */
export function unresolvedDependenciesMessage(
  waiting: readonly TaskDependencyLink[],
): string {
  return (
    "Cette tache attend des taches qui ne sont pas terminees : " +
    `${describeWaitingDependencies(waiting)}. ` +
    "Une dependance n'est satisfaite que lorsque la tache attendue est terminee."
  );
}

/** Message d'un refus d'ajout ou de retrait de dependance. */
export function dependencyRefusalMessage(code: TaskDependencyErrorCode): string {
  switch (code) {
    case TASK_DEPENDENCY_ERROR.UNKNOWN_TASK:
      return "Cette tache n'existe pas dans ce projet. Rechargez la page.";
    case TASK_DEPENDENCY_ERROR.SELF:
      return "Une tache ne peut pas dependre d'elle-meme.";
    case TASK_DEPENDENCY_ERROR.CROSS_PROJECT:
      return "Une dependance ne peut relier que deux taches du meme projet.";
    case TASK_DEPENDENCY_ERROR.CYCLE:
      return (
        "Cette dependance creerait un cycle : la tache attendue attend deja celle-ci, " +
        "directement ou en passant par d'autres taches."
      );
    case TASK_DEPENDENCY_ERROR.BOOTSTRAP_SOURCE:
      return (
        "La tache d'amorcage ne peut dependre d'aucune tache produit : elle prepare " +
        "justement le terrain sur lequel elles seront realisees. L'inverse reste possible."
      );
    case TASK_DEPENDENCY_ERROR.FROZEN:
      return (
        "Cette tache possede un historique d'execution : ses dependances sont figees, " +
        "pour que le contrat utilise au moment du lancement reste lisible."
      );
  }
}
