/**
 * Contrat du backlog de V1.
 *
 * ## Ce que cet objet est
 *
 * Un **backlog** est la liste ordonnee des increments d'implementation encore
 * necessaires pour atteindre le Living V1 Plan valide. Ce n'est ni le plan
 * lui-meme, ni un graphe de dependances :
 *
 * - Le plan reste au-dessus. Une etape de plan decrit une **capacite atteinte**
 *   — « le planning hebdomadaire est utilisable » — quand un element de backlog
 *   decrit un **travail borne** qui y mene. Un jalon peut demander plusieurs
 *   taches, et rien n'impose la correspondance un pour un.
 * - L'ordre exprime une **sequence recommandee**, rien de plus. Il n'existe ni
 *   `dependsOn`, ni `blockedBy`, ni DAG : ces notions arriveront quand elles
 *   auront un usage, et les inventer maintenant reviendrait a demander au modele
 *   de produire des liens que personne ne saurait verifier.
 *
 * ## Le travail restant, pas tout le travail
 *
 * Une proposition decrit ce qu'il reste a faire **compte tenu des taches qui
 * existent deja**. C'est ce qui permet de generer un backlog sur un projet
 * commence : le fournisseur recoit l'inventaire des taches, et n'a aucune raison
 * de reproposer ce qui est deja specifie, en cours, ou termine.
 *
 * ## Le contrat de tache n'est pas redefini
 *
 * Un element de backlog porte exactement les champs d'une proposition de tache
 * — titre, priorite, objectif, contexte, criteres, hors perimetre, documents,
 * commandes — et les memes gardes : `checkValidationCommand` pour les commandes,
 * la liste fermee du repository pour les documents, `readTaskSubmission` a la
 * creation. Un second contrat presque identique aurait diverge au premier ajout
 * de champ.
 *
 * ## Un backlog est une unite
 *
 * Si un seul element est invalide, **toute** la generation echoue et rien n'est
 * persiste comme proposition applicable. Conserver huit taches sur neuf
 * livrerait un backlog dont personne ne saurait dire ce qui manque — et le
 * decoupage propose ne tient que pris ensemble.
 */

import { checkValidationCommand } from "./claude-commands.js";
import { TASK_DEPENDENCY_LIMIT } from "./task-dependencies.js";
import { createStatusGuard } from "./statuses.js";
import { TASK_PRIORITIES, isTaskPriority, type TaskPriority } from "./tasks.js";
import {
  COMMAND_EXECUTION_MODE,
  COMMAND_EXECUTION_MODES,
  DEFAULT_HUMAN_INSTRUCTIONS,
  MAX_AUTONOMOUS_COMMANDS_PER_RUN,
  MAX_HUMAN_INSTRUCTIONS_LENGTH,
  VERIFICATION_MODE,
  VERIFICATION_MODES,
  checkAutonomousCommand,
  isCommandExecutionMode,
  isVerificationMode,
  type CommandExecutionMode,
  type VerificationMode,
} from "./verification.js";

/** Version du contrat de proposition de backlog, transmise et persistee. */
export const ARCHITECT_BACKLOG_SCHEMA_VERSION = 1;

/** Nom du format transmis au fournisseur ; doit rester stable. */
export const ARCHITECT_BACKLOG_SCHEMA_NAME = "nox_v1_backlog";

/** Prefixe du code affiche d'une generation de backlog. */
export const BACKLOG_CODE_PREFIX = "BACKLOG-";

/**
 * Derive le code affiche d'une generation de backlog.
 *
 * Meme regle que les taches et la memoire : le code n'est pas stocke, il se
 * recalcule a partir d'un numero immuable. Deux representations d'une meme
 * verite finissent toujours par diverger.
 */
