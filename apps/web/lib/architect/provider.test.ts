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
  ARCHITECT_DIAGNOSTIC_FIELD,
  ARCHITECT_ERROR,
  ARCHITECT_SCHEMA_NAME,
  buildArchitectTurnSchema,
} from "@nox/shared";
import { APIError, APIConnectionTimeoutError, APIUserAbortError } from "openai";

import {
  ARCHITECT_ENVIRONMENT_VARIABLES,
  ARCHITECT_HARD_TIMEOUT_MS,
  ARCHITECT_OPTIONAL_ENVIRONMENT_VARIABLES,
  DEFAULT_ARCHITECT_MODEL,
  loadArchitectConfig,
} from "./config.ts";
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
    await provider({ id: "resp_1", output_text: VALID_PROPOSAL }, captures).generateTaskTurn(
      INPUT,
    );

    // La garantie la plus importante de TASK-013 : le modele ne peut declencher
    // aucune action parce qu'aucune ne lui est offerte.
    assert.equal("tools" in captures[0]!.body, false);
    assert.equal("tool_choice" in captures[0]!.body, false);
  });

  it("demande explicitement de ne rien stocker", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn(INPUT);

    assert.equal(captures[0]!.body["store"], false);
  });

  it("ne reprend aucune conversation precedente", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn(INPUT);

    assert.equal("previous_response_id" in captures[0]!.body, false);
    assert.equal("conversation" in captures[0]!.body, false);
    assert.equal("background" in captures[0]!.body, false);
  });

  it("impose le Structured Output strict", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn(INPUT);

    const format = (captures[0]!.body["text"] as { format: Record<string, unknown> }).format;
    assert.equal(format["type"], "json_schema");
    assert.equal(format["strict"], true);
    assert.equal(format["name"], ARCHITECT_SCHEMA_NAME);
  });

  it("utilise le modele fourni par le serveur", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn(INPUT);

    assert.equal(captures[0]!.body["model"], "modele-de-test");
  });

  it("desactive tout reessai automatique", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn(INPUT);

    // Chaque generation est facturee : un reessai invisible transformerait un
    // clic en plusieurs appels.
    assert.equal(captures[0]!.options["maxRetries"], 0);
    assert.equal(captures[0]!.options["timeout"], 1_000);
  });

  it("separe instructions et contexte", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn(INPUT);

    assert.equal(captures[0]!.body["instructions"], INPUT.instructions);
    assert.equal(captures[0]!.body["input"], INPUT.input);
  });

  it("ne transmet jamais la cle dans le corps", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn(INPUT);

    assert.equal(JSON.stringify(captures[0]!.body).includes("cle-de-test"), false);
  });
});

describe("OpenAIArchitectProvider — reponses", () => {
  it("rend la structure et l'identifiant de reponse", async () => {
    const result = await provider({
      id: "resp_abc",
      output_text: VALID_PROPOSAL,
    }).generateTaskTurn(INPUT);

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
    }).generateTaskTurn(INPUT);

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
    }).generateTaskTurn(INPUT);

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
    const result = await provider({ id: "r", output_text: VALID_PROPOSAL }).generateTaskTurn(
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
    }).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_REFUSED);
  });

  it("refuse une sortie vide, et la classe comme incomplete", async () => {
    // Ce test disait `ARCHITECT_OUTPUT_INVALID` jusqu'a HOTFIX-003. Une reponse
    // vide n'est pas une reponse malformee : il n'y a rien a analyser, donc
    // rien a imputer au contrat. La confusion coutait a l'utilisateur le seul
    // indice qui lui aurait dit de raccourcir sa demande plutot que de la
    // relancer a l'identique.
    const result = await provider({ id: "r", output_text: "   " }).generateTaskTurn(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE);
  });

  it("refuse une sortie qui n'est pas du JSON", async () => {
    const result = await provider({ id: "r", output_text: "pas du json" }).generateTaskTurn(
      INPUT,
    );
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
  });
});

