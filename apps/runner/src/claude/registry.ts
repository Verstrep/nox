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

import {
  CLAUDE_RUN_EVENT_KIND,
  RUN_EVENT_LIMITS,
  RUN_LIMITS,
  RUN_STATUS,
  TRUNCATION_EVENT_DETAIL,
  TRUNCATION_EVENT_LABEL,
  boundTail,
  boundText,
  isCancellableRunStatus,
  isEssentialEventKind,
  isFinalRunStatus,
} from "@nox/shared";
import type {
  ClaudeRunEvent,
  ClaudeRunEventDraft,
  ClaudeRunSnapshot,
  RunReviewSnapshot,
  RunStatus,
  RunValidationResultView,
  RunnerErrorCode,
} from "@nox/shared";

import { ValidationTracker, type ValidationSignal } from "./validations.ts";

/** Nombre maximal d'executions terminees conservees. */
export const MAX_RETAINED_RUNS = 20;

/** Duree de conservation d'une execution terminee. */
export const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Contexte interne d'une execution.
 *
 * Ces valeurs ne figurent dans **aucun** instantane : elles servent a finaliser
 * une execution dont le processus ne s'arrete pas, et un chemin absolu n'a rien
 * a faire dans une reponse HTTP.
 */
export type RunContext = {
  repositoryRoot: string;
  headBefore: string;
};

type RegistryEntry = {
  runId: string;
  status: RunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  cancellationRequestedAt: Date | null;
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
  /** Evenements publics, dans l'ordre d'attribution. */
  events: ClaudeRunEvent[];
  /** Prochain numero a attribuer ; ne recule jamais, meme apres troncature. */
  nextEventSequence: number;
  /** Volume de texte deja conserve, en caracteres. */
  eventCharacters: number;
  eventsTruncated: boolean;
  context: RunContext | null;
  /** Table des commandes de validation attendues, si l'execution en a. */
  validations: ValidationTracker | null;
  /** Instantane de review, produit une seule fois a la finalisation. */
  review: ReviewState | null;
  /** Permet de terminer le processus au depassement du delai. */
  kill: (() => void) | null;
};

/**
 * Etat de la capture de review d'une execution.
 *
 * Deux issues seulement, et un echec **n'est pas** une absence : un run dont la
 * capture a echoue doit pouvoir le dire, sinon il serait confondu avec un run
 * d'avant TASK-011 qui n'en a jamais eu.
 */
export type ReviewState =
  | { ok: true; snapshot: RunReviewSnapshot }
  | { ok: false; code: RunnerErrorCode };

export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: "already_active" | "duplicate_id" };

/** Champs modifiables d'une entree, hors identite, statut et mecanique interne. */
export type RunUpdate = Partial<
  Omit<
    RegistryEntry,
    | "runId"
    | "status"
    | "kill"
    | "events"
    | "nextEventSequence"
    | "eventCharacters"
    | "eventsTruncated"
    | "context"
    | "validations"
    | "review"
  >
>;

/** Issue d'une demande d'annulation. */
export type CancellationResult =
  | { ok: true; requestedAt: Date }
  | { ok: false; reason: "not_found" | "already_final" | "already_cancelling" };

/** Lot d'evenements retourne apres un curseur. */
export type EventsPage = {
  events: ClaudeRunEvent[];
  nextSequence: number;
  status: RunStatus;
  isFinal: boolean;
  truncated: boolean;
};

