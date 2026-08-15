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
 * Documents, taches et memoire sont distingues parce qu'ils ne changent pas pour
 * les memes raisons : un document est modifie par l'utilisateur, une tache entre
 * ou sort de la fenetre des dix plus recentes sans que personne n'y touche, et
 * une entree de memoire ne bouge que sur une action explicite.
 *
 * `MEMORY_REMOVED` couvre deux gestes distincts — archivage et suppression — et
 * c'est volontaire : le manifest ne conserve que ce qui a ete **envoye**, donc
 * une entree absente est absente, sans que NOX puisse dire laquelle des deux
 * causes s'applique. Nommer la cause reviendrait a l'inventer.
 */
export const ARCHITECT_CONTEXT_CHANGE = {
  ADDED: "ADDED",
  REMOVED: "REMOVED",
  MODIFIED: "MODIFIED",
  TRUNCATION_CHANGED: "TRUNCATION_CHANGED",
  TASK_ADDED: "TASK_ADDED",
  TASK_MODIFIED: "TASK_MODIFIED",
  TASK_REMOVED: "TASK_REMOVED",
  MEMORY_ADDED: "MEMORY_ADDED",
  MEMORY_MODIFIED: "MEMORY_MODIFIED",
  MEMORY_REMOVED: "MEMORY_REMOVED",
  BRIEF_ADDED: "BRIEF_ADDED",
  BRIEF_MODIFIED: "BRIEF_MODIFIED",
  BRIEF_REMOVED: "BRIEF_REMOVED",
  PLAN_ADDED: "PLAN_ADDED",
  PLAN_MODIFIED: "PLAN_MODIFIED",
  PLAN_REMOVED: "PLAN_REMOVED",
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

/**
 * Nature d'un changement, selon la source concernee.
 *
 * Une table plutot qu'une suite de conditions : une nature de source ajoutee
 * plus tard ne peut pas passer inapercue, `Record` obligeant a la traiter.
 */
const CHANGE_KINDS: Record<
  ArchitectContextSource["kind"],
  { added: ArchitectContextChangeKind; modified: ArchitectContextChangeKind; removed: ArchitectContextChangeKind }
> = {
  INSTRUCTIONS: {
    added: ARCHITECT_CONTEXT_CHANGE.ADDED,
    modified: ARCHITECT_CONTEXT_CHANGE.MODIFIED,
    removed: ARCHITECT_CONTEXT_CHANGE.REMOVED,
  },
  DOCUMENT: {
    added: ARCHITECT_CONTEXT_CHANGE.ADDED,
    modified: ARCHITECT_CONTEXT_CHANGE.MODIFIED,
    removed: ARCHITECT_CONTEXT_CHANGE.REMOVED,
  },
  TASK: {
    added: ARCHITECT_CONTEXT_CHANGE.TASK_ADDED,
    modified: ARCHITECT_CONTEXT_CHANGE.TASK_MODIFIED,
    removed: ARCHITECT_CONTEXT_CHANGE.TASK_REMOVED,
  },
  MEMORY: {
    added: ARCHITECT_CONTEXT_CHANGE.MEMORY_ADDED,
    modified: ARCHITECT_CONTEXT_CHANGE.MEMORY_MODIFIED,
    removed: ARCHITECT_CONTEXT_CHANGE.MEMORY_REMOVED,
  },
  // `REMOVED` n'a pas d'interface pour le produire : aucune suppression n'est
  // offerte, une ligne creee reste. Il est conserve parce qu'un manifest
  // historique peut decrire un etat qui n'existe plus, et qu'une comparaison
  // muette serait pire qu'un fait rare.
  PROJECT_BRIEF: {
    added: ARCHITECT_CONTEXT_CHANGE.BRIEF_ADDED,
    modified: ARCHITECT_CONTEXT_CHANGE.BRIEF_MODIFIED,
    removed: ARCHITECT_CONTEXT_CHANGE.BRIEF_REMOVED,
  },
  PROJECT_V1_PLAN: {
    added: ARCHITECT_CONTEXT_CHANGE.PLAN_ADDED,
    modified: ARCHITECT_CONTEXT_CHANGE.PLAN_MODIFIED,
    removed: ARCHITECT_CONTEXT_CHANGE.PLAN_REMOVED,
  },
};

function changeKinds(source: ArchitectContextSource) {
  // Un manifest enregistre avant l'ajout d'une nature de source reste lisible :
  // une valeur inconnue est traitee comme un document ordinaire plutot que de
  // faire tomber la page d'historique.
  return CHANGE_KINDS[source.kind] ?? CHANGE_KINDS.DOCUMENT;
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
        kind: changeKinds(source).added,
        identifier: source.identifier,
        previousRevision: null,
        currentRevision: shortRevision(source.revision),
      });
      continue;
    }

    if (old.revision !== source.revision) {
      changes.push({
        kind: changeKinds(source).modified,
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
      kind: changeKinds(source).removed,
      identifier: source.identifier,
      previousRevision: shortRevision(source.revision),
      currentRevision: null,
    });
  }

  return changes;
}