export function formatBacklogCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Numero de backlog invalide : ${String(sequence)}`);
  }
  return `${BACKLOG_CODE_PREFIX}${String(sequence).padStart(3, "0")}`;
}

/**
 * Bornes du backlog.
 *
 * Des constantes, jamais des variables d'environnement : elles decident de ce
 * qui quitte la machine et de ce qui sera facture.
 *
 * ## Pourquoi elles sont plus strictes que `ARCHITECT_LIMITS`
 *
 * Une conversation propose **une** tache, et peut se permettre un objectif de
 * cinq mille caracteres. Un backlog en propose jusqu'a vingt d'un coup : les
 * memes bornes rendraient la reponse maximale ingerable, a l'ecran comme dans le
 * budget de sortie.
 *
 * Ce resserrement n'est pas qu'arithmetique, il porte une intention. Un element
 * de backlog est le **plus petit increment coherent** ; s'il lui faut trois
 * pages d'objectif, ce n'est pas un increment, c'est un projet. La borne dit la
 * meme chose que le prompt, et elle le dit de facon executable.
 */
export const ARCHITECT_BACKLOG_LIMITS = {
  /**
   * Nombre d'elements d'une proposition.
   *
   * Vingt au maximum. Le modele choisit le nombre reellement necessaire : NOX
   * n'en impose ni cinq, ni dix, parce qu'un projet de deux semaines et un
   * projet de six mois n'ont pas le meme backlog. Vingt est le point ou une
   * liste cesse d'etre relisible d'un seul tenant — et un backlog qu'on ne relit
   * pas ne protege plus de rien.
   *
   * Un minimum de un : une proposition vide n'est pas un backlog, c'est une
   * absence de reponse.
   */
  tasks: { min: 1, max: 20 },
  /** Resume de couverture destine a l'utilisateur. */
  message: 4 * 1024,
  title: 160,
  objective: 1_200,
  context: 2_000,
  criteria: { min: 1, max: 8, length: 300 },
  outOfScope: { max: 6, length: 300 },
  documents: { max: 6, length: 500 },
  commands: { max: 6, length: 200 },
  /**
   * Dependances d'un element.
   *
   * La meme borne que partout ailleurs dans NOX — `TASK_DEPENDENCY_LIMIT` —
   * plutot qu'une valeur propre au backlog : ce que le planificateur propose et
   * ce qu'un humain pose a la main finissent dans la meme table, et deux bornes
   * pour une seule contrainte se contrediraient le jour ou l'une bougerait.
   */
  dependencies: { max: TASK_DEPENDENCY_LIMIT },
} as const;

/**
 * Budget de sortie accorde a un appel de planification.
 *
 * ## D'ou vient le chiffre
 *
 * Un element au maximum de ses bornes occupe :
 *
 * ```text
 * 160 (titre) + 1 200 (objectif) + 2 000 (contexte)
 * + 8 x 300 (criteres) + 6 x 300 (hors perimetre)
 * + 6 x 500 (documents) + 6 x 200 (commandes)   = 11 360 caracteres
 * ```
 *
 * Vingt elements et un message de 4 Kio font environ 231 000 caracteres, et
 * l'enveloppe JSON ajoute environ un quart. On approche donc 72 000 jetons pour
 * le pire cas absolu.
 *
 * ## Et pourquoi il ne le couvre pas
 *
 * Trente-deux mille jetons couvrent tres largement un backlog reel — vingt
 * elements d'environ 1,5 Kio, ce que le prompt demande explicitement — avec un
 * facteur trois de marge. Reserver 80 000 jetons pour un cas que personne ne
 * produira ferait dependre NOX d'un plafond que tous les modeles n'offrent pas,
 * pour ne rien gagner.
 *
 * La limite est donc assumee, et elle est **sure** : une reponse coupee produit
 * du JSON invalide, la generation echoue proprement, et rien n'est persiste
 * comme proposition applicable. NOX prefere un echec lisible a un budget qu'il
 * ne saurait ni justifier ni garantir.
 */
export const ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS = 32_000;

/**
 * Etat d'une generation de backlog.
 *
 * `REFUSED` et `FAILED` restent distincts pour la meme raison que dans
 * l'Architecte conversationnel : le premier dit que le modele a refuse de
 * repondre, le second qu'aucune reponse exploitable n'est arrivee. Les
 * confondre priverait l'utilisateur de la seule information qui change ce qu'il
 * doit faire ensuite.
 */
export const ARCHITECT_BACKLOG_GENERATION_STATUS = {
  RUNNING: "RUNNING",
  READY: "READY",
  REFUSED: "REFUSED",
  FAILED: "FAILED",
} as const;

export type ArchitectBacklogGenerationStatus =
  (typeof ARCHITECT_BACKLOG_GENERATION_STATUS)[keyof typeof ARCHITECT_BACKLOG_GENERATION_STATUS];

export const ARCHITECT_BACKLOG_GENERATION_STATUSES: readonly ArchitectBacklogGenerationStatus[] =
  Object.values(ARCHITECT_BACKLOG_GENERATION_STATUS);

export const isArchitectBacklogGenerationStatus = createStatusGuard(
  ARCHITECT_BACKLOG_GENERATION_STATUSES,
);

/**
 * Etat d'une proposition de backlog.
 *
 * Trois etats, et une seule transition possible depuis `PENDING`. Il n'existe
 * volontairement **pas** de statut `STALE` : la peremption se derive de la
 * comparaison entre l'empreinte de planification enregistree et celle
 * d'aujourd'hui. La persister obligerait a la recalculer a chaque changement du
 * projet, et laisserait des propositions marquees perimees alors que l'etat est
 * revenu a ce qu'il etait.
 */
export const ARCHITECT_BACKLOG_PROPOSAL_STATUS = {
  PENDING: "PENDING",
  APPLIED: "APPLIED",
  DISMISSED: "DISMISSED",
} as const;

export type ArchitectBacklogProposalStatus =
  (typeof ARCHITECT_BACKLOG_PROPOSAL_STATUS)[keyof typeof ARCHITECT_BACKLOG_PROPOSAL_STATUS];

export const ARCHITECT_BACKLOG_PROPOSAL_STATUSES: readonly ArchitectBacklogProposalStatus[] =
  Object.values(ARCHITECT_BACKLOG_PROPOSAL_STATUS);

export const isArchitectBacklogProposalStatus = createStatusGuard(
  ARCHITECT_BACKLOG_PROPOSAL_STATUSES,
);

/**
 * Un element de backlog, tel que le fournisseur le rend.
 *
 * Sa **position** est celle du tableau qui le contient : aucun champ `order` n'a
 * ete ajoute. Un index et un champ d'ordre finiraient par se contredire, et le
 * jour ou ils se contrediraient, personne ne saurait lequel fait foi.
 */
export type ArchitectBacklogTaskProposal = {
  title: string;
  priority: TaskPriority;
  objective: string;
  context: string | null;
  acceptanceCriteria: string[];
  outOfScope: string[];
  documentReferences: string[];
  validationCommands: string[];
};

/**
 * Une proposition de backlog complete.
 *
 * `message` est un artefact destine a l'utilisateur : il resume ce que le
 * decoupage couvre et ce qu'il laisse de cote. Ce n'est **pas** du raisonnement
 * interne — NOX n'en demande pas, n'en recoit pas, et n'en persiste aucun — et
 * ce n'est pas non plus une autorite : la liste des taches est le coeur de la
 * reponse, le message l'accompagne.
 */
export type ArchitectBacklogProposal = {
  schemaVersion: typeof ARCHITECT_BACKLOG_SCHEMA_VERSION;
  message: string;
  tasks: ArchitectBacklogTaskProposal[];
};

export type ArchitectBacklogRefusal = {
  /** Champ concerne, prefixe de l'index quand il s'agit d'un element. */
  field: string;
  /** Phrase francaise, deja destinee a l'utilisateur. */
  message: string;
};

export type ArchitectBacklogResult =
  | { ok: true; proposal: ArchitectBacklogProposal }
  | { ok: false; refusal: ArchitectBacklogRefusal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuse(field: string, message: string): ArchitectBacklogResult {
  return { ok: false, refusal: { field, message } };
}

/**
 * Lit un texte obligatoire, normalise et borne.
 *
 * Ces lecteurs et les deux validateurs de contrat plus bas sont **exportes**
 * depuis TASK-032 : `replan/1` propose exactement le meme contrat de tache que
 * `backlog/2`, avec les memes bornes et les memes gardes. Deux implementations
 * presque identiques auraient diverge au premier ajout de champ — et celle qui
 * aurait tort serait celle qui laisse passer.
 */
export function readProposedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\r\n?/gu, "\n").trim();
  if (trimmed === "" || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

/** Lit un texte facultatif. `null` et `""` disent la meme chose : rien. */
export function readOptionalProposedText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.replace(/\r\n?/gu, "\n").trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed.length > max ? undefined : trimmed;
}

/**
 * Lit une liste de chaines courtes.
 *
 * Les entrees vides disparaissent, les doublons aussi : un modele repete parfois
 * un critere sous deux formulations identiques, et une liste qui dit deux fois
 * la meme chose ne dit rien de plus.
 */
export function readProposedList(value: unknown, limits: { max: number; length: number }): string[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const entries: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      return null;
    }
    const trimmed = raw.replace(/\s+/gu, " ").trim();
    if (trimmed === "" || entries.includes(trimmed)) {
      continue;
    }
    if (trimmed.length > limits.length) {
      return null;
    }
    entries.push(trimmed);
  }

  return entries.length > limits.max ? null : entries;
}

/**
 * Valide un element de backlog.
 *
 * `position` sert uniquement a nommer le champ fautif : « la tache 3 propose une
 * commande interdite » est actionnable, « une tache propose une commande
 * interdite » ne l'est pas.
 */
function readBacklogTask(
  value: unknown,
  position: number,
  availableDocuments: readonly string[],
): { ok: true; task: ArchitectBacklogTaskProposal } | { ok: false; refusal: ArchitectBacklogRefusal } {
  const at = (field: string): string => `tasks.${String(position)}.${field}`;
  const label = `Tache ${String(position + 1)}`;

  if (!isRecord(value)) {
    return {
      ok: false,
      refusal: { field: `tasks.${String(position)}`, message: `${label} n'est pas lisible.` },
    };
  }

  const title = readProposedText(value["title"], ARCHITECT_BACKLOG_LIMITS.title);
  if (title === null) {
    return { ok: false, refusal: { field: at("title"), message: `${label} n'a pas de titre exploitable.` } };
  }

  const priority: unknown = value["priority"];
  if (!isTaskPriority(priority)) {
    return {
      ok: false,
      refusal: { field: at("priority"), message: `${label} porte une priorite inconnue.` },
    };
  }

  const objective = readProposedText(value["objective"], ARCHITECT_BACKLOG_LIMITS.objective);
  if (objective === null) {
    return {
      ok: false,
      refusal: { field: at("objective"), message: `${label} n'a pas d'objectif exploitable.` },
    };
  }

  const context = readOptionalProposedText(value["context"], ARCHITECT_BACKLOG_LIMITS.context);
  if (context === undefined) {
    return { ok: false, refusal: { field: at("context"), message: `Le contexte de ${label} est trop long.` } };
  }

  const acceptanceCriteria = readProposedList(
    value["acceptanceCriteria"],
    ARCHITECT_BACKLOG_LIMITS.criteria,
  );
  if (acceptanceCriteria === null) {
    return {
      ok: false,
      refusal: {
        field: at("acceptanceCriteria"),
        message: `Les criteres de ${label} sont trop nombreux ou trop longs (maximum ${String(ARCHITECT_BACKLOG_LIMITS.criteria.max)}).`,
      },
    };
  }
  if (acceptanceCriteria.length < ARCHITECT_BACKLOG_LIMITS.criteria.min) {
    return {
      ok: false,
      refusal: {
        field: at("acceptanceCriteria"),
        message: `${label} ne porte aucun critere d'acceptation : sans lui, personne ne peut dire qu'elle est terminee.`,
      },
    };
  }

  const outOfScope = readProposedList(value["outOfScope"], ARCHITECT_BACKLOG_LIMITS.outOfScope);
  if (outOfScope === null) {
    return {
      ok: false,
      refusal: { field: at("outOfScope"), message: `Le hors perimetre de ${label} est trop long.` },
    };
  }

  const documentReferences = readProposedList(
    value["documentReferences"],
    ARCHITECT_BACKLOG_LIMITS.documents,
  );
  if (documentReferences === null) {
    return {
      ok: false,
      refusal: {
        field: at("documentReferences"),
        message: `Les documents de ${label} sont trop nombreux ou trop longs.`,
      },
    };
  }
  for (const reference of documentReferences) {
    if (!availableDocuments.includes(reference)) {
      return {
        ok: false,
        refusal: {
          field: at("documentReferences"),
          message: `${label} reference « ${reference} », qui ne fait pas partie des documents du repository : l'architecte ne peut pas en inventer.`,
        },
      };
    }
  }

  const validationCommands = readProposedList(
    value["validationCommands"],
    ARCHITECT_BACKLOG_LIMITS.commands,
  );
  if (validationCommands === null) {
    return {
      ok: false,
      refusal: {
        field: at("validationCommands"),
        message: `Les commandes de ${label} sont trop nombreuses ou trop longues.`,
      },
    };
  }
  for (const command of validationCommands) {
    // Exactement la garde de TASK-008, sans adaptation : une commande proposee
    // dans un backlog passe le meme controle qu'une commande saisie a la main.
    const problem = checkValidationCommand(command);
    if (problem !== null) {
      return {
        ok: false,
        refusal: {
          field: at("validationCommands"),
          message: `${label} propose « ${command} », qui ne peut pas etre autorisee : ${problem}`,
        },
      };
    }
  }

  return {
    ok: true,
    task: {
      title,
      priority,
      objective,
      context,
      acceptanceCriteria,
      outOfScope,
      documentReferences,
      validationCommands,
    },
  };
}

