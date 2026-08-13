/**
 * Contrat de l'Architecte NOX.
 *
 * L'Architecte est un second modele, distinct de Claude Code : il ne touche ni
 * au disque, ni a Git, ni a un processus. Il recoit du texte et rend une
 * **structure**. Ce fichier decrit cette structure une seule fois, pour les
 * quatre couches qui la manipulent — le fournisseur, la base, l'interface et la
 * creation de tache.
 *
 * ## Pourquoi une structure plutot qu'un Markdown a analyser
 *
 * Un modele qui rend du Markdown oblige a ecrire un analyseur, et un analyseur
 * de texte libre echoue toujours un jour sur une reponse legerement differente.
 * Le Structured Output du fournisseur reduit ce risque ; il ne le supprime pas.
 * `readArchitectProposal` revalide donc **tout** cote NOX : tailles, listes
 * fermees, references documentaires, commandes. Un schema strict est une aide,
 * jamais une garantie metier.
 *
 * ## `PROPOSAL_READY` n'est pas `TaskStatus.READY`
 *
 * Les deux mots designent deux choses sans rapport :
 *
 * - `ARCHITECT_PROPOSAL_STATUS.PROPOSAL_READY` : l'architecte estime avoir assez
 *   d'informations pour proposer une tache coherente.
 * - `TASK_STATUS.READY` : un humain a decide que la tache pouvait etre lancee.
 *
 * Une proposition `PROPOSAL_READY` devient toujours une tache `DRAFT`. Le nom
 * long est volontaire : `READY` tout court aurait fini par etre confondu.
 */

import { checkValidationCommand } from "./claude-commands.js";
import { createStatusGuard } from "./statuses.js";
import { TASK_PRIORITIES, isTaskPriority, type TaskPriority } from "./tasks.js";

/** Version du contrat de proposition, transmise et persistee. */
export const ARCHITECT_SCHEMA_VERSION = 1;

/**
 * Version du contrat de **tour** conversationnel.
 *
 * Le tour est ce que le modele rend depuis TASK-014 : un message public, des
 * questions eventuelles, et une proposition ou rien. La proposition qu'il porte
 * garde, elle, sa version 1 — sa forme n'a pas change, et les propositions
 * persistees avant TASK-014 restent lisibles telles quelles.
 */
export const ARCHITECT_TURN_SCHEMA_VERSION = 2;

/**
 * Issue d'un tour de conversation.
 *
 * Deux valeurs, et deux seulement :
 *
 * - `CONTINUE` : la discussion doit continuer. Le modele repond, recommande,
 *   pose au plus cinq questions — mais ne propose pas encore de tache.
 * - `PROPOSAL_READY` : une tache coherente peut etre proposee. La conversation
 *   **ne se ferme pas pour autant** : l'utilisateur peut demander plus petit, et
 *   le tour suivant produira une autre proposition.
 */
export const ARCHITECT_TURN_STATE = {
  CONTINUE: "CONTINUE",
  PROPOSAL_READY: "PROPOSAL_READY",
} as const;

export type ArchitectTurnState = (typeof ARCHITECT_TURN_STATE)[keyof typeof ARCHITECT_TURN_STATE];

export const ARCHITECT_TURN_STATES: readonly ArchitectTurnState[] =
  Object.values(ARCHITECT_TURN_STATE);

export const isArchitectTurnState = createStatusGuard(ARCHITECT_TURN_STATES);

/**
 * Auteur d'un message de conversation.
 *
 * `ARCHITECT` designe la **reponse publique** du modele — celle qui est ecrite
 * pour l'utilisateur. Aucun raisonnement interne n'est demande, ni recu, ni
 * persiste : les deux ne sont pas la meme chose et ne doivent jamais etre
 * confondus.
 */
export const ARCHITECT_MESSAGE_ROLE = {
  USER: "USER",
  ARCHITECT: "ARCHITECT",
} as const;

export type ArchitectMessageRole =
  (typeof ARCHITECT_MESSAGE_ROLE)[keyof typeof ARCHITECT_MESSAGE_ROLE];

export const ARCHITECT_MESSAGE_ROLES: readonly ArchitectMessageRole[] =
  Object.values(ARCHITECT_MESSAGE_ROLE);

export const isArchitectMessageRole = createStatusGuard(ARCHITECT_MESSAGE_ROLES);

