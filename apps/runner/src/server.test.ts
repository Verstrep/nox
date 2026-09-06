import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import type { RunnerConfig } from "./config.ts";
import { MAX_BODY_BYTES, MAX_DOCUMENT_BODY_BYTES } from "./http/body.ts";
import type {
  CorrectionPreflightRequest,
  CorrectionPreflightResult,
} from "./claude/correction-preflight.ts";
import {
  DELIVERY_POLICIES,
  DELIVERY_POLICY,
  type DeliveryPolicy,
  type ProjectTaskArtifact,
} from "@nox/shared";
import { createRunnerServer } from "./server.ts";
import type { ListDocumentsResult } from "./repositories/documents/list-documents.ts";
import type { ReadDocumentResult } from "./repositories/documents/read-document.ts";
import type { CreateDocumentResult } from "./repositories/documents/create-document.ts";
import type { CreateTaskDocumentResult } from "./repositories/tasks/create-task-document.ts";
import type { DeleteDocumentResult } from "./repositories/documents/delete-document.ts";
import type { DeleteProjectDocumentsResult } from "./repositories/tasks/delete-project-documents.ts";
import type { DeleteTaskDocumentResult } from "./repositories/tasks/delete-task-document.ts";
import type { PreflightResult } from "./claude/preflight.ts";
import { ClaudeRunRegistry } from "./claude/registry.ts";
import type { StartRunRequest, StartRunResult } from "./claude/runs.ts";
import type { UpdateDocumentResult } from "./repositories/documents/update-document.ts";
import type { ResolveRepositoryResult } from "./repositories/resolve-repository.ts";

const TOKEN = "jeton-de-test-0123456789abcdef";
const CONFIG: RunnerConfig = {
  host: "127.0.0.1",
  port: 0,
  token: TOKEN,
  // Aucun processus Claude n'est lance par ces tests : les routes concernees
  // recoivent des doublures.
  claude: { executable: "claude-inexistant", maxTurns: 10, timeoutMinutes: 1 },
};
const CANONICAL_PATH = "D:\\Projets\\depot-fictif";

const SAMPLE_DOCUMENT = {
  path: "docs/PROJECT_BRIEF.md",
  name: "PROJECT_BRIEF.md",
  category: "CORE",
  size: 42,
  updatedAt: "2026-08-04T18:30:00.000Z",
} as const;

/** Revisions fictives : le calcul reel est teste par `revisions.test.ts`. */
const CURRENT_REVISION = "a".repeat(64);
const NEXT_REVISION = "b".repeat(64);

/** Chemins transmis a la couche Git simulee, pour verifier le passage de relais. */
const receivedPaths: string[] = [];

/** Arguments transmis a la couche documents, meme objectif. */
const receivedDocumentCalls: { repositoryPath: string; documentPath: string }[] = [];

/**
 * Git est simule : les tests HTTP ne doivent dependre ni de Git, ni du systeme
 * de fichiers. La resolution reelle est couverte par `resolve-repository.test.ts`.
 */
function fakeResolve(repositoryPath: string): Promise<ResolveRepositoryResult> {
  receivedPaths.push(repositoryPath);
  if (repositoryPath === "explose") {
    return Promise.reject(new Error("panne simulee"));
  }
  if (repositoryPath === "") {
    return Promise.resolve({ ok: false, code: "PATH_REQUIRED" });
  }
  return Promise.resolve({ ok: true, canonicalPath: CANONICAL_PATH });
}

/** Inventaire simule : la decouverte reelle a ses propres tests. */
function fakeList(repositoryPath: string): Promise<ListDocumentsResult> {
  receivedDocumentCalls.push({ repositoryPath, documentPath: "" });
  if (repositoryPath === "vide") {
    return Promise.resolve({ ok: true, documents: [] });
  }
  if (repositoryPath === "disparu") {
    return Promise.resolve({ ok: false, code: "REPOSITORY_NOT_FOUND" });
  }
  return Promise.resolve({ ok: true, documents: [{ ...SAMPLE_DOCUMENT }] });
}

/** Lecture simulee, avec les refus les plus significatifs. */
function fakeRead(repositoryPath: string, documentPath: string): Promise<ReadDocumentResult> {
  receivedDocumentCalls.push({ repositoryPath, documentPath });

  if (documentPath.includes("..")) {
    return Promise.resolve({ ok: false, code: "DOCUMENT_PATH_INVALID" });
  }
  if (documentPath === "docs/ENORME.md") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_TOO_LARGE" });
  }
  if (documentPath === "docs/ABSENT.md") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_NOT_FOUND" });
  }
  return Promise.resolve({
    ok: true,
    document: { ...SAMPLE_DOCUMENT, content: "# Brief\n", revision: CURRENT_REVISION },
  });
}

/** Arguments transmis a la couche d'ecriture. */
const receivedUpdateCalls: {
  repositoryPath: string;
  documentPath: string;
  content: string;
  expectedRevision: string;
}[] = [];

/**
 * Ecriture simulee : le serveur ne doit toucher a aucun fichier pendant ses
 * propres tests. L'ecriture reelle est couverte par `update-document.test.ts`.
 */
function fakeUpdate(
  repositoryPath: string,
  documentPath: string,
  content: string,
  expectedRevision: string,
): Promise<UpdateDocumentResult> {
  receivedUpdateCalls.push({ repositoryPath, documentPath, content, expectedRevision });

  if (expectedRevision !== CURRENT_REVISION) {
    return Promise.resolve({ ok: false, code: "DOCUMENT_CONFLICT" });
  }
  if (documentPath === "docs/LIEN.md") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_SYMLINK_NOT_WRITABLE" });
  }
  if (documentPath === "docs/ABSENT.md") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_NOT_FOUND" });
  }

  return Promise.resolve({
    ok: true,
    document: {
      ...SAMPLE_DOCUMENT,
      size: Buffer.byteLength(content),
      content,
      revision: NEXT_REVISION,
    },
  });
}

/** Arguments transmis a la couche de creation. */
const receivedCreateCalls: { repositoryPath: string; documentPath: string; content: string }[] = [];

/**
 * Creation simulee : le serveur ne doit creer aucun fichier pendant ses propres
 * tests. La creation reelle est couverte par `create-document.test.ts`.
 */
function fakeCreate(
  repositoryPath: string,
  documentPath: string,
  content: string,
): Promise<CreateDocumentResult> {
  receivedCreateCalls.push({ repositoryPath, documentPath, content });

  if (documentPath === "docs/OCCUPE.md") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_ALREADY_EXISTS" });
  }
  if (documentPath === "docs/missing/NOTE.md") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_PARENT_NOT_FOUND" });
  }
  if (documentPath === "docs/lien/NOTE.md") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED" });
  }
  if (documentPath === "docs/CON.md") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_NAME_NOT_PORTABLE" });
  }

  return Promise.resolve({
    ok: true,
    document: {
      ...SAMPLE_DOCUMENT,
      path: documentPath,
      name: documentPath.split("/").at(-1) ?? documentPath,
      size: Buffer.byteLength(content),
      content,
      revision: NEXT_REVISION,
    },
  });
}

/** Arguments transmis a la creation du document d'une tache. */
const receivedTaskCalls: { repositoryPath: string; taskCode: string; content: string }[] = [];

/**
 * Creation simulee du document d'une tache : aucun fichier ni dossier n'est cree
 * pendant les tests du serveur. Le comportement reel — dont la creation de
 * `tasks/` — est couvert par `create-task-document.test.ts`.
 */
function fakeCreateTaskDocument(
  repositoryPath: string,
  taskCode: string,
  content: string,
): Promise<CreateTaskDocumentResult> {
  receivedTaskCalls.push({ repositoryPath, taskCode, content });

  if (taskCode === "TASK-999") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_ALREADY_EXISTS" });
  }
  if (taskCode === "TASK-998") {
    return Promise.resolve({ ok: false, code: "TASKS_DIRECTORY_NOT_DIRECTORY" });
  }
  if (taskCode === "TASK-997") {
    return Promise.resolve({ ok: false, code: "TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED" });
  }
  if (!/^TASK-\d{3,}$/.test(taskCode)) {
    return Promise.resolve({ ok: false, code: "TASK_CODE_INVALID" });
  }

  return Promise.resolve({
    ok: true,
    document: {
      ...SAMPLE_DOCUMENT,
      path: `tasks/${taskCode}.md`,
      name: `${taskCode}.md`,
      category: "TASK",
      size: Buffer.byteLength(content),
      content,
      revision: NEXT_REVISION,
    },
  });
}

/** Suppressions de documents recues, pour verifier le passage de relais. */
const receivedDeleteCalls: { repositoryPath: string; documentPath: string; expectedRevision: string }[] =
  [];

/**
 * Suppression simulee : aucun fichier n'est touche par les tests du serveur.
 * Le comportement reel est couvert par `delete-document.test.ts`, sur de vrais
 * repositories temporaires.
 */
function fakeDelete(
  repositoryPath: string,
  documentPath: string,
  expectedRevision: string,
): Promise<DeleteDocumentResult> {
  receivedDeleteCalls.push({ repositoryPath, documentPath, expectedRevision });

  if (documentPath.startsWith("tasks/TASK-")) {
    return Promise.resolve({ ok: false, code: "DOCUMENT_PROTECTED" });
  }
  if (expectedRevision !== CURRENT_REVISION) {
    return Promise.resolve({ ok: false, code: "DOCUMENT_DELETE_CONFLICT" });
  }
  if (documentPath === "docs/ABSENT.md") {
    return Promise.resolve({ ok: false, code: "DOCUMENT_NOT_FOUND" });
  }

  return Promise.resolve({ ok: true, path: documentPath, revision: expectedRevision });
}

/** Suppressions de documents de tache recues. */
const receivedTaskDeleteCalls: {
  repositoryPath: string;
  taskCode: string;
  expectedRevision: string | null;
}[] = [];

/** Nettoyages d'artefacts de projet recus. */
const receivedProjectCleanupCalls: {
  repositoryPath: string;
  artifacts: readonly ProjectTaskArtifact[];
}[] = [];

