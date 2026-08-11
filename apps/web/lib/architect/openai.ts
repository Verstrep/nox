/**
 * Fournisseur OpenAI de l'Architecte, cote serveur uniquement.
 *
 * ## La Responses API, et rien d'autre
 *
 * L'appel est volontairement pauvre :
 *
 * - `instructions` porte les regles, `input` le contexte — la separation du
 *   prompt est celle de l'API, pas une convention inventee par NOX ;
 * - `text.format` impose le Structured Output **strict** ;
 * - `store: false` : NOX possede son propre historique, et n'a aucune raison de
 *   demander au fournisseur d'en conserver un second ;
 * - **aucun `tools`**, aucun `previous_response_id`, aucun `conversation`,
 *   aucun `background`. Le modele recoit du texte et rend une structure ; il ne
 *   peut declencher aucune action, parce qu'aucune ne lui est offerte.
 *
 * ## Aucun retry
 *
 * Le SDK OpenAI reessaie par defaut. C'est desactive : chaque generation est
 * facturee, et un reessai invisible transformerait un clic en plusieurs appels.
 * `429`, delai depasse et `5xx` remontent tels quels ; l'utilisateur reclique
 * s'il le souhaite.
 *
 * ## Aucun detail fournisseur dans une erreur
 *
 * Les exceptions du SDK portent l'URL, les en-tetes et parfois un extrait du
 * corps envoye. Rien de tout cela ne ressort d'ici : seul un code stable est
 * rendu, et l'interface le traduit en francais.
 */

import OpenAI, {
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";

import { ARCHITECT_ERROR, EMPTY_ARCHITECT_USAGE, type ArchitectUsage } from "@nox/shared";

import type {
  ArchitectProvider,
  ArchitectProviderInput,
  ArchitectProviderResult,
} from "./provider.ts";

/** Forme minimale d'une reponse, telle que ce module la lit. */
type ResponseLike = {
  id?: unknown;
  output_text?: unknown;
  output?: unknown;
  usage?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumber(source: unknown, key: string): number | null {
  if (!isRecord(source)) {
    return null;
  }
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Lit la consommation rapportee.
 *
 * Chaque champ absent reste `null`. Rien n'est reconstitue : un total deduit
 * d'une somme partielle serait un chiffre invente, et NOX prefere dire « non
 * fourni ».
 */
function readUsage(usage: unknown): ArchitectUsage {
  if (!isRecord(usage)) {
    return EMPTY_ARCHITECT_USAGE;
  }
  return {
    inputTokens: readNumber(usage, "input_tokens"),
    outputTokens: readNumber(usage, "output_tokens"),
    totalTokens: readNumber(usage, "total_tokens"),
    cachedInputTokens: readNumber(usage["input_tokens_details"], "cached_tokens"),
  };
}

/**
 * Cherche un refus explicite dans la sortie.
 *
 * Le mode strict garantit la forme d'une reponse, pas son existence : le modele
 * peut refuser, et il le dit par un bloc `refusal`. Le confondre avec une
 * reponse illisible priverait l'utilisateur de la seule information qui change
 * ce qu'il doit faire ensuite.
 */
function containsRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) {
    return false;
  }
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item["content"])) {
      continue;
    }
    for (const block of item["content"]) {
      if (isRecord(block) && block["type"] === "refusal") {
        return true;
      }
    }
  }
  return false;
}

/** Traduit une exception du SDK en code stable, sans jamais la recopier. */
function classify(error: unknown): ArchitectProviderResult {
  if (error instanceof APIConnectionTimeoutError) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT };
  }
  if (error instanceof RateLimitError) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_RATE_LIMITED };
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED };
  }
  if (error instanceof APIError && error.status === 400) {
    // Une requete refusee pour sa forme n'est pas une panne du fournisseur :
    // c'est un contexte que NOX a laisse grossir au-dela de ce que le modele
    // accepte, ou un schema qu'il n'a pas su lire.
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE };
  }
  return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR };
}

export type OpenAIArchitectProviderOptions = {
  apiKey: string;
  /**
   * Client injecte, pour les tests uniquement.
   *
   * Il n'existe **aucune** variable d'environnement permettant de detourner
   * l'adresse du fournisseur : le seul point de substitution est ce parametre,
   * et il n'est atteignable que depuis du code de test.
   */
  client?: Pick<OpenAI, "responses">;
};

export class OpenAIArchitectProvider implements ArchitectProvider {
  readonly #client: Pick<OpenAI, "responses">;

  constructor(options: OpenAIArchitectProviderOptions) {
    this.#client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        // Aucun reessai automatique : un clic, un appel, une facture.
        maxRetries: 0,
      });
  }

  generateTaskTurn(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    return this.#call(input);
  }

  analyzeRunReview(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    return this.#call(input);
  }

  /**
   * Le seul endroit ou NOX parle au fournisseur.
   *
   * Les deux surfaces publiques passent par ici, et c'est voulu : `store`,
   * l'absence d'outils et l'absence de reessai n'ont qu'une implementation.
   * Deux copies finiraient par diverger, et la divergence serait exactement
   * celle qui compte.
   */
  async #call(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    let response: ResponseLike;

    try {
      response = (await this.#client.responses.create(
        {
          model: input.model,
          instructions: input.instructions,
          input: input.input,
          // NOX conserve son propre historique : rien a stocker chez le
          // fournisseur, et rien a reprendre d'un appel precedent.
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: input.schemaName,
              schema: input.schema,
              strict: true,
            },
          },
        },
        { timeout: input.timeoutMs, maxRetries: 0 },
      )) as ResponseLike;
    } catch (error) {
      return classify(error);
    }

    if (containsRefusal(response.output)) {
      return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_REFUSED };
    }

    const text = typeof response.output_text === "string" ? response.output_text : "";
    if (text.trim() === "") {
      return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // Le mode strict rend ce cas improbable ; « improbable » n'est pas
      // « impossible », et un analyseur qui suppose le contraire finit par
      // lever une exception dans une Server Action.
      return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID };
    }

    return {
      ok: true,
      value: {
        raw,
        responseId: typeof response.id === "string" ? response.id : null,
        usage: readUsage(response.usage),
      },
    };
  }
}
