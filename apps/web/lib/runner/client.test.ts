import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkRunnerHealth,
  claudePreflight,
  cancelClaudeRun,
  fetchClaudeRunEvents,
  fetchClaudeRunReview,
  fetchClaudeRunStatus,
  startClaudeRun,
  createProjectDocument,
  createTaskDocument,
  deleteProjectDocument,
  deleteTaskDocument,
  listProjectDocuments,
  readProjectDocument,
  resolveRepositoryPath,
  updateProjectDocument,
} from "./client.ts";
import {
  describeRunnerFailure,
  isDocumentAlreadyExists,
  isDocumentConflict,
  isRunnerUnavailable,
  type RunnerFailure,
} from "./errors.ts";

const TOKEN = "jeton-de-test-0123456789abcdef";
/** Revision fictive, au format attendu par le contrat : SHA-256 hexadecimal. */
const REVISION = "a".repeat(64);
const NEXT_REVISION = "b".repeat(64);
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
    revision: REVISION,
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
      // Une revision absente ou mal formee rend la protection contre les
      // conflits inoperante : la reponse est rejetee, pas rattrapee.
      { ok: true, document: { ...document, revision: undefined } },
      { ok: true, document: { ...document, revision: "pas-une-empreinte" } },
    ]) {
      const result = await readProjectDocument("D:\\Projets\\depot", "docs/a.md", {
        environment: ENVIRONMENT,
        fetch: stubFetch(200, body),
      });

      assert.equal(failureOf(result).kind, "invalid_response", JSON.stringify(body));
    }
  });

  it("retourne la revision du document", async () => {
    const result = await readProjectDocument("D:\\Projets\\depot", "docs/PROJECT_BRIEF.md", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, document }),
    });

    assert.equal(result.ok && result.value.revision, REVISION);
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

