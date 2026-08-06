/**
 * Registre en memoire des executions Claude Code.
 *
 * Le runner doit repondre au web **avant** que Claude Code ait fini : une
 * execution dure des minutes, une requete HTTP ne doit pas. Le processus vit
 * donc plus longtemps que la requete qui l'a lance, et son etat est consulte
 * ensuite par interrogation.
 *
 * ## En memoire, et assume comme tel
 *
 * Un redemarrage du runner perd le registre. C'est une limite acceptee pour
 * TASK-008, et elle est **visible** plutot que masquee : le web, ne retrouvant
 * plus une execution qu'il croyait active, la marque bloquee et le dit. NOX ne
 * pretend jamais connaitre le resultat d'un processus qu'il a cesse de suivre.
 *
 * ## Une seule execution active
 *
 * Globalement, tous projets confondus. Deux Claude Code simultanes sur la meme
 * machine se marcheraient dessus des qu'ils toucheraient au meme repository, et
 * rendraient toute relecture impossible. La contrainte est verifiee ici, dans le
 * runner : c'est le seul composant qui voit les processus reels.
 */

import { RUN_LIMITS, RUN_STATUS, boundTail, boundText, isFinalRunStatus } from "@nox/shared";
import type { ClaudeRunSnapshot, RunStatus } from "@nox/shared";

/** Nombre maximal d'executions terminees conservees. */
export const MAX_RETAINED_RUNS = 20;

/** Duree de conservation d'une execution terminee. */
export const RETENTION_MS = 24 * 60 * 60 * 1000;

type RegistryEntry = {
  runId: string;
  status: RunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  exitCode: number | null;
  errorCode: string | null;
  stderrTail: string | null;
  resultText: string | null;
  claudeSessionId: string | null;
  durationMs: number | null;
  durationApiMs: number | null;
  numTurns: number | null;
  reportedCostUsd: number | null;
  git: {
    branch: string | null;
    upstream: string | null;
    headBefore: string | null;
    headAfter: string | null;
    diffStat: string | null;
    changedFiles: string[];
  };
  /** Permet de terminer le processus au depassement du delai. */
  kill: (() => void) | null;
};

export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: "already_active" | "duplicate_id" };

/** Champs modifiables d'une entree, hors identite et statut. */
export type RunUpdate = Partial<Omit<RegistryEntry, "runId" | "status" | "kill">>;

function emptyEntry(runId: string): RegistryEntry {
  return {
    runId,
    status: RUN_STATUS.QUEUED,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    errorCode: null,
    stderrTail: null,
    resultText: null,
    claudeSessionId: null,
    durationMs: null,
    durationApiMs: null,
    numTurns: null,
    reportedCostUsd: null,
    git: {
      branch: null,
      upstream: null,
      headBefore: null,
      headAfter: null,
      diffStat: null,
      changedFiles: [],
    },
    kill: null,
  };
}

/**
 * Registre des executions.
 *
 * Une classe plutot qu'un module a l'etat global : les tests peuvent en creer
 * une instance neuve, et la contrainte « un seul run actif » reste verifiable
 * sans manipuler d'etat partage.
 */
export class ClaudeRunRegistry {
  readonly #entries = new Map<string, RegistryEntry>();
  readonly #maxRetained: number;
  readonly #retentionMs: number;
  readonly #now: () => Date;

  // Champs affectes explicitement : Node execute ce fichier par simple retrait
  // des types, et les proprietes de parametre de TypeScript ne survivent pas a
  // cette transformation.
  constructor(
    maxRetained: number = MAX_RETAINED_RUNS,
    retentionMs: number = RETENTION_MS,
    now: () => Date = () => new Date(),
  ) {
    this.#maxRetained = maxRetained;
    this.#retentionMs = retentionMs;
    this.#now = now;
  }

  /** Retourne l'execution active, s'il y en a une. */
  activeRunId(): string | null {
    for (const entry of this.#entries.values()) {
      if (!isFinalRunStatus(entry.status)) {
        return entry.runId;
      }
    }
    return null;
  }

  /**
   * Enregistre une nouvelle execution.
   *
   * Echoue si une autre est active, ou si l'identifiant est deja connu — meme
   * pour une execution terminee : reutiliser un identifiant ferait pointer deux
   * resultats differents au meme endroit.
   */
  register(runId: string): RegisterResult {
    this.prune();

    if (this.#entries.has(runId)) {
      return { ok: false, reason: "duplicate_id" };
    }
    if (this.activeRunId() !== null) {
      return { ok: false, reason: "already_active" };
    }

    this.#entries.set(runId, emptyEntry(runId));
    return { ok: true };
  }

