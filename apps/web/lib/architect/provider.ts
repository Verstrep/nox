/**
 * Frontiere avec le fournisseur de l'Architecte.
 *
 * Une interface volontairement etroite : deux methodes, qui recoivent du texte
 * et un schema, et rendent une structure ou un code d'erreur. Ce n'est pas un
 * cadre multi-fournisseurs — il n'en existe qu'un — mais le seul point ou les
 * tests peuvent se substituer au reseau.
 *
 * ## Deux methodes, et pas un `generate(...)` fourre-tout
 *
 * Concevoir une tache et relire une execution sont deux surfaces distinctes :
 * deux prompts, deux schemas, deux validations, deux facons de mal tourner. Les
 * nommer separement permet a un test de dire « la review n'a declare aucun
 * outil » sans avoir a deviner ce qu'un appel generique transportait, et rend
 * visible le jour ou l'une des deux divergerait de l'autre.
 *
 * Aucun test automatise de NOX ne joint `api.openai.com`. Ce serait consommer un
 * quota, dependre du reseau, et rendre les tests non reproductibles — exactement
 * les raisons pour lesquelles le faux Claude existe depuis TASK-008.
 *
 * ## Ce que le fournisseur ne decide pas
 *
 * Ni le modele, ni le schema, ni les instructions, ni les outils : tout lui est
 * donne. Il n'a aucune latitude, et notamment aucun moyen de reessayer tout seul
 * — un retour d'erreur remonte a l'utilisateur, qui recliquera s'il le souhaite.
 */

import {
  ARCHITECT_TURN_SCHEMA_VERSION_V5,
  ARCHITECT_TURN_STATE,
  PROJECT_UPDATE_ACTION,
  type ArchitectErrorCode,
  type ArchitectUsage,
  type ProjectBriefInput,
  type ProjectMemoryProposal,
  type ProjectV1PlanInput,
} from "@nox/shared";

export type ArchitectProviderInput = {
  model: string;
  /** Message systeme : les regles de l'architecte. */
  instructions: string;
  /** Contexte projet, demande et precisions, deja nettoyes et delimites. */
  input: string;
  /** Nom du format de sortie, stable. */
  schemaName: string;
  /** Schema JSON strict de la proposition. */
  schema: Record<string, unknown>;
  /**
   * Plafond de securite de l'appel.
   *
   * Ce n'est pas une duree attendue : c'est la derniere garde contre une
   * requete reellement bloquee. Le depasser produit `ARCHITECT_TIMEOUT`, et
   * reste distinct d'un arret demande par l'utilisateur.
   */
  timeoutMs: number;
  /**
   * De quoi interrompre la requete depuis l'exterieur.
   *
   * Absent pour les surfaces qui n'exposent aucun arret. Present, il doit
   * atteindre la couche reseau : un signal qui ne servirait qu'a court-circuiter
   * la lecture du resultat laisserait le fournisseur travailler et facturer.
   */
  signal?: AbortSignal;
  /**
   * Plafond de jetons de sortie, lorsque la surface en declare un.
   *
   * Absent pour les deux surfaces conversationnelles : leur reponse est un
   * message et au plus une proposition, et le defaut du modele suffit. Une
   * planification, elle, peut rendre vingt specifications d'un coup, et un
   * plafond explicite vaut mieux qu'une reponse coupee au hasard du modele
   * configure.
   */
  maxOutputTokens?: number;
};

export type ArchitectProviderSuccess = {
  /** Objet JSON rendu par le modele, **non valide**. */
  raw: unknown;
  /** Identifiant de reponse du fournisseur, lorsqu'il en fournit un. */
  responseId: string | null;
  usage: ArchitectUsage;
};

/**
 * Ce que le fournisseur sait dire d'un echec, sans rien reveler.
 *
 * Deux chaines produites par **NOX** : le marqueur de l'etape qui a echoue, et
 * une phrase qui la decrit. Ni le texte recu, ni les en-tetes, ni la trace n'y
 * entrent — le type n'a aucun champ ou les mettre, ce qui est une garantie plus
 * solide qu'un filtre.
 */
export type ArchitectProviderDiagnostic = {
  field: string;
  message: string;
};

export type ArchitectProviderResult =
  | { ok: true; value: ArchitectProviderSuccess }
  | {
      ok: false;
      code: ArchitectErrorCode;
      /**
       * Present quand une reponse a ete recue et refusee ici meme.
       *
       * Absent pour une panne de transport — delai, quota, cle refusee : il n'y
       * a alors aucune reponse a diagnostiquer, et `code` dit deja tout.
       */
      diagnostic?: ArchitectProviderDiagnostic;
    };

export interface ArchitectProvider {
  /** Un tour de conversation, dont peut sortir une proposition de tache. */
  generateTaskTurn(input: ArchitectProviderInput): Promise<ArchitectProviderResult>;
  /** Une analyse de review, dont sort une recommandation. */
  analyzeRunReview(input: ArchitectProviderInput): Promise<ArchitectProviderResult>;
  /** Une planification, dont sort un backlog ordonne. */
  generateBacklog(input: ArchitectProviderInput): Promise<ArchitectProviderResult>;
  /**
   * Un rafraichissement des plans de verification, apres un amorcage.
   *
   * Nommee separement pour la meme raison que les trois autres : son contrat
   * n'a rien de commun avec celui d'une planification — quatre champs, aucun
   * texte de tache — et un test qui veut prouver « exactement un appel de
   * rafraichissement » ne doit pas avoir a filtrer une liste generique.
   */
  refreshVerification(input: ArchitectProviderInput): Promise<ArchitectProviderResult>;
}