function fakeDeleteProjectTaskDocuments(
  repositoryPath: string,
  artifacts: readonly ProjectTaskArtifact[],
): Promise<DeleteProjectDocumentsResult> {
  receivedProjectCleanupCalls.push({ repositoryPath, artifacts: [...artifacts] });

  if (artifacts.some((artifact) => !/^TASK-\d{3,}$/.test(artifact.taskCode))) {
    return Promise.resolve({ ok: false, code: "TASK_CODE_INVALID" });
  }

  return Promise.resolve({
    ok: true,
    documents: artifacts.map((artifact) => ({
      taskCode: artifact.taskCode,
      path: `tasks/${artifact.taskCode}.md`,
      outcome: artifact.taskCode === "TASK-404" ? "ABSENT" : "REMOVED",
    })),
  });
}

function fakeDeleteTaskDocument(
  repositoryPath: string,
  taskCode: string,
  expectedRevision: string | null,
): Promise<DeleteTaskDocumentResult> {
  receivedTaskDeleteCalls.push({ repositoryPath, taskCode, expectedRevision });

  if (!/^TASK-\d{3,}$/.test(taskCode)) {
    return Promise.resolve({ ok: false, code: "TASK_CODE_INVALID" });
  }
  if (taskCode === "TASK-404") {
    return Promise.resolve({
      ok: true,
      deleted: false,
      alreadyAbsent: true,
      path: `tasks/${taskCode}.md`,
    });
  }
  if (expectedRevision === null) {
    return Promise.resolve({ ok: false, code: "TASK_DOCUMENT_REVISION_UNKNOWN" });
  }
  if (expectedRevision !== CURRENT_REVISION) {
    return Promise.resolve({ ok: false, code: "DOCUMENT_DELETE_CONFLICT" });
  }

  return Promise.resolve({
    ok: true,
    deleted: true,
    alreadyAbsent: false,
    path: `tasks/${taskCode}.md`,
  });
}

const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * Preflight simule : aucune commande Git n'est lancee par les tests du serveur,
 * et aucune version de Claude Code n'est cherchee. Le comportement reel est
 * couvert par `claude/preflight.test.ts`, sur de vrais repositories.
 */
const receivedPreflightPolicies: DeliveryPolicy[] = [];

function fakePreflight(
  repositoryPath: string,
  deliveryPolicy: DeliveryPolicy,
): Promise<PreflightResult> {
  receivedPreflightPolicies.push(deliveryPolicy);

  const refusals: Record<string, string> = {
    sale: "REPOSITORY_DIRTY",
    detache: "GIT_DETACHED_HEAD",
    "sans-upstream": "GIT_UPSTREAM_MISSING",
    desynchronise: "GIT_NOT_SYNCHRONIZED",
    "sans-claude": "CLAUDE_NOT_AVAILABLE",
  };

  const refusal = refusals[repositoryPath];
  if (refusal !== undefined) {
    return Promise.resolve({ ok: false, code: refusal as never });
  }

  return Promise.resolve({
    ok: true,
    claudeVersion: "9.9.9",
    git: {
      clean: true,
      branch: "main",
      upstream: "origin/main",
      head: "a".repeat(40),
      ahead: 0,
      behind: 0,
    },
  });
}

/** Demandes de lancement recues, pour verifier le passage de relais. */
const receivedStartCalls: StartRunRequest[] = [];

/** Lancement simule : aucun processus n'est cree par les tests du serveur. */
function fakeStartRun(request: StartRunRequest): Promise<StartRunResult> {
  receivedStartCalls.push(request);

  if (request.validationCommands.some((command) => command.startsWith("rm "))) {
    return Promise.resolve({ ok: false, code: "CLAUDE_COMMAND_NOT_ALLOWED" as never });
  }
  if (request.repositoryPath === "occupe") {
    return Promise.resolve({ ok: false, code: "CLAUDE_RUN_ALREADY_ACTIVE" as never });
  }
  if (request.expectedGitHead !== "a".repeat(40)) {
    return Promise.resolve({ ok: false, code: "GIT_HEAD_CHANGED" as never });
  }

  return Promise.resolve({ ok: true, startedAt: new Date("2026-08-06T10:00:00.000Z") });
}

/**
 * Preflight de correction simule.
 *
 * Il ne calcule aucune empreinte : ce n'est pas l'objet des tests de routage.
 * Il refuse simplement toute empreinte differente de celle attendue, ce qui
 * suffit a verifier la traduction en statut HTTP.
 */
function fakeCorrectionPreflight(
  request: CorrectionPreflightRequest,
): Promise<CorrectionPreflightResult> {
  if (request.expectedWorkspaceFingerprint !== "f".repeat(64)) {
    return Promise.resolve({ ok: false, code: "REVIEW_WORKTREE_CHANGED" as never });
  }
  return Promise.resolve({
    ok: true,
    claudeVersion: "2.1.223",
    git: { branch: "main", head: "a".repeat(40), upstream: "origin/main" },
  });
}
/** Registre neuf : la contrainte « un seul run actif » ne doit pas fuir entre tests. */
const testRegistry = new ClaudeRunRegistry();

let server: Server;
let baseUrl: string;

