/**
 * Test d'integration reel : client web -> runner NOX.
 *
 * Contrairement a `client.test.ts`, aucun `fetch` n'est simule ici. Un vrai
 * serveur de runner est demarre sur un port attribue par le systeme, et le
 * client du web l'interroge par le reseau local.
 *
 * Le module du runner est importe par chemin relatif : `apps/web` ne declare pas
 * `@nox/runner` en dependance, et il ne doit pas le faire — le web ne parle au
 * runner que par HTTP. Cette entorse est limitee a ce fichier de test.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createRunnerServer } from "../../../runner/src/server.ts";

import {
  checkRunnerHealth,
  listProjectDocuments,
  readProjectDocument,
  resolveRepositoryPath,
} from "./client.ts";
import type { RunnerFailure } from "./errors.ts";

const TOKEN = "jeton-integration-0123456789abcdef";
const CANONICAL_PATH = "D:\\Projets\\depot-resolu";
const BRIEF_CONTENT = "# Brief\n\nContenu avec accents : étude, dépôt.\n";

let server: Server;
let environment: Record<string, string>;
let workspace: string;
let documentsRepository: string;

function failureOf(result: { ok: boolean } & Record<string, unknown>): RunnerFailure {
  assert.equal(result.ok, false);
  return result["failure"] as RunnerFailure;
}

before(async () => {
  // Git est simule : la resolution Git a ses propres tests. En revanche, la
  // lecture des documents utilise les **vraies** fonctions du runner sur un
  // repository temporaire : c'est toute la chaine web -> HTTP -> disque qui est
  // exercee ici.
  server = createRunnerServer(
    { host: "127.0.0.1", port: 0, token: TOKEN },
    {
      log: () => undefined,
      resolveRepository: (repositoryPath) =>
        Promise.resolve(
          repositoryPath === "D:\\Projets\\inconnu"
            ? { ok: false, code: "NOT_A_GIT_REPOSITORY" }
            : { ok: true, canonicalPath: CANONICAL_PATH },
        ),
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  environment = {
    NOX_RUNNER_URL: `http://127.0.0.1:${String(address.port)}`,
    NOX_RUNNER_TOKEN: TOKEN,
  };

  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-integration-"));
  documentsRepository = path.join(workspace, "depot documente");
  await mkdir(path.join(documentsRepository, "docs", "nested"), { recursive: true });
  await mkdir(path.join(documentsRepository, "decisions"), { recursive: true });

  await writeFile(path.join(documentsRepository, "README.md"), "# Lisez-moi\n");
  await writeFile(path.join(documentsRepository, "docs", "PROJECT_BRIEF.md"), BRIEF_CONTENT);
  await writeFile(path.join(documentsRepository, "docs", "nested", "NOTE.md"), "# Note\n");
  await writeFile(path.join(documentsRepository, "decisions", "ADR-001.md"), "# ADR 001\n");
  await writeFile(path.join(documentsRepository, "docs", "image.png"), "pas du markdown");
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("integration web -> runner", () => {
  it("lit la sante du runner", async () => {
    const result = await checkRunnerHealth({ environment });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.service, "nox-runner");
  });

  it("resout un repository avec le bon jeton", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\depot-resolu\\src", { environment });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value, CANONICAL_PATH);
  });

  it("est refuse avec un jeton different", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\depot-resolu", {
      environment: { ...environment, NOX_RUNNER_TOKEN: "un-autre-jeton" },
    });

    assert.equal(failureOf(result).kind, "unauthorized");
  });

  it("remonte une erreur metier du runner", async () => {
    const result = await resolveRepositoryPath("D:\\Projets\\inconnu", { environment });

    const runnerFailure = failureOf(result);
    assert.equal(runnerFailure.kind, "runner_error");
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "NOT_A_GIT_REPOSITORY");
  });

  it("signale un runner arrete", async () => {
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));

    const result = await resolveRepositoryPath("D:\\Projets\\depot-resolu", { environment });
    assert.equal(failureOf(result).kind, "unreachable");

    // Le serveur est reouvert pour les suites suivantes. Le systeme attribue un
    // nouveau port : l'environnement doit etre reactualise, sinon les tests
    // suivants viseraient une adresse morte.
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    environment.NOX_RUNNER_URL = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
});

describe("integration web -> runner : documents", () => {
  it("inventorie les documents d'un vrai repository", async () => {
    const result = await listProjectDocuments(documentsRepository, { environment });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.ok ? result.value.map((document) => document.path) : [],
      ["docs/PROJECT_BRIEF.md", "README.md", "docs/nested/NOTE.md", "decisions/ADR-001.md"],
    );
  });

  it("categorise et renseigne les metadonnees", async () => {
    const result = await listProjectDocuments(documentsRepository, { environment });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const brief = result.value.find((document) => document.path === "docs/PROJECT_BRIEF.md");
    assert.equal(brief?.category, "CORE");
    assert.equal(brief?.name, "PROJECT_BRIEF.md");
    assert.equal(brief?.size, Buffer.byteLength(BRIEF_CONTENT));

    assert.equal(
      result.value.find((document) => document.path === "decisions/ADR-001.md")?.category,
      "DECISION",
    );
  });

  it("ne renvoie que des chemins relatifs", async () => {
    const result = await listProjectDocuments(documentsRepository, { environment });
    assert.equal(result.ok, true);

    const serialized = JSON.stringify(result.ok ? result.value : []);
    assert.equal(serialized.toLowerCase().includes(workspace.toLowerCase()), false);
  });

  it("lit un document et preserve son contenu", async () => {
    const result = await readProjectDocument(documentsRepository, "docs/PROJECT_BRIEF.md", {
      environment,
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.content, BRIEF_CONTENT);
    assert.equal(result.ok && result.value.path, "docs/PROJECT_BRIEF.md");
  });

  it("refuse une traversee de repertoire de bout en bout", async () => {
    const result = await readProjectDocument(documentsRepository, "../../secret.md", {
      environment,
    });

    const runnerFailure = failureOf(result);
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "DOCUMENT_PATH_INVALID");
  });

  it("signale un repository disparu", async () => {
    const result = await listProjectDocuments(path.join(workspace, "jamais-cree"), { environment });

    const runnerFailure = failureOf(result);
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "REPOSITORY_NOT_FOUND");
  });

  it("exige le bon jeton", async () => {
    const result = await listProjectDocuments(documentsRepository, {
      environment: { ...environment, NOX_RUNNER_TOKEN: "un-autre-jeton" },
    });

    assert.equal(failureOf(result).kind, "unauthorized");
  });
});
