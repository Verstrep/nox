/**
 * Construction du contexte projet envoye a l'Architecte.
 *
 * ## Une liste fermee, pas une exploration
 *
 * L'Architecte ne recoit **jamais** le repository. Il recoit huit chemins
 * connus a l'avance — deux fichiers de conventions, six documents produit — et
 * les dernieres taches enregistrees. Rien d'autre n'est candidat : ni code
 * source, ni diff, ni sortie de Claude Code, ni fichier `.env`, ni chemin choisi
 * par le navigateur.
 *
 * C'est la premiere protection de NOX, et de loin la plus solide. Un nettoyeur
 * de secrets peut manquer une forme inconnue ; une liste fermee ne peut pas
 * envoyer un fichier qui n'y figure pas.
 *
 * ## Ce module ne lit rien
 *
 * Il recoit des documents deja lus par le runner et des taches deja relues en
 * base, et decide de ce qui entre. Pur et deterministe : les memes entrees
 * produisent le meme bundle, ce qui rend l'empreinte d'entree comparable et les
 * tests possibles sans runner ni repository.
 *
 * ## Les bornes
 *
 * Des constantes, jamais des variables d'environnement. Elles decident de ce qui
 * quitte la machine et de ce qui sera facture ; une limite reglable depuis un
 * `.env` n'en est plus une.
 *
 * Un document trop grand est coupe en gardant **son debut et sa fin**, avec une
 * marque explicite au milieu. Ce n'est pas un compromis paresseux : pour un
 * fichier comme `DECISIONS.md`, le debut porte les conventions fondatrices et la
 * fin les decisions recentes — le milieu est la partie dont on se passe le mieux.
 * Aucun resume prealable n'est produit : ce serait un second appel, un second
 * cout, et une seconde source d'erreur.
 */

import type {
  ArchitectContextManifest,
  ArchitectContextSource,
  ArchitectPromptDocument,
  ArchitectPromptTask,
  DevelopmentTaskDetail,
  ProjectDocumentSummary,
} from "@nox/shared";

/** Bornes du contexte. Exprimees en caracteres, mesurees apres sanitation. */
export const ARCHITECT_CONTEXT_LIMITS = {
  /** Taille maximale d'un document, troncature comprise. */
  documentChars: 32 * 1024,
  /** Taille maximale de l'ensemble du Markdown envoye. */
  totalChars: 128 * 1024,
  /** Part conservee au debut d'un document tronque. */
  headChars: 8 * 1024,
  /** Nombre de taches recentes decrites. */
  recentTasks: 10,
  /** Taille maximale du resume d'une tache. */
  taskChars: 2 * 1024,
  /** Taille maximale de la liste fermee des documents referencables. */
  availableDocuments: 80,
} as const;

/**
 * Documents de conventions.
 *
 * Presentes a l'architecte comme des **regles a respecter**, pas comme de
 * l'information. C'est la seule categorie qui ait ce statut, et elle est fermee.
 */
export const ARCHITECT_INSTRUCTION_DOCUMENTS: readonly string[] = ["CLAUDE.md", "AGENTS.md"];

/**
 * Documents produit, dans leur ordre de priorite.
 *
 * L'ordre compte : le budget est consomme de haut en bas, donc le dernier de la
 * liste est le premier a etre tronque. `DECISIONS.md` ferme la marche parce
 * qu'il est le plus volumineux et le plus redondant avec les autres.
 */
export const ARCHITECT_CONTEXT_DOCUMENTS: readonly string[] = [
  "docs/PROJECT_BRIEF.md",
  "docs/V1_SCOPE.md",
  "docs/ARCHITECTURE.md",
  "docs/PROJECT_STATE.md",
  "docs/ROADMAP.md",
  "docs/DECISIONS.md",
];

/** Ensemble des chemins que NOX accepte de lire pour l'architecte. */
export const ARCHITECT_DOCUMENT_ALLOWLIST: readonly string[] = [
  ...ARCHITECT_INSTRUCTION_DOCUMENTS,
  ...ARCHITECT_CONTEXT_DOCUMENTS,
];