function emptyEntry(runId: string): RegistryEntry {
  return {
    runId,
    status: RUN_STATUS.QUEUED,
    startedAt: null,
    finishedAt: null,
    cancellationRequestedAt: null,
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
    events: [],
    nextEventSequence: 1,
    eventCharacters: 0,
    eventsTruncated: false,
    context: null,
    validations: null,
    review: null,
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

  /**
   * Marque une execution comme demarree.
   *
   * Ne ramene jamais un `CANCELLING` a `RUNNING` : une demande d'annulation
   * arrivee entre l'enregistrement et le demarrage serait sinon effacee, et
   * l'utilisateur verrait son clic disparaitre sans effet.
   */
  start(runId: string, startedAt: Date): void {
    const entry = this.#entries.get(runId);
    if (entry === undefined || isFinalRunStatus(entry.status)) {
      return;
    }
    if (entry.status !== RUN_STATUS.CANCELLING) {
      entry.status = RUN_STATUS.RUNNING;
    }
    entry.startedAt = startedAt;
  }

  /** Associe le contexte interne d'une execution. Jamais expose. */
  attachContext(runId: string, context: RunContext): void {
    const entry = this.#entries.get(runId);
    if (entry !== undefined) {
      entry.context = context;
    }
  }

  /** Contexte interne d'une execution, ou `null` si elle est inconnue. */
  context(runId: string): RunContext | null {
    return this.#entries.get(runId)?.context ?? null;
  }

  /** Vrai si un arret a ete demande pour cette execution. */
  isCancellationRequested(runId: string): boolean {
    return this.#entries.get(runId)?.cancellationRequestedAt != null;
  }

  /**
   * Recopie les commandes de validation attendues par la tache.
   *
   * Une **copie**, pas une reference : la review d'une execution passee doit
   * rester lisible meme si la specification de la tache change ensuite.
   */
  seedValidations(runId: string, commands: readonly string[]): void {
    const entry = this.#entries.get(runId);
    if (entry !== undefined) {
      entry.validations = new ValidationTracker(commands, this.#now);
    }
  }

  /** Applique ce que le flux vient d'apprendre d'une commande de validation. */
  applyValidation(runId: string, signal: ValidationSignal): void {
    this.#entries.get(runId)?.validations?.apply(signal);
  }

  /** Etat courant des validations, vide si l'execution n'en attendait aucune. */
  validations(runId: string): RunValidationResultView[] {
    return this.#entries.get(runId)?.validations?.snapshot() ?? [];
  }

  /**
   * Enregistre l'instantane de review d'une execution.
   *
   * Ecrit **une seule fois** : un second appel est ignore. C'est ce qui rend
   * l'instantane immuable des sa creation, sans dependre de la discipline de
   * l'appelant.
   */
  attachReview(runId: string, review: ReviewState): void {
    const entry = this.#entries.get(runId);
    if (entry !== undefined && entry.review === null) {
      entry.review = review;
    }
  }

  /** Instantane de review, ou `null` s'il n'a pas encore ete capture. */
  review(runId: string): ReviewState | null {
    return this.#entries.get(runId)?.review ?? null;
  }

  /**
   * Ajoute des evenements, en leur attribuant leur numero.
   *
   * `sequence` et `occurredAt` sont produits **ici**, jamais repris de l'appelant :
   * c'est le seul moyen de garantir une suite strictement croissante par
   * execution, meme si le producteur se trompe ou se repete.
   *
   * ## La troncature ne fait pas taire l'essentiel
   *
   * Une fois la limite atteinte, un unique evenement `TRUNCATED` est ajoute, puis
   * seuls les statuts, les erreurs et le resultat final continuent de passer. Ce
   * qui compte apres coup n'est pas la centieme lecture de fichier : c'est de
   * savoir ce qui a echoue et ce que l'execution a rendu.
   */
  appendEvents(runId: string, drafts: readonly ClaudeRunEventDraft[]): ClaudeRunEvent[] {
    const entry = this.#entries.get(runId);
    if (entry === undefined || drafts.length === 0) {
      return [];
    }

    const appended: ClaudeRunEvent[] = [];

    for (const draft of drafts) {
      const weight = draft.label.length + (draft.detail?.length ?? 0);
      const full =
        entry.events.length >= RUN_EVENT_LIMITS.maxEvents ||
        entry.eventCharacters + weight > RUN_EVENT_LIMITS.totalCharacters;

      if (full && !entry.eventsTruncated) {
        entry.eventsTruncated = true;
        appended.push(
          this.#push(entry, {
            kind: CLAUDE_RUN_EVENT_KIND.TRUNCATED,
            label: TRUNCATION_EVENT_LABEL,
            detail: TRUNCATION_EVENT_DETAIL,
            toolName: null,
            isError: false,
          }),
        );
      }

      if (full && !isEssentialEventKind(draft.kind)) {
        continue;
      }

      // Meme l'essentiel a une fin : sans ce plafond, une execution qui
      // n'emettrait que des erreurs contournerait entierement la borne.
      if (entry.events.length >= RUN_EVENT_LIMITS.maxEvents + RUN_EVENT_LIMITS.reservedEvents) {
        continue;
      }

      appended.push(this.#push(entry, draft));
    }

    return appended;
  }

  #push(entry: RegistryEntry, draft: ClaudeRunEventDraft): ClaudeRunEvent {
    const event: ClaudeRunEvent = {
      sequence: entry.nextEventSequence,
      kind: draft.kind,
      occurredAt: this.#now().toISOString(),
      label: draft.label,
      detail: draft.detail,
      toolName: draft.toolName,
      isError: draft.isError,
    };

    entry.nextEventSequence += 1;
    entry.eventCharacters += event.label.length + (event.detail?.length ?? 0);
    entry.events.push(event);
    return event;
  }

  /**
   * Retourne les evenements posterieurs a un curseur.
   *
   * `nextSequence` est calcule plutot que deduit du dernier element : un lot vide
   * doit laisser le curseur ou il est, et l'appelant n'a pas a le deviner.
   */
  getEvents(runId: string, afterSequence: number, limit: number): EventsPage | null {
    const entry = this.#entries.get(runId);
    if (entry === undefined) {
      return null;
    }

    const bounded = Math.min(Math.max(1, limit), RUN_EVENT_LIMITS.maxBatch);
    const pending = entry.events.filter((event) => event.sequence > afterSequence);
    const events = pending.slice(0, bounded);
    const last = events.at(-1);

    return {
      events,
      nextSequence: last?.sequence ?? Math.max(afterSequence, 0),
      status: entry.status,
      isFinal: isFinalRunStatus(entry.status),
      truncated: entry.eventsTruncated,
    };
  }

  /**
   * Enregistre une demande d'annulation et passe l'execution en `CANCELLING`.
   *
   * Ne tue rien : l'arret du processus est declenche par l'appelant, apres cette
   * reponse. La separation est deliberee — le registre decide si la demande est
   * recevable, il ne manipule pas de processus.
   *
   * Trois refus distincts, parce qu'ils appellent trois messages differents : une
   * execution inconnue, une execution deja terminee, une annulation deja engagee.
   */
  requestCancellation(runId: string): CancellationResult {
    const entry = this.#entries.get(runId);
    if (entry === undefined) {
      return { ok: false, reason: "not_found" };
    }
    if (isFinalRunStatus(entry.status)) {
      return { ok: false, reason: "already_final" };
    }
    if (!isCancellableRunStatus(entry.status)) {
      return { ok: false, reason: "already_cancelling" };
    }

    const requestedAt = this.#now();
    entry.status = RUN_STATUS.CANCELLING;
    entry.cancellationRequestedAt = requestedAt;

    this.appendEvents(runId, [
      {
        kind: CLAUDE_RUN_EVENT_KIND.STATUS,
        label: "Cancellation requested",
        detail: null,
        toolName: null,
        isError: false,
      },
    ]);

    return { ok: true, requestedAt };
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

    // Une commande encore « en cours » a la fin du processus ne le sera plus
    // jamais : son resultat n'arrivera pas, et l'afficher comme actif
    // annoncerait un travail qui n'existe plus.
    entry.validations?.seal();

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
      cancellationRequestedAt: entry.cancellationRequestedAt?.toISOString() ?? null,
      lastEventSequence: entry.nextEventSequence - 1,
      eventsTruncated: entry.eventsTruncated,
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