/**
 * Valide une proposition de backlog rendue par le fournisseur.
 *
 * Ne fait **aucune** confiance au Structured Output : celui-ci garantit une
 * forme, pas des invariants NOX. Vingt-cinq taches, une reference documentaire
 * inventee, une commande avec un tuyau : chacune de ces reponses respecte le
 * schema tout en etant inacceptable.
 *
 * Le premier probleme rencontre arrete la lecture, et **toute** la proposition
 * est refusee. Un backlog est une unite : garder ses elements valides
 * laisserait un decoupage dont personne ne pourrait dire ce qui manque.
 */
export function readArchitectBacklogProposal(
  value: unknown,
  availableDocuments: readonly string[],
): ArchitectBacklogResult {
  if (!isRecord(value)) {
    return refuse("backlog", "La reponse de planification n'est pas une structure lisible.");
  }

  if (value["schemaVersion"] !== ARCHITECT_BACKLOG_SCHEMA_VERSION) {
    return refuse(
      "schemaVersion",
      "La reponse de planification ne suit pas la version de contrat attendue.",
    );
  }

  const message = readProposedText(value["message"], ARCHITECT_BACKLOG_LIMITS.message);
  if (message === null) {
    return refuse("message", "La reponse de planification ne porte aucun resume exploitable.");
  }

  const rawTasks: unknown = value["tasks"];
  if (!Array.isArray(rawTasks)) {
    return refuse("tasks", "La reponse de planification ne porte aucune liste de taches.");
  }
  if (rawTasks.length < ARCHITECT_BACKLOG_LIMITS.tasks.min) {
    return refuse("tasks", "La reponse de planification ne propose aucune tache.");
  }
  if (rawTasks.length > ARCHITECT_BACKLOG_LIMITS.tasks.max) {
    return refuse(
      "tasks",
      `La reponse de planification propose ${String(rawTasks.length)} taches, au-dela du maximum de ${String(ARCHITECT_BACKLOG_LIMITS.tasks.max)}.`,
    );
  }

  const tasks: ArchitectBacklogTaskProposal[] = [];
  for (const [position, raw] of rawTasks.entries()) {
    const read = readBacklogTask(raw, position, availableDocuments);
    if (!read.ok) {
      return { ok: false, refusal: read.refusal };
    }
    tasks.push(read.task);
  }

  return {
    ok: true,
    proposal: { schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION, message, tasks },
  };
}

function shortStrings(description: string): Record<string, unknown> {
  return { type: "array", description, items: { type: "string" } };
}

/**
 * Schema JSON strict transmis au fournisseur.
 *
 * Construit ici, et nulle part ailleurs : il decrit exactement ce que
 * `readArchitectBacklogProposal` accepte.
 *
 * **Aucune borne de taille n'y figure.** Le sous-ensemble de JSON Schema accepte
 * en mode strict ignore `maxItems`, `minItems`, `maxLength` et `pattern` : les
 * declarer ferait echouer la requete entiere. Les bornes vivent donc a deux
 * endroits qui, eux, existent : les instructions du prompt les annoncent, et la
 * validation NOX les fait respecter.
 */