describe("OpenAIArchitectProvider — erreurs", () => {
  it("classe un delai depasse", async () => {
    const result = await provider(new APIConnectionTimeoutError({})).generateTaskTurn(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_TIMEOUT);
  });

  it("classe une limite d'utilisation", async () => {
    const error = APIError.generate(429, { error: { message: "rate" } }, "rate", new Headers());
    const result = await provider(error).generateTaskTurn(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_RATE_LIMITED);
  });

  it("classe une cle refusee", async () => {
    const error = APIError.generate(401, { error: { message: "auth" } }, "auth", new Headers());
    const result = await provider(error).generateTaskTurn(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED);
  });

  it("classe une requete refusee pour sa taille", async () => {
    const error = APIError.generate(400, { error: { message: "too long" } }, "long", new Headers());
    const result = await provider(error).generateTaskTurn(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE);
  });

  it("classe une panne serveur", async () => {
    const error = APIError.generate(500, { error: { message: "boom" } }, "boom", new Headers());
    const result = await provider(error).generateTaskTurn(INPUT);
    assert.equal(result.ok ? null : result.code, ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR);
  });

  it("n'expose aucun detail du fournisseur", async () => {
    const error = APIError.generate(
      500,
      { error: { message: "https://api.openai.com/v1/responses a echoue" } },
      "boom",
      new Headers({ authorization: "Bearer cle-de-test" }),
    );
    const result = await provider(error).generateTaskTurn(INPUT);

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

    assert.equal((await fake.generateTaskTurn(INPUT)).ok, false);
    assert.equal((await fake.generateTaskTurn(INPUT)).ok, true);
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[0]?.model, "modele-de-test");
  });

  it("separe les appels de conversation et ceux de review", async () => {
    const response = {
      ok: true as const,
      value: {
        raw: {},
        responseId: "r",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: null },
      },
    };
    const fake = new FakeArchitectProvider([response, response]);

    await fake.generateTaskTurn(INPUT);
    await fake.analyzeRunReview(INPUT);

    // Un test qui veut prouver « zero appel de review » ne doit pas avoir a
    // filtrer lui-meme la liste commune.
    assert.equal(fake.turnCalls.length, 1);
    assert.equal(fake.reviewCalls.length, 1);
    assert.equal(fake.calls.length, 2);
  });
});