/**
 * Faux fournisseur, pour les tests et le test fonctionnel.
 *
 * Il enregistre ce qu'il a recu — c'est ainsi que les tests verifient qu'aucun
 * outil n'est declare, que le modele vient du serveur et qu'aucune cle ne figure
 * dans l'entree — et rend les reponses programmees, dans l'ordre.
 *
 * `calls` porte les deux surfaces confondues, et `turnCalls` / `reviewCalls` les
 * separent : un test qui veut prouver que zero appel de review a ete fait ne
 * doit pas avoir a filtrer lui-meme.
 */
export class FakeArchitectProvider implements ArchitectProvider {
  readonly calls: ArchitectProviderInput[] = [];
  readonly turnCalls: ArchitectProviderInput[] = [];
  readonly reviewCalls: ArchitectProviderInput[] = [];
  readonly backlogCalls: ArchitectProviderInput[] = [];
  readonly refreshCalls: ArchitectProviderInput[] = [];
  #responses: ArchitectProviderResult[];

  constructor(responses: readonly ArchitectProviderResult[]) {
    this.#responses = [...responses];
  }

  #next(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    this.calls.push(input);
    const next = this.#responses.shift();
    if (next === undefined) {
      throw new Error("FakeArchitectProvider : aucune reponse programmee restante.");
    }
    return Promise.resolve(next);
  }

  generateTaskTurn(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    this.turnCalls.push(input);
    return this.#next(input);
  }

  analyzeRunReview(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    this.reviewCalls.push(input);
    return this.#next(input);
  }

  generateBacklog(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    this.backlogCalls.push(input);
    return this.#next(input);
  }

  refreshVerification(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    this.refreshCalls.push(input);
    return this.#next(input);
  }
}

/**
 * Reponses de tour programmables, pour les tests et le test fonctionnel.
 *
 * ## Pourquoi ces constructeurs existent
 *
 * Parce que `state` et `projectUpdate` sont **independants**, et que cette
 * independance doit etre exercee, pas seulement affirmee. Les quatre
 * combinaisons sont donc constructibles explicitement :
 *
 * ```text
 * A  CONTINUE        tache non   mise a jour non
 * B  CONTINUE        tache non   mise a jour oui
 * C  PROPOSAL_READY  tache oui   mise a jour non
 * D  PROPOSAL_READY  tache oui   mise a jour oui
 * ```
 *
 * Aucune de ces valeurs ne quitte les tests : ce sont des reponses simulees,
 * jamais un appel.
 */
export type FakeTaskProposal = {
  title: string;
  priority: string;
  objective: string;
  context?: string | null;
  acceptanceCriteria: string[];
  outOfScope?: string[];
  documentReferences?: string[];
  validationCommands?: string[];
  assumptions?: string[];
};

export type FakeProjectUpdate = {
  reason: string;
  brief?: ProjectBriefInput | null;
  plan?: ProjectV1PlanInput | null;
  /** Regles durables proposees par ce tour. Vides dans le cas ordinaire. */
  memories?: ProjectMemoryProposal[];
};

/** Une section de mise a jour, dans la forme attendue par le contrat v3. */
function fakeSection<TValue>(value: TValue | null | undefined): {
  action: string;
  value: TValue | null;
} {
  return value === null || value === undefined
    ? { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null }
    : { action: PROJECT_UPDATE_ACTION.SET, value };
}

/**
 * Construit la charge utile d'un tour de conversation projet.
 *
 * Rend l'objet **brut**, tel qu'un fournisseur le renverrait : il traversera
 * ensuite `readArchitectTurn` comme n'importe quelle reponse reelle. Court-
 * circuiter cette validation ferait des tests une preuve de rien.
 */
export function fakeProjectTurn(options: {
  message?: string;
  questions?: string[];
  proposal?: FakeTaskProposal | null;
  projectUpdate?: FakeProjectUpdate | null;
}): Record<string, unknown> {
  const proposal = options.proposal ?? null;
  const update = options.projectUpdate ?? null;

  return {
    schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION_V5,
    state:
      proposal === null ? ARCHITECT_TURN_STATE.CONTINUE : ARCHITECT_TURN_STATE.PROPOSAL_READY,
    message: options.message ?? "Voici ce que je propose.",
    questions: options.questions ?? [],
    proposal:
      proposal === null
        ? null
        : {
            title: proposal.title,
            priority: proposal.priority,
            objective: proposal.objective,
            context: proposal.context ?? null,
            acceptanceCriteria: proposal.acceptanceCriteria,
            outOfScope: proposal.outOfScope ?? [],
            documentReferences: proposal.documentReferences ?? [],
            validationCommands: proposal.validationCommands ?? [],
            assumptions: proposal.assumptions ?? [],
          },
    projectUpdate:
      update === null
        ? null
        : {
            reason: update.reason,
            brief: fakeSection(update.brief),
            plan: fakeSection(update.plan),
            // Depuis HOTFIX-005. Vide par defaut : un tour qui n'etablit aucune
            // regle durable n'en propose aucune, et c'est le cas ordinaire.
            memories: update.memories ?? [],
          },
  };
}

/** Enveloppe une charge utile dans une reponse reussie du fournisseur. */
export function fakeProviderSuccess(raw: unknown): ArchitectProviderResult {
  return {
    ok: true,
    value: {
      raw,
      responseId: "resp_fake",
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: null },
    },
  };
}