export function buildArchitectBacklogSchema(): Record<string, unknown> {
  const taskFields: Record<string, unknown> = {
    title: { type: "string", description: "Titre court de la tache, sans code." },
    priority: { type: "string", enum: [...TASK_PRIORITIES] },
    objective: { type: "string", description: "Resultat observable attendu." },
    context: { type: ["string", "null"], description: "Pourquoi cette tache existe." },
    acceptanceCriteria: shortStrings(
      `Criteres verifiables, de ${String(ARCHITECT_BACKLOG_LIMITS.criteria.min)} a ${String(ARCHITECT_BACKLOG_LIMITS.criteria.max)}.`,
    ),
    outOfScope: shortStrings("Ce que l'implementeur ne doit pas faire dans cette tache."),
    documentReferences: shortStrings("Chemins issus de la liste fermee fournie."),
    validationCommands: shortStrings("Commandes simples, sans operateur shell."),
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "message", "tasks"],
    properties: {
      schemaVersion: { type: "integer", enum: [ARCHITECT_BACKLOG_SCHEMA_VERSION] },
      message: {
        type: "string",
        description:
          "Resume destine a l'utilisateur : ce que ce decoupage couvre du plan de V1, et ce qu'il laisse de cote. Jamais de raisonnement interne.",
      },
      tasks: {
        type: "array",
        description: `Backlog ordonne, de ${String(ARCHITECT_BACKLOG_LIMITS.tasks.min)} a ${String(ARCHITECT_BACKLOG_LIMITS.tasks.max)} elements. L'ordre du tableau est l'ordre recommande.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: Object.keys(taskFields),
          properties: taskFields,
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Contrat `backlog/2` : le plan de verification entre dans la proposition
// ---------------------------------------------------------------------------

/**
 * Version 2 du contrat de proposition de backlog.
 *
 * ## Pourquoi une version, plutot qu'un champ de plus
 *
 * Parce que les propositions deja enregistrees ne changent pas. Un
 * `providerJson` ecrit en version 1 raconte ce que le fournisseur avait rendu ce
 * jour-la ; le relire avec les regles d'aujourd'hui le rendrait faux. La version
 * est donc portee **dans** le document, et c'est elle qui decide comment le
 * lire.
 *
 * ## Ce que la version 2 ajoute
 *
 * Chaque critere declare comment il se verifie, chaque commande declare ce que
 * NOX a le droit d'en faire, et un critere automatise **nomme** les commandes
 * qui le prouvent. C'est exactement le plan de verification de TASK-027, propose
 * au moment ou la tache est ecrite plutot que devine apres son execution.
 */
export const ARCHITECT_BACKLOG_SCHEMA_VERSION_2 = 2;

/** Nom du format v2 transmis au fournisseur ; doit rester stable. */
export const ARCHITECT_BACKLOG_SCHEMA_NAME_2 = "nox_v1_backlog_v2";

/**
 * Un critere d'acceptation propose, avec sa classification.
 *
 * `validationCommandIndexes` designe des positions dans `validationCommands` du
 * meme element. Des indices, et pas des chaines : deux commandes identiques
 * resteraient indistinguables, et une commande corrigee casserait le lien.
 */
export type ArchitectBacklogCriterionProposal = {
  text: string;
  verificationMode: VerificationMode;
  /** Consigne au testeur. Obligatoire pour un critere humain, absente sinon. */
  humanInstructions: string | null;
  validationCommandIndexes: number[];
};

/** Une commande de validation proposee, avec ce que NOX a le droit d'en faire. */
export type ArchitectBacklogCommandProposal = {
  command: string;
  executionMode: CommandExecutionMode;
};

/** Un element de backlog en version 2. */
export type ArchitectBacklogTaskProposalV2 = {
  title: string;
  priority: TaskPriority;
  objective: string;
  context: string | null;
  acceptanceCriteria: ArchitectBacklogCriterionProposal[];
  outOfScope: string[];
  documentReferences: string[];
  validationCommands: ArchitectBacklogCommandProposal[];
};

/**
 * Une proposition de backlog en version 2.
 *
 * C'est la **forme courante** de NOX : tout ce qui lit un backlog, quelle que
 * soit la version dans laquelle il a ete ecrit, le recoit sous cette forme. Une
 * proposition de version 1 est relevee par `upgradeBacklogProposal`, jamais
 * reecrite en base.
 */
export type ArchitectBacklogProposalV2 = {
  schemaVersion: typeof ARCHITECT_BACKLOG_SCHEMA_VERSION_2;
  message: string;
  tasks: ArchitectBacklogTaskProposalV2[];
};

export type ArchitectBacklogResultV2 =
  | { ok: true; proposal: ArchitectBacklogProposalV2 }
  | { ok: false; refusal: ArchitectBacklogRefusal };

/**
 * Releve une proposition de version 1 dans la forme courante.
 *
 * Les defauts appliques sont les **defauts surs**, les memes que partout
 * ailleurs dans NOX : chaque critere devient `HUMAN` avec l'instruction neutre,
 * chaque commande devient `AGENT_ONLY`. Une proposition ecrite avant TASK-027
 * ne peut donc pas gagner apres coup le droit de terminer une tache toute seule.
 *
 * Rien n'est reecrit en base : `providerJson` reste le document d'origine.
 */
export function upgradeBacklogProposal(
  proposal: ArchitectBacklogProposal,
): ArchitectBacklogProposalV2 {
  return {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_2,
    message: proposal.message,
    tasks: proposal.tasks.map((task) => ({
      title: task.title,
      priority: task.priority,
      objective: task.objective,
      context: task.context,
      acceptanceCriteria: task.acceptanceCriteria.map((text) => ({
        text,
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: DEFAULT_HUMAN_INSTRUCTIONS,
        validationCommandIndexes: [],
      })),
      outOfScope: [...task.outOfScope],
      documentReferences: [...task.documentReferences],
      validationCommands: task.validationCommands.map((command) => ({
        command,
        executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY,
      })),
    })),
  };
}

/** Lit une liste d'entiers positifs, dedoublonnee et triee. */
function readIndexes(value: unknown, count: number): number[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set<number>();
  for (const raw of value) {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw >= count) {
      return null;
    }
    seen.add(raw);
  }
  return [...seen].sort((left, right) => left - right);
}

/** Valide les commandes d'un element de version 2. */
export function readProposedTaskCommands(
  value: unknown,
  label: string,
  at: (field: string) => string,
): { ok: true; commands: ArchitectBacklogCommandProposal[] } | { ok: false; refusal: ArchitectBacklogRefusal } {
  if (value === undefined || value === null) {
    return { ok: true, commands: [] };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      refusal: { field: at("validationCommands"), message: `Les commandes de ${label} ne sont pas lisibles.` },
    };
  }
  if (value.length > ARCHITECT_BACKLOG_LIMITS.commands.max) {
    return {
      ok: false,
      refusal: {
        field: at("validationCommands"),
        message: `Les commandes de ${label} sont trop nombreuses.`,
      },
    };
  }

  const commands: ArchitectBacklogCommandProposal[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) {
      return {
        ok: false,
        refusal: { field: at("validationCommands"), message: `Une commande de ${label} n'est pas lisible.` },
      };
    }
    const command = readProposedText(raw["command"], ARCHITECT_BACKLOG_LIMITS.commands.length);
    if (command === null) {
      return {
        ok: false,
        refusal: { field: at("validationCommands"), message: `Une commande de ${label} est vide ou trop longue.` },
      };
    }

    // Exactement la garde de TASK-008, sans adaptation : une commande proposee
    // dans un backlog passe le meme controle qu'une commande saisie a la main.
    const problem = checkValidationCommand(command);
    if (problem !== null) {
      return {
        ok: false,
        refusal: {
          field: at("validationCommands"),
          message: `${label} propose « ${command} », qui ne peut pas etre autorisee : ${problem}`,
        },
      };
    }

    const executionMode: unknown = raw["executionMode"];
    if (!isCommandExecutionMode(executionMode)) {
      return {
        ok: false,
        refusal: {
          field: at("validationCommands"),
          message: `${label} ne dit pas si NOX a le droit d'executer « ${command} ».`,
        },
      };
    }

    if (executionMode === COMMAND_EXECUTION_MODE.AUTONOMOUS) {
      // Une commande declaree autonome doit l'etre reellement. La politique est
      // celle de TASK-027, revalidee ici : le fournisseur ne l'elargit pas.
      const refusal = checkAutonomousCommand(command);
      if (refusal !== null) {
        return {
          ok: false,
          refusal: {
            field: at("validationCommands"),
            message: `${label} demande a NOX d'executer « ${command} », ce qui est refuse : ${refusal}`,
          },
        };
      }
    }

    if (commands.some((entry) => entry.command === command)) {
      continue;
    }
    commands.push({ command, executionMode });
  }

  const autonomous = commands.filter(
    (entry) => entry.executionMode === COMMAND_EXECUTION_MODE.AUTONOMOUS,
  );
  if (autonomous.length > MAX_AUTONOMOUS_COMMANDS_PER_RUN) {
    return {
      ok: false,
      refusal: {
        field: at("validationCommands"),
        message: `${label} demande plus de ${String(MAX_AUTONOMOUS_COMMANDS_PER_RUN)} validations autonomes.`,
      },
    };
  }

  return { ok: true, commands };
}