/**
 * Version conversationnelle d'une session.
 *
 * `1` : session ouverte avant TASK-014. Elle n'a jamais enregistre de messages,
 * et NOX **ne lui en invente pas** : elle reste consultable, avec ses
 * generations et sa tache eventuelle, mais ne se poursuit plus.
 *
 * `2` : session conversationnelle, dont chaque tour est enregistre.
 */
export const ARCHITECT_CONVERSATION_VERSION = { LEGACY: 1, CONVERSATION: 2 } as const;

/**
 * Issue d'une generation, telle que le modele la declare.
 *
 * Deux valeurs, et deux seulement : soit l'architecte peut proposer, soit il a
 * besoin d'une decision qu'il n'a pas le droit de prendre a la place de
 * l'utilisateur.
 */
export const ARCHITECT_PROPOSAL_STATUS = {
  PROPOSAL_READY: "PROPOSAL_READY",
  NEEDS_INPUT: "NEEDS_INPUT",
} as const;

export type ArchitectProposalStatus =
  (typeof ARCHITECT_PROPOSAL_STATUS)[keyof typeof ARCHITECT_PROPOSAL_STATUS];

export const ARCHITECT_PROPOSAL_STATUSES: readonly ArchitectProposalStatus[] =
  Object.values(ARCHITECT_PROPOSAL_STATUS);

export const isArchitectProposalStatus = createStatusGuard(ARCHITECT_PROPOSAL_STATUSES);

/**
 * Etat d'une session Architecte.
 *
 * `FAILED` decrit la **derniere** generation, pas une session perdue : une
 * session en echec reste consultable, et un nouveau clic peut la ramener a
 * `PROPOSAL_READY`. Seul `APPLIED` est definitif — une tache a ete creee, et il
 * n'y en aura pas de seconde.
 *
 * `PROPOSAL_READY` n'est pas non plus un point d'arret : depuis TASK-014 la
 * conversation continue, et un tour suivant peut ramener la session a
 * `CONTINUE` puis a une autre proposition.
 *
 * `NEEDS_INPUT` n'est plus jamais ecrit : il decrivait le formulaire de
 * clarification de TASK-013. Il reste declare pour que les sessions ouvertes
 * avant TASK-014 se relisent sans erreur.
 */
export const ARCHITECT_SESSION_STATUS = {
  OPEN: "OPEN",
  GENERATING: "GENERATING",
  CONTINUE: "CONTINUE",
  NEEDS_INPUT: "NEEDS_INPUT",
  PROPOSAL_READY: "PROPOSAL_READY",
  APPLIED: "APPLIED",
  FAILED: "FAILED",
} as const;

export type ArchitectSessionStatus =
  (typeof ARCHITECT_SESSION_STATUS)[keyof typeof ARCHITECT_SESSION_STATUS];

export const ARCHITECT_SESSION_STATUSES: readonly ArchitectSessionStatus[] =
  Object.values(ARCHITECT_SESSION_STATUS);

export const isArchitectSessionStatus = createStatusGuard(ARCHITECT_SESSION_STATUSES);

/**
 * Issue d'une generation enregistree.
 *
 * `REFUSED` et `FAILED` sont distincts a dessein : le premier dit que le modele
 * a refuse de repondre, le second qu'aucune reponse exploitable n'est arrivee.
 * Les confondre priverait l'utilisateur de la seule information qui change ce
 * qu'il doit faire ensuite.
 *
 * `CONTINUE` et `PROPOSAL_READY` reprennent les deux issues d'un tour. Elles
 * sont les seules a produire des messages de conversation : une generation qui
 * echoue n'en laisse aucun, et le brouillon de l'utilisateur lui reste acquis.
 *
 * `NEEDS_INPUT` n'est plus jamais ecrit depuis TASK-014 ; il reste declare pour
 * les generations enregistrees avant.
 */
export const ARCHITECT_GENERATION_STATUS = {
  RUNNING: "RUNNING",
  PROPOSAL_READY: "PROPOSAL_READY",
  CONTINUE: "CONTINUE",
  NEEDS_INPUT: "NEEDS_INPUT",
  REFUSED: "REFUSED",
  FAILED: "FAILED",
} as const;

export type ArchitectGenerationStatus =
  (typeof ARCHITECT_GENERATION_STATUS)[keyof typeof ARCHITECT_GENERATION_STATUS];

export const ARCHITECT_GENERATION_STATUSES: readonly ArchitectGenerationStatus[] =
  Object.values(ARCHITECT_GENERATION_STATUS);

