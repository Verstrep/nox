import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import type { RunnerConfig } from "./config.ts";
import { MAX_BODY_BYTES } from "./http/body.ts";
import { createRunnerServer } from "./server.ts";
import type { ResolveRepositoryResult } from "./repositories/resolve-repository.ts";

const TOKEN = "jeton-de-test-0123456789abcdef";
const CONFIG: RunnerConfig = { host: "127.0.0.1", port: 0, token: TOKEN };
const CANONICAL_PATH = "D:\\Projets\\depot-fictif";

/** Chemins transmis a la couche Git simulee, pour verifier le passage de relais. */
const receivedPaths: string[] = [];

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

let server: Server;
let baseUrl: string;

before(async () => {
  // Le serveur est cree sans port fixe : le systeme en attribue un libre.
  server = createRunnerServer(CONFIG, { resolveRepository: fakeResolve, log: () => undefined });
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
