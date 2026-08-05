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
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  updateProjectDocument,
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

describe("integration web -> runner : ecriture d'un document", () => {
  /** Ouvre un document et retourne sa revision courante. */
  async function open(documentPath: string) {
    const result = await readProjectDocument(documentsRepository, documentPath, { environment });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("lecture impossible");
    return result.value;
  }

  it("enregistre un nouveau contenu et le rend immediatement relisible", async () => {
    const opened = await open("docs/nested/NOTE.md");

    const saved = await updateProjectDocument(
      documentsRepository,
      "docs/nested/NOTE.md",
      "# Note revue\n",
      opened.revision,
      { environment },
    );

    assert.equal(saved.ok, true);
    assert.equal(saved.ok && saved.value.content, "# Note revue\n");
    assert.notEqual(saved.ok && saved.value.revision, opened.revision);

    // Le fichier reel, vu depuis le test : c'est le disque qui fait foi.
    assert.equal(
      await readFile(path.join(documentsRepository, "docs", "nested", "NOTE.md"), "utf8"),
      "# Note revue\n",
    );

    const reopened = await open("docs/nested/NOTE.md");
    assert.equal(reopened.content, "# Note revue\n");
    assert.equal(reopened.revision, saved.ok ? saved.value.revision : "");
  });

  it("refuse une revision perimee et laisse le fichier intact", async () => {
    const opened = await open("decisions/ADR-001.md");

    // Modification exterieure, comme depuis un editeur ouvert en parallele.
    await writeFile(
      path.join(documentsRepository, "decisions", "ADR-001.md"),
      "# ADR 001 modifie ailleurs\n",
      "utf8",
    );

    const refused = await updateProjectDocument(
      documentsRepository,
      "decisions/ADR-001.md",
      "# Version de NOX\n",
      opened.revision,
      { environment },
    );

    const runnerFailure = failureOf(refused);
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "DOCUMENT_CONFLICT");
    assert.equal(
      await readFile(path.join(documentsRepository, "decisions", "ADR-001.md"), "utf8"),
      "# ADR 001 modifie ailleurs\n",
    );
  });

  it("refuse une traversee de repertoire de bout en bout", async () => {
    const refused = await updateProjectDocument(
      documentsRepository,
      "../../secret.md",
      "# Injecte\n",
      "a".repeat(64),
      { environment },
    );

    const runnerFailure = failureOf(refused);
    assert.equal(runnerFailure.kind === "runner_error" && runnerFailure.code, "DOCUMENT_PATH_INVALID");
  });

  it("exige le bon jeton pour ecrire", async () => {
    const opened = await open("README.md");
    const refused = await updateProjectDocument(documentsRepository, "README.md", "# Pirate\n", opened.revision, {
      environment: { ...environment, NOX_RUNNER_TOKEN: "un-autre-jeton" },
    });

    assert.equal(failureOf(refused).kind, "unauthorized");
    assert.equal(await readFile(path.join(documentsRepository, "README.md"), "utf8"), "# Lisez-moi\n");
  });

  it("ne laisse aucun fichier temporaire derriere lui", async () => {
    const opened = await open("docs/PROJECT_BRIEF.md");
    await updateProjectDocument(
      documentsRepository,
      "docs/PROJECT_BRIEF.md",
      "# Brief revu\n",
      opened.revision,
      { environment },
    );

    const entries = await readdir(path.join(documentsRepository, "docs"));
    assert.deepEqual(entries.filter((name) => name.startsWith(".nox-")), []);
  });
});