export const isArchitectGenerationStatus = createStatusGuard(ARCHITECT_GENERATION_STATUSES);

/**
 * Bornes de l'Architecte.
 *
 * Des constantes, jamais des variables d'environnement : une limite qu'on peut
 * desserrer depuis un `.env` n'en est plus une, et celles-ci decident de ce qui
 * quitte la machine.
 *
 * Les bornes de champs suivent celles du formulaire de tache (`TASK_LIMITS`) ou
 * sont plus strictes. Elles ne peuvent pas etre plus larges : une proposition qui
 * ne passerait pas la validation de creation serait une impasse.
 */
export const ARCHITECT_LIMITS = {
  /**
   * Message ecrit par l'utilisateur, premier compris.
   *
   * Une seule borne pour tous : le premier message d'une conversation n'est pas
   * d'une autre nature que le quatrieme, et deux limites differentes pour la
   * meme chose finiraient par diverger.
   */
  request: 8 * 1024,
  /** Precisions de TASK-013. Conservee pour relire les sessions d'alors. */
  clarification: 8 * 1024,
  /** Reponse publique de l'architecte, telle qu'elle est affichee et persistee. */
  architectMessage: 12 * 1024,
  /**
   * Transcript envoye au fournisseur.
   *
   * Depasser cette borne **arrete** la conversation : NOX ne resume pas, ne
   * fenetre pas, et ne supprime pas les premiers messages. Une decision prise au
   * deuxieme message peut etre essentielle au quinzieme ; l'oublier en silence
   * fabriquerait une memoire fictive, ce qui est pire qu'un refus lisible.
   */
  transcript: 64 * 1024,
  title: 160,
  objective: 5_000,
  context: 10_000,
  criteria: { min: 1, max: 12, length: 1_000 },
  outOfScope: { max: 12, length: 1_000 },
  documents: { max: 20, length: 500 },
  commands: { max: 10, length: 200 },
  assumptions: { max: 10, length: 500 },
  questions: { max: 5, length: 300 },
  /**
   * Generations d'une meme conversation, echecs compris.
   *
   * Vingt depuis TASK-014 : une conception reelle demande plusieurs allers et
   * retours, la ou TASK-013 n'en offrait qu'un ou deux. Compter aussi les echecs
   * reste indispensable — ne compter que les reussites autoriserait une boucle
   * infinie d'erreurs, chacune facturee.
   */
  generations: 20,
} as const;

/**
 * Proposition de tache produite par l'Architecte.
 *
 * Tous les champs de tache sont nullables ou vides : c'est le cas `NEEDS_INPUT`,
 * ou l'architecte n'a justement pas de quoi les remplir. La coherence entre
 * `status` et les champs est verifiee par `readArchitectProposal`, pas par le
 * type — un type ne sait pas dire « ce champ devient obligatoire quand cet autre
 * vaut telle valeur » sans devenir illisible.
 */
export type ArchitectTaskProposal = {
  schemaVersion: typeof ARCHITECT_SCHEMA_VERSION;
  status: ArchitectProposalStatus;
  title: string | null;
  priority: TaskPriority | null;
  objective: string | null;
  context: string | null;
  acceptanceCriteria: string[];
  outOfScope: string[];
  documentReferences: string[];
  validationCommands: string[];
  /** Decisions produit mineures prises faute d'information. */
  assumptions: string[];
  /** Questions decisionnelles, uniquement en `NEEDS_INPUT`. */
  questions: string[];
};

/** Raison pour laquelle une reponse du fournisseur est refusee. */
export type ArchitectProposalRefusal = {
  /** Champ concerne, pour pointer l'utilisateur au bon endroit. */
  field: string;
  /** Phrase francaise, deja destinee a l'utilisateur. */
  message: string;
};

export type ArchitectProposalResult =
  | { ok: true; proposal: ArchitectTaskProposal }
  | { ok: false; refusal: ArchitectProposalRefusal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Refus construit en un seul endroit : la forme reste identique partout.
 *
 * Le type de retour ne mentionne que la branche d'echec, commune a la lecture
 * d'une proposition et a celle d'un tour : les deux refusent de la meme facon.
 */
function refuse(field: string, message: string): { ok: false; refusal: ArchitectProposalRefusal } {
  return { ok: false, refusal: { field, message } };
}

/**
 * Lit une chaine facultative.
 *
 * `null` et `""` sont ramenes au meme resultat — l'absence. Un modele qui rend
 * une chaine vide veut dire « je n'ai rien a mettre ici », pas « le contexte est
 * la chaine vide ».
 */
function readOptionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed.length > max ? undefined : trimmed;
}