describe("updateProjectDocument", () => {
  const saved = {
    path: "docs/PROJECT_BRIEF.md",
    name: "PROJECT_BRIEF.md",
    category: "CORE",
    size: 18,
    updatedAt: "2026-08-05T09:00:00.000Z",
    content: "# Brief revu\n",
    revision: NEXT_REVISION,
  };

  it("retourne le document enregistre et sa nouvelle revision", async () => {
    const result = await updateProjectDocument(
      "D:\\Projets\\depot",
      "docs/PROJECT_BRIEF.md",
      "# Brief revu\n",
      REVISION,
      { environment: ENVIRONMENT, fetch: stubFetch(200, { ok: true, document: saved }) },
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.revision, NEXT_REVISION);
    assert.equal(result.ok && result.value.content, "# Brief revu\n");
  });

  it("envoie les quatre champs, et le jeton dans le seul en-tete", async () => {
    const capture: { request?: Request } = {};
    await updateProjectDocument(
      "D:\\Projets\\depot",
      "docs/PROJECT_BRIEF.md",
      "# Brief revu\n",
      REVISION,
      {
        environment: ENVIRONMENT,
        fetch: stubFetch(200, { ok: true, document: saved }, capture),
      },
    );

    assert.equal(capture.request?.method, "POST");
    assert.equal(capture.request?.url.endsWith("/repositories/documents/update"), true);
    assert.equal(capture.request?.headers.get("authorization"), `Bearer ${TOKEN}`);

    const body = await capture.request?.text();
    assert.equal(
      body,
      JSON.stringify({
        repositoryPath: "D:\\Projets\\depot",
        documentPath: "docs/PROJECT_BRIEF.md",
        content: "# Brief revu\n",
        expectedRevision: REVISION,
      }),
    );
    // Le jeton voyage dans l'en-tete, jamais dans le corps.
    assert.equal(body?.includes(TOKEN), false);
  });

  it("transmet un contenu vide sans le transformer", async () => {
    const capture: { request?: Request } = {};
    await updateProjectDocument("D:\\Projets\\depot", "docs/a.md", "", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, document: { ...saved, content: "", size: 0 } }, capture),
    });

    assert.equal(JSON.parse((await capture.request?.text()) ?? "{}").content, "");
  });

  it("traduit un conflit de revision", async () => {
    const result = await updateProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(409, { ok: false, error: { code: "DOCUMENT_CONFLICT" } }),
    });

    const runnerFailure = failureOf(result);
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "DOCUMENT_CONFLICT");
    assert.equal(isDocumentConflict(runnerFailure), true);
    assert.match(describeRunnerFailure(runnerFailure), /modifie depuis son ouverture/);
  });

  it("traduit un refus d'ecriture dans un lien symbolique", async () => {
    const result = await updateProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(403, { ok: false, error: { code: "DOCUMENT_SYMLINK_NOT_WRITABLE" } }),
    });

    assert.match(describeRunnerFailure(failureOf(result)), /lien symbolique/);
  });

  it("traduit un document absent", async () => {
    const result = await updateProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(404, { ok: false, error: { code: "DOCUMENT_NOT_FOUND" } }),
    });

    const runnerFailure = failureOf(result);
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "DOCUMENT_NOT_FOUND");
  });

  it("traduit un contenu trop volumineux", async () => {
    const result = await updateProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(413, { ok: false, error: { code: "DOCUMENT_TOO_LARGE" } }),
    });

    assert.match(describeRunnerFailure(failureOf(result)), /taille maximale/);
  });

  it("traduit une authentification refusee", async () => {
    const result = await updateProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(401, { ok: false, error: { code: "UNAUTHORIZED" } }),
    });

    assert.equal(failureOf(result).kind, "unauthorized");
  });

  it("signale un runner arrete", async () => {
    const result = await updateProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", REVISION, {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });

  it("refuse une reponse hors contrat", async () => {
    for (const body of [
      { ok: true, document: { ...saved, revision: "trop-court" } },
      { ok: true, document: { ...saved, content: undefined } },
      { ok: true },
      { ok: true, document: null },
    ]) {
      const result = await updateProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", REVISION, {
        environment: ENVIRONMENT,
        fetch: stubFetch(200, body),
      });

      assert.equal(failureOf(result).kind, "invalid_response", JSON.stringify(body));
    }
  });

  it("signale une configuration absente sans appeler le runner", async () => {
    let called = false;
    const result = await updateProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", REVISION, {
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

describe("createProjectDocument", () => {
  const created = {
    path: "docs/PRODUCT_VISION.md",
    name: "PRODUCT_VISION.md",
    category: "CORE",
    size: 9,
    updatedAt: "2026-08-05T09:00:00.000Z",
    content: "# Vision\n",
    revision: REVISION,
  };

  it("accepte un statut 201 et retourne le document cree", async () => {
    const result = await createProjectDocument(
      "D:\\Projets\\depot",
      "docs/PRODUCT_VISION.md",
      "# Vision\n",
      { environment: ENVIRONMENT, fetch: stubFetch(201, { ok: true, document: created }) },
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.path, "docs/PRODUCT_VISION.md");
    assert.equal(result.ok && result.value.revision, REVISION);
  });

  it("refuse un 200 : la creation doit annoncer une ressource nouvelle", async () => {
    const result = await createProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, document: created }),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });

  it("envoie les trois champs, et le jeton dans le seul en-tete", async () => {
    const capture: { request?: Request } = {};
    await createProjectDocument("D:\\Projets\\depot", "docs/PRODUCT_VISION.md", "# Vision\n", {
      environment: ENVIRONMENT,
      fetch: stubFetch(201, { ok: true, document: created }, capture),
    });

    assert.equal(capture.request?.method, "POST");
    assert.equal(capture.request?.url.endsWith("/repositories/documents/create"), true);
    assert.equal(capture.request?.headers.get("authorization"), `Bearer ${TOKEN}`);

    const body = await capture.request?.text();
    assert.equal(
      body,
      JSON.stringify({
        repositoryPath: "D:\\Projets\\depot",
        documentPath: "docs/PRODUCT_VISION.md",
        content: "# Vision\n",
      }),
    );
    assert.equal(body?.includes(TOKEN), false);
  });

  it("transmet un contenu initial vide sans le transformer", async () => {
    const capture: { request?: Request } = {};
    await createProjectDocument("D:\\Projets\\depot", "docs/a.md", "", {
      environment: ENVIRONMENT,
      fetch: stubFetch(201, { ok: true, document: { ...created, content: "", size: 0 } }, capture),
    });

    assert.equal(JSON.parse((await capture.request?.text()) ?? "{}").content, "");
  });

  it("traduit un document deja present comme conflit distinct", async () => {
    const result = await createProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", {
      environment: ENVIRONMENT,
      fetch: stubFetch(409, { ok: false, error: { code: "DOCUMENT_ALREADY_EXISTS" } }),
    });

    const runnerFailure = failureOf(result);
    assert.equal(isDocumentAlreadyExists(runnerFailure), true);
    // Il ne doit pas etre confondu avec le conflit de revision de l'edition.
    assert.equal(isDocumentConflict(runnerFailure), false);
    assert.match(describeRunnerFailure(runnerFailure), /ne le remplace jamais/);
  });

  it("traduit un dossier parent absent", async () => {
    const result = await createProjectDocument("D:\\Projets\\depot", "docs/x/a.md", "# X\n", {
      environment: ENVIRONMENT,
      fetch: stubFetch(404, { ok: false, error: { code: "DOCUMENT_PARENT_NOT_FOUND" } }),
    });

    assert.match(describeRunnerFailure(failureOf(result)), /ne cree aucun dossier/);
  });

  it("traduit un parent lien symbolique", async () => {
    const result = await createProjectDocument("D:\\Projets\\depot", "docs/lien/a.md", "# X\n", {
      environment: ENVIRONMENT,
      fetch: stubFetch(403, { ok: false, error: { code: "DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED" } }),
    });

    assert.match(describeRunnerFailure(failureOf(result)), /c'est un lien/);
  });

  it("traduit un nom non portable", async () => {
    const result = await createProjectDocument("D:\\Projets\\depot", "docs/CON.md", "# X\n", {
      environment: ENVIRONMENT,
      fetch: stubFetch(400, { ok: false, error: { code: "DOCUMENT_NAME_NOT_PORTABLE" } }),
    });

    assert.match(describeRunnerFailure(failureOf(result)), /noms reserves/);
  });

  it("traduit un contenu trop volumineux", async () => {
    const result = await createProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", {
      environment: ENVIRONMENT,
      fetch: stubFetch(413, { ok: false, error: { code: "DOCUMENT_TOO_LARGE" } }),
    });

    assert.match(describeRunnerFailure(failureOf(result)), /taille maximale/);
  });

  it("traduit une authentification refusee", async () => {
    const result = await createProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", {
      environment: ENVIRONMENT,
      fetch: stubFetch(401, { ok: false, error: { code: "UNAUTHORIZED" } }),
    });

    assert.equal(failureOf(result).kind, "unauthorized");
  });

  it("signale un runner arrete", async () => {
    const result = await createProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });

  it("refuse une reponse hors contrat", async () => {
    for (const body of [
      { ok: true, document: { ...created, revision: "trop-court" } },
      { ok: true, document: { ...created, content: undefined } },
      { ok: true },
      { ok: true, document: null },
    ]) {
      const result = await createProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", {
        environment: ENVIRONMENT,
        fetch: stubFetch(201, body),
      });

      assert.equal(failureOf(result).kind, "invalid_response", JSON.stringify(body));
    }
  });

  it("signale une configuration absente sans appeler le runner", async () => {
    let called = false;
    const result = await createProjectDocument("D:\\Projets\\depot", "docs/a.md", "# X\n", {
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

describe("deleteProjectDocument", () => {
  it("accepte une suppression reussie", async () => {
    const result = await deleteProjectDocument("D:\\depot", "docs/NOTE.md", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, deleted: { path: "docs/NOTE.md", revision: REVISION } }),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, { path: "docs/NOTE.md", revision: REVISION });
  });

  it("envoie le chemin, la revision et le jeton", async () => {
    const capture: { request?: Request } = {};
    await deleteProjectDocument("D:\\depot", "docs/NOTE.md", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, deleted: { path: "docs/NOTE.md", revision: REVISION } }, capture),
    });

    const request = capture.request;
    assert.ok(request !== undefined);
    assert.equal(request.method, "POST");
    assert.equal(new URL(request.url).pathname, "/repositories/documents/delete");
    assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);

    assert.deepEqual(await request.json(), {
      repositoryPath: "D:\\depot",
      documentPath: "docs/NOTE.md",
      expectedRevision: REVISION,
    });
  });

  it("remonte un conflit de revision", async () => {
    const result = await deleteProjectDocument("D:\\depot", "docs/NOTE.md", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(409, { ok: false, error: { code: "DOCUMENT_DELETE_CONFLICT" } }),
    });

    assert.deepEqual(failureOf(result), {
      kind: "runner_error",
      code: "DOCUMENT_DELETE_CONFLICT",
    });
  });

  it("remonte un refus de protection", async () => {
    const result = await deleteProjectDocument("D:\\depot", "tasks/TASK-001.md", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(403, { ok: false, error: { code: "DOCUMENT_PROTECTED" } }),
    });

    assert.deepEqual(failureOf(result), { kind: "runner_error", code: "DOCUMENT_PROTECTED" });
  });

  it("refuse une reponse hors contrat", async () => {
    const result = await deleteProjectDocument("D:\\depot", "docs/NOTE.md", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, deleted: { path: "docs/NOTE.md" } }),
    });

    assert.deepEqual(failureOf(result), { kind: "invalid_response" });
  });

  it("ne conclut rien d'un runner injoignable", async () => {
    const result = await deleteProjectDocument("D:\\depot", "docs/NOTE.md", REVISION, {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });

    assert.deepEqual(failureOf(result), { kind: "unreachable" });
  });
});