describe("OpenAIArchitectProvider — les deux surfaces", () => {
  it("envoie le meme corps minimal pour une review que pour un tour", async () => {
    const bodies: Record<string, unknown>[] = [];
    const provider = new OpenAIArchitectProvider({
      apiKey: "cle",
      client: {
        responses: {
          create: (body: Record<string, unknown>) => {
            bodies.push(body);
            return Promise.resolve({ id: "resp", output_text: "{}", output: [] });
          },
        },
      } as never,
    });

    await provider.generateTaskTurn(INPUT);
    await provider.analyzeRunReview({ ...INPUT, schemaName: "nox_architect_run_review" });

    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      assert.equal(body["store"], false);
      assert.ok(!Object.hasOwn(body, "tools"));
      assert.ok(!Object.hasOwn(body, "tool_choice"));
      assert.ok(!Object.hasOwn(body, "previous_response_id"));
      assert.ok(!Object.hasOwn(body, "conversation"));
      assert.ok(!Object.hasOwn(body, "background"));
    }
    // Chaque surface porte son propre schema.
    const first = bodies[0]?.["text"] as { format: { name: string } };
    const second = bodies[1]?.["text"] as { format: { name: string } };
    assert.notEqual(first.format.name, second.format.name);
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

  it("choisit le modele d'architecture quand aucun n'est configure", () => {
    // HOTFIX-001 : le defaut de fait n'etait pas « aucun modele », c'etait
    // « celui que l'utilisateur avait recopie ». Le pilote a decide une V1
    // entiere sur gpt-5-mini.
    const result = loadArchitectConfig({ NOX_OPENAI_API_KEY: "cle" });
    assert.ok(result.ok);
    assert.equal(result.config.model, DEFAULT_ARCHITECT_MODEL);
    assert.equal(result.config.model, "gpt-5.6-sol");
  });

  it("traite une valeur vide comme une valeur absente", () => {
    const result = loadArchitectConfig({ NOX_OPENAI_API_KEY: "cle", NOX_ARCHITECT_MODEL: "   " });
    assert.ok(result.ok);
    assert.equal(result.config.model, DEFAULT_ARCHITECT_MODEL);
  });

  it("ne retombe jamais sur gpt-5-mini", () => {
    for (const environment of [
      { NOX_OPENAI_API_KEY: "cle" },
      { NOX_OPENAI_API_KEY: "cle", NOX_ARCHITECT_MODEL: "" },
      { NOX_OPENAI_API_KEY: "cle", NOX_ARCHITECT_MODEL: "  " },
    ]) {
      const result = loadArchitectConfig(environment);
      assert.ok(result.ok);
      assert.notEqual(result.config.model, "gpt-5-mini");
    }
  });

  it("laisse la main a un modele explicitement configure", () => {
    // Configurer un modele est une decision, et NOX ne la reprend pas.
    const result = loadArchitectConfig({
      NOX_OPENAI_API_KEY: "cle",
      NOX_ARCHITECT_MODEL: "gpt-5-mini",
    });
    assert.ok(result.ok);
    assert.equal(result.config.model, "gpt-5-mini");
  });

  it("refuse une cle vide", () => {
    const result = loadArchitectConfig({ NOX_OPENAI_API_KEY: "   " });
    assert.deepEqual(result.ok ? [] : result.missing, ["NOX_OPENAI_API_KEY"]);
  });

  it("ignore une variable sans le prefixe NOX", () => {
    // `OPENAI_API_KEY` serait transmise a Claude Code : elle n'est jamais lue.
    const result = loadArchitectConfig({ OPENAI_API_KEY: "cle", NOX_ARCHITECT_MODEL: "modele" });
    assert.equal(result.ok, false);
  });

  it("ne demande un effort de raisonnement que pour le modele qu'il choisit", () => {
    const chosen = loadArchitectConfig({ NOX_OPENAI_API_KEY: "cle" });
    assert.ok(chosen.ok);
    assert.equal(chosen.config.reasoningEffort, "high");

    // NOX ne connait pas les capacites d'un modele configure a la main : un
    // `400` sur un parametre inconnu serait un echec que personne n'a demande.
    const configured = loadArchitectConfig({
      NOX_OPENAI_API_KEY: "cle",
      NOX_ARCHITECT_MODEL: "gpt-4.1",
    });
    assert.ok(configured.ok);
    assert.equal(configured.config.reasoningEffort, null);

    // Le meme modele configure explicitement en recoit un : l'effort suit le
    // modele, pas la provenance de la valeur.
    const explicit = loadArchitectConfig({
      NOX_OPENAI_API_KEY: "cle",
      NOX_ARCHITECT_MODEL: DEFAULT_ARCHITECT_MODEL,
    });
    assert.ok(explicit.ok);
    assert.equal(explicit.config.reasoningEffort, "high");
  });

  it("ne reclame que la cle", () => {
    // `NOX_ARCHITECT_MODEL` est devenue facultative : un ecran qui l'annoncerait
    // « manquante » enverrait renseigner ce qui n'est pas impose.
    assert.deepEqual([...ARCHITECT_ENVIRONMENT_VARIABLES], ["NOX_OPENAI_API_KEY"]);
    assert.deepEqual([...ARCHITECT_OPTIONAL_ENVIRONMENT_VARIABLES], ["NOX_ARCHITECT_MODEL"]);
  });
});

describe("effort de raisonnement — les trois surfaces a forte consequence", () => {
  /**
   * Le corps reellement envoye, pour une surface donnee.
   *
   * L'assertion porte sur ce qui part au fournisseur, pas sur ce qu'une couche
   * intermediaire a promis de transmettre.
   */
  async function bodyFor(
    surface: "generateTaskTurn" | "generateBacklog" | "analyzeRunReview",
    model: string,
  ): Promise<Record<string, unknown>> {
    const captures: Capture[] = [];
    const client = provider({ id: "r", output_text: VALID_PROPOSAL }, captures);
    await client[surface]({ ...INPUT, model });
    return captures[0]!.body;
  }

  const surfaces = ["generateTaskTurn", "generateBacklog", "analyzeRunReview"] as const;

  for (const surface of surfaces) {
    it(`transmet le modele et l'effort par defaut — ${surface}`, async () => {
      const body = await bodyFor(surface, DEFAULT_ARCHITECT_MODEL);

      assert.equal(body["model"], "gpt-5.6-sol");
      assert.deepEqual(body["reasoning"], { effort: "high" });
    });

    it(`ne demande aucun resume de raisonnement — ${surface}`, async () => {
      const body = await bodyFor(surface, DEFAULT_ARCHITECT_MODEL);
      const reasoning = body["reasoning"] as Record<string, unknown>;

      // NOX ne demande jamais le raisonnement interne d'un modele : il n'en
      // recevrait rien de bon, et n'aurait nulle part ou le mettre.
      assert.deepEqual(Object.keys(reasoning), ["effort"]);
      assert.equal("include" in body, false);
    });

    it(`n'impose aucun effort a un modele configure a la main — ${surface}`, async () => {
      const body = await bodyFor(surface, "gpt-4.1");

      assert.equal(body["model"], "gpt-4.1");
      assert.equal("reasoning" in body, false);
    });
  }
});

// ---------------------------------------------------------------------------
// HOTFIX-003 — classification des reponses inexploitables
// ---------------------------------------------------------------------------

/**
 * Une reponse recue peut echouer de trois facons differentes.
 *
 * Jusqu'a HOTFIX-003, les trois rendaient `ARCHITECT_OUTPUT_INVALID` sans un
 * mot de plus, et l'utilisateur lisait « le format attendu n'est pas
 * respecte ». Le second pilote reel a vu ce message deux fois de suite sans
 * pouvoir savoir laquelle des trois s'etait produite.
 *
 * Aucun appel reseau ici : le client OpenAI est injecte.
 */
describe("OpenAIArchitectProvider — reponses inexploitables", () => {
  it("classe une reponse declaree incomplete a part, avec son motif", async () => {
    // Le cas le plus probable des tours 8 et 9 : un modele de raisonnement qui
    // s'arrete avant d'avoir rendu son JSON. La reponse arrive, le fournisseur
    // dit lui-meme qu'elle est incomplete, et NOX la classait « format
    // invalide » — en conseillant de relancer sans savoir quoi raccourcir.
    const result = await provider({
      id: "r",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: "",
    }).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE);
    assert.equal(result.diagnostic?.field, ARCHITECT_DIAGNOSTIC_FIELD.INCOMPLETE);
    assert.match(result.diagnostic?.message ?? "", /max_output_tokens/u);
  });

  it("lit l'incompletude avant le texte, meme si un debut de JSON est lisible", async () => {
    // Une reponse coupee peut porter un JSON valide jusqu'a sa troncature.
    // L'analyser produirait soit une erreur de syntaxe imputee au contrat, soit
    // pire, un objet partiel accepte par hasard.
    const result = await provider({
      id: "r",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: VALID_PROPOSAL,
    }).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE);
    }
  });

  it("classe une reponse vide comme incomplete, jamais comme un contrat viole", async () => {
    const result = await provider({ id: "r", output_text: "   " }).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE);
      assert.notEqual(result.diagnostic, undefined);
    }
  });

  it("classe un texte illisible comme un JSON malforme, en le nommant", async () => {
    const result = await provider({
      id: "r",
      output_text: "Bien sur ! Voici le plan : { incomplet",
    }).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
      assert.equal(result.diagnostic?.field, ARCHITECT_DIAGNOSTIC_FIELD.JSON);
    }
  });

  it("ne recopie jamais le texte recu dans le diagnostic", async () => {
    // Le texte porterait du contenu de projet. Savoir que l'analyse a echoue
    // suffit a orienter ; le lire ne servirait a rien et exposerait tout.
    const secret = "Le plan confidentiel de TicketPulse et sa cle sk-proj-abc";
    const result = await provider({ id: "r", output_text: secret }).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.diagnostic);
      assert.equal(serialized.includes(secret), false);
      assert.equal(serialized.includes("sk-proj"), false);
      assert.equal(serialized.includes("TicketPulse"), false);
    }
  });

  it("n'accepte comme motif qu'un identifiant du contrat du fournisseur", async () => {
    // NOX ne recopie pas une chaine arbitraire venue du reseau dans un
    // diagnostic qu'il va persister et afficher.
    const result = await provider({
      id: "r",
      status: "incomplete",
      incomplete_details: { reason: "<script>alert(1)</script> chemin C:\\secret" },
      output_text: "",
    }).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.diagnostic?.message ?? "", /unknown/u);
      assert.equal((result.diagnostic?.message ?? "").includes("<script>"), false);
      assert.equal((result.diagnostic?.message ?? "").includes("C:"), false);
    }
  });

  it("un statut complete n'est jamais traite comme incomplet", async () => {
    const result = await provider({
      id: "r",
      status: "completed",
      output_text: VALID_PROPOSAL,
    }).generateTaskTurn(INPUT);

    assert.ok(result.ok);
  });

  it("une reponse sans champ status reste lue normalement", async () => {
    // Retrocompatibilite : rien n'exige que le fournisseur declare un statut.
    const result = await provider({ id: "r", output_text: VALID_PROPOSAL }).generateTaskTurn(INPUT);

    assert.ok(result.ok);
  });
});