/**
 * Lit une liste de chaines courtes.
 *
 * Les entrees vides disparaissent, les doublons aussi : l'architecte repete
 * parfois un critere sous deux formulations identiques, et une liste qui dit
 * deux fois la meme chose ne dit rien de plus.
 */
function readList(
  value: unknown,
  limits: { max: number; length: number },
): string[] | null {
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
 * Valide une reponse du fournisseur, quelle que soit sa provenance.
 *
 * Ne fait **aucune** confiance au Structured Output : celui-ci garantit une
 * forme, pas des invariants NOX. Une reference documentaire inventee, une
 * commande de validation avec un tuyau, douze questions au lieu de cinq :
 * chacune de ces reponses respecte le schema tout en etant inacceptable.
 *
 * `availableDocuments` est la liste **fermee** transmise au modele. Une
 * proposition qui reference autre chose est refusee : NOX ne cree jamais une
 * tache pointant vers un document invente.
 */
export function readArchitectProposal(
  value: unknown,
  availableDocuments: readonly string[],
): ArchitectProposalResult {
  if (!isRecord(value)) {
    return refuse("proposal", "La reponse de l'architecte n'est pas une structure lisible.");
  }

  if (value["schemaVersion"] !== ARCHITECT_SCHEMA_VERSION) {
    return refuse(
      "schemaVersion",
      "La reponse de l'architecte ne suit pas la version de contrat attendue.",
    );
  }

  const status: unknown = value["status"];
  if (!isArchitectProposalStatus(status)) {
    return refuse("status", "L'architecte a rendu une issue inconnue.");
  }

  const title = readOptionalText(value["title"], ARCHITECT_LIMITS.title);
  if (title === undefined) {
    return refuse("title", "Le titre propose est absent ou trop long.");
  }

  const rawPriority: unknown = value["priority"];
  const priority =
    rawPriority === null || rawPriority === undefined
      ? null
      : isTaskPriority(rawPriority)
        ? rawPriority
        : undefined;
  if (priority === undefined) {
    return refuse("priority", "La priorite proposee ne fait pas partie des valeurs connues.");
  }

  const objective = readOptionalText(value["objective"], ARCHITECT_LIMITS.objective);
  if (objective === undefined) {
    return refuse("objective", "L'objectif propose est absent ou trop long.");
  }

  const context = readOptionalText(value["context"], ARCHITECT_LIMITS.context);
  if (context === undefined) {
    return refuse("context", "Le contexte propose est trop long.");
  }

  const acceptanceCriteria = readList(value["acceptanceCriteria"], ARCHITECT_LIMITS.criteria);
  if (acceptanceCriteria === null) {
    return refuse(
      "acceptanceCriteria",
      `Les criteres d'acceptation proposes sont trop nombreux ou trop longs (maximum ${String(ARCHITECT_LIMITS.criteria.max)}).`,
    );
  }

  const outOfScope = readList(value["outOfScope"], ARCHITECT_LIMITS.outOfScope);
  if (outOfScope === null) {
    return refuse("outOfScope", "Le hors perimetre propose est trop long.");
  }

  const documentReferences = readList(value["documentReferences"], ARCHITECT_LIMITS.documents);
  if (documentReferences === null) {
    return refuse("documentReferences", "Les documents proposes sont trop nombreux ou trop longs.");
  }
  for (const reference of documentReferences) {
    if (!availableDocuments.includes(reference)) {
      return refuse(
        "documentReferences",
        `« ${reference} » ne fait pas partie des documents du repository : l'architecte ne peut pas en inventer.`,
      );
    }
  }

  const validationCommands = readList(value["validationCommands"], ARCHITECT_LIMITS.commands);
  if (validationCommands === null) {
    return refuse("validationCommands", "Les commandes proposees sont trop nombreuses ou trop longues.");
  }
  for (const command of validationCommands) {
    // La garde de TASK-008 fait foi, sans exception ni adaptation : une commande
    // proposee par un modele passe exactement le meme controle qu'une commande
    // saisie a la main.
    const problem = checkValidationCommand(command);
    if (problem !== null) {
      return refuse("validationCommands", `« ${command} » ne peut pas etre autorisee : ${problem}`);
    }
  }

  const assumptions = readList(value["assumptions"], ARCHITECT_LIMITS.assumptions);
  if (assumptions === null) {
    return refuse("assumptions", "Les hypotheses proposees sont trop nombreuses ou trop longues.");
  }

  const questions = readList(value["questions"], ARCHITECT_LIMITS.questions);
  if (questions === null) {
    return refuse(
      "questions",
      `L'architecte a pose trop de questions (maximum ${String(ARCHITECT_LIMITS.questions.max)}).`,
    );
  }

  if (status === ARCHITECT_PROPOSAL_STATUS.NEEDS_INPUT && questions.length === 0) {
    return refuse(
      "questions",
      "L'architecte declare manquer d'informations sans poser la moindre question.",
    );
  }

  if (status === ARCHITECT_PROPOSAL_STATUS.PROPOSAL_READY) {
    if (title === null) {
      return refuse("title", "Une proposition prete doit porter un titre.");
    }
    if (objective === null) {
      return refuse("objective", "Une proposition prete doit porter un objectif.");
    }
    if (priority === null) {
      return refuse("priority", "Une proposition prete doit porter une priorite.");
    }
    if (acceptanceCriteria.length < ARCHITECT_LIMITS.criteria.min) {
      return refuse(
        "acceptanceCriteria",
        "Une proposition prete doit porter au moins un critere d'acceptation.",
      );
    }
  }

  return {
    ok: true,
    proposal: {
      schemaVersion: ARCHITECT_SCHEMA_VERSION,
      status,
      title,
      priority,
      objective,
      context,
      acceptanceCriteria,
      outOfScope,
      documentReferences,
      validationCommands,
      assumptions,
      // Une proposition prete ne porte pas de question : elle n'attend rien.
      questions: status === ARCHITECT_PROPOSAL_STATUS.PROPOSAL_READY ? [] : questions,
    },
  };
}

/**
 * Un tour de conversation, tel que le modele le rend.
 *
 * `message` est le seul texte destine a l'utilisateur, et c'est un **artefact
 * utilisateur** : une explication, une comparaison d'options, une recommandation.
 * Ce n'est pas du raisonnement interne — NOX n'en demande pas, n'en recoit pas,
 * et n'en persiste aucun.
 */
export type ArchitectTurn = {
  schemaVersion: typeof ARCHITECT_TURN_SCHEMA_VERSION;
  state: ArchitectTurnState;
  message: string;
  questions: string[];
  /** Proposition complete, ou `null` lorsque la discussion continue. */
  proposal: ArchitectTaskProposal | null;
};

export type ArchitectTurnResult =
  | { ok: true; turn: ArchitectTurn }
  | { ok: false; refusal: ArchitectProposalRefusal };

/**
 * Valide un tour rendu par le fournisseur.
 *
 * Delegue **entierement** la partie proposition a `readArchitectProposal` : la
 * liste fermee des documents, les commandes de validation et les bornes de champ
 * n'ont qu'une seule implementation, et un tour ne l'assouplit pas.
 *
 * Les champs `schemaVersion` et `status` de la proposition sont poses ici plutot
 * que demandes au modele : les lui faire repeter alors que `state` les dit deja
 * n'ajouterait qu'une occasion de se contredire.
 */
export function readArchitectTurn(
  value: unknown,
  availableDocuments: readonly string[],
): ArchitectTurnResult {
  if (!isRecord(value)) {
    return refuse("turn", "La reponse de l'architecte n'est pas une structure lisible.");
  }

  if (value["schemaVersion"] !== ARCHITECT_TURN_SCHEMA_VERSION) {
    return refuse(
      "schemaVersion",
      "La reponse de l'architecte ne suit pas la version de contrat attendue.",
    );
  }

  const state: unknown = value["state"];
  if (!isArchitectTurnState(state)) {
    return refuse("state", "L'architecte a rendu une issue de tour inconnue.");
  }

  const rawMessage: unknown = value["message"];
  if (typeof rawMessage !== "string") {
    return refuse("message", "L'architecte n'a rendu aucune reponse lisible.");
  }
  const message = rawMessage.replace(/\r\n?/gu, "\n").trim();
  if (message === "") {
    return refuse("message", "L'architecte a rendu une reponse vide.");
  }
  if (message.length > ARCHITECT_LIMITS.architectMessage) {
    return refuse("message", "La reponse de l'architecte depasse la taille acceptee par NOX.");
  }

  const questions = readList(value["questions"], ARCHITECT_LIMITS.questions);
  if (questions === null) {
    return refuse(
      "questions",
      `L'architecte a pose trop de questions (maximum ${String(ARCHITECT_LIMITS.questions.max)}).`,
    );
  }

  const rawProposal: unknown = value["proposal"];

  if (state === ARCHITECT_TURN_STATE.CONTINUE) {
    if (isRecord(rawProposal)) {
      return refuse(
        "proposal",
        "L'architecte annonce vouloir continuer la discussion tout en rendant une proposition.",
      );
    }
    return {
      ok: true,
      turn: { schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION, state, message, questions, proposal: null },
    };
  }

  if (!isRecord(rawProposal)) {
    return refuse("proposal", "L'architecte annonce une proposition prete sans en rendre aucune.");
  }

  const validated = readArchitectProposal(
    {
      ...rawProposal,
      schemaVersion: ARCHITECT_SCHEMA_VERSION,
      status: ARCHITECT_PROPOSAL_STATUS.PROPOSAL_READY,
      questions: [],
    },
    availableDocuments,
  );
  if (!validated.ok) {
    return validated;
  }

  return {
    ok: true,
    turn: {
      schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION,
      state,
      message,
      // Une proposition prete n'attend rien : les questions eventuelles du
      // modele seraient contradictoires, et sont ignorees plutot qu'affichees.
      questions: [],
      proposal: validated.proposal,
    },
  };
}

function shortStrings(description: string): Record<string, unknown> {
  return { type: "array", description, items: { type: "string" } };
}

/**
 * Champs d'une proposition, sans son enveloppe.
 *
 * Definis une seule fois : le schema strict les declare, et
 * `readArchitectProposal` les fait respecter. Deux listes concurrentes
 * divergeraient au premier ajout de champ.
 */
function proposalFieldSchemas(): Record<string, Record<string, unknown>> {
  return {
    title: { type: ["string", "null"], description: "Titre court de la tache." },
    priority: { type: ["string", "null"], enum: [...TASK_PRIORITIES, null] },
    objective: { type: ["string", "null"], description: "Resultat attendu." },
    context: { type: ["string", "null"], description: "Pourquoi la tache existe." },
    acceptanceCriteria: shortStrings(
      `Criteres verifiables, de ${String(ARCHITECT_LIMITS.criteria.min)} a ${String(ARCHITECT_LIMITS.criteria.max)}.`,
    ),
    outOfScope: shortStrings("Ce que l'implementeur ne doit pas faire."),
    documentReferences: shortStrings("Chemins issus de la liste fermee fournie."),
    validationCommands: shortStrings("Commandes simples, sans operateur shell."),
    assumptions: shortStrings("Hypotheses produit prises faute d'information."),
  };
}

/**
 * Schema JSON strict transmis au fournisseur.
 *
 * Construit ici, et nulle part ailleurs : le web l'envoie, les tests le
 * verifient, et il decrit exactement ce que `readArchitectTurn` accepte.
 *
 * Le mode strict d'OpenAI impose que **tous** les champs soient requis et que
 * chaque objet porte `additionalProperties: false`. Les champs facultatifs sont
 * donc exprimes par une union avec `null`, pas par leur absence — y compris
 * `proposal`, qui vaut `null` tant que la discussion continue.
 *
 * **Aucune borne de taille n'y figure.** Le sous-ensemble de JSON Schema accepte
 * en mode strict ignore `maxItems`, `minItems`, `maxLength` et `pattern` : les
 * declarer ferait echouer la requete entiere. Les bornes vivent donc a deux
 * endroits qui, eux, existent : les instructions du prompt les annoncent, et
 * `readArchitectTurn` les fait respecter. C'est exactement la raison pour
 * laquelle un schema strict ne dispense jamais d'une validation metier.
 */
export function buildArchitectTurnSchema(): Record<string, unknown> {
  const fields = proposalFieldSchemas();

  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "state", "message", "questions", "proposal"],
    properties: {
      schemaVersion: { type: "integer", enum: [ARCHITECT_TURN_SCHEMA_VERSION] },
      state: { type: "string", enum: [...ARCHITECT_TURN_STATES] },
      message: {
        type: "string",
        description:
          "Reponse redigee pour l'utilisateur : options, compromis, recommandation. Jamais de raisonnement interne.",
      },
      questions: shortStrings(
        `Questions decisionnelles, au plus ${String(ARCHITECT_LIMITS.questions.max)}, uniquement si l'etat est ${ARCHITECT_TURN_STATE.CONTINUE}.`,
      ),
      proposal: {
        type: ["object", "null"],
        description: `Proposition de tache, uniquement si l'etat est ${ARCHITECT_TURN_STATE.PROPOSAL_READY}.`,
        additionalProperties: false,
        required: Object.keys(fields),
        properties: fields,
      },
    },
  };
}

