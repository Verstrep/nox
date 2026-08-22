/**
 * Dependances explicites entre taches.
 *
 * ## Une seule convention, et elle est ecrite une fois
 *
 * Une arete `{ taskId, dependsOnTaskId }` se lit **« taskId attend
 * dependsOnTaskId »**. `taskId` est la tache qui attend ; `dependsOnTaskId` est
 * celle qui doit etre terminee avant. Inverser les deux au milieu d'un module
 * produirait un graphe qui a l'air correct et qui bloque exactement les
 * mauvaises taches — c'est la seule erreur de ce fichier qu'aucun test
 * n'attraperait facilement, donc la convention est rappelee partout ou une
 * arete est manipulee.
 *
 * ## Ce que l'ordre des codes ne dit pas
 *
 * `TASK-002` peut dependre de `TASK-004`. Les numeros disent quand une tache a
 * ete creee, pas dans quel ordre le travail doit se faire. NOX ne deduit donc
 * **jamais** une dependance d'un numero, et n'en refuse aucune pour cette
 * raison : la seule contrainte structurelle est l'absence de cycle.
 *
 * ## Derive, jamais persiste
 *
 * Rien de ce que ce module calcule n'est stocke. Le nombre de dependances
 * satisfaites se relit a chaque affichage a partir du statut courant des taches.
 * Un compteur enregistre aurait ete faux des la premiere fois qu'une tache
 * terminee est rouverte — et personne ne l'aurait su.
 *
 * Ce module est **pur** : ni base, ni disque, ni reseau, ni fournisseur.
 */

import { TASK_KIND, type TaskKind } from "./tasks.js";
import { TASK_STATUS, createStatusGuard, type TaskStatus } from "./statuses.js";

/**
 * Refus possibles a l'ajout d'une dependance.
 *
 * Des codes plutot que des phrases : le refus voyage jusqu'a l'interface, qui
 * choisit le texte. Une trace technique brute n'atteint jamais l'utilisateur.
 */
export const TASK_DEPENDENCY_ERROR = {
  /** L'une des deux taches n'existe pas. */
  UNKNOWN_TASK: "TASK_DEPENDENCY_UNKNOWN_TASK",
  /** Une tache ne peut pas s'attendre elle-meme. */
  SELF: "TASK_DEPENDENCY_SELF",
  /** Les deux taches n'appartiennent pas au meme projet. */
  CROSS_PROJECT: "TASK_DEPENDENCY_CROSS_PROJECT",
  /** L'arete fermerait une boucle, directe ou transitive. */
  CYCLE: "TASK_DEPENDENCY_CYCLE",
  /** Une tache d'amorcage ne peut dependre d'aucune tache produit. */
  BOOTSTRAP_SOURCE: "TASK_DEPENDENCY_BOOTSTRAP_SOURCE",
  /** La tache possede un historique d'execution : son contrat est fige. */
  FROZEN: "TASK_DEPENDENCY_FROZEN",
} as const;

export type TaskDependencyErrorCode =
  (typeof TASK_DEPENDENCY_ERROR)[keyof typeof TASK_DEPENDENCY_ERROR];

export const TASK_DEPENDENCY_ERROR_CODES: readonly TaskDependencyErrorCode[] =
  Object.values(TASK_DEPENDENCY_ERROR);

export const isTaskDependencyErrorCode = createStatusGuard(TASK_DEPENDENCY_ERROR_CODES);

/** Code du refus de lancement lorsque des dependances restent en attente. */
export const TASK_DEPENDENCIES_UNRESOLVED = "TASK_DEPENDENCIES_UNRESOLVED";

/**
 * Une arete du graphe, reduite a ce qui la definit.
 *
 * `taskId` **attend** `dependsOnTaskId`.
 */
export type TaskDependencyEdge = {
  taskId: string;
  dependsOnTaskId: string;
};

/** Ce qu'il faut savoir d'une tache pour l'afficher dans une liste de dependances. */
export type TaskDependencyRef = {
  id: string;
  code: string;
  title: string;
  status: TaskStatus;
  kind: TaskKind;
};

/** Une dependance, accompagnee de la seule question qui compte a son sujet. */
export type TaskDependencyLink = TaskDependencyRef & {
  /** La tache attendue est terminee. */
  satisfied: boolean;
};

/**
 * Lecture derivee du graphe autour d'une tache.
 *
 * `dependsOn` : ce que cette tache attend. `dependents` : ce qui l'attend.
 * Les compteurs ne portent que sur `dependsOn` — savoir combien de taches
 * dependent de celle-ci n'empeche jamais de la lancer.
 */
export type TaskDependencySummary = {
  dependsOn: readonly TaskDependencyLink[];
  dependents: readonly TaskDependencyLink[];
  total: number;
  resolved: number;
  unresolved: number;
  /** Les dependances non satisfaites, dans l'ordre d'affichage. */
  waiting: readonly TaskDependencyLink[];
  /**
   * Aucune dependance n'attend.
   *
   * Vrai lorsqu'il n'y en a aucune : une tache sans dependance n'attend rien,
   * et c'est le cas de la quasi-totalite des taches de NOX.
   */
  allSatisfied: boolean;
};

/**
 * Une dependance est satisfaite lorsque la tache attendue est **terminee**.
 *
 * `COMPLETED` et rien d'autre. `REVIEW` veut dire qu'un humain n'a pas encore
 * tranche, `READY` qu'aucun travail n'a commence, `BLOCKED` qu'il s'est arrete.
 * Aucun de ces etats ne permet de dire que le travail attendu est disponible —
 * et une dependance qui se satisferait d'un « presque » ne contraindrait rien.
 */
