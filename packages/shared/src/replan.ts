/**
 * Contrat de replanification : `replan/1`.
 *
 * ## Ce que cet objet est, et pourquoi il n'est pas `backlog/2`
 *
 * `backlog/2` planifie un projet **sans passe** : aucune tache n'existe, rien
 * n'a tourne, et la proposition n'a qu'a decrire ce qu'il faut construire.
 *
 * `replan/1` intervient apres. Le projet possede des taches terminees, des
 * taches en cours, une file, des dependances, et des taches futures encore
 * modifiables. Les invariants ne sont pas les memes : ici, la moitie de l'etat
 * est **intouchable**, et c'est le coeur du contrat.
 *
 *     THE PAST IS IMMUTABLE.
 *     THE FUTURE IS REPLANNABLE.
 *
 * Une tache deja commencee, executee, inscrite en file ou d'amorcage n'est
 * jamais reecrite. Si une decision remet en cause du travail deja livre, la
 * reponse correcte est une **nouvelle tache future**, jamais une reecriture de
 * l'ancienne — sans quoi l'historique se mettrait a mentir : le prompt envoye,
 * la review capturee et les validations enregistrees citent tous une
 * specification qui aurait change apres coup.
 *
 * ## Un etat cible, jamais une liste d'operations
 *
 * Le fournisseur ne rend ni `DELETE #3`, ni `MOVE #4`, ni `PATCH #7 champ X`. Il
 * rend l'**etat cible complet** des taches futures. NOX en derive ensuite
 * `KEEP`, `UPDATE`, `REMOVE`, `ADD`, `REORDER` et les changements de
 * dependances.
 *
 * Ce choix n'est pas esthetique. Une liste d'operations peut se contredire
 * elle-meme, ne se compare a rien, ne se relit pas, ne se modifie pas avant
 * application, et obligerait NOX a ecrire une petite machine a patcher pilotee
 * par un modele. Un etat cible se compare a l'etat courant, se corrige a la
 * main, et se verifie entierement — graphe compris — **avant** la moindre
 * mutation. C'est la meme philosophie que la mise a jour de projet de
 * TASK-021 : un etat cible complet plutot qu'un patch opaque.
 *
 * ## Le contrat de tache n'est pas redefini
 *
 * Un element de cible porte exactement les champs d'un element de `backlog/2` —
 * titre, priorite, objectif, contexte, hors perimetre, documents, criteres avec
 * leur mode de verification, commandes avec leur mode d'execution — et passe
 * par **les memes** validateurs, importes et non recopies. Un replan n'est
 * jamais plus permissif que l'editeur de tache normal.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne lit ni base, ni disque, ni reseau. Il valide une reponse de fournisseur
 * contre un etat source qu'on lui donne. Ni la classification des taches, ni la
 * derivation du diff, ni l'application ne vivent ici.
 */

import {
  ARCHITECT_BACKLOG_LIMITS,
  readOptionalProposedText,
  readProposedList,
  readProposedTaskCommands,
  readProposedTaskCriteria,
  readProposedText,
  type ArchitectBacklogCommandProposal,
  type ArchitectBacklogCriterionProposal,
  type ArchitectBacklogRefusal,
} from "./backlog.js";
import { createStatusGuard } from "./statuses.js";
import { TASK_DEPENDENCY_LIMIT } from "./task-dependencies.js";
import { isTaskPriority, type TaskPriority } from "./tasks.js";

/**
 * Version du prompt de replanification.
 *
 * Distincte de `backlog/2`, et ce n'est pas un detail de numerotation : les deux
 * consignes decrivent des situations differentes, et melanger leurs versions
 * rendrait impossible de dire, six mois plus tard, avec quelles instructions une
 * proposition a ete produite.
 */
export const REPLAN_PROMPT_VERSION = "replan/1";

/** Version du contrat de proposition, transmise et persistee. */
export const REPLAN_SCHEMA_VERSION = 1;

/**
 * Ce qu'un tour dit du futur du projet.
 *
 * Deux valeurs, fermees. `UNCHANGED` est le cas courant : la grande majorite des
 * tours d'une conversation repondent a une question sans rien replanifier.
 */
export const REPLAN_MODE = {
  /** Ce tour ne touche pas au plan des taches futures. */
  UNCHANGED: "UNCHANGED",
  /** Ce tour propose un nouvel etat cible des taches futures. */
  PROPOSED: "PROPOSED",
} as const;

