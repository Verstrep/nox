/**
 * Presentation de l'Architecte : URL, sort des sources, tailles.
 *
 * Aucune de ces fonctions ne touche a la base, au runner ni au fournisseur.
 * Elles sont pures et testables directement, la ou une page ne l'est pas.
 *
 * Les libelles, eux, vivent dans `lib/labels.ts` — un mapping concurrent dans un
 * module isole finirait par diverger.
 */

import type { ArchitectTaskOrigin } from "@nox/database";
import {
  ARCHITECT_SESSION_KIND,
  TASK_PRIORITY,
  type ArchitectContextManifest,
  type ArchitectContextSource,
  type ArchitectTaskProposal,
} from "@nox/shared";

import type { ArchitectSourceStatus } from "../labels.ts";
import type { TaskFormValues } from "../task-input.ts";

/** Page des sessions Architecte d'un projet. */
export function architectUrl(projectId: string): string {
  return `/projects/${projectId}/architect`;
}

/** Page d'une session Architecte. */
export function architectSessionUrl(projectId: string, sessionId: string): string {
  return `/projects/${projectId}/architect/${sessionId}`;
}

/** Page des conversations historiques d'un projet. */
export function architectHistoryUrl(projectId: string): string {
  return `/projects/${projectId}/architect/history`;
}

/**
 * Ou mene « Designed with Architect », selon d'ou vient la tache.
 *
 * Deux modeles, deux surfaces. Une tache issue de la conversation projet mene a
 * la conversation elle-meme, qui n'a pas d'identifiant dans son URL — il n'y en
 * a qu'une. Une tache historique mene a sa session, qui est en lecture seule.
 *
 * Confondre les deux enverrait l'utilisateur vers un fil qu'il ne peut pas
 * poursuivre, ou vers un fil qui n'a jamais parle de sa tache.
 */
export function architectOriginUrl(projectId: string, origin: ArchitectTaskOrigin): string {
  return origin.kind === ARCHITECT_SESSION_KIND.PROJECT
    ? architectUrl(projectId)
    : architectSessionUrl(projectId, origin.sessionId);
}

/**
 * Comment nommer cette provenance.
 *
 * Le numero du tour n'apparait que lorsqu'il existe : une session historique
 * n'en a pas, et inventer « tour 1 » lui prêterait une conversation.
 */
export function architectOriginLabel(origin: ArchitectTaskOrigin): string {
  if (origin.kind !== ARCHITECT_SESSION_KIND.PROJECT) {
    return origin.code;
  }
  return origin.generationSequence === null
    ? "Project Architect"
    : `Project Architect · tour ${String(origin.generationSequence)}`;
}

/**
 * Une ligne de la preview du contexte.
 *
 * `revision` est raccourcie : douze caracteres suffisent a distinguer deux
 * versions d'un document, et la ligne reste lisible.
 */
export type ArchitectSourceRow = {
  kind: ArchitectContextSource["kind"];
  identifier: string;
  revision: string | null;
  status: ArchitectSourceStatus;
  chars: number;
};

/**
 * Une ligne de la section « Project memory » de la preview.
 *
 * Distincte des lignes de sources : une memoire se lit par son code et sa
 * categorie, la ou un document se lit par son chemin. Les melanger obligerait
 * l'utilisateur a deviner laquelle des deux natures il regarde.
 */
export type ArchitectMemoryRow = {
  code: string;
  category: string;
  revision: string | null;
  chars: number;
};

/** Extrait les entrees de memoire du manifest, dans l'ordre d'envoi. */
export function memoryRows(manifest: ArchitectContextManifest): ArchitectMemoryRow[] {
  return manifest.sources
    .filter((source) => source.kind === "MEMORY")
    .map((source) => ({
      code: source.identifier,
      category: source.category ?? "",
      revision: source.revision === null ? null : source.revision.slice(0, 12),
      chars: source.includedChars,
    }));
}

/**
 * Sort d'une source, derive du manifest.
 *
 * Un document present mais sans un seul caractere transmis est `OMITTED`, pas
 * `TRUNCATED` : dire « tronque » laisserait croire qu'une partie est partie.
 */
export function sourceStatus(source: ArchitectContextSource): ArchitectSourceStatus {
  if (source.includedChars === 0) {
    return "OMITTED";
  }
  return source.truncated ? "TRUNCATED" : "INCLUDED";
}

/**
 * Transforme un manifest en lignes affichables.
 *
 * Les documents absents apparaissent aussi, marques `MISSING` : leur absence est
 * une information — elle explique pourquoi l'architecte en sait moins.
 */
export function manifestRows(manifest: ArchitectContextManifest): ArchitectSourceRow[] {
  const rows: ArchitectSourceRow[] = manifest.sources.map((source) => ({
    kind: source.kind,
    identifier: source.identifier,
    revision: source.revision === null ? null : source.revision.slice(0, 12),
    status: sourceStatus(source),
    chars: source.includedChars,
  }));

  for (const path of manifest.missing) {
    rows.push({ kind: "DOCUMENT", identifier: path, revision: null, status: "MISSING", chars: 0 });
  }

  return rows;
}

/** Nombre de taches decrites dans un manifest. */
export function manifestTaskCount(manifest: ArchitectContextManifest): number {
  return manifest.sources.filter((source) => source.kind === "TASK").length;
}

/**
 * Taille lisible d'un nombre de caracteres.
 *
 * Le kibioctet est annonce comme tel : NOX compte en caracteres, et une
 * approximation affichee comme un octet exact serait fausse des le premier
 * accent.
 */
export function formatChars(chars: number): string {
  if (chars < 1024) {
    return `${String(chars)} car.`;
  }
  return `${(chars / 1024).toFixed(1)} Kio`;
}

/**
 * Traduit une proposition en valeurs de formulaire de tache.
 *
 * Les listes deviennent des lignes, comme dans le formulaire de creation
 * ordinaire : c'est la meme saisie, donc le meme format, donc la meme validation
 * cote serveur. Les hypotheses n'y figurent pas — elles servent a la relecture de
 * la proposition, pas a la specification de la tache.
 */
export function proposalToFormValues(proposal: ArchitectTaskProposal): TaskFormValues {
  return {
    title: proposal.title ?? "",
    priority: proposal.priority ?? TASK_PRIORITY.MEDIUM,
    objective: proposal.objective ?? "",
    context: proposal.context ?? "",
    outOfScope: proposal.outOfScope.join("\n"),
    documents: proposal.documentReferences.join("\n"),
    criteria: proposal.acceptanceCriteria.join("\n"),
    commands: proposal.validationCommands.join("\n"),
  };
}

/** Extrait court d'un texte, pour une liste de sessions. */
export function architectExcerpt(text: string, max = 140): string {
  const single = text.replace(/\s+/gu, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}
