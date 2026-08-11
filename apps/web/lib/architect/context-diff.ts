/**
 * Comparaison de deux manifests de contexte.
 *
 * ## Des faits, jamais un diff de contenu
 *
 * NOX ne conserve pas le texte des documents envoyes — seulement leur
 * description. Il ne peut donc pas montrer ce qui a change **dans** un document,
 * et il ne le pretend pas : il dit qu'il a change, et de quelle revision a
 * quelle revision.
 *
 * C'est une limite assumee plutot qu'une lacune. Conserver le contenu complet de
 * chaque tour ferait grossir la base sans borne, dupliquerait des documents que
 * le repository possede deja, et donnerait l'illusion que NOX peut rejouer un
 * ancien contexte — ce qu'il refuse justement de faire.
 *
 * ## Pur, donc testable
 *
 * Ce module ne touche ni au disque, ni a la base, ni au reseau. Deux manifests
 * entrent, une liste de faits sort.
 */

import type { ArchitectContextManifest, ArchitectContextSource } from "@nox/shared";

/**
 * Nature d'un changement entre deux tours.
 *
 * Les documents et les taches sont distingues parce qu'ils ne changent pas pour
 * les memes raisons : un document est modifie par l'utilisateur, une tache entre
 * ou sort de la fenetre des dix plus recentes sans que personne n'y touche.
 */
export const ARCHITECT_CONTEXT_CHANGE = {
  ADDED: "ADDED",
  REMOVED: "REMOVED",
  MODIFIED: "MODIFIED",
  TRUNCATION_CHANGED: "TRUNCATION_CHANGED",
  TASK_ADDED: "TASK_ADDED",
  TASK_MODIFIED: "TASK_MODIFIED",
  TASK_REMOVED: "TASK_REMOVED",
} as const;

export type ArchitectContextChangeKind =
  (typeof ARCHITECT_CONTEXT_CHANGE)[keyof typeof ARCHITECT_CONTEXT_CHANGE];

export type ArchitectContextChange = {
  kind: ArchitectContextChangeKind;
  /** Chemin d'un document ou code d'une tache. */
  identifier: string;
  /** Revision courte precedente, lorsqu'elle existe. */
  previousRevision: string | null;
  /** Revision courte actuelle, lorsqu'elle existe. */
  currentRevision: string | null;
};

/** Douze caracteres suffisent a distinguer deux versions et restent lisibles. */
function shortRevision(revision: string | null): string | null {
  return revision === null ? null : revision.slice(0, 12);
}

function isTask(source: ArchitectContextSource): boolean {
  return source.kind === "TASK";
}

/** Indexe les sources par identifiant ; deux sources ne le partagent jamais. */
function index(manifest: ArchitectContextManifest): Map<string, ArchitectContextSource> {
  return new Map(manifest.sources.map((source) => [source.identifier, source]));
}

/**
 * Compare deux manifests et rend les faits surs.
 *
 * L'ordre de sortie suit celui du manifest **actuel**, puis les disparitions :
 * c'est l'ordre dans lequel l'utilisateur lit sa preview, et une liste triee
 * autrement l'obligerait a chercher.
 */
export function diffArchitectManifests(
  previous: ArchitectContextManifest,
  current: ArchitectContextManifest,
): ArchitectContextChange[] {
  const before = index(previous);
  const after = index(current);
  const changes: ArchitectContextChange[] = [];

  for (const source of current.sources) {
    const old = before.get(source.identifier);

    if (old === undefined) {
      changes.push({
        kind: isTask(source) ? ARCHITECT_CONTEXT_CHANGE.TASK_ADDED : ARCHITECT_CONTEXT_CHANGE.ADDED,
        identifier: source.identifier,
        previousRevision: null,
        currentRevision: shortRevision(source.revision),
      });
      continue;
    }

    if (old.revision !== source.revision) {
      changes.push({
        kind: isTask(source)
          ? ARCHITECT_CONTEXT_CHANGE.TASK_MODIFIED
          : ARCHITECT_CONTEXT_CHANGE.MODIFIED,
        identifier: source.identifier,
        previousRevision: shortRevision(old.revision),
        currentRevision: shortRevision(source.revision),
      });
      continue;
    }

    // Meme revision, mais coupe differemment : le document n'a pas change, ce
    // qui en part si. Le dire « modifie » serait faux, le taire serait pire.
    if (old.truncated !== source.truncated) {
      changes.push({
        kind: ARCHITECT_CONTEXT_CHANGE.TRUNCATION_CHANGED,
        identifier: source.identifier,
        previousRevision: shortRevision(old.revision),
        currentRevision: shortRevision(source.revision),
      });
    }
  }

  for (const source of previous.sources) {
    if (after.has(source.identifier)) {
      continue;
    }
    changes.push({
      kind: isTask(source) ? ARCHITECT_CONTEXT_CHANGE.TASK_REMOVED : ARCHITECT_CONTEXT_CHANGE.REMOVED,
      identifier: source.identifier,
      previousRevision: shortRevision(source.revision),
      currentRevision: null,
    });
  }

  return changes;
}