export function isDependencySatisfied(status: TaskStatus): boolean {
  return status === TASK_STATUS.COMPLETED;
}

function toLink(ref: TaskDependencyRef): TaskDependencyLink {
  return { ...ref, satisfied: isDependencySatisfied(ref.status) };
}

/**
 * Construit la lecture derivee, a partir des seuls statuts courants.
 *
 * Appelee a chaque rendu. Rouvrir une tache terminee fait donc immediatement
 * repasser ses dependants en attente, sans qu'aucune ligne ne soit reecrite.
 */
export function summarizeTaskDependencies(input: {
  dependsOn: readonly TaskDependencyRef[];
  dependents: readonly TaskDependencyRef[];
}): TaskDependencySummary {
  const dependsOn = input.dependsOn.map(toLink);
  const dependents = input.dependents.map(toLink);
  const waiting = dependsOn.filter((entry) => !entry.satisfied);

  return {
    dependsOn,
    dependents,
    total: dependsOn.length,
    resolved: dependsOn.length - waiting.length,
    unresolved: waiting.length,
    waiting,
    allSatisfied: waiting.length === 0,
  };
}

/**
 * Existe-t-il deja un chemin de dependance de `fromId` vers `toId` ?
 *
 * Parcours en profondeur des aretes, dans le sens « attend » : on part de
 * `fromId` et on suit ses `dependsOnTaskId`. Le graphe d'un projet compte au
 * plus quelques dizaines de taches ; un index par sommet suffit largement, et
 * une fermeture transitive stockee serait une seconde verite a maintenir.
 *
 * Le `visited` n'est pas une precaution de style : si le graphe stocke contenait
 * deja un cycle — base modifiee a la main —, un parcours naif ne terminerait
 * pas.
 */
export function dependencyPathExists(
  edges: readonly TaskDependencyEdge[],
  fromId: string,
  toId: string,
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = outgoing.get(edge.taskId);
    if (existing === undefined) {
      outgoing.set(edge.taskId, [edge.dependsOnTaskId]);
    } else {
      existing.push(edge.dependsOnTaskId);
    }
  }

  const visited = new Set<string>();
  const stack = [fromId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);

    for (const next of outgoing.get(current) ?? []) {
      if (next === toId) {
        return true;
      }
      stack.push(next);
    }
  }

  return false;
}

/**
 * Ajouter « taskId attend dependsOnTaskId » fermerait-il une boucle ?
 *
 * Oui si les deux sont la meme tache, ou si `dependsOnTaskId` attend deja
 * `taskId` — directement ou par une suite d'aretes.
 *
 * Se contenter de chercher l'arete inverse aurait laisse passer
 * `A → B → C → A`, c'est-a-dire exactement le cas ou personne ne voit le
 * probleme en relisant une seule ligne.
 */
export function createsDependencyCycle(
  edges: readonly TaskDependencyEdge[],
  taskId: string,
  dependsOnTaskId: string,
): boolean {
  if (taskId === dependsOnTaskId) {
    return true;
  }
  return dependencyPathExists(edges, dependsOnTaskId, taskId);
}

/** Les deux taches, telles que la verification semantique a besoin de les voir. */
export type TaskDependencyEndpoint = {
  id: string;
  projectId: string;
  kind: TaskKind;
};

/**
 * Verifications qui ne demandent pas de connaitre le graphe.
 *
 * Le cycle, lui, en depend : il est verifie a part, et **dans** la transaction
 * qui ecrit l'arete.
 *
 * ## L'amorcage ne depend de rien
 *
 * `TASK-000` prepare le terrain que les taches produit utiliseront ensuite. La
 * faire attendre l'une d'elles inverserait la seule chose que l'amorcage
 * garantit. La condition porte sur la nature de la cible parce que c'est ce que
 * la regle **dit** ; dans les faits un projet n'a qu'une tache d'amorcage, et
 * une tache ne peut pas s'attendre elle-meme, donc une tache `BOOTSTRAP` n'a
 * jamais de dependance.
 *
 * L'inverse reste autorise, et c'est le cas utile : une tache produit peut
 * explicitement attendre `TASK-000`.
 */
export function checkTaskDependencyPair(input: {
  task: TaskDependencyEndpoint;
  dependsOn: TaskDependencyEndpoint;
}): TaskDependencyErrorCode | null {
  if (input.task.id === input.dependsOn.id) {
    return TASK_DEPENDENCY_ERROR.SELF;
  }
  if (input.task.projectId !== input.dependsOn.projectId) {
    return TASK_DEPENDENCY_ERROR.CROSS_PROJECT;
  }
  if (input.task.kind === TASK_KIND.BOOTSTRAP && input.dependsOn.kind === TASK_KIND.NORMAL) {
    return TASK_DEPENDENCY_ERROR.BOOTSTRAP_SOURCE;
  }
  return null;
}

/** Nombre maximal de dependances directes pour une tache. */
export const TASK_DEPENDENCY_LIMIT = 50;

/**
 * Normalise un ensemble de dependances soumis par un formulaire.
 *
 * Les doublons disparaissent, l'ordre de saisie est conserve, et les entrees
 * vides sont retirees. Rien n'est valide ici : l'existence, le projet, la nature
 * et les cycles se verifient cote serveur, avec la base sous les yeux.
 */
export function normalizeDependencyIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (id === "" || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** Deux ensembles de dependances designent-ils exactement les memes taches ? */
export function sameDependencySet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const target = new Set(right);
  return left.every((id) => target.has(id));
}
