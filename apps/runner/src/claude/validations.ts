/**
 * Suivi des commandes de validation reellement executees par Claude Code.
 *
 * ## Ce que ce module represente, et ce qu'il ne represente pas
 *
 * Il represente **ce qui s'est passe**. Pas ce qui aurait du se passer, pas ce
 * qu'on obtiendrait en relancant les commandes soi-meme. Une commande que
 * l'agent n'a jamais lancee reste `NOT_RUN`, et c'est une information de premier
 * ordre : elle dit que la tache n'a pas ete validee comme elle devait l'etre.
 *
 * NOX ne relance jamais `npm run test` pour completer le tableau. Ce serait
 * doubler le temps de validation, ouvrir une seconde surface d'execution de
 * commandes, et surtout remplacer l'histoire reelle du run par une reconstitution.
 *
 * ## Pourquoi une table plutot qu'un simple compteur
 *
 * Parce que la question interessante n'est pas « combien ont reussi » mais
 * « laquelle a echoue, et laquelle n'a pas tourne ». Les positions viennent de la
 * tache et ne bougent pas : la review d'un run reste lisible meme si la
 * specification evolue ensuite.
 *
 * ## Le cas de la commande repetee
 *
 * Une tache peut declarer deux fois la meme commande a deux positions. La regle
 * de correspondance est explicite et deterministe — premiere entree en attente,
 * sinon la derniere portant ce texte — plutot que « la premiere trouvee », qui
 * ferait qu'un second passage ecraserait le resultat du premier.
 *
 * ## Le cas de la commande relancee
 *
 * Un agent qui echoue, corrige, puis relance la meme commande produit deux
 * couples depart/resultat pour une seule entree. C'est **le dernier resultat
 * terminal qui est represente** : il decrit l'etat dans lequel l'execution s'est
 * reellement achevee. Le fait que la commande ait tourne, lui, ne se perd jamais
 * — elle ne redevient pas `NOT_RUN`.
 */

import {
  REVIEW_LIMITS,
  RUN_VALIDATION_STATUS,
  type RunValidationResultView,
  type RunValidationStatus,
} from "@nox/shared";

import type { ValidationOutcome } from "./stream/normalize-event.ts";

/** Statut final correspondant a chaque issue observee. */
const STATUS_BY_OUTCOME: Record<ValidationOutcome, RunValidationStatus> = {
  passed: RUN_VALIDATION_STATUS.PASSED,
  failed: RUN_VALIDATION_STATUS.FAILED,
  unknown: RUN_VALIDATION_STATUS.UNKNOWN,
};

/** Ce que le flux Claude Code apprend d'une commande de validation. */
export type ValidationSignal =
  | { kind: "started"; command: string }
  | {
      kind: "finished";
      command: string;
      /** Issue observee ; `unknown` quand le flux ne permet pas de trancher. */
      outcome: ValidationOutcome;
      /** Code de sortie **rapporte** par l'outil ; `null` s'il n'en fournit pas. */
      exitCode: number | null;
      /** Resume deja nettoye et borne, ou `null`. */
      summary: string | null;
    };