/** Valide les criteres d'un element de version 2. */
export function readProposedTaskCriteria(
  value: unknown,
  label: string,
  at: (field: string) => string,
  commands: readonly ArchitectBacklogCommandProposal[],
): { ok: true; criteria: ArchitectBacklogCriterionProposal[] } | { ok: false; refusal: ArchitectBacklogRefusal } {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      refusal: { field: at("acceptanceCriteria"), message: `Les criteres de ${label} ne sont pas lisibles.` },
    };
  }
  if (
    value.length < ARCHITECT_BACKLOG_LIMITS.criteria.min ||
    value.length > ARCHITECT_BACKLOG_LIMITS.criteria.max
  ) {
    return {
      ok: false,
      refusal: {
        field: at("acceptanceCriteria"),
        message: `${label} doit porter de ${String(ARCHITECT_BACKLOG_LIMITS.criteria.min)} a ${String(ARCHITECT_BACKLOG_LIMITS.criteria.max)} criteres d'acceptation.`,
      },
    };
  }

  const criteria: ArchitectBacklogCriterionProposal[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) {
      return {
        ok: false,
        refusal: { field: at("acceptanceCriteria"), message: `Un critere de ${label} n'est pas lisible.` },
      };
    }

    const text = readProposedText(raw["text"], ARCHITECT_BACKLOG_LIMITS.criteria.length);
    if (text === null) {
      return {
        ok: false,
        refusal: { field: at("acceptanceCriteria"), message: `Un critere de ${label} est vide ou trop long.` },
      };
    }
    if (criteria.some((entry) => entry.text === text)) {
      continue;
    }

    const verificationMode: unknown = raw["verificationMode"];
    if (!isVerificationMode(verificationMode)) {
      return {
        ok: false,
        refusal: {
          field: at("acceptanceCriteria"),
          message: `${label} ne dit pas si « ${text} » se verifie automatiquement ou a la main.`,
        },
      };
    }

    const indexes = readIndexes(raw["validationCommandIndexes"], commands.length);
    if (indexes === null) {
      return {
        ok: false,
        refusal: {
          field: at("acceptanceCriteria"),
          message: `Les preuves de « ${text} » designent une commande qui n'existe pas dans ${label}.`,
        },
      };
    }

    if (verificationMode === VERIFICATION_MODE.HUMAN) {
      const instructions = readProposedText(
        raw["humanInstructions"],
        MAX_HUMAN_INSTRUCTIONS_LENGTH,
      );
      if (instructions === null) {
        return {
          ok: false,
          refusal: {
            field: at("acceptanceCriteria"),
            message: `« ${text} » demande un humain sans dire ce qu'il doit verifier.`,
          },
        };
      }
      if (indexes.length > 0) {
        return {
          ok: false,
          refusal: {
            field: at("acceptanceCriteria"),
            message: `« ${text} » demande un humain tout en nommant des commandes : s'il en avait, il serait automatise.`,
          },
        };
      }
      criteria.push({
        text,
        verificationMode,
        humanInstructions: instructions,
        validationCommandIndexes: [],
      });
      continue;
    }

    // AUTOMATED : au moins une preuve, et chaque preuve doit en etre une.
    if (indexes.length === 0) {
      return {
        ok: false,
        refusal: {
          field: at("acceptanceCriteria"),
          message: `« ${text} » est declare automatise sans nommer la moindre commande qui le prouve.`,
        },
      };
    }
    for (const index of indexes) {
      const command = commands[index];
      if (command === undefined) {
        return {
          ok: false,
          refusal: {
            field: at("acceptanceCriteria"),
            message: `Les preuves de « ${text} » designent une commande qui n'existe pas dans ${label}.`,
          },
        };
      }
      if (command.executionMode !== COMMAND_EXECUTION_MODE.AUTONOMOUS) {
        return {
          ok: false,
          refusal: {
            field: at("acceptanceCriteria"),
            message: `« ${text} » s'appuie sur « ${command.command} », que NOX n'executera pas : elle ne peut donc rien prouver.`,
          },
        };
      }
    }

    criteria.push({
      text,
      verificationMode,
      humanInstructions: null,
      validationCommandIndexes: indexes,
    });
  }

  if (criteria.length < ARCHITECT_BACKLOG_LIMITS.criteria.min) {
    return {
      ok: false,
      refusal: {
        field: at("acceptanceCriteria"),
        message: `${label} ne porte aucun critere d'acceptation exploitable.`,
      },
    };
  }

  return { ok: true, criteria };
}

