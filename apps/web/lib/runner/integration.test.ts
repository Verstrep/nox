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
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { createRunnerServer } from "../../../runner/src/server.ts";

import { checkRunnerHealth, resolveRepositoryPath } from "./client.ts";
import type { RunnerFailure } from "./errors.ts";

const TOKEN = "jeton-integration-0123456789abcdef";
const CANONICAL_PATH = "D:\\Projets\\depot-resolu";

let server: Server;
let environment: Record<string, string>;

function failureOf(result: { ok: boolean } & Record<string, unknown>): RunnerFailure {
  assert.equal(result.ok, false);
  return result["failure"] as RunnerFailure;
}

before(async () => {
  // Git est simule : ce test verifie la chaine HTTP, pas la resolution Git,
  // deja couverte par les tests du runner.
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
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
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

    // Le serveur est reouvert pour ne pas perturber d'eventuels tests suivants.
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
});