type ValidationEntry = {
  position: number;
  command: string;
  status: RunValidationStatus;
  exitCode: number | null;
  summary: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

/**
 * Table des validations d'une execution.
 *
 * Une classe plutot que des fonctions libres : l'etat doit vivre exactement le
 * temps d'une execution, et les tests doivent pouvoir en creer une instance
 * neuve sans toucher a un etat partage.
 */
export class ValidationTracker {
  readonly #entries: ValidationEntry[];
  readonly #now: () => Date;

  /**
   * Recopie les commandes attendues, dans leur ordre de declaration.
   *
   * La copie est le point important : la table ne **reference** pas la tache,
   * elle en garde une photo. Corriger une commande dans la specification, des
   * mois plus tard, ne doit pas reecrire l'histoire des executions passees.
   */
  constructor(commands: readonly string[], now: () => Date = () => new Date()) {
    this.#now = now;
    this.#entries = commands.map((command, position) => ({
      position,
      command: command.slice(0, REVIEW_LIMITS.command),
      status: RUN_VALIDATION_STATUS.NOT_RUN,
      exitCode: null,
      summary: null,
      startedAt: null,
      finishedAt: null,
    }));
  }

  /** Nombre de commandes attendues. */
  get size(): number {
    return this.#entries.length;
  }

  /** Applique ce que le flux vient d'apprendre. Ne leve jamais. */
  apply(signal: ValidationSignal): void {
    const entry =
      signal.kind === "started" ? this.#forStart(signal.command) : this.#forFinish(signal.command);

    if (entry === undefined) {
      // Une commande Bash qui n'est pas une validation attendue n'a rien a
      // faire ici : elle est ignoree, pas ajoutee. La table decrit ce que la
      // tache demandait, pas tout ce que l'agent a lance.
      return;
    }

    if (signal.kind === "started") {
      entry.status = RUN_VALIDATION_STATUS.RUNNING;
      entry.startedAt = this.#now();
      // Un nouveau depart efface le resultat du precedent : afficher le resume
      // d'un premier passage a cote du statut d'un second raconterait deux
      // executions differentes comme si elles n'en formaient qu'une.
      entry.finishedAt = null;
      entry.exitCode = null;
      entry.summary = null;
      return;
    }

    entry.status = STATUS_BY_OUTCOME[signal.outcome];
    entry.exitCode = signal.exitCode;
    entry.summary = signal.summary;
    entry.finishedAt = this.#now();
    entry.startedAt ??= entry.finishedAt;
  }

  /**
   * Fige la table a la fin de l'execution.
   *
   * Une commande encore `RUNNING` devient `UNKNOWN` : le processus est termine,
   * son resultat n'arrivera jamais, et laisser `RUNNING` afficherait un travail
   * en cours qui n'existe plus. `NOT_RUN`, lui, ne bouge pas — c'est deja la
   * bonne reponse.
   */
  seal(): void {
    for (const entry of this.#entries) {
      if (entry.status === RUN_VALIDATION_STATUS.RUNNING) {
        entry.status = RUN_VALIDATION_STATUS.UNKNOWN;
      }
    }
  }

  /** Etat courant des validations, dans l'ordre de la tache. */
  snapshot(): RunValidationResultView[] {
    return this.#entries.map((entry) => ({
      position: entry.position,
      command: entry.command,
      status: entry.status,
      exitCode: entry.exitCode,
      summary: entry.summary,
      startedAt: entry.startedAt?.toISOString() ?? null,
      finishedAt: entry.finishedAt?.toISOString() ?? null,
    }));
  }

  /** Premiere entree en attente portant ce texte, sinon la derniere. */
  #forStart(command: string): ValidationEntry | undefined {
    const waiting = this.#entries.find(
      (entry) => entry.command === command && entry.status === RUN_VALIDATION_STATUS.NOT_RUN,
    );
    return waiting ?? this.#last(command);
  }

  /**
   * Entree que ce resultat conclut.
   *
   * L'ordre des essais suit la vraisemblance : une commande en cours d'abord,
   * puis une commande jamais lancee — un resultat sans debut reste un resultat —,
   * puis la derniere portant ce texte.
   */
  #forFinish(command: string): ValidationEntry | undefined {
    const running = this.#entries.find(
      (entry) => entry.command === command && entry.status === RUN_VALIDATION_STATUS.RUNNING,
    );
    if (running !== undefined) {
      return running;
    }

    const waiting = this.#entries.find(
      (entry) => entry.command === command && entry.status === RUN_VALIDATION_STATUS.NOT_RUN,
    );
    return waiting ?? this.#last(command);
  }

  #last(command: string): ValidationEntry | undefined {
    return this.#entries.findLast((entry) => entry.command === command);
  }
}