describe("deleteTaskDocument", () => {
  it("accepte une suppression effective", async () => {
    const result = await deleteTaskDocument("D:\\depot", "TASK-001", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, {
        ok: true,
        deleted: true,
        alreadyAbsent: false,
        path: "tasks/TASK-001.md",
      }),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.deleted, true);
    assert.equal(result.value.alreadyAbsent, false);
    assert.equal(result.value.path, "tasks/TASK-001.md");
  });

  it("accepte une absence comme une reussite", async () => {
    const result = await deleteTaskDocument("D:\\depot", "TASK-042", null, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, {
        ok: true,
        deleted: false,
        alreadyAbsent: true,
        path: "tasks/TASK-042.md",
      }),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.alreadyAbsent, true);
  });

  it("envoie le code et la revision, jamais un chemin", async () => {
    const capture: { request?: Request } = {};
    await deleteTaskDocument("D:\\depot", "TASK-001", REVISION, {
      environment: ENVIRONMENT,
      fetch: stubFetch(
        200,
        { ok: true, deleted: true, alreadyAbsent: false, path: "tasks/TASK-001.md" },
        capture,
      ),
    });

    const request = capture.request;
    assert.ok(request !== undefined);
    assert.equal(new URL(request.url).pathname, "/repositories/tasks/delete-document");

    const body: unknown = await request.json();
    assert.deepEqual(body, {
      repositoryPath: "D:\\depot",
      taskCode: "TASK-001",
      expectedRevision: REVISION,
    });
    // Le contrat ne transporte aucun chemin : c'est le runner qui compose
    // `tasks/<code>.md`.
    assert.equal(Object.keys(body as object).includes("documentPath"), false);
  });

  it("transmet une revision nulle telle quelle", async () => {
    const capture: { request?: Request } = {};
    await deleteTaskDocument("D:\\depot", "TASK-042", null, {
      environment: ENVIRONMENT,
      fetch: stubFetch(
        200,
        { ok: true, deleted: false, alreadyAbsent: true, path: "tasks/TASK-042.md" },
        capture,
      ),
    });

    const request = capture.request;
    assert.ok(request !== undefined);
    assert.deepEqual(await request.json(), {
      repositoryPath: "D:\\depot",
      taskCode: "TASK-042",
      expectedRevision: null,
    });
  });

  it("remonte un fichier inattendu sans revision connue", async () => {
    const result = await deleteTaskDocument("D:\\depot", "TASK-001", null, {
      environment: ENVIRONMENT,
      fetch: stubFetch(409, { ok: false, error: { code: "TASK_DOCUMENT_REVISION_UNKNOWN" } }),
    });

    assert.deepEqual(failureOf(result), {
      kind: "runner_error",
      code: "TASK_DOCUMENT_REVISION_UNKNOWN",
    });
  });

  it("ne conclut rien d'un runner injoignable", async () => {
    const result = await deleteTaskDocument("D:\\depot", "TASK-001", REVISION, {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });

    assert.deepEqual(failureOf(result), { kind: "unreachable" });
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
    { kind: "runner_error", code: "DOCUMENT_CONFLICT" },
    { kind: "runner_error", code: "DOCUMENT_SYMLINK_NOT_WRITABLE" },
    { kind: "runner_error", code: "DOCUMENT_CONTENT_INVALID" },
    { kind: "runner_error", code: "DOCUMENT_WRITE_FAILED" },
    { kind: "runner_error", code: "DOCUMENT_TEMPORARY_FILE_FAILED" },
    { kind: "runner_error", code: "DOCUMENT_REVISION_REQUIRED" },
    { kind: "runner_error", code: "DOCUMENT_REVISION_INVALID" },
    { kind: "runner_error", code: "DOCUMENT_ALREADY_EXISTS" },
    { kind: "runner_error", code: "DOCUMENT_PARENT_NOT_FOUND" },
    { kind: "runner_error", code: "DOCUMENT_PARENT_NOT_DIRECTORY" },
    { kind: "runner_error", code: "DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED" },
    { kind: "runner_error", code: "DOCUMENT_NAME_NOT_PORTABLE" },
    { kind: "runner_error", code: "DOCUMENT_CREATION_FAILED" },
    { kind: "runner_error", code: "TASKS_DIRECTORY_NOT_DIRECTORY" },
    { kind: "runner_error", code: "TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED" },
    { kind: "runner_error", code: "TASKS_DIRECTORY_CREATION_FAILED" },
    { kind: "runner_error", code: "TASK_CODE_INVALID" },
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

describe("createTaskDocument", () => {
  const REPOSITORY = "D:\\Projets\\depot";
  const CONTENT = "# TASK-001 — Une tache\n";
  const created = {
    path: "tasks/TASK-001.md",
    name: "TASK-001.md",
    category: "TASK",
    size: Buffer.byteLength(CONTENT),
    updatedAt: "2026-08-06T09:00:00.000Z",
    content: CONTENT,
    revision: REVISION,
  };

  it("accepte un statut 201 et retourne le document cree", async () => {
    const result = await createTaskDocument(REPOSITORY, "TASK-001", CONTENT, {
      environment: ENVIRONMENT,
      fetch: stubFetch(201, { ok: true, document: created }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.path, "tasks/TASK-001.md");
    assert.equal(result.ok && result.value.revision, REVISION);
  });

  it("refuse un 200 : la creation doit annoncer une ressource nouvelle", async () => {
    const result = await createTaskDocument(REPOSITORY, "TASK-001", CONTENT, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, document: created }),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });

  it("envoie un code de tache, jamais un chemin", async () => {
    const capture: { request?: Request } = {};

    await createTaskDocument(REPOSITORY, "TASK-001", CONTENT, {
      environment: ENVIRONMENT,
      fetch: stubFetch(201, { ok: true, document: created }, capture),
    });

    const request = capture.request;
    assert.ok(request !== undefined);
    assert.equal(new URL(request.url).pathname, "/repositories/tasks/create-document");

    const body: unknown = await request.json();
    assert.deepEqual(body, {
      repositoryPath: REPOSITORY,
      taskCode: "TASK-001",
      content: CONTENT,
    });
    // Aucun champ de chemin : le runner le compose lui-meme.
    assert.equal(Object.keys(body as object).includes("documentPath"), false);

    assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  });

  it("traduit un emplacement occupe en echec reconnaissable", async () => {
    const result = await createTaskDocument(REPOSITORY, "TASK-001", CONTENT, {
      environment: ENVIRONMENT,
      fetch: stubFetch(409, { ok: false, error: { code: "DOCUMENT_ALREADY_EXISTS" } }),
    });

    assert.equal(isDocumentAlreadyExists(failureOf(result)), true);
  });

  it("traduit un dossier tasks inutilisable", async () => {
    for (const [status, code] of [
      [422, "TASKS_DIRECTORY_NOT_DIRECTORY"],
      [403, "TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED"],
      [500, "TASKS_DIRECTORY_CREATION_FAILED"],
    ] as const) {
      const result = await createTaskDocument(REPOSITORY, "TASK-001", CONTENT, {
        environment: ENVIRONMENT,
        fetch: stubFetch(status, { ok: false, error: { code } }),
      });

      const failure = failureOf(result);
      assert.equal(failure.kind, "runner_error");
      assert.equal(failure.kind === "runner_error" ? failure.code : null, code);
      assert.equal(isDocumentAlreadyExists(failure), false);
    }
  });

  it("signale un runner injoignable", async () => {
    const result = await createTaskDocument(REPOSITORY, "TASK-001", CONTENT, {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new Error("connexion refusee")),
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });

  it("n'appelle pas le runner sans configuration", async () => {
    let called = false;

    const result = await createTaskDocument(REPOSITORY, "TASK-001", CONTENT, {
      environment: {},
      fetch: () => {
        called = true;
        return Promise.resolve(new Response("{}"));
      },
    });

    assert.equal(failureOf(result).kind, "not_configured");
    assert.equal(called, false);
  });
});

describe("claudePreflight", () => {
  const REPOSITORY = "D:Projetsdepot";
  const success = {
    ok: true,
    claude: { available: true, version: "1.2.3" },
    git: {
      clean: true,
      branch: "main",
      upstream: "origin/main",
      head: "a".repeat(40),
      ahead: 0,
      behind: 0,
    },
  };

  it("retourne l'etat Git et la version de Claude Code", async () => {
    const result = await claudePreflight(REPOSITORY, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, success),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.git.branch, "main");
    assert.equal(result.ok && result.value.claude.version, "1.2.3");
  });

  it("envoie le jeton dans le seul en-tete Authorization", async () => {
    const capture: { request?: Request } = {};

    await claudePreflight(REPOSITORY, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, success, capture),
    });

    const request = capture.request;
    assert.ok(request !== undefined);
    assert.equal(new URL(request.url).pathname, "/claude/preflight");
    assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal((await request.text()).includes(TOKEN), false);
  });

  it("traduit chaque refus de preflight", async () => {
    for (const [status, code] of [
      [422, "REPOSITORY_DIRTY"],
      [422, "GIT_DETACHED_HEAD"],
      [422, "GIT_UPSTREAM_MISSING"],
      [422, "GIT_NOT_SYNCHRONIZED"],
      [503, "CLAUDE_NOT_AVAILABLE"],
    ] as const) {
      const result = await claudePreflight(REPOSITORY, {
        environment: ENVIRONMENT,
        fetch: stubFetch(status, { ok: false, error: { code } }),
      });

      const failure = failureOf(result);
      assert.equal(failure.kind, "runner_error");
      assert.equal(failure.kind === "runner_error" ? failure.code : null, code);
      assert.ok(describeRunnerFailure(failure).length > 20);
    }
  });

  it("signale un runner injoignable", async () => {
    const result = await claudePreflight(REPOSITORY, {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new Error("connexion refusee")),
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });

  it("refuse une reponse hors contrat", async () => {
    const result = await claudePreflight(REPOSITORY, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, claude: { available: true } }),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });
});

describe("startClaudeRun", () => {
  const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const request = {
    runId: RUN_ID,
    repositoryPath: "D:Projetsdepot",
    prompt: "Prompt d'execution.",
    expectedGitHead: "a".repeat(40),
    validationCommands: ["npm run test"],
  };
  const accepted = {
    ok: true,
    run: { runId: RUN_ID, status: "RUNNING", startedAt: "2026-08-06T10:00:00.000Z" },
  };

  it("accepte un statut 202 : la demande est acceptee, rien n'est termine", async () => {
    const result = await startClaudeRun(request, {
      environment: ENVIRONMENT,
      fetch: stubFetch(202, accepted),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.startedAt, "2026-08-06T10:00:00.000Z");
  });

  it("refuse un 200 : un lancement n'est pas une operation terminee", async () => {
    const result = await startClaudeRun(request, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, accepted),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });

  it("envoie exactement les cinq champs du contrat", async () => {
    const capture: { request?: Request } = {};

    await startClaudeRun(request, {
      environment: ENVIRONMENT,
      fetch: stubFetch(202, accepted, capture),
    });

    const sent = capture.request;
    assert.ok(sent !== undefined);
    assert.equal(new URL(sent.url).pathname, "/claude/runs/start");

    const body = (await sent.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      "expectedGitHead",
      "prompt",
      "repositoryPath",
      "runId",
      "validationCommands",
    ]);
    // Aucune liste d'outils ni aucun executable ne circule : le runner les
    // calcule lui-meme.
    assert.equal("allowedTools" in body, false);
    assert.equal("executable" in body, false);
  });

  it("traduit un run deja actif", async () => {
    const result = await startClaudeRun(request, {
      environment: ENVIRONMENT,
      fetch: stubFetch(409, { ok: false, error: { code: "CLAUDE_RUN_ALREADY_ACTIVE" } }),
    });

    const failure = failureOf(result);
    assert.equal(failure.kind === "runner_error" ? failure.code : null, "CLAUDE_RUN_ALREADY_ACTIVE");
  });

  it("traduit un HEAD modifie", async () => {
    const result = await startClaudeRun(request, {
      environment: ENVIRONMENT,
      fetch: stubFetch(409, { ok: false, error: { code: "GIT_HEAD_CHANGED" } }),
    });

    const failure = failureOf(result);
    assert.equal(failure.kind === "runner_error" ? failure.code : null, "GIT_HEAD_CHANGED");
  });

  it("n'appelle pas le runner sans configuration", async () => {
    let called = false;

    const result = await startClaudeRun(request, {
      environment: {},
      fetch: () => {
        called = true;
        return Promise.resolve(new Response("{}"));
      },
    });

    assert.equal(failureOf(result).kind, "not_configured");
    assert.equal(called, false);
  });
});

describe("fetchClaudeRunStatus", () => {
  const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const snapshot = {
    ok: true,
    run: {
      runId: RUN_ID,
      status: "COMPLETED",
      startedAt: "2026-08-06T10:00:00.000Z",
      finishedAt: "2026-08-06T10:05:00.000Z",
      cancellationRequestedAt: null,
      lastEventSequence: 12,
      eventsTruncated: false,
      exitCode: 0,
      errorCode: null,
      stderrTail: null,
      resultText: "Compte rendu.",
      claudeSessionId: "session-abc",
      durationMs: 300000,
      durationApiMs: 250000,
      numTurns: 6,
      reportedCostUsd: 0.12,
      git: {
        branch: "main",
        upstream: "origin/main",
        headBefore: "a".repeat(40),
        headAfter: "a".repeat(40),
        diffStat: " 1 file changed",
        changedFiles: ["src/a.ts"],
      },
    },
  };

  it("retourne l'etat d'une execution", async () => {
    const result = await fetchClaudeRunStatus(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, snapshot),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.status, "COMPLETED");
    assert.equal(result.ok && result.value.resultText, "Compte rendu.");
  });

  it("accepte une execution encore active, aux champs absents", async () => {
    const running = {
      ok: true,
      run: {
        ...snapshot.run,
        status: "RUNNING",
        finishedAt: null,
        exitCode: null,
        resultText: null,
        claudeSessionId: null,
        durationMs: null,
        durationApiMs: null,
        numTurns: null,
        reportedCostUsd: null,
        git: { ...snapshot.run.git, headAfter: null, diffStat: null, changedFiles: [] },
      },
    };

    const result = await fetchClaudeRunStatus(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, running),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.status, "RUNNING");
  });

  it("traduit une execution inconnue du runner", async () => {
    const result = await fetchClaudeRunStatus(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: stubFetch(404, { ok: false, error: { code: "CLAUDE_RUN_NOT_FOUND" } }),
    });

    const failure = failureOf(result);
    assert.equal(failure.kind === "runner_error" ? failure.code : null, "CLAUDE_RUN_NOT_FOUND");
    assert.match(describeRunnerFailure(failure), /redemarrage/i);
  });

  it("refuse un statut inconnu du contrat", async () => {
    const result = await fetchClaudeRunStatus(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, run: { ...snapshot.run, status: "PARTI" } }),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });

  it("refuse un identifiant hors contrat dans la reponse", async () => {
    const result = await fetchClaudeRunStatus(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, { ok: true, run: { ...snapshot.run, runId: "pas-un-uuid" } }),
    });

    assert.equal(failureOf(result).kind, "invalid_response");
  });
});