/** Valide un element de backlog en version 2. */
function readBacklogTaskV2(
  value: unknown,
  position: number,
  availableDocuments: readonly string[],
): { ok: true; task: ArchitectBacklogTaskProposalV2 } | { ok: false; refusal: ArchitectBacklogRefusal } {
  const at = (field: string): string => `tasks.${String(position)}.${field}`;
  const label = `Tache ${String(position + 1)}`;

  if (!isRecord(value)) {
    return {
      ok: false,
      refusal: { field: `tasks.${String(position)}`, message: `${label} n'est pas lisible.` },
    };
  }

  const title = readProposedText(value["title"], ARCHITECT_BACKLOG_LIMITS.title);
  if (title === null) {
    return { ok: false, refusal: { field: at("title"), message: `${label} n'a pas de titre exploitable.` } };
  }

  const priority: unknown = value["priority"];
  if (!isTaskPriority(priority)) {
    return {
      ok: false,
      refusal: { field: at("priority"), message: `${label} porte une priorite inconnue.` },
    };
  }

  const objective = readProposedText(value["objective"], ARCHITECT_BACKLOG_LIMITS.objective);
  if (objective === null) {
    return {
      ok: false,
      refusal: { field: at("objective"), message: `${label} n'a pas d'objectif exploitable.` },
    };
  }

  const context = readOptionalProposedText(value["context"], ARCHITECT_BACKLOG_LIMITS.context);
  if (context === undefined) {
    return { ok: false, refusal: { field: at("context"), message: `Le contexte de ${label} est trop long.` } };
  }

  const outOfScope = readProposedList(value["outOfScope"], ARCHITECT_BACKLOG_LIMITS.outOfScope);
  if (outOfScope === null) {
    return {
      ok: false,
      refusal: { field: at("outOfScope"), message: `Le hors perimetre de ${label} est trop long.` },
    };
  }

  const documentReferences = readProposedList(
    value["documentReferences"],
    ARCHITECT_BACKLOG_LIMITS.documents,
  );
  if (documentReferences === null) {
    return {
      ok: false,
      refusal: {
        field: at("documentReferences"),
        message: `Les documents de ${label} sont trop nombreux ou trop longs.`,
      },
    };
  }
  for (const reference of documentReferences) {
    if (!availableDocuments.includes(reference)) {
      return {
        ok: false,
        refusal: {
          field: at("documentReferences"),
          message: `${label} reference « ${reference} », qui ne fait pas partie des documents du repository : l'architecte ne peut pas en inventer.`,
        },
      };
    }
  }

  // Les commandes sont lues avant les criteres : un critere automatise se juge
  // sur ce que ses preuves sont reellement, donc elles doivent exister d'abord.
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

  return {
    ok: true,
    task: {
      title,
      priority,
      objective,
      context,
      acceptanceCriteria: criteria.criteria,
      outOfScope,
      documentReferences,
      validationCommands: commands.commands,
    },
  };
}

/**
 * Valide une proposition de backlog en version 2.
 *
 * Meme discipline que la version 1 : aucune confiance au Structured Output, le
 * premier probleme arrete la lecture, et **toute** la proposition est refusee.
 * Un backlog est une unite.
 */
export function readArchitectBacklogProposalV2(
  value: unknown,
  availableDocuments: readonly string[],
): ArchitectBacklogResultV2 {
  if (!isRecord(value)) {
    return { ok: false, refusal: { field: "backlog", message: "La reponse de planification n'est pas une structure lisible." } };
  }

  if (value["schemaVersion"] !== ARCHITECT_BACKLOG_SCHEMA_VERSION_2) {
    return {
      ok: false,
      refusal: {
        field: "schemaVersion",
        message: "La reponse de planification ne suit pas la version de contrat attendue.",
      },
    };
  }

  const message = readProposedText(value["message"], ARCHITECT_BACKLOG_LIMITS.message);
  if (message === null) {
    return {
      ok: false,
      refusal: { field: "message", message: "La reponse de planification ne porte aucun resume exploitable." },
    };
  }

  const rawTasks: unknown = value["tasks"];
  if (!Array.isArray(rawTasks)) {
    return {
      ok: false,
      refusal: { field: "tasks", message: "La reponse de planification ne porte aucune liste de taches." },
    };
  }
  if (rawTasks.length < ARCHITECT_BACKLOG_LIMITS.tasks.min) {
    return {
      ok: false,
      refusal: { field: "tasks", message: "La reponse de planification ne propose aucune tache." },
    };
  }
  if (rawTasks.length > ARCHITECT_BACKLOG_LIMITS.tasks.max) {
    return {
      ok: false,
      refusal: {
        field: "tasks",
        message: `La reponse de planification propose ${String(rawTasks.length)} taches, au-dela du maximum de ${String(ARCHITECT_BACKLOG_LIMITS.tasks.max)}.`,
      },
    };
  }

  const tasks: ArchitectBacklogTaskProposalV2[] = [];
  for (const [position, raw] of rawTasks.entries()) {
    const read = readBacklogTaskV2(raw, position, availableDocuments);
    if (!read.ok) {
      return { ok: false, refusal: read.refusal };
    }
    tasks.push(read.task);
  }

  return {
    ok: true,
    proposal: { schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_2, message, tasks },
  };
}

/**
 * Schema JSON strict de la version 2.
 *
 * Comme en version 1, **aucune borne de taille n'y figure** : le sous-ensemble
 * de JSON Schema accepte en mode strict ignore `maxItems`, `minItems`,
 * `maxLength` et `pattern`, et les declarer ferait echouer la requete entiere.
 * Les bornes vivent donc dans le prompt, qui les annonce, et dans
 * `readArchitectBacklogProposalV2`, qui les fait respecter.
 */