describe("HOTFIX-003 — le delai reste distinct d'une reponse refusee", () => {
  it("un delai depasse ne porte aucun diagnostic de contrat", async () => {
    // Requirement 10 : le timeout se classe a part. Les tours 5-6 du pilote et
    // ses tours 8-9 n'ont pas la meme cause, et ne doivent pas se lire pareil.
    const timeout = Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
    const result = await provider(timeout).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.notEqual(result.code, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
      assert.notEqual(result.code, ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE);
      // Aucune reponse n'a ete recue : il n'y a rien a diagnostiquer.
      assert.equal(result.diagnostic, undefined);
    }
  });

  it("transmet le delai configure au client, par requete", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn({
      ...INPUT,
      timeoutMs: 90_000,
    });

    assert.equal(captures[0]?.options["timeout"], 90_000);
    // Aucun reessai automatique : un echec ne doit jamais produire une seconde
    // facture ni une proposition dupliquee.
    assert.equal(captures[0]?.options["maxRetries"], 0);
  });
});

/**
 * HOTFIX-004 — le plafond, et l'abandon.
 *
 * ## Ce que le second pilote reel a montre
 *
 * Quatre depassements de delai sur deux charges de travail distinctes, et une
 * seule reussite — obtenue en raccourcissant la demande. Quatre-vingt-dix
 * secondes n'etait donc pas un garde-fou mais une echeance de travail, et elle
 * ne tenait pas.
 *
 * Ces tests fixent les deux moities du correctif a l'endroit ou elles vivent
 * reellement : la valeur transmise au client, et la maniere dont un abandon se
 * distingue d'un delai depasse.
 */
