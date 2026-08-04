import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkRunnerHealth, resolveRepositoryPath } from "./client.ts";
import { describeRunnerFailure, isRunnerUnavailable, type RunnerFailure } from "./errors.ts";

const TOKEN = "jeton-de-test-0123456789abcdef";
const ENVIRONMENT = {
  NOX_RUNNER_URL: "http://127.0.0.1:9999",
  NOX_RUNNER_TOKEN: TOKEN,
};

/** Construit un `fetch` simule renvoyant une reponse figee. */
function stubFetch(status: number, body: unknown, capture?: { request?: Request }) {
  return (input: string | URL | Request, init?: RequestInit) => {
    if (capture !== undefined) {
      capture.request = new Request(typeof input === "string" ? input : input.toString(), init);
    }
    return Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

function failureOf(result: { ok: boolean } & Record<string, unknown>): RunnerFailure {
  assert.equal(result.ok, false);
  return result["failure"] as RunnerFailure;
}

describe("checkRunnerHealth", () => {
  it("accepte une reponse de sante valide", async () => {
    const result = await checkRunnerHealth({
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { service: "nox-runner", status: "ok", version: "0.1.0" }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.version, "0.1.0");
  });

  it("signale une configuration absente", async () => {
    const result = await checkRunnerHealth({ environment: {}, fetch: stubFetch(200, {}) });
    assert.equal(failureOf(result).kind, "not_configured");
  });

  it("signale un runner arrete", async () => {
    const result = await checkRunnerHealth({
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:9999")),
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });

  it("signale un contrat inattendu", async () => {
    const result = await checkRunnerHealth({
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { service: "autre-service", status: "ok", version: "0.1.0" }),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });

  it("signale une reponse JSON invalide", async () => {
    const result = await checkRunnerHealth({
      environment: ENVIRONMENT,
      fetch: () =>
        Promise.resolve(
          new Response("pas du json", { status: 200, headers: { "content-type": "application/json" } }),
        ),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });

  it("n'envoie pas le jeton sur la route publique de sante", async () => {
    const capture: { request?: Request } = {};
    await checkRunnerHealth({
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { service: "nox-runner", status: "ok", version: "0.1.0" }, capture),
    });

    assert.equal(capture.request?.headers.get("authorization"), null);
  });
});

describe("resolveRepositoryPath", () => {
  it("retourne le chemin canonique", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\depot\\src", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, repository: { canonicalPath: "D:\\Projets\\depot" } }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value, "D:\\Projets\\depot");
  });

  it("envoie le jeton dans l'en-tete Authorization attendu", async () => {
    const capture: { request?: Request } = {};
    await resolveRepositoryPath("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, repository: { canonicalPath: "D:\\Projets\\depot" } }, capture),
    });

    assert.equal(capture.request?.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(capture.request?.headers.get("content-type"), "application/json");
    assert.equal(capture.request?.method, "POST");
    assert.equal(await capture.request?.text(), JSON.stringify({ repositoryPath: "D:\\Projets\\depot" }));
  });

  it("traduit un 401 en echec d'authentification", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: stubFetch(401, { ok: false, error: { code: "UNAUTHORIZED" } }),
    });

    assert.equal(failureOf(result).kind, "unauthorized");
  });

  it("traduit une erreur metier Git en code du contrat", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\sans-git", {
      environment: ENVIRONMENT,
      fetch: stubFetch(422, { ok: false, error: { code: "NOT_A_GIT_REPOSITORY" } }),
    });

    const runnerFailure = failureOf(result);
    assert.equal(runnerFailure.kind, "runner_error");
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "NOT_A_GIT_REPOSITORY");
    assert.match(describeRunnerFailure(runnerFailure), /repository Git/);
  });

  it("signale un runner arrete", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });

  it("signale un depassement de delai", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      timeoutMs: 20,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => { reject(new Error("aborted")); });
        }),
    });

    assert.equal(failureOf(result).kind, "timeout");
  });

  it("signale un contrat inattendu", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, repository: { chemin: "D:\\Projets\\depot" } }),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });

  it("signale un code d'erreur inconnu comme contrat inattendu", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: stubFetch(422, { ok: false, error: { code: "CODE_QUI_N_EXISTE_PAS" } }),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });

  it("signale une configuration absente sans appeler le runner", async () => {
    let called = false;
    const result = await resolveRepositoryPath("D:\\Projets\\depot", {
      environment: { NOX_RUNNER_URL: "http://127.0.0.1:9999" },
      fetch: () => {
        called = true;
        return Promise.resolve(new Response("{}"));
      },
    });

    assert.equal(failureOf(result).kind, "not_configured");
    assert.equal(called, false);
  });
});

describe("messages presentes a l'utilisateur", () => {
  const failures: RunnerFailure[] = [
    { kind: "not_configured" },
    { kind: "unreachable" },
    { kind: "timeout" },
    { kind: "unauthorized" },
    { kind: "invalid_response" },
    { kind: "runner_error", code: "NOT_A_GIT_REPOSITORY" },
    { kind: "runner_error", code: "GIT_NOT_AVAILABLE" },
    { kind: "runner_error", code: "INTERNAL_ERROR" },
  ];

  it("produit un message non vide pour chaque echec", () => {
    for (const runnerFailure of failures) {
      assert.ok(describeRunnerFailure(runnerFailure).length > 20, runnerFailure.kind);
    }
  });

  it("n'expose jamais le jeton ni l'URL interne", () => {
    for (const runnerFailure of failures) {
      const message = describeRunnerFailure(runnerFailure);
      assert.equal(message.includes(TOKEN), false, runnerFailure.kind);
      assert.equal(message.includes("127.0.0.1"), false, runnerFailure.kind);
      assert.equal(message.includes("9999"), false, runnerFailure.kind);
    }
  });

  it("distingue indisponibilite du runner et erreur de saisie", () => {
    assert.equal(isRunnerUnavailable({ kind: "unreachable" }), true);
    assert.equal(isRunnerUnavailable({ kind: "not_configured" }), true);
    assert.equal(isRunnerUnavailable({ kind: "runner_error", code: "PATH_NOT_FOUND" }), false);
  });
});