export type ReplanMode = (typeof REPLAN_MODE)[keyof typeof REPLAN_MODE];

export const REPLAN_MODES: readonly ReplanMode[] = Object.values(REPLAN_MODE);

export const isReplanMode = createStatusGuard(REPLAN_MODES);

/**
 * Etat d'une proposition de replanification.
 *
 * Le meme vocabulaire que les propositions de backlog et de mise a jour du
 * projet, et pour la meme raison : il n'existe **pas** de statut `STALE`. La
 * peremption se derive de la comparaison entre l'empreinte enregistree et celle
 * d'aujourd'hui. La persister obligerait a la recalculer a chaque changement du
 * projet, et laisserait des propositions marquees perimees alors que l'etat est
 * revenu a ce qu'il etait.
 */
export const REPLAN_PROPOSAL_STATUS = {
  PENDING: "PENDING",
  APPLIED: "APPLIED",
  DISMISSED: "DISMISSED",
} as const;

export type ReplanProposalStatus =
  (typeof REPLAN_PROPOSAL_STATUS)[keyof typeof REPLAN_PROPOSAL_STATUS];

export const REPLAN_PROPOSAL_STATUSES: readonly ReplanProposalStatus[] =
  Object.values(REPLAN_PROPOSAL_STATUS);

export const isReplanProposalStatus = createStatusGuard(REPLAN_PROPOSAL_STATUSES);

/**
 * Le sort d'un element du plan, tel que NOX le derive.
 *
 * Le fournisseur ne pose **jamais** ces etiquettes : il rend un etat cible, et
 * NOX les calcule en le comparant au plan courant. La derivation vit dans
 * `apps/web` — elle a besoin de la comparaison de contrats de TASK-024 — mais le
 * vocabulaire vit ici, comme toutes les listes fermees de NOX : il doit rester
 * importable par un composant client sans entrainer la couche de donnees dans
 * le bundle du navigateur.
 */
export const REPLAN_CHANGE = {
  /** Conserve tel quel. Peut malgre tout etre deplace ou voir ses dependances bouger. */
  KEEP: "KEEP",
  /** Au moins un champ du contrat change reellement. */
  UPDATE: "UPDATE",
  /** Tache future retiree du plan. */
  REMOVE: "REMOVE",
  /** Tache nouvelle, sans code tant qu'elle n'est pas appliquee. */
  ADD: "ADD",
} as const;

export type ReplanChange = (typeof REPLAN_CHANGE)[keyof typeof REPLAN_CHANGE];

export const REPLAN_CHANGES: readonly ReplanChange[] = Object.values(REPLAN_CHANGE);

export const isReplanChange = createStatusGuard(REPLAN_CHANGES);

/**
 * Champs du contrat qu'une comparaison sait nommer.
 *
 * Une liste fermee, et non « tout ce qui differe » : un ecran qui inventerait un
 * nom de champ afficherait une phrase que personne n'a ecrite.
 */
export const REPLAN_FIELD = {
  TITLE: "TITLE",
  PRIORITY: "PRIORITY",
  OBJECTIVE: "OBJECTIVE",
  CONTEXT: "CONTEXT",
  OUT_OF_SCOPE: "OUT_OF_SCOPE",
  CRITERIA: "CRITERIA",
  DOCUMENTS: "DOCUMENTS",
  COMMANDS: "COMMANDS",
} as const;

export type ReplanField = (typeof REPLAN_FIELD)[keyof typeof REPLAN_FIELD];

export const REPLAN_FIELDS: readonly ReplanField[] = Object.values(REPLAN_FIELD);

/**
 * Bornes de la replanification.
 *
 * Des constantes, jamais des variables d'environnement : elles decident de ce
 * qui quitte la machine et de ce qui sera facture.
 *
 * Les bornes d'un **element** ne figurent pas ici : ce sont exactement celles de
 * `backlog/2`, importees. Un element de cible est un contrat de tache, et NOX
 * n'en connait qu'un seul.
 */