/** Nom du format transmis au fournisseur ; doit rester stable. */
export const ARCHITECT_SCHEMA_NAME = "nox_architect_turn";

// --- Manifest du contexte ----------------------------------------------------

/**
 * Une source du contexte envoye, decrite sans son contenu.
 *
 * Le manifest repond a une question, des mois plus tard : **avec quoi** cette
 * proposition a-t-elle ete produite ? Il ne contient donc ni chemin absolu, ni
 * texte, ni secret — seulement de quoi retrouver la version utilisee.
 */
export type ArchitectContextSource = {
  kind: "INSTRUCTIONS" | "DOCUMENT" | "TASK" | "MEMORY";
  /** Chemin relatif d'un document, code d'une tache, ou code d'une memoire. */
  identifier: string;
  /** Revision SHA-256 du contenu envoye, lorsqu'elle existe. */
  revision: string | null;
  includedChars: number;
  truncated: boolean;
  /**
   * Categorie d'une entree de memoire.
   *
   * Facultative parce qu'elle n'a de sens que pour `MEMORY` — et parce qu'un
   * manifest enregistre avant TASK-017 n'en porte aucune. Un champ obligatoire
   * rendrait illisibles les generations passees, que NOX conserve precisement
   * pour pouvoir les relire.
   */
  category?: string;
};

