/**
 * Contrat metier des executions (« runs »).
 *
 * Une execution est un passage de Claude Code sur une tache. `RunStatus` existe
 * depuis TASK-001 : ce fichier lui ajoute ce qui manquait pour s'en servir —
 * les etats finaux, le code affiche, et les bornes de tout ce qui vient d'un
 * processus exterieur.
 *
 * Aucune dependance a Prisma, Node ou React : les memes types servent a la base,
 * au runner, au web et aux tests.
 */

import { RUN_STATUS, type RunStatus } from "./statuses.js";
import { type TaskStatus, TASK_STATUS } from "./statuses.js";

/**
 * Etats finaux d'une execution.
 *
 * Un etat final ne redevient jamais actif : c'est cette regle qui rend le
 * polling idempotent. Sans elle, une reponse tardive du runner pourrait
 * ressusciter un run que la base avait deja conclu.
 */
export const FINAL_RUN_STATUSES: readonly RunStatus[] = [
  RUN_STATUS.BLOCKED,
  RUN_STATUS.FAILED,
  RUN_STATUS.CANCELLED,
  RUN_STATUS.COMPLETED,
];

export function isFinalRunStatus(status: RunStatus): boolean {
  return FINAL_RUN_STATUSES.includes(status);
}

/**
 * Statuts d'une execution encore suivie par le runner.
 *
 * `CANCELLING` en fait partie : un arret demande n'est pas un arret constate, et
 * tant que le processus n'a pas ferme, il peut encore ecrire dans le repository.
 * Le traiter comme termine reviendrait a cesser de le surveiller au moment
 * precis ou il faut le surveiller.
 */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = [
  RUN_STATUS.QUEUED,
  RUN_STATUS.RUNNING,
  RUN_STATUS.CANCELLING,
];

/** Vrai si une demande d'annulation peut encore etre acceptee. */
export function isCancellableRunStatus(status: RunStatus): boolean {
  return status === RUN_STATUS.QUEUED || status === RUN_STATUS.RUNNING;
}

/** Prefixe du code affiche d'une execution. */
export const RUN_CODE_PREFIX = "RUN-";

/**
 * Derive le code affiche d'une execution a partir de son numero.
 *
 * Meme regle que pour les taches : le code n'est pas stocke, il se recalcule a
 * partir d'un `sequence` immuable.
 */
export function formatRunCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Numero d'execution invalide : ${String(sequence)}`);
  }
  return `${RUN_CODE_PREFIX}${String(sequence).padStart(3, "0")}`;
}

/**
 * Identifiant d'execution transmis au runner.
 *
 * Volontairement strict : c'est une cle de registre en memoire, jamais un
 * chemin ni un argument de commande. Un identifiant libre n'apporterait rien et
 * ouvrirait une surface inutile.
 */
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRunnerRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID_PATTERN.test(value);
}

/**
 * Bornes appliquees a tout ce qui vient du processus Claude Code.
 *
 * Le runner ne controle ni la longueur d'un compte rendu, ni celle d'une trace
 * d'erreur : sans borne, une execution bavarde remplirait la base et la page de
 * resultat. La troncature est signalee, jamais silencieuse.
 */
export const RUN_LIMITS = {
  /** Compte rendu final de Claude Code. */
  resultText: 200_000,
  /** Queue de la sortie d'erreur, conservee pour le diagnostic. */
  stderrTail: 8_000,
  /** Message d'erreur affiche a l'utilisateur. */
  errorMessage: 2_000,
  /** Empreintes par entree du dossier de travail, serialisees. */
  workspaceEntries: 262_144,
  /** Prompt envoye au processus. */
  prompt: 200_000,
  /** Sortie standard conservee en memoire par le runner. */
  stdout: 2_000_000,
  /** Nombre de fichiers modifies listes. */
  changedFiles: 500,
  /** Sortie de `git diff --stat`. */
  gitDiffStat: 20_000,
} as const;

const TRUNCATION_NOTICE = "\n[…] Contenu tronque par NOX.";

/**
 * Borne une chaine et signale explicitement la troncature.
 *
 * Une troncature muette produit des comptes rendus qui s'arretent au milieu
 * d'une phrase sans que personne ne sache pourquoi.
 */
export function boundText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const room = Math.max(0, maxLength - TRUNCATION_NOTICE.length);
  return value.slice(0, room) + TRUNCATION_NOTICE;
}

/**
 * Conserve la **fin** d'une chaine plutot que son debut.
 *
 * Pour une sortie d'erreur, c'est la fin qui porte la cause : le debut n'est
 * souvent qu'un preambule.
 */
export function boundTail(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const notice = "[…] Debut tronque par NOX.\n";
  const room = Math.max(0, maxLength - notice.length);
  return notice + value.slice(value.length - room);
}

/** Fiche courte d'une execution, suffisante pour l'historique d'une tache. */
export type DevelopmentRunSummary = {
  id: string;
  /** Derive de `sequence`, jamais stocke : `RUN-001`. */
  code: string;
  status: RunStatus;
  /** Date ISO 8601, ou `null` tant que le processus n'a pas demarre. */
  startedAt: string | null;
  /** Date ISO 8601, ou `null` tant que l'execution n'est pas terminee. */
  finishedAt: string | null;
  createdAt: string;
  /** Duree rapportee par Claude Code, en millisecondes. */
  durationMs: number | null;
  /** `INITIAL` ou `CORRECTION` ; valeur de `RunKind`. */
  kind: string;
};

