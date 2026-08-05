import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkRunnerHealth,
  listProjectDocuments,
  readProjectDocument,
  resolveRepositoryPath,
} from "./client.ts";
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

describe("listProjectDocuments", () => {
  const documents = [
    {
      path: "docs/PROJECT_BRIEF.md",
      name: "PROJECT_BRIEF.md",
      category: "CORE",
      size: 4821,
      updatedAt: "2026-08-04T18:30:00.000Z",
    },
  ];

  it("retourne l'inventaire", async () => {
    const result = await listProjectDocuments("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, documents }),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.value, documents);
  });

  it("accepte un inventaire vide", async () => {
    const result = await listProjectDocuments("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, documents: [] }),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.value, []);
  });

  it("envoie le jeton et le chemin du repository", async () => {
    const capture: { request?: Request } = {};
    await listProjectDocuments("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, documents: [] }, capture),
    });

    assert.equal(capture.request?.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(capture.request?.url.endsWith("/repositories/documents/list"), true);
    assert.equal(
      await capture.request?.text(),
      JSON.stringify({ repositoryPath: "D:\\Projets\\depot" }),
    );
  });

  it("signale un runner arrete", async () => {
    const result = await listProjectDocuments("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });

  it("signale une erreur d'authentification", async () => {
    const result = await listProjectDocuments("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: stubFetch(401, { ok: false, error: { code: "UNAUTHORIZED" } }),
    });

    assert.equal(failureOf(result).kind, "unauthorized");
  });

  it("traduit un repository disparu", async () => {
    const result = await listProjectDocuments("D:\\Projets\\depot", {
      environment: ENVIRONMENT,
      fetch: stubFetch(422, { ok: false, error: { code: "REPOSITORY_NOT_FOUND" } }),
    });

    const runnerFailure = failureOf(result);
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "REPOSITORY_NOT_FOUND");
    assert.match(describeRunnerFailure(runnerFailure), /deplace ou supprime/);
  });

  it("refuse un inventaire hors contrat", async () => {
    for (const body of [
      { ok: true, documents: [{ path: "a.md" }] },
      { ok: true, documents: [{ ...documents[0], category: "INCONNUE" }] },
      { ok: true, documents: "pas un tableau" },
      { ok: true },
    ]) {
      const result = await listProjectDocuments("D:\\Projets\\depot", {
        environment: ENVIRONMENT,
        fetch: stubFetch(200, body),
      });

      assert.equal(failureOf(result).kind, "invalid_response", JSON.stringify(body));
    }
  });
});

describe("readProjectDocument", () => {
  const document = {
    path: "docs/PROJECT_BRIEF.md",
    name: "PROJECT_BRIEF.md",
    category: "CORE",
    size: 9,
    updatedAt: "2026-08-04T18:30:00.000Z",
    content: "# Brief\n",
  };

  it("retourne le document et son contenu", async () => {
    const result = await readProjectDocument("D:\\Projets\\depot", "docs/PROJECT_BRIEF.md", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, document }),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.value, document);
  });

  it("transmet un chemin relatif et n'en recoit pas d'absolu", async () => {
    const capture: { request?: Request } = {};
    const result = await readProjectDocument("D:\\Projets\\depot", "docs/PROJECT_BRIEF.md", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, document }, capture),
    });

    assert.equal(
      await capture.request?.text(),
      JSON.stringify({
        repositoryPath: "D:\\Projets\\depot",
        documentPath: "docs/PROJECT_BRIEF.md",
      }),
    );
    // Le contrat ne comporte aucun champ de chemin absolu.
    assert.equal(result.ok && result.value.path, "docs/PROJECT_BRIEF.md");
    assert.equal(result.ok && JSON.stringify(result.value).includes("D:\\\\Projets"), false);
  });

  it("signale un document absent", async () => {
    const result = await readProjectDocument("D:\\Projets\\depot", "docs/ABSENT.md", {
      environment: ENVIRONMENT,
      fetch: stubFetch(404, { ok: false, error: { code: "DOCUMENT_NOT_FOUND" } }),
    });

    const runnerFailure = failureOf(result);
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "DOCUMENT_NOT_FOUND");
    assert.match(describeRunnerFailure(runnerFailure), /n'existe plus/);
  });

  it("signale un document trop volumineux", async () => {
    const result = await readProjectDocument("D:\\Projets\\depot", "docs/ENORME.md", {
      environment: ENVIRONMENT,
      fetch: stubFetch(413, { ok: false, error: { code: "DOCUMENT_TOO_LARGE" } }),
    });

    const runnerFailure = failureOf(result);
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "DOCUMENT_TOO_LARGE");
    assert.match(describeRunnerFailure(runnerFailure), /taille maximale/);
  });

  it("signale un refus de confinement", async () => {
    const result = await readProjectDocument("D:\\Projets\\depot", "docs/FUITE.md", {
      environment: ENVIRONMENT,
      fetch: stubFetch(403, { ok: false, error: { code: "DOCUMENT_OUTSIDE_REPOSITORY" } }),
    });

    assert.match(describeRunnerFailure(failureOf(result)), /hors du repository/);
  });

  it("refuse une reponse hors contrat", async () => {
    for (const body of [
      { ok: true, document: { ...document, content: 42 } },
      { ok: true, document: { path: "a.md" } },
      { ok: true },
    ]) {
      const result = await readProjectDocument("D:\\Projets\\depot", "docs/a.md", {
        environment: ENVIRONMENT,
        fetch: stubFetch(200, body),
      });

      assert.equal(failureOf(result).kind, "invalid_response", JSON.stringify(body));
    }
  });

  it("signale une configuration absente sans appeler le runner", async () => {
    let called = false;
    const result = await readProjectDocument("D:\\Projets\\depot", "docs/a.md", {
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
    { kind: "runner_error", code: "REPOSITORY_NOT_FOUND" },
    { kind: "runner_error", code: "DOCUMENT_NOT_FOUND" },
    { kind: "runner_error", code: "DOCUMENT_TOO_LARGE" },
    { kind: "runner_error", code: "DOCUMENT_OUTSIDE_REPOSITORY" },
    { kind: "runner_error", code: "DOCUMENT_NOT_UTF8" },
    { kind: "runner_error", code: "TOO_MANY_DOCUMENTS" },
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