export const REPLAN_LIMITS = {
  /** Justification destinee a l'utilisateur. Court, structure, jamais un essai. */
  rationale: 4 * 1024,
  /**
   * Taches **nouvelles** proposees en un replan.
   *
   * La meme borne que `backlog/2`, et pour la meme raison : au-dela, une liste
   * cesse d'etre relisible d'un seul tenant. Elle porte volontairement sur les
   * ajouts seuls — un projet peut avoir davantage de taches futures conservees,
   * et les compter dans la meme limite reviendrait a supprimer en silence des
   * taches existantes pour tenir dans le quota.
   */
  newTasks: { max: 20 },
  /**
   * Taille totale de la cible.
   *
   * Elle borne la reponse entiere, ajouts et conservations confondus. Un projet
   * qui porterait plus de soixante taches futures simultanees n'est pas un
   * projet qu'un replan peut relire d'un bloc — et NOX le dira plutot que de
   * tronquer.
   */
  targetTasks: { max: 60 },
  /** Identifiant temporaire d'une tache proposee. */
  tempId: 64,
  /** Dependances declarees par un element, avant resolution. */
  dependencies: { max: TASK_DEPENDENCY_LIMIT },
} as const;

/**
 * Budget de sortie accorde a un tour qui peut replanifier.
 *
 * Meme raisonnement que `backlog/2` : le pire cas absolu n'est pas couvert, et
 * c'est assume. Une reponse coupee produit du JSON invalide, le tour echoue
 * proprement, et rien n'est persiste comme proposition applicable. NOX prefere
 * un echec lisible a un plafond qu'il ne saurait ni justifier ni garantir.
 */
export const REPLAN_MAX_OUTPUT_TOKENS = 32_000;

/** Un element de l'etat cible, tel que le fournisseur le rend. */
export type ReplanTargetTask = {
  /**
   * Tache existante que cet element remplace, ou `null` pour une tache nouvelle.
   *
   * Exactement un des deux identifiants est renseigne. Le fournisseur peut
   * designer une tache existante par son identifiant ou par son code — les deux
   * lui sont montres, et exiger l'un des deux ne rendrait service a personne.
   * NOX resout et normalise vers l'identifiant.
   */
  existingTaskId: string | null;
  /** Identifiant temporaire d'une tache nouvelle, ou `null`. */
  tempId: string | null;
  title: string;
  priority: TaskPriority;
  objective: string;
  context: string | null;
  acceptanceCriteria: ArchitectBacklogCriterionProposal[];
  outOfScope: string[];
  documentReferences: string[];
  validationCommands: ArchitectBacklogCommandProposal[];
  /** Taches existantes attendues, resolues vers leur identifiant. */
  dependsOnTaskIds: string[];
  /** Taches nouvelles attendues, designees par leur identifiant temporaire. */
  dependsOnTempIds: string[];
};

/** Une proposition de replanification complete. */
export type ReplanProposal = {
  schemaVersion: typeof REPLAN_SCHEMA_VERSION;
  mode: typeof REPLAN_MODE.PROPOSED;
  /**
   * Pourquoi ce changement, en quelques lignes.
   *
   * Un artefact destine a l'utilisateur : quelle decision declenche le
   * changement, quelles taches futures sont touchees, pourquoi le travail
   * verrouille reste intact. Ce n'est **pas** du raisonnement interne — NOX n'en
   * demande pas, n'en recoit pas, et n'en persiste aucun.
   */
  rationale: string;
  futureTasks: ReplanTargetTask[];
};

/** Ce qu'un tour dit du futur : rien, ou une cible complete. */
export type ArchitectReplan = { mode: typeof REPLAN_MODE.UNCHANGED } | ReplanProposal;

/** Refus de lecture ; meme forme que partout ailleurs dans l'Architecte. */
export type ReplanRefusal = ArchitectBacklogRefusal;

export type ReplanResult =
  | { ok: true; replan: ArchitectReplan }
  | { ok: false; refusal: ReplanRefusal };

/**
 * Une tache existante, telle que la validation a besoin de la connaitre.
 *
 * Ni contrat, ni statut : ce module ne decide pas de ce qui est modifiable — il
 * recoit la reponse. La classification vit dans `replan-classification.ts`, qui
 * la derive des regles de TASK-024 et d'elles seules.
 */
export type ReplanSourceTask = {
  id: string;
  code: string;
  /** Dependances actuelles de cette tache, pour verifier le graphe cible. */
  dependsOnTaskIds: readonly string[];
};