/** Etat Git capture autour d'une execution. */
export type RunGitState = {
  branch: string | null;
  upstream: string | null;
  /** `HEAD` avant lancement. */
  headBefore: string | null;
  /** `HEAD` apres execution ; doit etre identique a `headBefore`. */
  headAfter: string | null;
  /** Sortie de `git diff --stat`, telle quelle. */
  diffStat: string | null;
  /** Chemins relatifs des fichiers modifies. */
  changedFiles: readonly string[];
};

/** Metadonnees rapportees par Claude Code, toutes facultatives. */
export type RunClaudeReport = {
  /** Compte rendu final. */
  resultText: string | null;
  /** Identifiant de session, lorsqu'il est fourni. */
  sessionId: string | null;
  durationMs: number | null;
  durationApiMs: number | null;
  numTurns: number | null;
  /**
   * Cout rapporte par Claude Code, en dollars.
   *
   * Jamais calcule ni estime par NOX : absent lorsque l'outil ne le fournit pas.
   */
  reportedCostUsd: number | null;
  exitCode: number | null;
};

/** Execution complete, telle qu'affichee sur sa page. */
export type DevelopmentRunDetail = DevelopmentRunSummary & {
  taskId: string;
  /** Execution relue dont cette correction reprend la session ;  sinon. */
  parentRunId: string | null;
  /** Prompt exact envoye au processus. */
  prompt: string;
  /** Empreinte SHA-256 du prompt, en hexadecimal minuscule. */
  promptSha256: string;
  /** Identifiant transmis au runner ; cle de son registre en memoire. */
  runnerRunId: string;
  claude: RunClaudeReport;
  git: RunGitState;
  /** Code d'erreur stable du contrat runner, lorsqu'il y en a un. */
  errorCode: string | null;
  /** Message deja destine a l'utilisateur, sans detail systeme. */
  errorMessage: string | null;
  /**
   * Ce qui a cede, tel que le runner l'a nomme. Valeur de `RunFailureCategory`.
   *
   * `null` pour une execution anterieure a HOTFIX-006 : la categorie se derive
   * alors du code et du code de sortie, a la lecture, par
   * `readRunFailureCategory`. Le champ dit donc « ce que la base porte », pas
   * « ce qu'on peut en conclure » — les deux ne doivent pas se confondre.
   */
  failureCategory: string | null;
  /** Phrase de diagnostic ecrite par NOX, bornee. Jamais un message systeme. */
  failureDetail: string | null;
  /** Queue de la sortie d'erreur, bornee. */
  stderrTail: string | null;
  /** Date ISO de la demande d'annulation, si un humain en a formule une. */
  cancellationRequestedAt: string | null;
  updatedAt: string;
};

/**
 * Transitions de statut **automatisees**, declenchees par le cycle de vie d'une
 * execution.
 *
 * Elles sont separees des transitions manuelles de `tasks.ts` parce qu'elles
 * repondent a une question differente : non pas « l'utilisateur a-t-il le droit
 * de cliquer ici », mais « ce resultat d'execution justifie-t-il ce statut ».
 * Une seule table melangeant les deux rendrait `RUNNING` selectionnable a la
 * main, ce que TASK-007 interdit explicitement.
 */
const AUTOMATED_TASK_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  [TASK_STATUS.READY]: [TASK_STATUS.RUNNING],
  [TASK_STATUS.RUNNING]: [TASK_STATUS.REVIEW, TASK_STATUS.FAILED, TASK_STATUS.BLOCKED],
  [TASK_STATUS.DRAFT]: [],
  [TASK_STATUS.BLOCKED]: [],
  [TASK_STATUS.FAILED]: [],
  [TASK_STATUS.REVIEW]: [],
  [TASK_STATUS.COMPLETED]: [],
};

/** Seule autorite sur les changements de statut declenches par une execution. */
export function canAutomateTaskStatusTransition(from: TaskStatus, to: TaskStatus): boolean {
  return AUTOMATED_TASK_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Statut de tache correspondant a l'issue d'une execution.
 *
 * Une reussite mene a `REVIEW`, jamais directement a `COMPLETED` : un resultat
 * de Claude Code n'est pas une validation humaine, et c'est l'utilisateur qui
 * accepte le travail.
 */
export function taskStatusForRunOutcome(status: RunStatus): TaskStatus | null {
  switch (status) {
    case RUN_STATUS.COMPLETED:
      return TASK_STATUS.REVIEW;
    case RUN_STATUS.FAILED:
      return TASK_STATUS.FAILED;
    case RUN_STATUS.BLOCKED:
    case RUN_STATUS.CANCELLED:
      return TASK_STATUS.BLOCKED;
    // `CANCELLING` est deliberement sans effet : la tache reste `RUNNING`
    // jusqu'a la terminaison reelle. Faire basculer la tache sur une simple
    // *demande* d'arret annoncerait une fin que rien ne garantit encore.
    case RUN_STATUS.QUEUED:
    case RUN_STATUS.RUNNING:
    case RUN_STATUS.CANCELLING:
      return null;
  }
}
