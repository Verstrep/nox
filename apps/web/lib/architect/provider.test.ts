/**
 * Tests du fournisseur OpenAI, avec un client injecte.
 *
 * **Aucun test ne joint `api.openai.com`.** Le client est remplace par un objet
 * qui enregistre ce qu'il recoit et rend ce qu'on lui demande — c'est ainsi que
 * les garanties les plus importantes de TASK-013 se verifient : aucun outil
 * declare, `store: false`, aucun reessai, aucun modele venu du navigateur.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_ERROR,
  ARCHITECT_SCHEMA_NAME,
  buildArchitectTurnSchema,
} from "@nox/shared";
import { APIError, APIConnectionTimeoutError } from "openai";

import { loadArchitectConfig } from "./config.ts";
import { OpenAIArchitectProvider } from "./openai.ts";
import { FakeArchitectProvider, type ArchitectProviderInput } from "./provider.ts";

const INPUT: ArchitectProviderInput = {
  model: "modele-de-test",
  instructions: "Tu es l'architecte.",
  input: "## Demande\n\nExporter les taches.",
  schemaName: ARCHITECT_SCHEMA_NAME,
  schema: buildArchitectTurnSchema(),
  timeoutMs: 1_000,
};

type Capture = { body: Record<string, unknown>; options: Record<string, unknown> };

/** Client injecte : il enregistre l'appel et rend la reponse programmee. */
function fakeClient(
  response: unknown,
  captures: Capture[] = [],
): { responses: { create: (body: unknown, options: unknown) => Promise<unknown> } } {
  return {
    responses: {
      create: (body: unknown, options: unknown) => {
        captures.push({
          body: body as Record<string, unknown>,
          options: options as Record<string, unknown>,
        });
        if (response instanceof Error) {
          return Promise.reject(response);
        }
        return Promise.resolve(response);
      },
    },
  };
}

const VALID_PROPOSAL = JSON.stringify({
  schemaVersion: 1,
  status: "PROPOSAL_READY",
  title: "Exporter les taches",
  priority: "MEDIUM",
  objective: "Un objectif.",
  context: null,
  acceptanceCriteria: ["Un critere."],
  outOfScope: [],
  documentReferences: [],
  validationCommands: [],
  assumptions: [],
  questions: [],
});

function provider(response: unknown, captures: Capture[] = []): OpenAIArchitectProvider {
  return new OpenAIArchitectProvider({
    apiKey: "cle-de-test",
    client: fakeClient(response, captures) as never,
  });
}

describe("OpenAIArchitectProvider — forme de la requete", () => {
  it("n'y declare aucun outil", async () => {
    const captures: Capture[] = [];
    await provider({ id: "resp_1", output_text: VALID_PROPOSAL }, captures).generateTaskProposal(
      INPUT,
    );

    // La garantie la plus importante de TASK-013 : le modele ne peut declencher
    // aucune action parce qu'aucune ne lui est offerte.
    assert.equal("tools" in captures[0]!.body, false);
    assert.equal("tool_choice" in captures[0]!.body, false);
  });

  it("demande explicitement de ne rien stocker", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskProposal(INPUT);

    assert.equal(captures[0]!.body["store"], false);
  });

  it("ne reprend aucune conversation precedente", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskProposal(INPUT);

    assert.equal("previous_response_id" in captures[0]!.body, false);
    assert.equal("conversation" in captures[0]!.body, false);
    assert.equal("background" in captures[0]!.body, false);
  });

  it("impose le Structured Output strict", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskProposal(INPUT);

    const format = (captures[0]!.body["text"] as { format: Record<string, unknown> }).format;
    assert.equal(format["type"], "json_schema");
    assert.equal(format["strict"], true);
    assert.equal(format["name"], ARCHITECT_SCHEMA_NAME);
  });

  it("utilise le modele fourni par le serveur", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskProposal(INPUT);

    assert.equal(captures[0]!.body["model"], "modele-de-test");
  });

  it("desactive tout reessai automatique", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskProposal(INPUT);

    // Chaque generation est facturee : un reessai invisible transformerait un
    // clic en plusieurs appels.
    assert.equal(captures[0]!.options["maxRetries"], 0);
    assert.equal(captures[0]!.options["timeout"], 1_000);
  });

  it("separe instructions et contexte", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskProposal(INPUT);

    assert.equal(captures[0]!.body["instructions"], INPUT.instructions);
    assert.equal(captures[0]!.body["input"], INPUT.input);
  });

  it("ne transmet jamais la cle dans le corps", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskProposal(INPUT);

    assert.equal(JSON.stringify(captures[0]!.body).includes("cle-de-test"), false);
  });
});