/**
 * L'etat source contre lequel une proposition est validee.
 *
 * Les deux listes sont disjointes et couvrent toutes les taches du projet. Une
 * tache absente des deux est, par construction, une tache d'un autre projet ou
 * une invention du fournisseur — et les deux se refusent de la meme facon.
 */
export type ReplanSourceState = {
  /** Taches futures modifiables, au sens de TASK-024. */
  editable: readonly ReplanSourceTask[];
  /** Taches verrouillees : historiques, en cours, en file, ou d'amorcage. */
  locked: readonly ReplanSourceTask[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuse(field: string, message: string): { ok: false; refusal: ReplanRefusal } {
  return { ok: false, refusal: { field, message } };
}

/** Un identifiant temporaire lisible, et impossible a confondre avec un cuid. */
const TEMP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

type Lookup = {
  editableIds: Set<string>;
  lockedIds: Set<string>;
  /** Code vers identifiant, toutes taches du projet confondues. */
  idByCode: Map<string, string>;
  editableById: Map<string, ReplanSourceTask>;
};

function buildLookup(source: ReplanSourceState): Lookup {
  const idByCode = new Map<string, string>();
  for (const task of [...source.locked, ...source.editable]) {
    idByCode.set(task.code, task.id);
  }
  return {
    editableIds: new Set(source.editable.map((task) => task.id)),
    lockedIds: new Set(source.locked.map((task) => task.id)),
    idByCode,
    editableById: new Map(source.editable.map((task) => [task.id, task])),
  };
}

/**
 * Resout une reference vers une tache existante.
 *
 * Ordre deterministe : identifiant d'abord, code ensuite. Un code ne peut pas
 * ressembler a un identifiant — `TASK-004` contre un cuid — donc l'ordre ne
 * change rien en pratique ; l'ecrire evite d'avoir a s'en convaincre.
 */
function resolveExisting(reference: string, lookup: Lookup): string | null {
  if (lookup.editableIds.has(reference) || lookup.lockedIds.has(reference)) {
    return reference;
  }
  return lookup.idByCode.get(reference) ?? null;
}

/** Lit les dependances declarees, sans encore les resoudre. */
function readDependencyRefs(
  value: unknown,
  at: (field: string) => string,
): string[] | ReplanRefusal {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return { field: at("dependsOn"), message: "Les dependances proposees ne sont pas lisibles." };
  }
  if (value.length > REPLAN_LIMITS.dependencies.max) {
    return {
      field: at("dependsOn"),
      message: `Une tache ne peut pas attendre plus de ${String(REPLAN_LIMITS.dependencies.max)} autres taches.`,
    };
  }

  const refs: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      return {
        field: at("dependsOn"),
        message: "Une dependance proposee n'est pas une reference.",
      };
    }
    const trimmed = raw.trim();
    if (trimmed === "" || refs.includes(trimmed)) {
      continue;
    }
    refs.push(trimmed);
  }
  return refs;
}