export type ArchitectContextManifest = {
  schemaVersion: typeof ARCHITECT_SCHEMA_VERSION;
  sources: ArchitectContextSource[];
  totalChars: number;
  /** Documents absents du repository, nommes pour que l'interface le dise. */
  missing: string[];
};

const CONTEXT_SOURCE_KINDS: readonly string[] = ["INSTRUCTIONS", "DOCUMENT", "TASK", "MEMORY"];

function isContextSource(value: unknown): value is ArchitectContextSource {
  return (
    isRecord(value) &&
    typeof value["kind"] === "string" &&
    CONTEXT_SOURCE_KINDS.includes(value["kind"]) &&
    typeof value["identifier"] === "string" &&
    (value["revision"] === null || typeof value["revision"] === "string") &&
    typeof value["includedChars"] === "number" &&
    typeof value["truncated"] === "boolean" &&
    (value["category"] === undefined || typeof value["category"] === "string")
  );
}

/** Verifie qu'un manifest relu en base est encore exploitable. */
export function isArchitectContextManifest(value: unknown): value is ArchitectContextManifest {
  if (!isRecord(value) || value["schemaVersion"] !== ARCHITECT_SCHEMA_VERSION) {
    return false;
  }
  const sources: unknown = value["sources"];
  const missing: unknown = value["missing"];
  return (
    Array.isArray(sources) &&
    sources.every(isContextSource) &&
    typeof value["totalChars"] === "number" &&
    Array.isArray(missing) &&
    missing.every((entry) => typeof entry === "string")
  );
}