/** Marque inseree a la place du texte retire d'un document tronque. */
export function truncationNotice(omitted: number): string {
  return `\n\n[... ${String(omitted)} caracteres retires par NOX ...]\n\n`;
}

/** Un document lu par le runner, tel que le constructeur l'attend. */
export type FetchedArchitectDocument = {
  path: string;
  revision: string | null;
  content: string;
};

export type ArchitectContextInput = {
  /** Documents effectivement lus, quel que soit leur ordre. */
  documents: readonly FetchedArchitectDocument[];
  /** Inventaire complet du repository, pour la liste fermee des references. */
  inventory: readonly ProjectDocumentSummary[];
  /** Taches du projet, de la plus recente a la plus ancienne. */
  tasks: readonly DevelopmentTaskDetail[];
  /** Nettoyeur applique a **toute** chaine transmise. */
  sanitize: (value: string) => string;
  /**
   * Revision d'une tache, calculee sur ce qui est reellement envoye.
   *
   * Injectee plutot qu'importee : ce module reste pur et sans dependance Node,
   * donc testable sans repository. La fonction de production vit dans
   * `fingerprint.ts`, qui a le droit d'utiliser `node:crypto`.
   */
  taskRevision: (task: ArchitectPromptTask) => string;
};

export type ArchitectContextBundle = {
  manifest: ArchitectContextManifest;
  instructionDocuments: ArchitectPromptDocument[];
  contextDocuments: ArchitectPromptDocument[];
  recentTasks: ArchitectPromptTask[];
  /** Liste fermee des chemins referencables par une proposition. */
  availableDocuments: string[];
};

/**
 * Coupe un texte en gardant son debut et sa fin.
 *
 * Un budget nul retourne une chaine vide et une marque de troncature : le
 * document existe, mais aucune de ses lignes n'a eu la place d'entrer. La
 * distinction avec un document absent est conservee jusque dans l'interface.
 */
export function truncateAroundMiddle(
  content: string,
  budget: number,
): { text: string; truncated: boolean } {
  if (content.length <= budget) {
    return { text: content, truncated: false };
  }
  if (budget <= 0) {
    return { text: "", truncated: true };
  }

  const head = Math.min(ARCHITECT_CONTEXT_LIMITS.headChars, Math.floor(budget / 4));
  const notice = truncationNotice(content.length - budget);
  const tail = Math.max(0, budget - head - notice.length);

  if (tail === 0) {
    return { text: content.slice(0, budget), truncated: true };
  }

  return {
    text: content.slice(0, head) + notice + content.slice(content.length - tail),
    truncated: true,
  };
}

/** Reduit une liste et ses entrees, sans jamais reformuler leur contenu. */
function boundList(entries: readonly string[], count: number, length: number): string[] {
  return entries.slice(0, count).map((entry) => entry.slice(0, length));
}

/**
 * Resume une tache pour le contexte.
 *
 * Ce qui entre : ce que la tache **demandait**. Ce qui n'entre jamais : ce que
 * son execution a produit — prompt, timeline, diff, cout, session, feedback. Ce
 * n'est pas une omission, c'est le perimetre : l'architecte concoit une tache, il
 * n'audite pas un run.
 */
function summarizeTask(
  task: DevelopmentTaskDetail,
  sanitize: (value: string) => string,
): { task: ArchitectPromptTask; chars: number } {
  const summary: ArchitectPromptTask = {
    code: task.code,
    title: sanitize(task.title).slice(0, 200),
    status: task.status,
    objective: sanitize(task.objective).slice(0, 600),
    outOfScope: task.outOfScope === null ? null : sanitize(task.outOfScope).slice(0, 400),
    acceptanceCriteria: boundList(task.acceptanceCriteria.map(sanitize), 6, 200),
    documentReferences: boundList(task.documentReferences.map(sanitize), 8, 200),
    validationCommands: boundList(task.validationCommands.map(sanitize), 6, 200),
  };

  const chars =
    summary.title.length +
    summary.objective.length +
    (summary.outOfScope?.length ?? 0) +
    summary.acceptanceCriteria.join("").length +
    summary.documentReferences.join("").length +
    summary.validationCommands.join("").length;

  return { task: summary, chars: Math.min(chars, ARCHITECT_CONTEXT_LIMITS.taskChars) };
}