/** Valide un element de cible, hors resolution des dependances. */
function readTargetTask(
  value: unknown,
  position: number,
  lookup: Lookup,
  availableDocuments: readonly string[],
):
  | { ok: true; task: ReplanTargetTask; dependencyRefs: string[] }
  | { ok: false; refusal: ReplanRefusal } {
  const at = (field: string): string => `replan.futureTasks.${String(position)}.${field}`;
  const label = `L'element ${String(position + 1)} du plan propose`;

  if (!isRecord(value)) {
    return refuse(`replan.futureTasks.${String(position)}`, `${label} n'est pas lisible.`);
  }

  const rawExisting: unknown = value["existingTaskId"];
  const rawTemp: unknown = value["tempId"];
  const existingRef =
    typeof rawExisting === "string" && rawExisting.trim() !== "" ? rawExisting.trim() : null;
  const tempRef = typeof rawTemp === "string" && rawTemp.trim() !== "" ? rawTemp.trim() : null;

  if (existingRef !== null && tempRef !== null) {
    return refuse(
      at("existingTaskId"),
      `${label} se declare a la fois comme une tache existante et comme une tache nouvelle.`,
    );
  }
  if (existingRef === null && tempRef === null) {
    return refuse(
      at("existingTaskId"),
      `${label} ne dit pas s'il remplace une tache existante ou s'il en cree une.`,
    );
  }

  let existingTaskId: string | null = null;
  let tempId: string | null = null;

  if (existingRef !== null) {
    const resolved = resolveExisting(existingRef, lookup);
    if (resolved === null) {
      // Un identifiant inconnu couvre trois cas d'un coup : une invention du
      // modele, une tache supprimee entre-temps, et une tache d'un autre projet.
      // Les trois se refusent, et aucun ne se convertit en creation implicite.
      return refuse(
        at("existingTaskId"),
        `${label} designe une tache qui n'existe pas dans ce projet.`,
      );
    }
    if (lookup.lockedIds.has(resolved)) {
      // Le refus le plus important du contrat. NOX ne « convertit » pas cette
      // edition en tache nouvelle : ce serait decider a la place du fournisseur
      // ce que la decision de l'utilisateur voulait dire.
      return refuse(
        at("existingTaskId"),
        `${label} tente de reecrire une tache verrouillee : le travail deja commence n'est jamais reecrit.`,
      );
    }
    existingTaskId = resolved;
  } else if (tempRef !== null) {
    if (tempRef.length > REPLAN_LIMITS.tempId || !TEMP_ID_PATTERN.test(tempRef)) {
      return refuse(at("tempId"), `${label} porte un identifiant temporaire inexploitable.`);
    }
    if (resolveExisting(tempRef, lookup) !== null) {
      return refuse(
        at("tempId"),
        `${label} reutilise comme identifiant temporaire celui d'une tache existante.`,
      );
    }
    tempId = tempRef;
  }

  const title = readProposedText(value["title"], ARCHITECT_BACKLOG_LIMITS.title);
  if (title === null) {
    return refuse(at("title"), `${label} n'a pas de titre exploitable.`);
  }

  const priority: unknown = value["priority"];
  if (!isTaskPriority(priority)) {
    return refuse(at("priority"), `${label} porte une priorite inconnue.`);
  }

  const objective = readProposedText(value["objective"], ARCHITECT_BACKLOG_LIMITS.objective);
  if (objective === null) {
    return refuse(at("objective"), `${label} n'a pas d'objectif exploitable.`);
  }

  const context = readOptionalProposedText(value["context"], ARCHITECT_BACKLOG_LIMITS.context);
  if (context === undefined) {
    return refuse(at("context"), `${label} porte un contexte trop long.`);
  }

  const outOfScope = readProposedList(value["outOfScope"], ARCHITECT_BACKLOG_LIMITS.outOfScope);
  if (outOfScope === null) {
    return refuse(at("outOfScope"), `${label} porte un hors perimetre inexploitable.`);
  }

  const documentReferences = readProposedList(
    value["documentReferences"],
    ARCHITECT_BACKLOG_LIMITS.documents,
  );
  if (documentReferences === null) {
    return refuse(at("documentReferences"), `${label} reference trop de documents.`);
  }
  for (const reference of documentReferences) {
    if (!availableDocuments.includes(reference)) {
      return refuse(
        at("documentReferences"),
        `${label} reference « ${reference} », qui ne fait pas partie des documents transmis.`,
      );
    }
  }

  // Criteres et commandes : exactement les validateurs de `backlog/2`, importes.
  const commands = readProposedTaskCommands(value["validationCommands"], label, at);
  if (!commands.ok) {
    return { ok: false, refusal: commands.refusal };
  }

  const criteria = readProposedTaskCriteria(
    value["acceptanceCriteria"],
    label,
    at,
    commands.commands,
  );
  if (!criteria.ok) {
    return { ok: false, refusal: criteria.refusal };
  }

  const refs = readDependencyRefs(value["dependsOn"], at);
  if (!Array.isArray(refs)) {
    return { ok: false, refusal: refs };
  }

  return {
    ok: true,
    dependencyRefs: refs,
    task: {
      existingTaskId,
      tempId,
      title,
      priority,
      objective,
      context,
      acceptanceCriteria: criteria.criteria,
      outOfScope,
      documentReferences,
      validationCommands: commands.commands,
      dependsOnTaskIds: [],
      dependsOnTempIds: [],
    },
  };
}

/** Cle d'un noeud du graphe cible : identifiant de tache, ou identifiant temporaire. */
function nodeKey(task: ReplanTargetTask): string {
  return task.existingTaskId ?? `temp:${task.tempId ?? ""}`;
}