// --- Erreurs -----------------------------------------------------------------

/**
 * Codes d'erreur de l'Architecte.
 *
 * Volontairement separes de `RUNNER_ERROR` : ils ne decrivent pas le meme
 * composant, et aucun d'eux ne remonte du runner. Comme pour lui, le code est
 * stable et sans texte — la phrase francaise vit dans l'interface.
 */
export const ARCHITECT_ERROR = {
  /** `NOX_OPENAI_API_KEY` ou `NOX_ARCHITECT_MODEL` absent. */
  ARCHITECT_NOT_CONFIGURED: "ARCHITECT_NOT_CONFIGURED",
  /** Le fournisseur n'a pas repondu dans le delai imparti. */
  ARCHITECT_TIMEOUT: "ARCHITECT_TIMEOUT",
  /** Quota ou cadence depassee chez le fournisseur. */
  ARCHITECT_RATE_LIMITED: "ARCHITECT_RATE_LIMITED",
  /** Cle refusee par le fournisseur. */
  ARCHITECT_AUTH_FAILED: "ARCHITECT_AUTH_FAILED",
  /** Le modele a refuse de repondre. */
  ARCHITECT_REFUSED: "ARCHITECT_REFUSED",
  /** Reponse recue, mais inexploitable apres validation NOX. */
  ARCHITECT_OUTPUT_INVALID: "ARCHITECT_OUTPUT_INVALID",
  /** Toute autre panne du fournisseur. */
  ARCHITECT_PROVIDER_ERROR: "ARCHITECT_PROVIDER_ERROR",
  /** Le contexte prepare depasse les bornes de NOX. */
  ARCHITECT_CONTEXT_TOO_LARGE: "ARCHITECT_CONTEXT_TOO_LARGE",
  /** La session a atteint son nombre maximal de generations. */
  ARCHITECT_GENERATION_LIMIT: "ARCHITECT_GENERATION_LIMIT",
  /** Une generation est deja en cours dans cette session. */
  ARCHITECT_GENERATION_ACTIVE: "ARCHITECT_GENERATION_ACTIVE",
  /** La session a deja produit une tache. */
  ARCHITECT_ALREADY_APPLIED: "ARCHITECT_ALREADY_APPLIED",
  /** Aucun tour prepare : il faut relire le contexte avant d'envoyer. */
  ARCHITECT_NO_PENDING_TURN: "ARCHITECT_NO_PENDING_TURN",
  /** Le contexte du projet a change depuis l'apercu. */
  ARCHITECT_CONTEXT_CHANGED: "ARCHITECT_CONTEXT_CHANGED",
  /** Le transcript depasse la borne : la conversation ne peut plus continuer. */
  ARCHITECT_CONVERSATION_TOO_LARGE: "ARCHITECT_CONVERSATION_TOO_LARGE",
  /** Session ouverte avant TASK-014 : consultable, jamais poursuivie. */
  ARCHITECT_SESSION_LEGACY: "ARCHITECT_SESSION_LEGACY",
  /** Aucun instantane de review exploitable pour cette execution. */
  ARCHITECT_REVIEW_UNAVAILABLE: "ARCHITECT_REVIEW_UNAVAILABLE",
  /** Le bundle prepare ne correspond plus a l'apercu relu. */
  ARCHITECT_REVIEW_CHANGED: "ARCHITECT_REVIEW_CHANGED",
  /** L'execution a atteint son nombre maximal d'analyses. */
  ARCHITECT_REVIEW_LIMIT: "ARCHITECT_REVIEW_LIMIT",
  /** Une analyse est deja en cours pour cette execution. */
  ARCHITECT_REVIEW_ACTIVE: "ARCHITECT_REVIEW_ACTIVE",
} as const;