export function buildArchitectBacklogSchemaV2(): Record<string, unknown> {
  const criterion: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["text", "verificationMode", "humanInstructions", "validationCommandIndexes"],
    properties: {
      text: { type: "string", description: "Critere verifiable, en une phrase." },
      verificationMode: {
        type: "string",
        enum: [...VERIFICATION_MODES],
        description:
          "AUTOMATED seulement si une commande enregistree, executee par NOX apres le travail, suffit a prouver ce critere. HUMAN dans tous les autres cas.",
      },
      humanInstructions: {
        type: ["string", "null"],
        description:
          "Ce qu'un humain doit verifier, et comment. Obligatoire pour HUMAN, null pour AUTOMATED.",
      },
      validationCommandIndexes: {
        type: "array",
        items: { type: "integer" },
        description:
          "Positions, dans validationCommands de cette meme tache, des commandes autonomes qui prouvent ce critere. Vide pour HUMAN, au moins une pour AUTOMATED.",
      },
    },
  };

  const command: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["command", "executionMode"],
    properties: {
      command: { type: "string", description: "Commande simple, sans operateur shell." },
      executionMode: {
        type: "string",
        enum: [...COMMAND_EXECUTION_MODES],
        description:
          "AGENT_ONLY : seulement autorisee a l'implementeur. AUTONOMOUS : NOX l'executera lui-meme apres le travail, et elle pourra prouver un critere.",
      },
    },
  };

  const taskFields: Record<string, unknown> = {
    title: { type: "string", description: "Titre court de la tache, sans code." },
    priority: { type: "string", enum: [...TASK_PRIORITIES] },
    objective: { type: "string", description: "Resultat observable attendu." },
    context: { type: ["string", "null"], description: "Pourquoi cette tache existe." },
    acceptanceCriteria: {
      type: "array",
      description: `Criteres verifiables, de ${String(ARCHITECT_BACKLOG_LIMITS.criteria.min)} a ${String(ARCHITECT_BACKLOG_LIMITS.criteria.max)}, chacun classe.`,
      items: criterion,
    },
    outOfScope: shortStrings("Ce que l'implementeur ne doit pas faire dans cette tache."),
    documentReferences: shortStrings("Chemins issus de la liste fermee fournie."),
    validationCommands: {
      type: "array",
      description: "Commandes de validation de la tache, avec leur mode d'execution.",
      items: command,
    },
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "message", "tasks"],
    properties: {
      schemaVersion: { type: "integer", enum: [ARCHITECT_BACKLOG_SCHEMA_VERSION_2] },
      message: {
        type: "string",
        description:
          "Resume destine a l'utilisateur : ce que ce decoupage couvre du plan de V1, et ce qu'il laisse de cote. Jamais de raisonnement interne.",
      },
      tasks: {
        type: "array",
        description: `Backlog ordonne, de ${String(ARCHITECT_BACKLOG_LIMITS.tasks.min)} a ${String(ARCHITECT_BACKLOG_LIMITS.tasks.max)} elements. L'ordre du tableau est l'ordre recommande.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: Object.keys(taskFields),
          properties: taskFields,
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Version 3 : les dependances fonctionnelles entrent dans le backlog
// ---------------------------------------------------------------------------

/**
 * Version 3 du contrat de proposition de backlog.
 *
 * ## Ce qu'elle ajoute, et pourquoi
 *
 * Un champ, `dependsOn`. Le premier pilote reel a produit deux taches dont la
 * seconde etendait le modele, la persistance et l'ecran de la premiere — et
 * aucun lien entre elles, parce que `backlog/2` n'avait aucun endroit ou en
 * ecrire un. L'ordre du tableau restait juste ; il n'empechait simplement rien.
 * Dans un workflow reellement autonome, cette absence autorise un ordre
 * d'execution invalide.
 *
 * ## Pourquoi des positions, et pourquoi seulement en arriere
 *
 * Une tache proposee n'a pas encore de code : NOX les attribue a l'application.
 * Le seul identifiant disponible est donc la **position** dans le tableau — la
 * meme convention que `validationCommandIndexes`.
 *
 * Et une dependance ne peut designer qu'une position **strictement anterieure**.
 * C'est la contrainte qui fait tout le travail :
 *
 * - elle rend un cycle structurellement impossible, sans parcours de graphe ;
 * - elle interdit qu'une tache s'attende elle-meme ;
 * - elle force l'ordre du tableau et les dependances a raconter la meme
 *   histoire. Un plan ou la tache 2 attend la tache 5 est un plan dont l'ordre
 *   est faux ; NOX le refuse et le dit, plutot que de reordonner en silence.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle ne devine rien. NOX ne deduit aucune dependance d'un numero, d'un mot
 * commun dans deux titres ou de l'ordre du backlog : la semantique appartient au
 * fournisseur, et le code garantit le contrat et le graphe. Une regle qui
 * pretendrait comprendre le produit avec une expression reguliere serait fausse
 * exactement au moment ou elle compterait.
 */
export const ARCHITECT_BACKLOG_SCHEMA_VERSION_3 = 3;

/** Nom du format v3 transmis au fournisseur ; doit rester stable. */
export const ARCHITECT_BACKLOG_SCHEMA_NAME_3 = "nox_v1_backlog_v3";

/** Un element de backlog en version 3. */
export type ArchitectBacklogTaskProposalV3 = ArchitectBacklogTaskProposalV2 & {
  /** Positions, strictement anterieures, des elements que celui-ci attend. */
  dependsOn: number[];
};

/**
 * Une proposition de backlog en version 3.
 *
 * C'est la **forme courante** de NOX : tout ce qui lit un backlog, quelle que
 * soit la version dans laquelle il a ete ecrit, le recoit sous cette forme.
 */
export type ArchitectBacklogProposalV3 = {
  schemaVersion: typeof ARCHITECT_BACKLOG_SCHEMA_VERSION_3;
  message: string;
  tasks: ArchitectBacklogTaskProposalV3[];
};

export type ArchitectBacklogResultV3 =
  | { ok: true; proposal: ArchitectBacklogProposalV3 }
  | { ok: false; refusal: ArchitectBacklogRefusal };

/**
 * Releve une proposition de version 2 dans la forme courante.
 *
 * Le defaut sur est la liste vide : une proposition ecrite avant TASK-033 n'a
 * jamais exprime de dependance, et lui en inventer une apres coup reviendrait a
 * lui faire dire ce que son auteur n'avait pas dit. Rien n'est reecrit en base.
 */
export function upgradeBacklogProposalV2(
  proposal: ArchitectBacklogProposalV2,
): ArchitectBacklogProposalV3 {
  return {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
    message: proposal.message,
    tasks: proposal.tasks.map((task) => ({ ...task, dependsOn: [] })),
  };
}

/**
 * Lit les dependances d'un element.
 *
 * Refuse plutot que de corriger : une reference vers l'avant n'est pas une
 * maladresse d'ecriture, c'est un plan dont l'ordre contredit les prerequis. La
 * reordonner nous-memes ferait passer pour valide un decoupage que personne
 * n'aurait relu.
 */
export function readBacklogDependsOn(
  value: unknown,
  position: number,
  label: string,
  at: (field: string) => string,
): { ok: true; dependsOn: number[] } | { ok: false; refusal: ArchitectBacklogRefusal } {
  const field = at("dependsOn");
  if (value === undefined || value === null) {
    return { ok: true, dependsOn: [] };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      refusal: { field, message: `Les dependances de ${label} ne sont pas lisibles.` },
    };
  }
  if (value.length > ARCHITECT_BACKLOG_LIMITS.dependencies.max) {
    return {
      ok: false,
      refusal: {
        field,
        message: `${label} attend plus de ${String(ARCHITECT_BACKLOG_LIMITS.dependencies.max)} autres taches.`,
      },
    };
  }

  const seen = new Set<number>();
  for (const raw of value) {
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      return {
        ok: false,
        refusal: { field, message: `Les dependances de ${label} ne sont pas des positions.` },
      };
    }
    if (raw === position) {
      return { ok: false, refusal: { field, message: `${label} s'attend elle-meme.` } };
    }
    if (raw < 0 || raw >= position) {
      return {
        ok: false,
        refusal: {
          field,
          message: `${label} attend la tache ${String(raw + 1)}, qui ne la precede pas : l'ordre du backlog et ses dependances se contredisent.`,
        },
      };
    }
    seen.add(raw);
  }

  return { ok: true, dependsOn: [...seen].sort((left, right) => left - right) };
}

/**
 * Valide une proposition de backlog en version 3.
 *
 * Meme discipline que les versions precedentes : aucune confiance au Structured
 * Output, le premier probleme arrete la lecture, et **toute** la proposition est
 * refusee. Un backlog est une unite.
 */
export function readArchitectBacklogProposalV3(
  value: unknown,
  availableDocuments: readonly string[],
): ArchitectBacklogResultV3 {
  if (!isRecord(value)) {
    return {
      ok: false,
      refusal: {
        field: "backlog",
        message: "La reponse de planification n'est pas une structure lisible.",
      },
    };
  }
  if (value["schemaVersion"] !== ARCHITECT_BACKLOG_SCHEMA_VERSION_3) {
    return {
      ok: false,
      refusal: {
        field: "schemaVersion",
        message: "La reponse de planification ne suit pas la version de contrat attendue.",
      },
    };
  }

  // Le corps est exactement celui de la version 2 : meme contrat de tache, memes
  // bornes, memes gardes. Une seconde implementation presque identique aurait
  // diverge au premier ajout de champ.
  const base = readArchitectBacklogProposalV2(
    { ...value, schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_2 },
    availableDocuments,
  );
  if (!base.ok) {
    return base;
  }

  const rawTasks: unknown = value["tasks"];
  const tasks: ArchitectBacklogTaskProposalV3[] = [];
  for (const [position, task] of base.proposal.tasks.entries()) {
    const raw: unknown = Array.isArray(rawTasks) ? rawTasks[position] : undefined;
    const read = readBacklogDependsOn(
      isRecord(raw) ? raw["dependsOn"] : undefined,
      position,
      `Tache ${String(position + 1)}`,
      (field) => `tasks.${String(position)}.${field}`,
    );
    if (!read.ok) {
      return { ok: false, refusal: read.refusal };
    }
    tasks.push({ ...task, dependsOn: read.dependsOn });
  }

  return {
    ok: true,
    proposal: {
      schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
      message: base.proposal.message,
      tasks,
    },
  };
}