/**
 * Verifie le graphe forme par la cible et les taches verrouillees.
 *
 * Trois choses, et elles se verifient ensemble parce qu'elles portent sur le
 * meme graphe :
 *
 * - **Aucune tache verrouillee laissee sans ce qu'elle attend.** Si une tache
 *   verrouillee attend une tache future que la cible supprime, la cible est
 *   refusee — jamais la tache verrouillee modifiee pour « resoudre » le
 *   probleme.
 * - **Aucun cycle.** Le fournisseur peut en produire un ; NOX ne lui fait pas
 *   confiance, et une revue humaine qui en introduirait un serait refusee de la
 *   meme facon.
 *
 * Exportee parce qu'elle sera rejouee a l'application : une cible validee il y a
 * vingt minutes ne prouve rien sur l'etat d'aujourd'hui.
 */
export function checkReplanTargetGraph(
  futureTasks: readonly ReplanTargetTask[],
  source: ReplanSourceState,
): ReplanRefusal | null {
  const lookup = buildLookup(source);
  const keptExisting = new Set<string>();

  for (const task of futureTasks) {
    if (task.existingTaskId !== null) {
      keptExisting.add(task.existingTaskId);
    }
  }

  // Une tache verrouillee qui attend une tache future supprimee resterait
  // bloquee pour toujours, sans que rien ne le dise.
  for (const locked of source.locked) {
    for (const dependency of locked.dependsOnTaskIds) {
      if (lookup.editableIds.has(dependency) && !keptExisting.has(dependency)) {
        const code = lookup.editableById.get(dependency)?.code ?? dependency;
        return {
          field: "replan.futureTasks",
          message: `Le plan propose supprime ${code}, que ${locked.code} attend encore.`,
        };
      }
    }
  }

  // Graphe oriente : une arete va de la tache qui attend vers celle qu'elle
  // attend. Les taches verrouillees y entrent avec leurs dependances actuelles.
  const edges = new Map<string, string[]>();
  for (const locked of source.locked) {
    edges.set(
      locked.id,
      locked.dependsOnTaskIds.filter((id) => keptExisting.has(id) || lookup.lockedIds.has(id)),
    );
  }
  for (const task of futureTasks) {
    const targets: string[] = [...task.dependsOnTaskIds];
    for (const temp of task.dependsOnTempIds) {
      targets.push(`temp:${temp}`);
    }
    edges.set(nodeKey(task), targets);
  }

  const VISITING = 1;
  const DONE = 2;
  const marks = new Map<string, number>();

  const visit = (node: string): boolean => {
    const mark = marks.get(node);
    if (mark === DONE) {
      return false;
    }
    if (mark === VISITING) {
      return true;
    }
    marks.set(node, VISITING);
    for (const next of edges.get(node) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    marks.set(node, DONE);
    return false;
  };

  for (const node of edges.keys()) {
    if (visit(node)) {
      return {
        field: "replan.futureTasks",
        message:
          "Le plan propose contient un cycle de dependances : aucune tache ne pourrait partir.",
      };
    }
  }

  return null;
}

/**
 * Lit ce qu'un tour dit du futur du projet.
 *
 * Le Structured Output garantit une **forme**, jamais un invariant metier : tout
 * est revalide ici, contre l'etat source relu en base par le serveur.
 */
export function readArchitectReplan(
  value: unknown,
  source: ReplanSourceState,
  availableDocuments: readonly string[],
): ReplanResult {
  if (value === null || value === undefined) {
    return { ok: true, replan: { mode: REPLAN_MODE.UNCHANGED } };
  }
  if (!isRecord(value)) {
    return refuse("replan", "La replanification rendue par l'architecte n'est pas lisible.");
  }

  const mode: unknown = value["mode"];
  if (!isReplanMode(mode)) {
    return refuse("replan.mode", "L'architecte a rendu un mode de replanification inconnu.");
  }
  if (mode === REPLAN_MODE.UNCHANGED) {
    return { ok: true, replan: { mode: REPLAN_MODE.UNCHANGED } };
  }

  const rationale = readProposedText(value["rationale"], REPLAN_LIMITS.rationale);
  if (rationale === null) {
    return refuse(
      "replan.rationale",
      "L'architecte propose un nouveau plan sans dire ce qui le motive.",
    );
  }

  const rawTasks: unknown = value["futureTasks"];
  if (!Array.isArray(rawTasks)) {
    return refuse("replan.futureTasks", "Le plan propose n'est pas lisible.");
  }
  if (rawTasks.length > REPLAN_LIMITS.targetTasks.max) {
    return refuse(
      "replan.futureTasks",
      `Le plan propose porte plus de ${String(REPLAN_LIMITS.targetTasks.max)} taches futures.`,
    );
  }

  const lookup = buildLookup(source);
  const futureTasks: ReplanTargetTask[] = [];
  const dependencyRefs: string[][] = [];
  const seenExisting = new Set<string>();
  const seenTemp = new Set<string>();

  for (const [position, raw] of rawTasks.entries()) {
    const read = readTargetTask(raw, position, lookup, availableDocuments);
    if (!read.ok) {
      return read;
    }

    const { task } = read;
    if (task.existingTaskId !== null) {
      if (seenExisting.has(task.existingTaskId)) {
        return refuse(
          `replan.futureTasks.${String(position)}.existingTaskId`,
          "Le plan propose designe deux fois la meme tache existante.",
        );
      }
      seenExisting.add(task.existingTaskId);
    }
    if (task.tempId !== null) {
      if (seenTemp.has(task.tempId)) {
        return refuse(
          `replan.futureTasks.${String(position)}.tempId`,
          "Le plan propose reutilise un identifiant temporaire.",
        );
      }
      seenTemp.add(task.tempId);
    }

    futureTasks.push(task);
    dependencyRefs.push(read.dependencyRefs);
  }

  if (seenTemp.size > REPLAN_LIMITS.newTasks.max) {
    return refuse(
      "replan.futureTasks",
      `Le plan propose cree plus de ${String(REPLAN_LIMITS.newTasks.max)} taches nouvelles.`,
    );
  }

  // Resolution des dependances, une fois tous les identifiants temporaires
  // connus : une tache peut attendre une tache nouvelle declaree plus bas.
  for (const [position, task] of futureTasks.entries()) {
    const at = `replan.futureTasks.${String(position)}.dependsOn`;
    const self = nodeKey(task);

    for (const reference of dependencyRefs[position] ?? []) {
      if (seenTemp.has(reference)) {
        if (`temp:${reference}` === self) {
          return refuse(at, "Une tache proposee s'attend elle-meme.");
        }
        task.dependsOnTempIds.push(reference);
        continue;
      }

      const resolved = resolveExisting(reference, lookup);
      if (resolved === null) {
        return refuse(
          at,
          `Le plan propose fait attendre une tache qui n'existe pas dans ce projet : « ${reference} ».`,
        );
      }
      if (resolved === self) {
        return refuse(at, "Une tache proposee s'attend elle-meme.");
      }
      // Une tache editable supprimee de la cible ne peut plus etre attendue :
      // elle n'existera plus.
      if (lookup.editableIds.has(resolved) && !seenExisting.has(resolved)) {
        const code = lookup.editableById.get(resolved)?.code ?? resolved;
        return refuse(at, `Le plan propose fait attendre ${code}, qu'il supprime par ailleurs.`);
      }
      task.dependsOnTaskIds.push(resolved);
    }
  }

  const graph = checkReplanTargetGraph(futureTasks, source);
  if (graph !== null) {
    return { ok: false, refusal: graph };
  }

  return {
    ok: true,
    replan: {
      schemaVersion: REPLAN_SCHEMA_VERSION,
      mode: REPLAN_MODE.PROPOSED,
      rationale,
      futureTasks,
    },
  };
}

/**
 * Reconnait une proposition persistee.
 *
 * Une proposition enregistree a deja passe toutes les validations ; ce qui est
 * verifie ici est sa **forme**, pas sa coherence avec l'etat courant. Cette
 * coherence-la se rejoue a l'application, contre l'etat d'alors.
 */
export function isReplanProposal(value: unknown): value is ReplanProposal {
  return (
    isRecord(value) &&
    value["schemaVersion"] === REPLAN_SCHEMA_VERSION &&
    value["mode"] === REPLAN_MODE.PROPOSED &&
    typeof value["rationale"] === "string" &&
    Array.isArray(value["futureTasks"])
  );
}

/**
 * Schema JSON strict de la section `replan` d'un tour.
 *
 * Aucune borne de taille n'y figure : le sous-ensemble de JSON Schema accepte en
 * mode strict ignore `maxItems`, `minItems` et `maxLength`, et les declarer
 * ferait echouer la requete entiere. Les bornes vivent donc dans les
 * instructions du prompt et dans `readArchitectReplan` — c'est exactement la
 * raison pour laquelle un schema strict ne dispense jamais d'une validation
 * metier.
 */
export function buildReplanSchema(): Record<string, unknown> {
  const strings = (description: string): Record<string, unknown> => ({
    type: "array",
    description,
    items: { type: "string" },
  });

  const criterion = {
    type: "object",
    additionalProperties: false,
    required: ["text", "verificationMode", "humanInstructions", "validationCommandIndexes"],
    properties: {
      text: { type: "string", description: "Critere verifiable." },
      verificationMode: {
        type: "string",
        enum: ["AUTOMATED", "HUMAN"],
        description:
          "AUTOMATED : NOX le prouve en executant des commandes. HUMAN : un humain doit regarder.",
      },
      humanInstructions: {
        type: ["string", "null"],
        description: "Ce que l'humain doit verifier. Obligatoire si HUMAN, null sinon.",
      },
      validationCommandIndexes: {
        type: "array",
        description:
          "Positions, dans validationCommands du meme element, des commandes qui prouvent ce critere. Vide si HUMAN.",
        items: { type: "integer" },
      },
    },
  };

  const command = {
    type: "object",
    additionalProperties: false,
    required: ["command", "executionMode"],
    properties: {
      command: { type: "string", description: "Commande simple, sans operateur shell." },
      executionMode: {
        type: "string",
        enum: ["AUTONOMOUS", "AGENT_ONLY"],
        description:
          "AUTONOMOUS : NOX l'execute lui-meme apres le travail. AGENT_ONLY : seul l'agent peut la lancer.",
      },
    },
  };

  const task = {
    type: "object",
    additionalProperties: false,
    required: [
      "existingTaskId",
      "tempId",
      "title",
      "priority",
      "objective",
      "context",
      "acceptanceCriteria",
      "outOfScope",
      "documentReferences",
      "validationCommands",
      "dependsOn",
    ],
    properties: {
      existingTaskId: {
        type: ["string", "null"],
        description:
          "Identifiant ou code d'une tache future modifiable a conserver. null pour une tache nouvelle. Jamais une tache verrouillee.",
      },
      tempId: {
        type: ["string", "null"],
        description:
          "Identifiant temporaire d'une tache nouvelle, stable dans cette reponse. null pour une tache existante.",
      },
      title: { type: "string", description: "Titre court de la tache." },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      objective: { type: "string", description: "Resultat attendu." },
      context: { type: ["string", "null"], description: "Pourquoi la tache existe." },
      acceptanceCriteria: { type: "array", items: criterion },
      outOfScope: strings("Ce que l'implementeur ne doit pas faire."),
      documentReferences: strings("Chemins issus de la liste fermee fournie."),
      validationCommands: { type: "array", items: command },
      dependsOn: strings(
        "Taches attendues : identifiant ou code d'une tache existante, ou tempId d'une tache nouvelle de cette meme reponse.",
      ),
    },
  };

  return {
    type: ["object", "null"],
    description:
      "Nouvel etat cible complet des taches futures. null ou mode UNCHANGED lorsque ce tour ne replanifie rien. Ne contient jamais de tache verrouillee.",
    additionalProperties: false,
    required: ["mode", "rationale", "futureTasks"],
    properties: {
      mode: {
        type: "string",
        enum: [...REPLAN_MODES],
        description:
          "UNCHANGED laisse le plan des taches futures tel quel ; PROPOSED le remplace entierement par futureTasks.",
      },
      rationale: {
        type: ["string", "null"],
        description:
          "Quelle decision declenche ce changement, quelles taches futures sont touchees, pourquoi le travail verrouille reste intact. null lorsque mode vaut UNCHANGED.",
      },
      futureTasks: {
        type: "array",
        description:
          "Etat cible COMPLET des taches futures : celles a conserver telles quelles, celles a modifier, celles a creer. Une tache absente est supprimee. L'ordre du tableau est l'ordre de planification propose.",
        items: task,
      },
    },
  };
}