  has(runId: string): boolean {
    return this.#entries.has(runId);
  }

  /** Associe une fonction d'arret au processus d'une execution. */
  attachKill(runId: string, kill: () => void): void {
    const entry = this.#entries.get(runId);
    if (entry !== undefined) {
      entry.kill = kill;
    }
  }

  /**
   * Termine le processus d'une execution donnee.
   *
   * L'arret ne peut viser qu'un run connu du registre : aucun identifiant de
   * processus ne circule, et rien venu du navigateur ne peut designer un
   * processus arbitraire de la machine.
   */
  kill(runId: string): boolean {
    const entry = this.#entries.get(runId);
    if (entry?.kill == null) {
      return false;
    }
    entry.kill();
    return true;
  }

  /** Met a jour les champs d'une execution encore active. */
  update(runId: string, update: RunUpdate): void {
    const entry = this.#entries.get(runId);
    if (entry === undefined || isFinalRunStatus(entry.status)) {
      return;
    }
    Object.assign(entry, update);
  }

  /** Marque une execution comme demarree. */
  start(runId: string, startedAt: Date): void {
    const entry = this.#entries.get(runId);
    if (entry === undefined || isFinalRunStatus(entry.status)) {
      return;
    }
    entry.status = RUN_STATUS.RUNNING;
    entry.startedAt = startedAt;
  }

  /**
   * Fige une execution dans un etat final.
   *
   * Le premier etat final gagne : une fin de processus arrivant apres un
   * depassement de delai ne doit pas effacer la raison de l'arret.
   */
  finish(runId: string, status: RunStatus, update: RunUpdate = {}): void {
    const entry = this.#entries.get(runId);
    if (entry === undefined || isFinalRunStatus(entry.status)) {
      return;
    }

    Object.assign(entry, update);
    entry.status = status;
    entry.finishedAt = update.finishedAt ?? this.#now();
    entry.kill = null;

    if (entry.resultText !== null) {
      entry.resultText = boundText(entry.resultText, RUN_LIMITS.resultText);
    }
    if (entry.stderrTail !== null) {
      entry.stderrTail = boundTail(entry.stderrTail, RUN_LIMITS.stderrTail);
    }
    if (entry.git.diffStat !== null) {
      entry.git.diffStat = boundText(entry.git.diffStat, RUN_LIMITS.gitDiffStat);
    }
    entry.git.changedFiles = entry.git.changedFiles.slice(0, RUN_LIMITS.changedFiles);

    this.prune();
  }

  /** Retourne l'etat d'une execution, ou `null` si elle est inconnue. */
  snapshot(runId: string): ClaudeRunSnapshot | null {
    const entry = this.#entries.get(runId);
    if (entry === undefined) {
      return null;
    }

    return {
      runId: entry.runId,
      status: entry.status,
      startedAt: entry.startedAt?.toISOString() ?? null,
      finishedAt: entry.finishedAt?.toISOString() ?? null,
      exitCode: entry.exitCode,
      errorCode: entry.errorCode,
      stderrTail: entry.stderrTail,
      resultText: entry.resultText,
      claudeSessionId: entry.claudeSessionId,
      durationMs: entry.durationMs,
      durationApiMs: entry.durationApiMs,
      numTurns: entry.numTurns,
      reportedCostUsd: entry.reportedCostUsd,
      git: { ...entry.git, changedFiles: [...entry.git.changedFiles] },
    };
  }

  /** Nombre d'entrees conservees, tous statuts confondus. */
  size(): number {
    return this.#entries.size;
  }

  /**
   * Retire les executions terminees devenues inutiles.
   *
   * Ne touche **jamais** a une entree active, quels que soient son age et le
   * nombre d'entrees : supprimer un run en cours reviendrait a perdre le seul
   * moyen d'en connaitre l'issue.
   */
  prune(): void {
    const cutoff = this.#now().getTime() - this.#retentionMs;

    const finished = [...this.#entries.values()]
      .filter((entry) => isFinalRunStatus(entry.status))
      .sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0));

    for (const entry of finished) {
      const expired = (entry.finishedAt?.getTime() ?? 0) < cutoff;
      if (expired) {
        this.#entries.delete(entry.runId);
      }
    }

    const remaining = [...this.#entries.values()]
      .filter((entry) => isFinalRunStatus(entry.status))
      .sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0));

    const excess = remaining.length - this.#maxRetained;
    for (let index = 0; index < excess; index += 1) {
      const entry = remaining[index];
      if (entry !== undefined) {
        this.#entries.delete(entry.runId);
      }
    }
  }
}