describe("fetchClaudeRunEvents", () => {
  const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const EVENT = {
    sequence: 1,
    kind: "TOOL_STARTED",
    occurredAt: "2026-08-07T10:00:00.000Z",
    label: "Reading README.md",
    detail: null,
    toolName: "Read",
    isError: false,
  };

  const page = {
    ok: true,
    events: [EVENT],
    nextSequence: 1,
    status: "RUNNING",
    isFinal: false,
    truncated: false,
  };

  it("retourne un lot d'evenements", async () => {
    const result = await fetchClaudeRunEvents(RUN_ID, 0, 100, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, page),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.events.length, 1);
    assert.equal(result.ok && result.value.events[0]?.label, "Reading README.md");
  });

  it("transmet le curseur et la limite", async () => {
    const calls: RequestInit[] = [];
    const capture: typeof globalThis.fetch = (_url, init) => {
      calls.push(init ?? {});
      return Promise.resolve(
        new Response(JSON.stringify(page), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };

    await fetchClaudeRunEvents(RUN_ID, 12, 50, { environment: ENVIRONMENT, fetch: capture });

    const body = JSON.parse(String(calls[0]?.body)) as Record<string, unknown>;
    assert.equal(body["afterSequence"], 12);
    assert.equal(body["limit"], 50);
    assert.equal(body["runId"], RUN_ID);
  });

  it("rejette une reponse dont un evenement est hors contrat", async () => {
    const corrupted = {
      ...page,
      events: [{ ...EVENT, kind: "THINKING" }],
    };

    const result = await fetchClaudeRunEvents(RUN_ID, 0, 100, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, corrupted),
    });

    // Une reponse hors contrat n'atteint jamais l'interface.
    assert.equal(result.ok, false);
  });

  it("traduit une execution inconnue du runner", async () => {
    const result = await fetchClaudeRunEvents(RUN_ID, 0, 100, {
      environment: ENVIRONMENT,
      fetch: stubFetch(404, { ok: false, error: { code: "CLAUDE_RUN_NOT_FOUND" } }),
    });

    assert.equal(failureOf(result).kind, "runner_error");
  });

  it("signale un runner injoignable", async () => {
    const result = await fetchClaudeRunEvents(RUN_ID, 0, 100, {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new Error("connexion refusee")),
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });
});