before(async () => {
  // Le serveur est cree sans port fixe : le systeme en attribue un libre.
  server = createRunnerServer(CONFIG, {
    claudePreflight: fakePreflight,
    claudeCorrectionPreflight: fakeCorrectionPreflight,
    startClaudeRun: fakeStartRun,
    runRegistry: testRegistry,
    resolveRepository: fakeResolve,
    listDocuments: fakeList,
    readDocument: fakeRead,
    updateDocument: fakeUpdate,
    createDocument: fakeCreate,
    deleteDocument: fakeDelete,
    createTaskDocument: fakeCreateTaskDocument,
    deleteTaskDocument: fakeDeleteTaskDocument,
    deleteProjectTaskDocuments: fakeDeleteProjectTaskDocuments,
    log: () => undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
});

type RequestOptions = {
  method?: string;
  token?: string | null;
  contentType?: string | null;
  body?: string;
};

async function call(pathname: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {};

  if (options.token !== null && options.token !== undefined) {
    headers["authorization"] = options.token;
  }
  if (options.contentType !== null) {
    headers["content-type"] = options.contentType ?? "application/json";
  }

  const response = await fetch(baseUrl + pathname, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: response.status, headers: response.headers, text, json };
}

function errorCode(json: unknown): string | null {
  if (typeof json !== "object" || json === null) {
    return null;
  }
  const error = (json as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

describe("GET /health", () => {
  it("repond sans authentification", async () => {
    const response = await call("/health", { contentType: null });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      service: "nox-runner",
      status: "ok",
      version: "0.1.0",
    });
  });

  it("ne divulgue ni jeton, ni chemin, ni variable d'environnement", async () => {
    const response = await call("/health", { contentType: null });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(/[A-Za-z]:\\\\|\/home\/|\/Users\//.test(response.text), false);
    assert.deepEqual(Object.keys(response.json as object).sort(), [
      "service",
      "status",
      "version",
    ]);
  });

  it("expose un identifiant de requete", async () => {
    const response = await call("/health", { contentType: null });
    assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f]{8}$/);
  });

  it("refuse une methode incorrecte", async () => {
    const response = await call("/health", { method: "POST", body: "{}" });

    assert.equal(response.status, 405);
    assert.equal(errorCode(response.json), "METHOD_NOT_ALLOWED");
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  });
});

describe("routage", () => {
  it("repond 404 sur une route inconnue", async () => {
    const response = await call("/inconnue", { contentType: null });

    assert.equal(response.status, 404);
    assert.equal(errorCode(response.json), "ROUTE_NOT_FOUND");
  });

  it("refuse GET sur la route de resolution", async () => {
    const response = await call("/repositories/resolve", { token: `Bearer ${TOKEN}` });

    assert.equal(response.status, 405);
    assert.equal(errorCode(response.json), "METHOD_NOT_ALLOWED");
    assert.equal(response.headers.get("allow"), "POST");
  });

  it("ignore un slash final", async () => {
    const response = await call("/health/", { contentType: null });
    assert.equal(response.status, 200);
  });
});

describe("POST /repositories/resolve - authentification", () => {
  const body = JSON.stringify({ repositoryPath: "D:\\Projets\\quelconque" });

  it("refuse l'absence d'en-tete Authorization", async () => {
    const response = await call("/repositories/resolve", { method: "POST", token: null, body });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
  });

  it("refuse un schema incorrect", async () => {
    const response = await call("/repositories/resolve", {
      method: "POST",
      token: `Basic ${TOKEN}`,
      body,
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
  });

  it("refuse un mauvais jeton", async () => {
    const response = await call("/repositories/resolve", {
      method: "POST",
      token: "Bearer mauvais-jeton",
      body,
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
  });

  it("ne renvoie jamais le jeton attendu dans une reponse 401", async () => {
    const response = await call("/repositories/resolve", { method: "POST", token: null, body });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(response.text.includes(TOKEN.slice(0, 8)), false);
  });

  it("accepte le bon jeton", async () => {
    const response = await call("/repositories/resolve", {
      method: "POST",
      token: `Bearer ${TOKEN}`,
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { ok: true, repository: { canonicalPath: CANONICAL_PATH } });
  });

  it("verifie l'authentification avant de lire le corps", async () => {
    const before = receivedPaths.length;
    await call("/repositories/resolve", { method: "POST", token: null, body });
    assert.equal(receivedPaths.length, before);
  });
});

describe("POST /repositories/resolve - corps de requete", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;

  it("refuse un Content-Type incorrect", async () => {
    const response = await call("/repositories/resolve", {
      ...authorized,
      contentType: "text/plain",
      body: JSON.stringify({ repositoryPath: "D:\\x" }),
    });

    assert.equal(response.status, 415);
    assert.equal(errorCode(response.json), "UNSUPPORTED_MEDIA_TYPE");
  });

  it("accepte un Content-Type avec charset", async () => {
    const response = await call("/repositories/resolve", {
      ...authorized,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ repositoryPath: "D:\\x" }),
    });

    assert.equal(response.status, 200);
  });

  it("refuse un JSON invalide", async () => {
    const response = await call("/repositories/resolve", { ...authorized, body: "{ pas du json" });

    assert.equal(response.status, 400);
    assert.equal(errorCode(response.json), "INVALID_JSON");
  });

  it("refuse un corps vide", async () => {
    const response = await call("/repositories/resolve", { ...authorized, body: "" });

    assert.equal(response.status, 400);
    assert.equal(errorCode(response.json), "INVALID_JSON");
  });

  it("refuse un corps qui ne respecte pas le contrat", async () => {
    for (const body of ["{}", '{"repositoryPath":42}', '{"autre":"valeur"}', "[]", '"texte"']) {
      const response = await call("/repositories/resolve", { ...authorized, body });

      assert.equal(response.status, 400, body);
      assert.equal(errorCode(response.json), "INVALID_REQUEST", body);
    }
  });

  it("refuse un corps trop volumineux", async () => {
    const response = await call("/repositories/resolve", {
      ...authorized,
      body: JSON.stringify({ repositoryPath: "D:\\" + "x".repeat(MAX_BODY_BYTES + 1024) }),
    });

    assert.equal(response.status, 413);
    assert.equal(errorCode(response.json), "PAYLOAD_TOO_LARGE");
  });
});

describe("POST /repositories/resolve - resultats", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;

  it("transmet le chemin recu a la couche de resolution", async () => {
    await call("/repositories/resolve", {
      ...authorized,
      body: JSON.stringify({ repositoryPath: "D:\\Projets\\vise" }),
    });

    assert.equal(receivedPaths.at(-1), "D:\\Projets\\vise");
  });

  it("traduit un echec de resolution en erreur du contrat", async () => {
    const response = await call("/repositories/resolve", {
      ...authorized,
      body: JSON.stringify({ repositoryPath: "" }),
    });

    assert.equal(response.status, 422);
    assert.equal(errorCode(response.json), "PATH_REQUIRED");
  });

  it("transforme une exception inattendue en 500 sans trace", async () => {
    const response = await call("/repositories/resolve", {
      ...authorized,
      body: JSON.stringify({ repositoryPath: "explose" }),
    });

    assert.equal(response.status, 500);
    assert.equal(errorCode(response.json), "INTERNAL_ERROR");
    assert.equal(response.text.includes("panne simulee"), false);
    assert.equal(response.text.includes("at "), false);
  });
});

describe("POST /repositories/documents/list", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;

  it("refuse l'absence de jeton", async () => {
    const response = await call("/repositories/documents/list", {
      method: "POST",
      token: null,
      body: JSON.stringify({ repositoryPath: "D:\\Projets\\depot" }),
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
    assert.equal(response.text.includes(TOKEN), false);
  });

  it("refuse un mauvais jeton", async () => {
    const response = await call("/repositories/documents/list", {
      method: "POST",
      token: "Bearer mauvais-jeton",
      body: JSON.stringify({ repositoryPath: "D:\\Projets\\depot" }),
    });

    assert.equal(response.status, 401);
  });

  it("refuse une methode incorrecte", async () => {
    const response = await call("/repositories/documents/list", { ...authorized, method: "GET" });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });

  it("retourne l'inventaire", async () => {
    const response = await call("/repositories/documents/list", {
      ...authorized,
      body: JSON.stringify({ repositoryPath: "D:\\Projets\\depot" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { ok: true, documents: [SAMPLE_DOCUMENT] });
    assert.equal(receivedDocumentCalls.at(-1)?.repositoryPath, "D:\\Projets\\depot");
  });

  it("retourne une liste vide sans erreur", async () => {
    const response = await call("/repositories/documents/list", {
      ...authorized,
      body: JSON.stringify({ repositoryPath: "vide" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { ok: true, documents: [] });
  });

  it("traduit un repository disparu en erreur du contrat", async () => {
    const response = await call("/repositories/documents/list", {
      ...authorized,
      body: JSON.stringify({ repositoryPath: "disparu" }),
    });

    assert.equal(response.status, 422);
    assert.equal(errorCode(response.json), "REPOSITORY_NOT_FOUND");
  });

  it("refuse un corps qui ne respecte pas le contrat", async () => {
    for (const body of ["{}", '{"repositoryPath":42}', "[]"]) {
      const response = await call("/repositories/documents/list", { ...authorized, body });
      assert.equal(response.status, 400, body);
      assert.equal(errorCode(response.json), "INVALID_REQUEST", body);
    }
  });
});

describe("POST /repositories/documents/read", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const validBody = JSON.stringify({
    repositoryPath: "D:\\Projets\\depot",
    documentPath: "docs/PROJECT_BRIEF.md",
  });

  it("refuse l'absence de jeton", async () => {
    const response = await call("/repositories/documents/read", {
      method: "POST",
      token: null,
      body: validBody,
    });

    assert.equal(response.status, 401);
    assert.equal(response.text.includes(TOKEN), false);
  });

  it("retourne le document et son contenu", async () => {
    const response = await call("/repositories/documents/read", {
      ...authorized,
      body: validBody,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      ok: true,
      document: { ...SAMPLE_DOCUMENT, content: "# Brief\n", revision: CURRENT_REVISION },
    });
  });

  it("transmet les deux chemins a la couche metier", async () => {
    await call("/repositories/documents/read", { ...authorized, body: validBody });

    assert.deepEqual(receivedDocumentCalls.at(-1), {
      repositoryPath: "D:\\Projets\\depot",
      documentPath: "docs/PROJECT_BRIEF.md",
    });
  });

  it("refuse une traversee de repertoire", async () => {
    const response = await call("/repositories/documents/read", {
      ...authorized,
      body: JSON.stringify({
        repositoryPath: "D:\\Projets\\depot",
        documentPath: "../../secret.md",
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(errorCode(response.json), "DOCUMENT_PATH_INVALID");
  });

  it("refuse un document trop volumineux", async () => {
    const response = await call("/repositories/documents/read", {
      ...authorized,
      body: JSON.stringify({
        repositoryPath: "D:\\Projets\\depot",
        documentPath: "docs/ENORME.md",
      }),
    });

    assert.equal(response.status, 413);
    assert.equal(errorCode(response.json), "DOCUMENT_TOO_LARGE");
  });

  it("signale un document absent", async () => {
    const response = await call("/repositories/documents/read", {
      ...authorized,
      body: JSON.stringify({
        repositoryPath: "D:\\Projets\\depot",
        documentPath: "docs/ABSENT.md",
      }),
    });

    assert.equal(response.status, 404);
    assert.equal(errorCode(response.json), "DOCUMENT_NOT_FOUND");
  });

  it("exige les deux chemins", async () => {
    for (const body of [
      '{"repositoryPath":"D:\\\\Projets\\\\depot"}',
      '{"documentPath":"docs/a.md"}',
      "{}",
    ]) {
      const response = await call("/repositories/documents/read", { ...authorized, body });
      assert.equal(response.status, 400, body);
      assert.equal(errorCode(response.json), "INVALID_REQUEST", body);
    }
  });
});

describe("POST /repositories/documents/update", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const REPOSITORY = "D:\\Projets\\depot";

  function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      repositoryPath: REPOSITORY,
      documentPath: "docs/PROJECT_BRIEF.md",
      content: "# Nouvelle version\n",
      expectedRevision: CURRENT_REVISION,
      ...overrides,
    });
  }

  it("enregistre et retourne la nouvelle revision", async () => {
    const response = await call("/repositories/documents/update", { ...authorized, body: body() });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      ok: true,
      document: {
        ...SAMPLE_DOCUMENT,
        size: Buffer.byteLength("# Nouvelle version\n"),
        content: "# Nouvelle version\n",
        revision: NEXT_REVISION,
      },
    });
  });

  it("transmet les quatre champs a la couche metier", async () => {
    await call("/repositories/documents/update", { ...authorized, body: body() });

    assert.deepEqual(receivedUpdateCalls.at(-1), {
      repositoryPath: REPOSITORY,
      documentPath: "docs/PROJECT_BRIEF.md",
      content: "# Nouvelle version\n",
      expectedRevision: CURRENT_REVISION,
    });
  });

  it("accepte un contenu vide", async () => {
    const response = await call("/repositories/documents/update", {
      ...authorized,
      body: body({ content: "" }),
    });

    assert.equal(response.status, 200);
    assert.equal(receivedUpdateCalls.at(-1)?.content, "");
  });

  it("refuse une requete sans jeton, sans appeler la couche metier", async () => {
    const before = receivedUpdateCalls.length;
    const response = await call("/repositories/documents/update", {
      method: "POST",
      token: null,
      body: body(),
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
    assert.equal(receivedUpdateCalls.length, before);
  });

  it("refuse un jeton incorrect", async () => {
    const response = await call("/repositories/documents/update", {
      method: "POST",
      token: "Bearer un-autre-jeton",
      body: body(),
    });

    assert.equal(response.status, 401);
  });

  it("refuse une methode incorrecte", async () => {
    const response = await call("/repositories/documents/update", {
      method: "GET",
      token: `Bearer ${TOKEN}`,
    });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });

  it("traduit un conflit de revision en 409", async () => {
    const response = await call("/repositories/documents/update", {
      ...authorized,
      body: body({ expectedRevision: "c".repeat(64) }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "DOCUMENT_CONFLICT");
  });

  it("traduit un lien symbolique en 403", async () => {
    const response = await call("/repositories/documents/update", {
      ...authorized,
      body: body({ documentPath: "docs/LIEN.md" }),
    });

    assert.equal(response.status, 403);
    assert.equal(errorCode(response.json), "DOCUMENT_SYMLINK_NOT_WRITABLE");
  });

  it("traduit un document absent en 404", async () => {
    const response = await call("/repositories/documents/update", {
      ...authorized,
      body: body({ documentPath: "docs/ABSENT.md" }),
    });

    assert.equal(response.status, 404);
    assert.equal(errorCode(response.json), "DOCUMENT_NOT_FOUND");
  });

  it("exige les quatre champs, tous de type chaine", async () => {
    for (const raw of [
      JSON.stringify({ documentPath: "docs/a.md", content: "", expectedRevision: CURRENT_REVISION }),
      JSON.stringify({ repositoryPath: REPOSITORY, content: "", expectedRevision: CURRENT_REVISION }),
      JSON.stringify({ repositoryPath: REPOSITORY, documentPath: "docs/a.md", expectedRevision: CURRENT_REVISION }),
      JSON.stringify({ repositoryPath: REPOSITORY, documentPath: "docs/a.md", content: "" }),
      // Un contenu qui n'est pas une chaine est un desaccord de contrat.
      JSON.stringify({
        repositoryPath: REPOSITORY,
        documentPath: "docs/a.md",
        content: 42,
        expectedRevision: CURRENT_REVISION,
      }),
    ]) {
      const response = await call("/repositories/documents/update", { ...authorized, body: raw });
      assert.equal(response.status, 400, raw);
      assert.equal(errorCode(response.json), "INVALID_REQUEST", raw);
    }
  });

  it("accepte un corps plus volumineux que la limite des autres routes", async () => {
    // La route d'ecriture transporte un document entier : sa limite de corps est
    // plus haute que les 32 Kio des routes qui n'echangent que des chemins.
    const response = await call("/repositories/documents/update", {
      ...authorized,
      body: body({ content: "x".repeat(MAX_BODY_BYTES * 2) }),
    });

    assert.equal(response.status, 200);
  });

  it("refuse un corps depassant la limite d'ecriture", async () => {
    const response = await call("/repositories/documents/update", {
      ...authorized,
      body: body({ content: "x".repeat(MAX_DOCUMENT_BODY_BYTES + 1024) }),
    });

    assert.equal(response.status, 413);
    assert.equal(errorCode(response.json), "PAYLOAD_TOO_LARGE");
  });

  it("ne divulgue jamais le jeton dans une reponse d'erreur", async () => {
    const response = await call("/repositories/documents/update", {
      ...authorized,
      body: body({ expectedRevision: "c".repeat(64) }),
    });

    assert.equal(response.text.includes(TOKEN), false);
  });
});

describe("POST /repositories/documents/create", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const REPOSITORY = "D:\\Projets\\depot";

  function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      repositoryPath: REPOSITORY,
      documentPath: "docs/PRODUCT_VISION.md",
      content: "# Vision\n",
      ...overrides,
    });
  }

  it("repond 201 et retourne le document cree", async () => {
    const response = await call("/repositories/documents/create", { ...authorized, body: body() });

    assert.equal(response.status, 201);
    assert.deepEqual(response.json, {
      ok: true,
      document: {
        ...SAMPLE_DOCUMENT,
        path: "docs/PRODUCT_VISION.md",
        name: "PRODUCT_VISION.md",
        size: Buffer.byteLength("# Vision\n"),
        content: "# Vision\n",
        revision: NEXT_REVISION,
      },
    });
  });

  it("transmet les trois champs a la couche metier", async () => {
    await call("/repositories/documents/create", { ...authorized, body: body() });

    assert.deepEqual(receivedCreateCalls.at(-1), {
      repositoryPath: REPOSITORY,
      documentPath: "docs/PRODUCT_VISION.md",
      content: "# Vision\n",
    });
  });

  it("accepte un contenu initial vide", async () => {
    const response = await call("/repositories/documents/create", {
      ...authorized,
      body: body({ content: "" }),
    });

    assert.equal(response.status, 201);
    assert.equal(receivedCreateCalls.at(-1)?.content, "");
  });

  it("refuse une requete sans jeton, sans appeler la couche metier", async () => {
    const before = receivedCreateCalls.length;
    const response = await call("/repositories/documents/create", {
      method: "POST",
      token: null,
      body: body(),
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
    assert.equal(receivedCreateCalls.length, before);
  });

  it("refuse un jeton incorrect", async () => {
    const response = await call("/repositories/documents/create", {
      method: "POST",
      token: "Bearer un-autre-jeton",
      body: body(),
    });

    assert.equal(response.status, 401);
  });

  it("refuse une methode incorrecte", async () => {
    const response = await call("/repositories/documents/create", {
      method: "GET",
      token: `Bearer ${TOKEN}`,
    });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });

  it("traduit un document deja present en 409", async () => {
    const response = await call("/repositories/documents/create", {
      ...authorized,
      body: body({ documentPath: "docs/OCCUPE.md" }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "DOCUMENT_ALREADY_EXISTS");
  });

  it("traduit un dossier parent absent en 404", async () => {
    const response = await call("/repositories/documents/create", {
      ...authorized,
      body: body({ documentPath: "docs/missing/NOTE.md" }),
    });

    assert.equal(response.status, 404);
    assert.equal(errorCode(response.json), "DOCUMENT_PARENT_NOT_FOUND");
  });

  it("traduit un parent lien symbolique en 403", async () => {
    const response = await call("/repositories/documents/create", {
      ...authorized,
      body: body({ documentPath: "docs/lien/NOTE.md" }),
    });

    assert.equal(response.status, 403);
    assert.equal(errorCode(response.json), "DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED");
  });

  it("traduit un nom non portable en 400", async () => {
    const response = await call("/repositories/documents/create", {
      ...authorized,
      body: body({ documentPath: "docs/CON.md" }),
    });

    assert.equal(response.status, 400);
    assert.equal(errorCode(response.json), "DOCUMENT_NAME_NOT_PORTABLE");
  });

  it("exige les trois champs, tous de type chaine", async () => {
    for (const raw of [
      JSON.stringify({ documentPath: "docs/a.md", content: "" }),
      JSON.stringify({ repositoryPath: REPOSITORY, content: "" }),
      JSON.stringify({ repositoryPath: REPOSITORY, documentPath: "docs/a.md" }),
      JSON.stringify({ repositoryPath: REPOSITORY, documentPath: "docs/a.md", content: 42 }),
    ]) {
      const response = await call("/repositories/documents/create", { ...authorized, body: raw });
      assert.equal(response.status, 400, raw);
      assert.equal(errorCode(response.json), "INVALID_REQUEST", raw);
    }
  });

  it("accepte un corps plus volumineux que la limite des autres routes", async () => {
    const response = await call("/repositories/documents/create", {
      ...authorized,
      body: body({ content: "x".repeat(MAX_BODY_BYTES * 2) }),
    });

    assert.equal(response.status, 201);
  });

  it("refuse un corps depassant la limite d'ecriture", async () => {
    const response = await call("/repositories/documents/create", {
      ...authorized,
      body: body({ content: "x".repeat(MAX_DOCUMENT_BODY_BYTES + 1024) }),
    });

    assert.equal(response.status, 413);
    assert.equal(errorCode(response.json), "PAYLOAD_TOO_LARGE");
  });

  it("ne divulgue ni jeton ni chemin absolu dans une reponse d'erreur", async () => {
    const response = await call("/repositories/documents/create", {
      ...authorized,
      body: body({ documentPath: "docs/OCCUPE.md" }),
    });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(/[A-Za-z]:\\/.test(response.text), false);
  });
});

describe("POST /repositories/tasks/create-document", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const REPOSITORY = "D:\\Projets\\depot";
  const CONTENT = "# TASK-001 — Une tache\n";

  function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      repositoryPath: REPOSITORY,
      taskCode: "TASK-001",
      content: CONTENT,
      ...overrides,
    });
  }

  it("repond 201 et retourne le document cree", async () => {
    const response = await call("/repositories/tasks/create-document", {
      ...authorized,
      body: body(),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(response.json, {
      ok: true,
      document: {
        ...SAMPLE_DOCUMENT,
        path: "tasks/TASK-001.md",
        name: "TASK-001.md",
        category: "TASK",
        size: Buffer.byteLength(CONTENT),
        content: CONTENT,
        revision: NEXT_REVISION,
      },
    });
  });

  it("transmet le code plutot qu'un chemin a la couche metier", async () => {
    receivedTaskCalls.length = 0;
    await call("/repositories/tasks/create-document", { ...authorized, body: body() });

    assert.deepEqual(receivedTaskCalls, [
      { repositoryPath: REPOSITORY, taskCode: "TASK-001", content: CONTENT },
    ]);
  });

  it("exige le jeton", async () => {
    const response = await call("/repositories/tasks/create-document", {
      method: "POST",
      token: null,
      body: body(),
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
  });

  it("refuse un jeton errone", async () => {
    const response = await call("/repositories/tasks/create-document", {
      method: "POST",
      token: "Bearer mauvais-jeton",
      body: body(),
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
  });

  it("refuse une methode autre que POST", async () => {
    const response = await call("/repositories/tasks/create-document", {
      method: "GET",
      token: `Bearer ${TOKEN}`,
    });

    assert.equal(response.status, 405);
    assert.equal(errorCode(response.json), "METHOD_NOT_ALLOWED");
  });

  it("refuse un code de tache mal forme", async () => {
    for (const taskCode of ["TASK-1", "task-001", "TASK-001.md", "../TASK-001", ""]) {
      const response = await call("/repositories/tasks/create-document", {
        ...authorized,
        body: body({ taskCode }),
      });

      assert.equal(response.status, 400, `code « ${taskCode} »`);
      assert.equal(errorCode(response.json), "TASK_CODE_INVALID");
    }
  });

  it("refuse un corps auquel il manque un champ", async () => {
    for (const raw of [
      JSON.stringify({ repositoryPath: REPOSITORY, taskCode: "TASK-001" }),
      JSON.stringify({ repositoryPath: REPOSITORY, content: CONTENT }),
      JSON.stringify({ taskCode: "TASK-001", content: CONTENT }),
      JSON.stringify({ repositoryPath: REPOSITORY, taskCode: 1, content: CONTENT }),
    ]) {
      const response = await call("/repositories/tasks/create-document", {
        ...authorized,
        body: raw,
      });

      assert.equal(response.status, 400);
      assert.equal(errorCode(response.json), "INVALID_REQUEST");
    }
  });

  it("traduit un emplacement deja occupe en 409", async () => {
    const response = await call("/repositories/tasks/create-document", {
      ...authorized,
      body: body({ taskCode: "TASK-999" }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "DOCUMENT_ALREADY_EXISTS");
  });

  it("traduit un dossier tasks occupe par un fichier en 422", async () => {
    const response = await call("/repositories/tasks/create-document", {
      ...authorized,
      body: body({ taskCode: "TASK-998" }),
    });

    assert.equal(response.status, 422);
    assert.equal(errorCode(response.json), "TASKS_DIRECTORY_NOT_DIRECTORY");
  });

  it("traduit un dossier tasks lie en 403", async () => {
    const response = await call("/repositories/tasks/create-document", {
      ...authorized,
      body: body({ taskCode: "TASK-997" }),
    });

    assert.equal(response.status, 403);
    assert.equal(errorCode(response.json), "TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED");
  });

  it("refuse un corps depassant la limite d'ecriture", async () => {
    const response = await call("/repositories/tasks/create-document", {
      ...authorized,
      body: body({ content: "x".repeat(MAX_DOCUMENT_BODY_BYTES + 1024) }),
    });

    assert.equal(response.status, 413);
    assert.equal(errorCode(response.json), "PAYLOAD_TOO_LARGE");
  });

  it("ne divulgue ni jeton ni chemin absolu dans une reponse d'erreur", async () => {
    const response = await call("/repositories/tasks/create-document", {
      ...authorized,
      body: body({ taskCode: "TASK-999" }),
    });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(/[A-Za-z]:\\/.test(response.text), false);
  });
});

describe("POST /repositories/documents/delete", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const REPOSITORY = "D:\\Projets\\depot";

  function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      repositoryPath: REPOSITORY,
      documentPath: "docs/NOTE.md",
      expectedRevision: CURRENT_REVISION,
      ...overrides,
    });
  }

  it("repond 200 avec le chemin relatif et la revision supprimee", async () => {
    const response = await call("/repositories/documents/delete", { ...authorized, body: body() });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      ok: true,
      deleted: { path: "docs/NOTE.md", revision: CURRENT_REVISION },
    });
  });

  it("transmet la revision attendue a la couche metier", async () => {
    receivedDeleteCalls.length = 0;
    await call("/repositories/documents/delete", { ...authorized, body: body() });

    assert.deepEqual(receivedDeleteCalls, [
      {
        repositoryPath: REPOSITORY,
        documentPath: "docs/NOTE.md",
        expectedRevision: CURRENT_REVISION,
      },
    ]);
  });

  it("repond 409 sur un conflit de revision", async () => {
    const response = await call("/repositories/documents/delete", {
      ...authorized,
      body: body({ expectedRevision: NEXT_REVISION }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "DOCUMENT_DELETE_CONFLICT");
  });

  it("repond 403 sur un document de tache protege", async () => {
    const response = await call("/repositories/documents/delete", {
      ...authorized,
      body: body({ documentPath: "tasks/TASK-001.md" }),
    });

    assert.equal(response.status, 403);
    assert.equal(errorCode(response.json), "DOCUMENT_PROTECTED");
  });

  it("repond 404 sur un document absent", async () => {
    const response = await call("/repositories/documents/delete", {
      ...authorized,
      body: body({ documentPath: "docs/ABSENT.md" }),
    });

    assert.equal(response.status, 404);
    assert.equal(errorCode(response.json), "DOCUMENT_NOT_FOUND");
  });

  it("exige le jeton", async () => {
    const response = await call("/repositories/documents/delete", {
      method: "POST",
      token: null,
      body: body(),
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
  });

  it("refuse un jeton errone", async () => {
    const response = await call("/repositories/documents/delete", {
      method: "POST",
      token: "Bearer mauvais-jeton",
      body: body(),
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
  });

  it("n'appelle pas la couche metier sans jeton", async () => {
    receivedDeleteCalls.length = 0;
    await call("/repositories/documents/delete", { method: "POST", token: null, body: body() });

    assert.deepEqual(receivedDeleteCalls, []);
  });

  it("refuse une methode autre que POST", async () => {
    const response = await call("/repositories/documents/delete", {
      method: "GET",
      token: `Bearer ${TOKEN}`,
    });

    assert.equal(response.status, 405);
    assert.equal(errorCode(response.json), "METHOD_NOT_ALLOWED");
  });

  it("refuse un corps sans revision", async () => {
    const response = await call("/repositories/documents/delete", {
      ...authorized,
      body: JSON.stringify({ repositoryPath: REPOSITORY, documentPath: "docs/NOTE.md" }),
    });

    assert.equal(response.status, 400);
    assert.equal(errorCode(response.json), "INVALID_REQUEST");
  });

  it("ne divulgue ni jeton ni chemin absolu dans une reponse d'erreur", async () => {
    const response = await call("/repositories/documents/delete", {
      ...authorized,
      body: body({ expectedRevision: NEXT_REVISION }),
    });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(response.text.includes(REPOSITORY), false);
    assert.equal(response.text.includes("D:\\"), false);
  });
});

describe("POST /repositories/tasks/delete-project-documents", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const REPOSITORY = "D:\\Projets\\depot";

  function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      repositoryPath: REPOSITORY,
      artifacts: [
        { taskCode: "TASK-000", expectedRevision: CURRENT_REVISION },
        { taskCode: "TASK-001", expectedRevision: CURRENT_REVISION },
      ],
      ...overrides,
    });
  }

  it("rapporte le sort de chaque document", async () => {
    const response = await call("/repositories/tasks/delete-project-documents", {
      ...authorized,
      body: body(),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      ok: true,
      documents: [
        { taskCode: "TASK-000", path: "tasks/TASK-000.md", outcome: "REMOVED" },
        { taskCode: "TASK-001", path: "tasks/TASK-001.md", outcome: "REMOVED" },
      ],
    });
  });

  it("transmet des codes, jamais un chemin", async () => {
    receivedProjectCleanupCalls.length = 0;
    await call("/repositories/tasks/delete-project-documents", {
      ...authorized,
      // Un chemin glisse dans une entree n'a aucune prise : le contrat ne le
      // transporte pas, et le runner compose le sien a partir du code.
      body: JSON.stringify({
        repositoryPath: REPOSITORY,
        artifacts: [
          {
            taskCode: "TASK-001",
            expectedRevision: CURRENT_REVISION,
            path: "../../src/App.tsx",
          },
        ],
      }),
    });

    assert.deepEqual(receivedProjectCleanupCalls, [
      {
        repositoryPath: REPOSITORY,
        artifacts: [{ taskCode: "TASK-001", expectedRevision: CURRENT_REVISION }],
      },
    ]);
  });

  it("refuse un corps sans revision", async () => {
    const response = await call("/repositories/tasks/delete-project-documents", {
      ...authorized,
      body: body({ artifacts: [{ taskCode: "TASK-001" }] }),
    });

    assert.equal(response.status, 400);
  });

  it("remonte un refus metier", async () => {
    const response = await call("/repositories/tasks/delete-project-documents", {
      ...authorized,
      body: body({ artifacts: [{ taskCode: "../secret", expectedRevision: CURRENT_REVISION }] }),
    });

    assert.equal(response.status, 400);
    assert.equal(
      (response.json as { error?: { code?: string } }).error?.code,
      "TASK_CODE_INVALID",
    );
  });

  it("exige le jeton", async () => {
    const response = await call("/repositories/tasks/delete-project-documents", {
      method: "POST",
      body: body(),
    });

    assert.equal(response.status, 401);
  });

  it("refuse une autre methode", async () => {
    const response = await call("/repositories/tasks/delete-project-documents", {
      token: `Bearer ${TOKEN}`,
    });

    assert.equal(response.status, 405);
  });
});

describe("POST /repositories/tasks/delete-document", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const REPOSITORY = "D:\\Projets\\depot";

  function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      repositoryPath: REPOSITORY,
      taskCode: "TASK-001",
      expectedRevision: CURRENT_REVISION,
      ...overrides,
    });
  }

  it("repond 200 sur une suppression effective", async () => {
    const response = await call("/repositories/tasks/delete-document", {
      ...authorized,
      body: body(),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      ok: true,
      deleted: true,
      alreadyAbsent: false,
      path: "tasks/TASK-001.md",
    });
  });

  it("repond 200 sur un document deja absent", async () => {
    const response = await call("/repositories/tasks/delete-document", {
      ...authorized,
      body: body({ taskCode: "TASK-404", expectedRevision: null }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      ok: true,
      deleted: false,
      alreadyAbsent: true,
      path: "tasks/TASK-404.md",
    });
  });

  it("transmet le code plutot qu'un chemin a la couche metier", async () => {
    receivedTaskDeleteCalls.length = 0;
    await call("/repositories/tasks/delete-document", {
      ...authorized,
      // Un chemin glisse dans le corps ne doit avoir aucune prise : le contrat
      // ne le transporte pas, et le runner compose le sien.
      body: body({ documentPath: "../../hors-depot/SECRET.md" }),
    });

    assert.deepEqual(receivedTaskDeleteCalls, [
      { repositoryPath: REPOSITORY, taskCode: "TASK-001", expectedRevision: CURRENT_REVISION },
    ]);
  });

  it("repond 409 quand un document present n'a pas de revision connue", async () => {
    const response = await call("/repositories/tasks/delete-document", {
      ...authorized,
      body: body({ expectedRevision: null }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "TASK_DOCUMENT_REVISION_UNKNOWN");
  });

  it("repond 409 sur un conflit de revision", async () => {
    const response = await call("/repositories/tasks/delete-document", {
      ...authorized,
      body: body({ expectedRevision: NEXT_REVISION }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "DOCUMENT_DELETE_CONFLICT");
  });

  it("repond 400 sur un code invalide", async () => {
    const response = await call("/repositories/tasks/delete-document", {
      ...authorized,
      body: body({ taskCode: "../secret" }),
    });

    assert.equal(response.status, 400);
    assert.equal(errorCode(response.json), "TASK_CODE_INVALID");
  });

  it("exige le jeton", async () => {
    const response = await call("/repositories/tasks/delete-document", {
      method: "POST",
      token: null,
      body: body(),
    });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
  });

  it("n'appelle pas la couche metier sans jeton", async () => {
    receivedTaskDeleteCalls.length = 0;
    await call("/repositories/tasks/delete-document", {
      method: "POST",
      token: null,
      body: body(),
    });

    assert.deepEqual(receivedTaskDeleteCalls, []);
  });

  it("refuse une methode autre que POST", async () => {
    const response = await call("/repositories/tasks/delete-document", {
      method: "GET",
      token: `Bearer ${TOKEN}`,
    });

    assert.equal(response.status, 405);
    assert.equal(errorCode(response.json), "METHOD_NOT_ALLOWED");
  });

  it("refuse un corps sans champ expectedRevision", async () => {
    const response = await call("/repositories/tasks/delete-document", {
      ...authorized,
      body: JSON.stringify({ repositoryPath: REPOSITORY, taskCode: "TASK-001" }),
    });

    assert.equal(response.status, 400);
    assert.equal(errorCode(response.json), "INVALID_REQUEST");
  });

  it("ne divulgue ni jeton ni chemin absolu", async () => {
    const response = await call("/repositories/tasks/delete-document", {
      ...authorized,
      body: body(),
    });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(response.text.includes(REPOSITORY), false);
    assert.equal(response.text.includes("D:\\"), false);
  });
});

describe("POST /claude/preflight", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;

  function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({ repositoryPath: "D:Projetsdepot", ...overrides });
  }

  it("repond 200 avec l'etat Git et la version de Claude Code", async () => {
    const response = await call("/claude/preflight", { ...authorized, body: body() });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      ok: true,
      claude: { available: true, version: "9.9.9" },
      git: {
        clean: true,
        branch: "main",
        upstream: "origin/main",
        head: "a".repeat(40),
        ahead: 0,
        behind: 0,
      },
    });
  });

  it("ne renvoie aucun chemin absolu", async () => {
    const response = await call("/claude/preflight", { ...authorized, body: body() });

    assert.equal(/[A-Za-z]:\\/.test(response.text), false);
    assert.equal(response.text.includes(TOKEN), false);
  });

  it("exige le jeton", async () => {
    const response = await call("/claude/preflight", { method: "POST", token: null, body: body() });

    assert.equal(response.status, 401);
    assert.equal(errorCode(response.json), "UNAUTHORIZED");
  });

  it("refuse une methode autre que POST", async () => {
    const response = await call("/claude/preflight", { method: "GET", token: `Bearer ${TOKEN}` });

    assert.equal(response.status, 405);
  });

  it("traduit un repository sale en 422", async () => {
    const response = await call("/claude/preflight", {
      ...authorized,
      body: body({ repositoryPath: "sale" }),
    });

    assert.equal(response.status, 422);
    assert.equal(errorCode(response.json), "REPOSITORY_DIRTY");
  });

  it("traduit les refus Git structurels en 422", async () => {
    for (const [repositoryPath, code] of [
      ["detache", "GIT_DETACHED_HEAD"],
      ["sans-upstream", "GIT_UPSTREAM_MISSING"],
      ["desynchronise", "GIT_NOT_SYNCHRONIZED"],
    ] as const) {
      const response = await call("/claude/preflight", {
        ...authorized,
        body: body({ repositoryPath }),
      });

      assert.equal(response.status, 422, repositoryPath);
      assert.equal(errorCode(response.json), code);
    }
  });

  it("traduit une absence de Claude Code en 503", async () => {
    const response = await call("/claude/preflight", {
      ...authorized,
      body: body({ repositoryPath: "sans-claude" }),
    });

    assert.equal(response.status, 503);
    assert.equal(errorCode(response.json), "CLAUDE_NOT_AVAILABLE");
  });

  it("refuse un corps mal forme", async () => {
    const response = await call("/claude/preflight", { ...authorized, body: "{}" });

    assert.equal(response.status, 400);
    assert.equal(errorCode(response.json), "INVALID_REQUEST");
  });

  it("transmet la politique de livraison declaree", async () => {
    for (const policy of DELIVERY_POLICIES) {
      receivedPreflightPolicies.length = 0;

      const response = await call("/claude/preflight", {
        ...authorized,
        body: body({ repositoryPath: "/depot", deliveryPolicy: policy }),
      });

      assert.equal(response.status, 200, policy);
      assert.deepEqual(receivedPreflightPolicies, [policy]);
    }
  });

  it("lit MANUAL quand la politique est absente ou illisible", async () => {
    // Le defaut sur : un corps qui ne declare rien, ou qui declare n'importe
    // quoi, n'obtient jamais l'assouplissement reserve a `AUTO_COMMIT`.
    for (const declared of [undefined, "AUTO", "auto_commit", 42, null]) {
      receivedPreflightPolicies.length = 0;

      const payload: Record<string, unknown> = { repositoryPath: "/depot" };
      if (declared !== undefined) {
        payload["deliveryPolicy"] = declared;
      }

      const response = await call("/claude/preflight", { ...authorized, body: body(payload) });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedPreflightPolicies, [DELIVERY_POLICY.MANUAL], String(declared));
    }
  });
});

describe("POST /claude/runs/start", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;

  function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      runId: RUN_ID,
      repositoryPath: "D:Projetsdepot",
      prompt: "Prompt d'execution.",
      expectedGitHead: "a".repeat(40),
      validationCommands: ["npm run test"],
      taskKind: "NORMAL",
      ...overrides,
    });
  }

  it("repond 202 : la demande est acceptee, rien n'est termine", async () => {
    const response = await call("/claude/runs/start", { ...authorized, body: body() });

    assert.equal(response.status, 202);
    assert.deepEqual(response.json, {
      ok: true,
      run: { runId: RUN_ID, status: "RUNNING", startedAt: "2026-08-06T10:00:00.000Z" },
    });
  });

  it("transmet la demande complete a la couche metier", async () => {
    receivedStartCalls.length = 0;
    await call("/claude/runs/start", { ...authorized, body: body() });

    assert.equal(receivedStartCalls.length, 1);
    assert.equal(receivedStartCalls[0]?.runId, RUN_ID);
    assert.equal(receivedStartCalls[0]?.prompt, "Prompt d'execution.");
    assert.deepEqual(receivedStartCalls[0]?.validationCommands, ["npm run test"]);
  });

  it("exige le jeton", async () => {
    const response = await call("/claude/runs/start", { method: "POST", token: null, body: body() });

    assert.equal(response.status, 401);
  });

  it("traduit un run deja actif en 409", async () => {
    const response = await call("/claude/runs/start", {
      ...authorized,
      body: body({ repositoryPath: "occupe" }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "CLAUDE_RUN_ALREADY_ACTIVE");
  });

  it("traduit un HEAD modifie en 409", async () => {
    const response = await call("/claude/runs/start", {
      ...authorized,
      body: body({ expectedGitHead: "b".repeat(40) }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "GIT_HEAD_CHANGED");
  });

  it("traduit une commande refusee en 422", async () => {
    const response = await call("/claude/runs/start", {
      ...authorized,
      body: body({ validationCommands: ["rm -rf dist"] }),
    });

    assert.equal(response.status, 422);
    assert.equal(errorCode(response.json), "CLAUDE_COMMAND_NOT_ALLOWED");
  });

  it("refuse un corps auquel il manque un champ", async () => {
    for (const raw of [
      JSON.stringify({
        runId: RUN_ID,
        prompt: "x",
        expectedGitHead: "y",
        validationCommands: [],
        taskKind: "NORMAL",
      }),
      JSON.stringify({
        runId: RUN_ID,
        repositoryPath: "x",
        expectedGitHead: "y",
        validationCommands: [],
        taskKind: "NORMAL",
      }),
      JSON.stringify({
        runId: RUN_ID,
        repositoryPath: "x",
        prompt: "y",
        expectedGitHead: "z",
        validationCommands: [1],
        taskKind: "NORMAL",
      }),
      // La nature est exigee : sans elle, NOX ne saurait pas nommer le niveau de
      // privilege de l'execution, et ne la lance pas.
      JSON.stringify({
        runId: RUN_ID,
        repositoryPath: "x",
        prompt: "y",
        expectedGitHead: "z",
        validationCommands: [],
      }),
      JSON.stringify({
        runId: RUN_ID,
        repositoryPath: "x",
        prompt: "y",
        expectedGitHead: "z",
        validationCommands: [],
        taskKind: "AUTRE",
      }),
    ]) {
      const response = await call("/claude/runs/start", { ...authorized, body: raw });
      assert.equal(response.status, 400);
      assert.equal(errorCode(response.json), "INVALID_REQUEST");
    }
  });

  it("refuse un corps depassant la limite", async () => {
    const response = await call("/claude/runs/start", {
      ...authorized,
      body: body({ prompt: "x".repeat(MAX_DOCUMENT_BODY_BYTES + 1024) }),
    });

    assert.equal(response.status, 413);
    assert.equal(errorCode(response.json), "PAYLOAD_TOO_LARGE");
  });
});

describe("POST /claude/runs/status", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;

  it("retourne l'etat d'une execution connue", async () => {
    testRegistry.register(RUN_ID, "d:\\depots\\alpha");
    testRegistry.start(RUN_ID, new Date("2026-08-06T10:00:00.000Z"));

    const response = await call("/claude/runs/status", {
      ...authorized,
      body: JSON.stringify({ runId: RUN_ID }),
    });

    assert.equal(response.status, 200);
    const payload = response.json as { run?: { status?: string; runId?: string } };
    assert.equal(payload.run?.status, "RUNNING");
    assert.equal(payload.run?.runId, RUN_ID);
  });

  it("retourne 404 pour une execution inconnue du registre", async () => {
    const response = await call("/claude/runs/status", {
      ...authorized,
      body: JSON.stringify({ runId: "3f2504e0-4f89-41d3-9a0c-999999999999" }),
    });

    assert.equal(response.status, 404);
    assert.equal(errorCode(response.json), "CLAUDE_RUN_NOT_FOUND");
  });

  it("conserve le resultat final apres la fin de l'execution", async () => {
    const finished = "3f2504e0-4f89-41d3-9a0c-0305e82c3399";
    // Le registre n'accepte qu'une execution active : celle du test precedent
    // doit d'abord etre conclue.
    testRegistry.finish(RUN_ID, "COMPLETED");
    testRegistry.register(finished, "d:\\depots\\alpha");
    testRegistry.finish(finished, "COMPLETED", { resultText: "Fini.", exitCode: 0 });

    const response = await call("/claude/runs/status", {
      ...authorized,
      body: JSON.stringify({ runId: finished }),
    });

    const payload = response.json as { run?: { status?: string; resultText?: string } };
    assert.equal(payload.run?.status, "COMPLETED");
    assert.equal(payload.run?.resultText, "Fini.");
  });

  it("exige le jeton", async () => {
    const response = await call("/claude/runs/status", {
      method: "POST",
      token: null,
      body: JSON.stringify({ runId: RUN_ID }),
    });

    assert.equal(response.status, 401);
  });

  it("ne divulgue ni jeton ni chemin absolu", async () => {
    const response = await call("/claude/runs/status", {
      ...authorized,
      body: JSON.stringify({ runId: RUN_ID }),
    });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(/[A-Za-z]:\\/.test(response.text), false);
  });
});

describe("POST /claude/runs/events", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const EVENTS_RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3401";

  function seed(): void {
    // Ces suites partagent un meme repository de test : le registre n'y accepte
    // qu'une execution active a la fois, et celles des suites precedentes
    // doivent d'abord etre conclues. Celle de cette suite, en revanche, doit
    // rester active d'un test a l'autre.
    for (const active of testRegistry.activeRunIds()) {
      if (active !== EVENTS_RUN) {
        testRegistry.finish(active, "COMPLETED");
      }
    }
    if (!testRegistry.has(EVENTS_RUN)) {
      testRegistry.register(EVENTS_RUN, "d:\\depots\\alpha");
      testRegistry.start(EVENTS_RUN, new Date("2026-08-07T10:00:00.000Z"));
      testRegistry.appendEvents(EVENTS_RUN, [
        { kind: "STATUS", label: "Started", detail: null, toolName: null, isError: false },
        {
          kind: "TOOL_STARTED",
          label: "Reading README.md",
          detail: null,
          toolName: "Read",
          isError: false,
        },
        {
          kind: "ASSISTANT_MESSAGE",
          label: "Assistant message",
          detail: "Un message public.",
          toolName: null,
          isError: false,
        },
      ]);
    }
  }

  it("retourne les evenements d'une execution connue", async () => {
    seed();

    const response = await call("/claude/runs/events", {
      ...authorized,
      body: JSON.stringify({ runId: EVENTS_RUN, afterSequence: 0, limit: 100 }),
    });

    assert.equal(response.status, 200);
    const payload = response.json as { events?: { sequence?: number; label?: string }[] };
    assert.equal(payload.events?.length, 3);
    assert.deepEqual(payload.events?.map((event) => event.sequence), [1, 2, 3]);
  });

  it("respecte le curseur", async () => {
    seed();

    const response = await call("/claude/runs/events", {
      ...authorized,
      body: JSON.stringify({ runId: EVENTS_RUN, afterSequence: 2, limit: 100 }),
    });

    const payload = response.json as { events?: { sequence?: number }[]; nextSequence?: number };
    assert.deepEqual(payload.events?.map((event) => event.sequence), [3]);
    assert.equal(payload.nextSequence, 3);
  });

  it("borne la taille du lot", async () => {
    seed();

    const response = await call("/claude/runs/events", {
      ...authorized,
      body: JSON.stringify({ runId: EVENTS_RUN, afterSequence: 0, limit: 1 }),
    });

    assert.equal((response.json as { events?: unknown[] }).events?.length, 1);
  });

  it("annonce le statut et l'etat final", async () => {
    seed();

    const response = await call("/claude/runs/events", {
      ...authorized,
      body: JSON.stringify({ runId: EVENTS_RUN }),
    });

    const payload = response.json as { status?: string; isFinal?: boolean; truncated?: boolean };
    assert.equal(payload.status, "RUNNING");
    assert.equal(payload.isFinal, false);
    assert.equal(payload.truncated, false);
  });

  it("retourne 404 pour une execution inconnue", async () => {
    const response = await call("/claude/runs/events", {
      ...authorized,
      body: JSON.stringify({ runId: "3f2504e0-4f89-41d3-9a0c-999999999998" }),
    });

    assert.equal(response.status, 404);
    assert.equal(errorCode(response.json), "CLAUDE_RUN_NOT_FOUND");
  });

  it("refuse un curseur negatif", async () => {
    const response = await call("/claude/runs/events", {
      ...authorized,
      body: JSON.stringify({ runId: EVENTS_RUN, afterSequence: -5 }),
    });

    assert.equal(response.status, 400);
  });

  it("exige le jeton", async () => {
    const response = await call("/claude/runs/events", {
      method: "POST",
      token: null,
      body: JSON.stringify({ runId: EVENTS_RUN }),
    });

    assert.equal(response.status, 401);
  });

  it("refuse GET", async () => {
    const response = await call("/claude/runs/events", { method: "GET", token: `Bearer ${TOKEN}` });
    assert.equal(response.status, 405);
  });

  it("ne divulgue ni jeton ni chemin absolu", async () => {
    seed();

    const response = await call("/claude/runs/events", {
      ...authorized,
      body: JSON.stringify({ runId: EVENTS_RUN }),
    });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(/[A-Za-z]:\\/.test(response.text), false);
  });

  it("ne renvoie aucun champ hors du contrat public", async () => {
    seed();

    const response = await call("/claude/runs/events", {
      ...authorized,
      body: JSON.stringify({ runId: EVENTS_RUN }),
    });

    const payload = response.json as { events?: Record<string, unknown>[] };
    for (const event of payload.events ?? []) {
      assert.deepEqual(
        Object.keys(event).sort(),
        ["detail", "isError", "kind", "label", "occurredAt", "sequence", "toolName"],
      );
    }
  });
});

describe("POST /claude/runs/cancel", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const CANCEL_RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3402";

  function seedActive(runId: string): void {
    for (const active of testRegistry.activeRunIds()) {
      if (active !== runId) {
        testRegistry.finish(active, "COMPLETED");
      }
    }
    if (!testRegistry.has(runId)) {
      testRegistry.register(runId, "d:\\depots\\alpha");
      testRegistry.start(runId, new Date());
      testRegistry.attachKill(runId, () => undefined);
    }
  }

  it("accepte l'arret d'une execution active", async () => {
    seedActive(CANCEL_RUN);

    const response = await call("/claude/runs/cancel", {
      ...authorized,
      body: JSON.stringify({ runId: CANCEL_RUN }),
    });

    // `202` : la demande est acceptee, l'arret engage, mais rien n'est termine.
    assert.equal(response.status, 202);
    const payload = response.json as { run?: { status?: string } };
    assert.equal(payload.run?.status, "CANCELLING");
  });

  it("refuse un second appel pendant l'arret", async () => {
    seedActive(CANCEL_RUN);

    const response = await call("/claude/runs/cancel", {
      ...authorized,
      body: JSON.stringify({ runId: CANCEL_RUN }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "CLAUDE_RUN_CANCELLING");
  });

  it("refuse une execution deja terminee", async () => {
    const finished = "3f2504e0-4f89-41d3-9a0c-0305e82c3403";
    testRegistry.finish(CANCEL_RUN, "CANCELLED");
    testRegistry.register(finished, "d:\\depots\\alpha");
    testRegistry.finish(finished, "COMPLETED");

    const response = await call("/claude/runs/cancel", {
      ...authorized,
      body: JSON.stringify({ runId: finished }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "CLAUDE_RUN_ALREADY_FINISHED");
  });

  it("retourne 404 pour une execution inconnue", async () => {
    const response = await call("/claude/runs/cancel", {
      ...authorized,
      body: JSON.stringify({ runId: "3f2504e0-4f89-41d3-9a0c-999999999997" }),
    });

    assert.equal(response.status, 404);
    assert.equal(errorCode(response.json), "CLAUDE_RUN_NOT_FOUND");
  });

  it("exige le jeton", async () => {
    const response = await call("/claude/runs/cancel", {
      method: "POST",
      token: null,
      body: JSON.stringify({ runId: CANCEL_RUN }),
    });

    assert.equal(response.status, 401);
  });

  it("refuse GET", async () => {
    const response = await call("/claude/runs/cancel", { method: "GET", token: `Bearer ${TOKEN}` });
    assert.equal(response.status, 405);
  });

  it("ignore un PID transmis par l'appelant", async () => {
    const target = "3f2504e0-4f89-41d3-9a0c-0305e82c3404";
    seedActive(target);

    const response = await call("/claude/runs/cancel", {
      ...authorized,
      body: JSON.stringify({ runId: target, pid: 4242, signal: "SIGKILL", force: true }),
    });

    // Le corps supplementaire n'a aucun effet : seul le `runId` est lu, et
    // l'execution designee est bien celle du registre.
    assert.equal(response.status, 202);
    assert.equal(testRegistry.snapshot(target)?.status, "CANCELLING");
  });

  it("ne divulgue ni jeton ni chemin absolu", async () => {
    const target = "3f2504e0-4f89-41d3-9a0c-0305e82c3405";
    testRegistry.finish("3f2504e0-4f89-41d3-9a0c-0305e82c3404", "CANCELLED");
    seedActive(target);

    const response = await call("/claude/runs/cancel", {
      ...authorized,
      body: JSON.stringify({ runId: target }),
    });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(/[A-Za-z]:\\/.test(response.text), false);
  });
});

describe("POST /claude/runs/review", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;
  const REVIEW_RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3501";
  const ACTIVE_RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3502";
  const FAILED_RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3503";

  /** Termine ce qui tourne encore : le registre n'accepte qu'un run actif. */
  function idle(except?: string): void {
    for (const active of testRegistry.activeRunIds()) {
      if (active !== except) {
        testRegistry.finish(active, "COMPLETED");
      }
    }
  }

  function seedCaptured(): void {
    idle();
    if (testRegistry.has(REVIEW_RUN)) {
      return;
    }
    testRegistry.register(REVIEW_RUN, "d:\\depots\\alpha");
    testRegistry.finish(REVIEW_RUN, "COMPLETED");
    testRegistry.attachReview(REVIEW_RUN, {
      ok: true,
      snapshot: {
        capturedAt: "2026-08-07T12:00:00.000Z",
        headBefore: "a".repeat(40),
        unreliable: false,
        files: [
          {
            position: 0,
            path: "README.md",
            previousPath: null,
            changeType: "MODIFIED",
            additions: 2,
            deletions: 1,
            isBinary: false,
            isSensitive: false,
            isTruncated: false,
            patch: "@@ -1 +1 @@\n-avant\n+apres\n",
          },
        ],
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
        workspace: { value: "f".repeat(64), version: "v1", errorCode: null },
      },
    });
  }

  it("retourne l'instantane capture", async () => {
    seedCaptured();

    const response = await call("/claude/runs/review", {
      ...authorized,
      body: JSON.stringify({ runId: REVIEW_RUN }),
    });

    assert.equal(response.status, 200);
    const payload = response.json as {
      review?: { files?: { path?: string }[]; validations?: unknown[] };
    };
    assert.equal(payload.review?.files?.length, 1);
    assert.equal(payload.review?.files?.[0]?.path, "README.md");
    assert.equal(payload.review?.validations?.length, 1);
  });

  it("refuse une execution qui n'a pas encore fini", async () => {
    idle(ACTIVE_RUN);
    if (!testRegistry.has(ACTIVE_RUN)) {
      testRegistry.register(ACTIVE_RUN, "d:\\depots\\alpha");
      testRegistry.start(ACTIVE_RUN, new Date("2026-08-07T10:00:00.000Z"));
    }

    const response = await call("/claude/runs/review", {
      ...authorized,
      body: JSON.stringify({ runId: ACTIVE_RUN }),
    });

    assert.equal(response.status, 409);
    assert.equal(errorCode(response.json), "CLAUDE_REVIEW_NOT_READY");
  });

  it("signale une capture ratee sans pretendre a une review vide", async () => {
    testRegistry.finish(ACTIVE_RUN, "COMPLETED");
    idle();
    if (!testRegistry.has(FAILED_RUN)) {
      testRegistry.register(FAILED_RUN, "d:\\depots\\alpha");
      testRegistry.finish(FAILED_RUN, "COMPLETED");
      testRegistry.attachReview(FAILED_RUN, { ok: false, code: "CLAUDE_REVIEW_FAILED" });
    }

    const response = await call("/claude/runs/review", {
      ...authorized,
      body: JSON.stringify({ runId: FAILED_RUN }),
    });

    assert.equal(response.status, 500);
    assert.equal(errorCode(response.json), "CLAUDE_REVIEW_FAILED");
  });

  it("retourne 404 pour une execution inconnue", async () => {
    const response = await call("/claude/runs/review", {
      ...authorized,
      body: JSON.stringify({ runId: "3f2504e0-4f89-41d3-9a0c-999999999996" }),
    });

    assert.equal(response.status, 404);
    assert.equal(errorCode(response.json), "CLAUDE_RUN_NOT_FOUND");
  });

  it("exige le jeton", async () => {
    const response = await call("/claude/runs/review", {
      method: "POST",
      token: null,
      body: JSON.stringify({ runId: REVIEW_RUN }),
    });

    assert.equal(response.status, 401);
  });

  it("refuse GET", async () => {
    const response = await call("/claude/runs/review", { method: "GET", token: `Bearer ${TOKEN}` });
    assert.equal(response.status, 405);
  });

  it("ignore tout chemin transmis par l'appelant", async () => {
    seedCaptured();

    const response = await call("/claude/runs/review", {
      ...authorized,
      body: JSON.stringify({
        runId: REVIEW_RUN,
        repositoryPath: "D:\\ailleurs",
        file: "../../etc/passwd",
        expectedGitHead: "b".repeat(40),
      }),
    });

    // Ces champs n'ont aucun chemin de code vers la suite : la route ne lit
    // qu'un `runId`, et rend un instantane deja capture.
    assert.equal(response.status, 200);
    const payload = response.json as { review?: { files?: { path?: string }[] } };
    assert.equal(payload.review?.files?.[0]?.path, "README.md");
  });

  it("ne divulgue ni jeton ni chemin absolu", async () => {
    seedCaptured();

    const response = await call("/claude/runs/review", {
      ...authorized,
      body: JSON.stringify({ runId: REVIEW_RUN }),
    });

    assert.equal(response.text.includes(TOKEN), false);
    assert.equal(/[A-Za-z]:\\/.test(response.text), false);
  });
});

describe("POST /claude/corrections/preflight", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;

  const REVIEWED = {
    repositoryPath: "D:/depot",
    expectedGitHead: "a".repeat(40),
    expectedBranch: "main",
    expectedWorkspaceFingerprint: "f".repeat(64),
  };

  it("exige une authentification", async () => {
    const response = await call("/claude/corrections/preflight", {
      method: "POST",
      token: null,
      body: JSON.stringify(REVIEWED),
    });

    assert.equal(response.status, 401);
  });

  it("accepte un etat identique et repond sans empreinte", async () => {
    const response = await call("/claude/corrections/preflight", {
      ...authorized,
      body: JSON.stringify(REVIEWED),
    });

    assert.equal(response.status, 200);
    // Ni chemin absolu, ni empreinte dans la reponse : l'appelant apprend que
    // l'etat correspond, pas a quoi il correspond.
    const serialized = JSON.stringify(response.json);
    assert.equal(serialized.includes(REVIEWED.expectedWorkspaceFingerprint), false);
    assert.equal(serialized.includes("D:/depot"), false);
  });

  it("traduit un dossier de travail different en 409", async () => {
    const response = await call("/claude/corrections/preflight", {
      ...authorized,
      body: JSON.stringify({ ...REVIEWED, expectedWorkspaceFingerprint: "e".repeat(64) }),
    });

    assert.equal(response.status, 409);
    assert.equal(
      errorCode(response.json),
      "REVIEW_WORKTREE_CHANGED",
    );
  });

  it("refuse un corps sans empreinte attendue", async () => {
    const response = await call("/claude/corrections/preflight", {
      ...authorized,
      body: JSON.stringify({ ...REVIEWED, expectedWorkspaceFingerprint: "" }),
    });

    // Une empreinte vide ferait passer n'importe quel repository pour l'etat
    // relu : le corps est invalide, pas « permissif ».
    assert.equal(response.status, 400);
  });

  it("refuse un corps sans HEAD attendu", async () => {
    const response = await call("/claude/corrections/preflight", {
      ...authorized,
      body: JSON.stringify({ ...REVIEWED, expectedGitHead: "" }),
    });

    assert.equal(response.status, 400);
  });

  it("refuse une autre methode", async () => {
    const response = await call("/claude/corrections/preflight", {
      method: "GET",
      token: `Bearer `,
    });

    assert.equal(response.status, 405);
  });
});

describe("POST /claude/runs/start — correction ciblee", () => {
  const authorized = { method: "POST", token: `Bearer ${TOKEN}` } as const;

  const BASE = {
    runId: "3f2504e0-4f89-41d3-9a0c-0305e82c9922",
    repositoryPath: "D:/depot",
    prompt: "Corrige la deuxieme phrase.",
    expectedGitHead: "a".repeat(40),
    validationCommands: ["npm run test"],
    taskKind: "NORMAL",
  };

  const CORRECTION = {
    sessionId: "62b9a0f0-1d01-4a0c-8201-60f9bae0d34e",
    expectedBranch: "main",
    expectedWorkspaceFingerprint: "f".repeat(64),
  };

  it("transmet le bloc de correction au lancement", async () => {
    receivedStartCalls.length = 0;

    const response = await call("/claude/runs/start", {
      ...authorized,
      body: JSON.stringify({ ...BASE, correction: CORRECTION }),
    });

    assert.equal(response.status, 202);
    // Les entrees attendues s'ajoutent au bloc depuis HOTFIX-006. Absentes du
    // corps, elles valent `null` : le controle d'empreinte est inchange, seul
    // le diagnostic d'un refus eventuel sera moins bavard.
    assert.deepEqual(receivedStartCalls[0]?.correction, {
      ...CORRECTION,
      expectedWorkspaceEntries: null,
    });
  });

  it("transporte les entrees attendues quand le web les fournit", async () => {
    receivedStartCalls.length = 0;
    const entries = JSON.stringify([{ path: "a.ts", code: " M", digest: "abc" }]);

    const response = await call("/claude/runs/start", {
      ...authorized,
      body: JSON.stringify({
        ...BASE,
        correction: { ...CORRECTION, expectedWorkspaceEntries: entries },
      }),
    });

    assert.equal(response.status, 202);
    assert.equal(receivedStartCalls[0]?.correction?.expectedWorkspaceEntries, entries);
  });

  it("refuse des entrees attendues qui ne sont pas une chaine", async () => {
    // Elles n'accordent rien, mais un corps mal forme reste un corps mal forme :
    // NOX ne devine pas ce qu'un appelant a voulu dire.
    const response = await call("/claude/runs/start", {
      ...authorized,
      body: JSON.stringify({
        ...BASE,
        correction: { ...CORRECTION, expectedWorkspaceEntries: 42 },
      }),
    });

    assert.equal(response.status, 400);
  });

  it("laisse un run initial sans bloc de correction", async () => {
    receivedStartCalls.length = 0;

    await call("/claude/runs/start", { ...authorized, body: JSON.stringify(BASE) });

    assert.equal(receivedStartCalls[0]?.correction, undefined);
  });

  it("refuse un bloc de correction incomplet", async () => {
    // Une session sans empreinte attendue produirait une reprise sans controle
    // d'etat : le corps est rejete, pas ramene a un lancement initial.
    const response = await call("/claude/runs/start", {
      ...authorized,
      body: JSON.stringify({
        ...BASE,
        correction: { sessionId: CORRECTION.sessionId, expectedBranch: "main" },
      }),
    });

    assert.equal(response.status, 400);
  });

  it("refuse une session vide", async () => {
    const response = await call("/claude/runs/start", {
      ...authorized,
      body: JSON.stringify({ ...BASE, correction: { ...CORRECTION, sessionId: "" } }),
    });

    assert.equal(response.status, 400);
  });
});