describe("HOTFIX-004 — plafond de securite et abandon", () => {
  it("transmet le plafond genereux au client, toujours par requete", async () => {
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn({
      ...INPUT,
      timeoutMs: ARCHITECT_HARD_TIMEOUT_MS,
    });

    assert.equal(captures[0]?.options["timeout"], ARCHITECT_HARD_TIMEOUT_MS);
    // Inchange, et non negociable : un plafond plus genereux ne doit surtout
    // pas s'accompagner d'un reessai, qui doublerait la facture d'une attente
    // deja longue.
    assert.equal(captures[0]?.options["maxRetries"], 0);
  });

  it("le plafond laisse passer une generation de plusieurs minutes", () => {
    // Requirement 1 : un travail qui depasse l'ancienne echeance doit aboutir.
    assert.equal(ARCHITECT_HARD_TIMEOUT_MS > 90_000, true);
  });

  it("transmet le signal d'abandon jusqu'au client", async () => {
    // La garantie centrale : sans cela, `Arrêter` ne ferait que changer une
    // ligne en base pendant que le fournisseur continue de travailler et de
    // facturer.
    const captures: Capture[] = [];
    const controller = new AbortController();
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn({
      ...INPUT,
      signal: controller.signal,
    });

    assert.equal(captures[0]?.options["signal"], controller.signal);
  });

  it("n'envoie aucun signal quand la surface n'en fournit pas", async () => {
    // Le rafraichissement de verification et l'analyse de review n'exposent
    // aucun arret : leur requete ne doit pas porter un signal fantome.
    const captures: Capture[] = [];
    await provider({ id: "r", output_text: VALID_PROPOSAL }, captures).generateTaskTurn(INPUT);

    assert.equal("signal" in (captures[0]?.options ?? {}), false);
  });

  it("un abandon se classe comme arret, jamais comme delai depasse", async () => {
    // Une **vraie** instance du SDK : la classification repose sur
    // `instanceof`, et un objet qui se contente d'en porter le nom ne prouverait
    // rien de ce que le code fait en production.
    const result = await provider(new APIUserAbortError()).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, ARCHITECT_ERROR.ARCHITECT_CANCELLED);
      assert.notEqual(result.code, ARCHITECT_ERROR.ARCHITECT_TIMEOUT);
      assert.notEqual(result.code, ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR);
      // Aucune reponse recue : rien a diagnostiquer, et rien a inventer.
      assert.equal(result.diagnostic, undefined);
    }
  });

  it("un plafond atteint reste un delai depasse, et non un arret", async () => {
    // Requirement 2 : les deux causes se distinguent, et le SDK les distingue
    // lui-meme. Les confondre ferait lire une panne comme une decision humaine.
    const result = await provider(new APIConnectionTimeoutError({})).generateTaskTurn(INPUT);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, ARCHITECT_ERROR.ARCHITECT_TIMEOUT);
      assert.notEqual(result.code, ARCHITECT_ERROR.ARCHITECT_CANCELLED);
    }
  });

  it("les diagnostics de HOTFIX-003 restent inchanges", async () => {
    // Requirement 18 : le plafond et l'arret n'ont rien reclasse.
    const incomplete = await provider({
      id: "r",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: "",
    }).generateTaskTurn(INPUT);
    assert.equal(incomplete.ok, false);
    if (!incomplete.ok) {
      assert.equal(incomplete.code, ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE);
    }

    const malformed = await provider({ id: "r", output_text: "pas du json" }).generateTaskTurn(
      INPUT,
    );
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.equal(malformed.code, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
    }
  });
});