export type ArchitectErrorCode = (typeof ARCHITECT_ERROR)[keyof typeof ARCHITECT_ERROR];

export const ARCHITECT_ERROR_CODES: readonly ArchitectErrorCode[] = Object.values(ARCHITECT_ERROR);

export const isArchitectErrorCode = createStatusGuard(ARCHITECT_ERROR_CODES);

// --- Usage rapporte ----------------------------------------------------------

/**
 * Consommation rapportee par le fournisseur.
 *
 * Chaque champ est nullable, et le reste : NOX n'invente aucun total, ne deduit
 * aucun cout, et n'estime rien en dollars. « non fourni » est une reponse
 * honnete ; un chiffre reconstitue ne le serait pas.
 */
export type ArchitectUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
};

export const EMPTY_ARCHITECT_USAGE: ArchitectUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
};

// --- Saisie utilisateur ------------------------------------------------------

export type ArchitectTextRefusal = "empty" | "blank" | "too_long" | "control_character";

/**
 * Verifie un texte saisi par l'utilisateur — demande ou precisions.
 *
 * Meme forme que `checkReviewFeedback` de TASK-012, et pour la meme raison : ce
 * texte est du **contenu**, jamais une instruction. Il est borne, debarrasse de
 * ses caracteres de controle, et rien d'autre ne lui est fait — le censurer
 * reviendrait a decider a la place de l'utilisateur de ce qu'il a le droit de
 * demander.
 */
export function checkArchitectText(text: string, max: number): ArchitectTextRefusal | null {
  if (text === "") {
    return "empty";
  }
  if (text.trim() === "") {
    return "blank";
  }
  if (text.length > max) {
    return "too_long";
  }
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const printable = code >= 0x20 && code !== 0x7f;
    const structural = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!printable && !structural) {
      return "control_character";
    }
  }
  return null;
}

/** Normalise un texte saisi : fins de ligne `\n`, sans marges. */
export function normalizeArchitectText(text: string): string {
  return text.replace(/\r\n?/gu, "\n").trim();
}