describe("OpenAIArchitectProvider — reponses", () => {
  it("rend la structure et l'identifiant de reponse", async () => {
    const result = await provider({
      id: "resp_abc",
      output_text: VALID_PROPOSAL,
    }).generateTaskProposal(INPUT);

    assert.ok(result.ok);
    assert.equal(result.value.responseId, "resp_abc");
    assert.equal((result.value.raw as { title: string }).title, "Exporter les taches");
  });

  it("lit la consommation complete", async () => {
    const result = await provider({
      id: "r",
      output_text: VALID_PROPOSAL,
      usage: {
        input_tokens: 1_200,
        output_tokens: 300,
        total_tokens: 1_500,
        input_tokens_details: { cached_tokens: 800 },
      },
    }).generateTaskProposal(INPUT);

    assert.ok(result.ok);
    assert.deepEqual(result.value.usage, {
      inputTokens: 1_200,
      outputTokens: 300,
      totalTokens: 1_500,
      cachedInputTokens: 800,
    });
  });

  it("laisse nulle une consommation partielle", async () => {
    const result = await provider({
      id: "r",
      output_text: VALID_PROPOSAL,
      usage: { input_tokens: 10 },
    }).generateTaskProposal(INPUT);

    assert.ok(result.ok);
    // Rien n'est reconstitue : un total deduit serait un chiffre invente.
    assert.deepEqual(result.value.usage, {
      inputTokens: 10,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
    });
  });

  it("laisse nulle une consommation absente", async () => {
    const result = await provider({ id: "r", output_text: VALID_PROPOSAL }).generateTaskProposal(
      INPUT,
    );
    assert.ok(result.ok);
    assert.equal(result.value.usage.totalTokens, null);
  });

  it("reconnait un refus du modele", async () => {
    const result = await provider({
      id: "r",
      output_text: "",
      output: [{ content: [{ type: "refusal", refusal: "Je ne peux pas repondre." }] }],
    }).generateTaskProposal(INPUT);

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_REFUSED);
  });

  it("refuse une sortie vide", async () => {
    const result = await provider({ id: "r", output_text: "   " }).generateTaskProposal(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
  });

  it("refuse une sortie qui n'est pas du JSON", async () => {
    const result = await provider({ id: "r", output_text: "pas du json" }).generateTaskProposal(
      INPUT,
    );
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
  });
});

describe("OpenAIArchitectProvider — erreurs", () => {
  it("classe un delai depasse", async () => {
    const result = await provider(new APIConnectionTimeoutError({})).generateTaskProposal(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_TIMEOUT);
  });

  it("classe une limite d'utilisation", async () => {
    const error = APIError.generate(429, { error: { message: "rate" } }, "rate", new Headers());
    const result = await provider(error).generateTaskProposal(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_RATE_LIMITED);
  });

  it("classe une cle refusee", async () => {
    const error = APIError.generate(401, { error: { message: "auth" } }, "auth", new Headers());
    const result = await provider(error).generateTaskProposal(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED);
  });

  it("classe une requete refusee pour sa taille", async () => {
    const error = APIError.generate(400, { error: { message: "too long" } }, "long", new Headers());
    const result = await provider(error).generateTaskProposal(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE);
  });

  it("classe une panne serveur", async () => {
    const error = APIError.generate(500, { error: { message: "boom" } }, "boom", new Headers());
    const result = await provider(error).generateTaskProposal(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR);
  });

  it("n'expose aucun detail du fournisseur", async () => {
    const error = APIError.generate(
      500,
      { error: { message: "https://api.openai.com/v1/responses a echoue" } },
      "boom",
      new Headers({ authorization: "Bearer cle-de-test" }),
    );
    const result = await provider(error).generateTaskProposal(INPUT);

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("openai.com"), false);
    assert.equal(serialized.includes("cle-de-test"), false);
    assert.equal(serialized.includes("Bearer"), false);
  });
});

describe("FakeArchitectProvider", () => {
  it("rend les reponses dans l'ordre et enregistre les appels", async () => {
    const fake = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
      { ok: true, value: { raw: {}, responseId: "r", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: null } } },
    ]);

    assert.equal((await fake.generateTaskProposal(INPUT)).ok, false);
    assert.equal((await fake.generateTaskProposal(INPUT)).ok, true);
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[0]?.model, "modele-de-test");
  });
});

describe("loadArchitectConfig", () => {
  it("accepte une configuration complete", () => {
    const result = loadArchitectConfig({
      NOX_OPENAI_API_KEY: "cle",
      NOX_ARCHITECT_MODEL: "modele",
    });
    assert.ok(result.ok);
    assert.equal(result.config.model, "modele");
  });

  it("refuse une cle absente", () => {
    const result = loadArchitectConfig({ NOX_ARCHITECT_MODEL: "modele" });
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok ? [] : result.missing, ["NOX_OPENAI_API_KEY"]);
  });

  it("refuse un modele absent, sans en choisir un", () => {
    // Aucun defaut : choisir en silence reviendrait a choisir un cout a la place
    // de l'utilisateur.
    const result = loadArchitectConfig({ NOX_OPENAI_API_KEY: "cle" });
    assert.deepEqual(result.ok ? [] : result.missing, ["NOX_ARCHITECT_MODEL"]);
  });

  it("refuse une valeur vide comme une valeur absente", () => {
    const result = loadArchitectConfig({ NOX_OPENAI_API_KEY: "   ", NOX_ARCHITECT_MODEL: "" });
    assert.deepEqual(result.ok ? [] : result.missing, [
      "NOX_OPENAI_API_KEY",
      "NOX_ARCHITECT_MODEL",
    ]);
  });

  it("ignore une variable sans le prefixe NOX", () => {
    // `OPENAI_API_KEY` serait transmise a Claude Code : elle n'est jamais lue.
    const result = loadArchitectConfig({ OPENAI_API_KEY: "cle", NOX_ARCHITECT_MODEL: "modele" });
    assert.equal(result.ok, false);
  });
});