describe("cancelClaudeRun", () => {
  const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const accepted = {
    ok: true,
    run: {
      runId: RUN_ID,
      status: "CANCELLING",
      cancellationRequestedAt: "2026-08-07T10:00:00.000Z",
    },
  };

  it("accepte une reponse 202", async () => {
    const result = await cancelClaudeRun(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: stubFetch(202, accepted),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.status, "CANCELLING");
  });

  it("refuse une reponse 200, qui affirmerait une fin non constatee", async () => {
    const result = await cancelClaudeRun(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: stubFetch(200, accepted),
    });

    assert.equal(result.ok, false);
  });

  it("n'envoie que l'identifiant d'execution", async () => {
    const calls: RequestInit[] = [];
    const capture: typeof globalThis.fetch = (_url, init) => {
      calls.push(init ?? {});
      return Promise.resolve(
        new Response(JSON.stringify(accepted), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      );
    };

    await cancelClaudeRun(RUN_ID, { environment: ENVIRONMENT, fetch: capture });

    // Ni PID, ni signal, ni delai, ni option de forcage : le corps n'a qu'un
    // seul champ, et c'est structurel.
    assert.deepEqual(Object.keys(JSON.parse(String(calls[0]?.body)) as object), ["runId"]);
  });

  it("traduit une execution deja terminee", async () => {
    const result = await cancelClaudeRun(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: stubFetch(409, {
        ok: false,
        error: { code: "CLAUDE_RUN_ALREADY_FINISHED" },
      }),
    });

    const failure = failureOf(result);
    assert.equal(failure.kind, "runner_error");
    assert.equal(
      failure.kind === "runner_error" && failure.code,
      "CLAUDE_RUN_ALREADY_FINISHED",
    );
  });

  it("traduit un arret deja engage", async () => {
    const result = await cancelClaudeRun(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: stubFetch(409, { ok: false, error: { code: "CLAUDE_RUN_CANCELLING" } }),
    });

    const failure = failureOf(result);
    assert.equal(
      failure.kind === "runner_error" && failure.code,
      "CLAUDE_RUN_CANCELLING",
    );
  });

  it("signale un runner injoignable", async () => {
    const result = await cancelClaudeRun(RUN_ID, {
      environment: ENVIRONMENT,
      fetch: () => Promise.reject(new Error("connexion refusee")),
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });
});