/**
 * Schema JSON strict de la version 3.
 *
 * Comme en versions 1 et 2, **aucune borne de taille n'y figure** : le
 * sous-ensemble de JSON Schema accepte en mode strict ignore `maxItems`,
 * `minItems`, `maxLength` et `pattern`, et les declarer ferait echouer la
 * requete entiere. Les bornes vivent dans le prompt, qui les annonce, et dans
 * `readArchitectBacklogProposalV3`, qui les fait respecter.
 *
 * Il est **derive** de celui de la version 2 : un second schema recopie aurait
 * diverge au premier ajout de champ, et celui qui aurait tort serait celui qui
 * laisse passer.
 */
export function buildArchitectBacklogSchemaV3(): Record<string, unknown> {
  const base = buildArchitectBacklogSchemaV2();
  const properties = base["properties"] as Record<string, unknown>;
  const tasks = properties["tasks"] as Record<string, unknown>;
  const item = tasks["items"] as Record<string, unknown>;
  const fields = item["properties"] as Record<string, unknown>;

  const taskFields: Record<string, unknown> = {
    ...fields,
    dependsOn: {
      type: "array",
      items: { type: "integer" },
      description:
        "Positions, dans ce meme tableau, des taches que celle-ci attend reellement. Strictement anterieures a la sienne. Vide si cette tache n'a aucun prerequis dans ce backlog.",
    },
  };

  return {
    ...base,
    properties: {
      ...properties,
      schemaVersion: { type: "integer", enum: [ARCHITECT_BACKLOG_SCHEMA_VERSION_3] },
      tasks: {
        ...tasks,
        items: { ...item, required: Object.keys(taskFields), properties: taskFields },
      },
    },
  };
}

/**
 * Relit une proposition enregistree, quelle que soit sa version.
 *
 * La version portee par le document decide : une proposition de version 1 ou 2
 * est relevee avec les defauts surs — chaque critere humain, chaque commande
 * `AGENT_ONLY`, aucune dependance —, une proposition de version 3 est lue telle
 * quelle. Aucun document n'est reecrit, et une version inconnue n'est pas
 * devinee : elle est refusee.
 */
export function readAnyArchitectBacklogProposal(
  value: unknown,
  availableDocuments: readonly string[],
): ArchitectBacklogResultV3 {
  if (!isRecord(value)) {
    return {
      ok: false,
      refusal: { field: "backlog", message: "La reponse de planification n'est pas une structure lisible." },
    };
  }

  if (value["schemaVersion"] === ARCHITECT_BACKLOG_SCHEMA_VERSION) {
    const read = readArchitectBacklogProposal(value, availableDocuments);
    return read.ok
      ? { ok: true, proposal: upgradeBacklogProposalV2(upgradeBacklogProposal(read.proposal)) }
      : { ok: false, refusal: read.refusal };
  }

  if (value["schemaVersion"] === ARCHITECT_BACKLOG_SCHEMA_VERSION_2) {
    const read = readArchitectBacklogProposalV2(value, availableDocuments);
    return read.ok
      ? { ok: true, proposal: upgradeBacklogProposalV2(read.proposal) }
      : { ok: false, refusal: read.refusal };
  }

  return readArchitectBacklogProposalV3(value, availableDocuments);
}

// --- Inventaire des taches existantes ----------------------------------------

/**
 * Une tache existante, telle que le contexte de planification la transporte.
 *
 * Elle repond a une question et une seule : **qu'est-ce qui est deja
 * specifie ?** Ni execution, ni diff, ni cout, ni session : le planificateur
 * decoupe du travail restant, il n'audite pas ce qui a tourne.
 */
export type BacklogInventoryTask = {
  code: string;
  title: string;
  status: string;
  priority: string;
  objective: string;
  /** Revision du contenu reellement transmis pour cette tache. */
  revision: string;
};

// --- Manifest de planification -----------------------------------------------

/**
 * Une source du contexte de planification, decrite sans son contenu.
 *
 * Le manifest repond a une question, des mois plus tard : **avec quoi** ce
 * backlog a-t-il ete produit ? Il ne contient donc ni chemin absolu, ni texte,
 * ni secret — seulement de quoi retrouver la version utilisee.
 */
export type BacklogContextSource = {
  kind:
    | "INSTRUCTIONS"
    | "DOCUMENT"
    | "TASK"
    | "MEMORY"
    | "PROJECT_BRIEF"
    | "PROJECT_V1_PLAN";
  identifier: string;
  revision: string | null;
  includedChars: number;
  truncated: boolean;
  category?: string;
};

export type BacklogContextManifest = {
  schemaVersion: typeof ARCHITECT_BACKLOG_SCHEMA_VERSION;
  sources: BacklogContextSource[];
  totalChars: number;
  /** Documents absents du repository, nommes pour que l'interface le dise. */
  missing: string[];
  /** Revision deterministe de l'inventaire des taches reellement transmis. */
  taskInventoryRevision: string;
};

const BACKLOG_SOURCE_KINDS: readonly string[] = [
  "INSTRUCTIONS",
  "DOCUMENT",
  "TASK",
  "MEMORY",
  "PROJECT_BRIEF",
  "PROJECT_V1_PLAN",
];

function isBacklogSource(value: unknown): value is BacklogContextSource {
  return (
    isRecord(value) &&
    typeof value["kind"] === "string" &&
    BACKLOG_SOURCE_KINDS.includes(value["kind"]) &&
    typeof value["identifier"] === "string" &&
    (value["revision"] === null || typeof value["revision"] === "string") &&
    typeof value["includedChars"] === "number" &&
    typeof value["truncated"] === "boolean" &&
    (value["category"] === undefined || typeof value["category"] === "string")
  );
}

/** Verifie qu'un manifest relu en base est encore exploitable. */
export function isBacklogContextManifest(value: unknown): value is BacklogContextManifest {
  if (!isRecord(value) || value["schemaVersion"] !== ARCHITECT_BACKLOG_SCHEMA_VERSION) {
    return false;
  }
  const sources: unknown = value["sources"];
  const missing: unknown = value["missing"];
  return (
    Array.isArray(sources) &&
    sources.every(isBacklogSource) &&
    typeof value["totalChars"] === "number" &&
    typeof value["taskInventoryRevision"] === "string" &&
    Array.isArray(missing) &&
    missing.every((entry) => typeof entry === "string")
  );
}