/**
 * Liste fermee des documents referencables par une proposition.
 *
 * Elle vient de l'inventaire reel du repository, jamais d'une invention du
 * modele. Les documents de tache passent en dernier : ils sont nombreux et
 * rarement utiles comme reference d'une **nouvelle** tache, mais les exclure
 * priverait l'utilisateur d'un cas legitime.
 */
export function buildAvailableDocuments(
  inventory: readonly ProjectDocumentSummary[],
): string[] {
  const ordinary = inventory.filter((entry) => entry.category !== "TASK").map((entry) => entry.path);
  const tasks = inventory.filter((entry) => entry.category === "TASK").map((entry) => entry.path);
  return [...ordinary, ...tasks].slice(0, ARCHITECT_CONTEXT_LIMITS.availableDocuments);
}

/**
 * Construit le bundle transmis a l'architecte.
 *
 * L'ordre de consommation du budget est fixe : conventions, taches recentes,
 * puis documents produit. Les conventions d'abord parce qu'elles sont des
 * regles ; les taches ensuite parce qu'elles sont petites et montrent la taille
 * attendue d'une tache dans ce projet ; les documents enfin, du plus general au
 * plus volumineux.
 */
export function buildArchitectContext(input: ArchitectContextInput): ArchitectContextBundle {
  const byPath = new Map(input.documents.map((document) => [document.path, document]));
  const sources: ArchitectContextSource[] = [];
  const missing: string[] = [];
  let remaining = ARCHITECT_CONTEXT_LIMITS.totalChars;

  const takeDocument = (
    path: string,
    kind: "INSTRUCTIONS" | "DOCUMENT",
  ): ArchitectPromptDocument | null => {
    const found = byPath.get(path);
    if (found === undefined) {
      // Un document absent n'est pas une erreur : c'est simplement moins de
      // contexte. Un projet qui commence n'en possede aucun.
      missing.push(path);
      return null;
    }

    const cleaned = input.sanitize(found.content);
    const budget = Math.min(ARCHITECT_CONTEXT_LIMITS.documentChars, remaining);
    const { text, truncated } = truncateAroundMiddle(cleaned, budget);
    remaining -= text.length;

    sources.push({
      kind,
      identifier: path,
      revision: found.revision,
      includedChars: text.length,
      truncated,
    });

    return { path, revision: found.revision, truncated, content: text };
  };

  const instructionDocuments: ArchitectPromptDocument[] = [];
  for (const path of ARCHITECT_INSTRUCTION_DOCUMENTS) {
    const document = takeDocument(path, "INSTRUCTIONS");
    if (document !== null && document.content !== "") {
      instructionDocuments.push(document);
    }
  }

  const recentTasks: ArchitectPromptTask[] = [];
  for (const task of input.tasks.slice(0, ARCHITECT_CONTEXT_LIMITS.recentTasks)) {
    const { task: summary, chars } = summarizeTask(task, input.sanitize);
    if (chars > remaining) {
      break;
    }
    remaining -= chars;
    recentTasks.push(summary);
    sources.push({
      kind: "TASK",
      identifier: task.code,
      // La revision du **contenu envoye**, pas celle du document Markdown : ce
      // dernier n'est pas transmis, et une specification modifiee sans
      // synchronisation resterait invisible.
      revision: input.taskRevision(summary),
      includedChars: chars,
      truncated: false,
    });
  }

  const contextDocuments: ArchitectPromptDocument[] = [];
  for (const path of ARCHITECT_CONTEXT_DOCUMENTS) {
    const document = takeDocument(path, "DOCUMENT");
    if (document !== null && document.content !== "") {
      contextDocuments.push(document);
    }
  }

  return {
    manifest: {
      schemaVersion: 1,
      sources,
      totalChars: ARCHITECT_CONTEXT_LIMITS.totalChars - remaining,
      missing,
    },
    instructionDocuments,
    contextDocuments,
    recentTasks,
    availableDocuments: buildAvailableDocuments(input.inventory),
  };
}