describe("fetchClaudeRunReview", () => {
  const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3701";

  const FILE = {
    position: 0,
    path: "apps/web/lib/runs.ts",
    previousPath: null,
    changeType: "MODIFIED",
    additions: 2,
    deletions: 1,
    isBinary: false,
    isSensitive: false,
    isTruncated: false,
    patch: "@@ -1 +1 @@\n-avant\n+apres\n",
  };

  const REVIEW = {
    ok: true,
    review: {
      capturedAt: "2026-08-07T12:00:00.000Z",
      headBefore: "a".repeat(40),
      unreliable: false,
      files: [FILE],
      omittedFiles: 0,
      validations: [
        {
          position: 0,
          command: "npm run test",
          status: "PASSED",
          exitCode: 0,
          summary: "tout passe",
          startedAt: null,
          finishedAt: null,
        },
      ],
    },
  };

  it("retourne l'instantane du runner", async () => {
    const result = await fetchClaudeRunReview(RUN_ID, {
      fetch: stubFetch(200, REVIEW),
      environment: ENVIRONMENT,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.files.length, 1);
      assert.equal(result.value.files[0]?.path, "apps/web/lib/runs.ts");
      assert.equal(result.value.validations.length, 1);
    }
  });

  it("n'envoie qu'un identifiant d'execution", async () => {
    const capture: { request?: Request } = {};
    await fetchClaudeRunReview(RUN_ID, {
      fetch: stubFetch(200, REVIEW, capture),
      environment: ENVIRONMENT,
    });

    const body = (await capture.request?.text()) ?? "";
    assert.deepEqual(JSON.parse(body), { runId: RUN_ID });
    // Ni chemin de repository, ni commit attendu, ni chemin de fichier : la
    // route ne sait relire que ce qu'elle a elle-meme capture.
    assert.equal(body.includes("repositoryPath"), false);
    assert.equal(body.includes("expectedGitHead"), false);
    assert.equal(body.includes("file"), false);
  });

  it("authentifie la requete sans exposer le jeton dans le resultat", async () => {
    const capture: { request?: Request } = {};
    const result = await fetchClaudeRunReview(RUN_ID, {
      fetch: stubFetch(200, REVIEW, capture),
      environment: ENVIRONMENT,
    });

    assert.equal(capture.request?.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  });

  it("accepte une review sans aucun changement", async () => {
    const result = await fetchClaudeRunReview(RUN_ID, {
      fetch: stubFetch(200, {
        ok: true,
        review: { ...REVIEW.review, files: [], validations: [] },
      }),
      environment: ENVIRONMENT,
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.files.length, 0);
  });

  it("rejette un instantane dont un fichier porte un chemin absolu", async () => {
    const result = await fetchClaudeRunReview(RUN_ID, {
      fetch: stubFetch(200, {
        ok: true,
        review: {
          ...REVIEW.review,
          files: [FILE, { ...FILE, position: 1, path: "C:/Windows/win.ini" }],
        },
      }),
      environment: ENVIRONMENT,
    });

    // Un seul element hors contrat fait rejeter l'instantane entier : c'est la
    // derniere barriere avant que du contenu de repository n'entre en base.
    assert.equal(result.ok, false);
    assert.equal(failureOf(result).kind, "invalid_response");
  });

  it("rejette un type de changement inconnu", async () => {
    const result = await fetchClaudeRunReview(RUN_ID, {
      fetch: stubFetch(200, {
        ok: true,
        review: { ...REVIEW.review, files: [{ ...FILE, changeType: "REWRITTEN" }] },
      }),
      environment: ENVIRONMENT,
    });

    assert.equal(result.ok, false);
  });

  it("traduit un refus du runner", async () => {
    const result = await fetchClaudeRunReview(RUN_ID, {
      fetch: stubFetch(409, { ok: false, error: { code: "CLAUDE_REVIEW_NOT_READY" } }),
      environment: ENVIRONMENT,
    });

    const failure = failureOf(result);
    assert.equal(failure.kind, "runner_error");
    assert.equal(failure.kind === "runner_error" ? failure.code : null, "CLAUDE_REVIEW_NOT_READY");
  });

  it("traduit une capture ratee", async () => {
    const result = await fetchClaudeRunReview(RUN_ID, {
      fetch: stubFetch(500, { ok: false, error: { code: "CLAUDE_REVIEW_FAILED" } }),
      environment: ENVIRONMENT,
    });

    const failure = failureOf(result);
    assert.equal(failure.kind === "runner_error" ? failure.code : null, "CLAUDE_REVIEW_FAILED");
  });

  it("signale un runner injoignable sans rien conclure", async () => {
    const result = await fetchClaudeRunReview(RUN_ID, {
      fetch: () => Promise.reject(new Error("connexion refusee")),
      environment: ENVIRONMENT,
    });

    assert.equal(failureOf(result).kind, "unreachable");
  });
});
