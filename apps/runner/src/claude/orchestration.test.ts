/**
 * Ce que l'orchestration multi-repositories du runner ne fait plus.
 *
 * ## Pourquoi ce fichier lit des sources
 *
 * Parce que les garanties de TASK-031 sont pour moitie des **absences** : plus
 * d'execution courante, plus de processus courant, plus de « cancel current »,
 * plus de registre vide d'un coup. Une absence ne s'observe pas en lancant le
 * code une fois — elle se reintroduit un jour par commodite, et le test qui
 * l'aurait vue n'existe pas. Celui-ci porte sur le texte des modules concernes.
 *
 * Le comportement, lui, est verifie ailleurs : `registry.test.ts` pour
 * l'exclusion et l'isolation, `runs.test.ts` pour le refus au lancement,
 * `cancel.test.ts` pour l'arret cible, et le test fonctionnel pour la
 * simultaneite reelle de plusieurs processus.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CLAUDE_RUN_EVENT_KIND } from "@nox/shared";

import { ClaudeRunRegistry } from "./registry.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function source(file: string): Promise<string> {
  return readFile(path.join(HERE, file), "utf8");
}

/** Le code seul : les entetes nomment ce qu'ils refusent, et c'est voulu. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
}

describe("aucun singleton d'execution", () => {
  it("le registre n'expose aucune execution courante", async () => {
    const text = code(await source("registry.ts"));

    // `activeRunId()` designait « l'execution active de NOX ». La remettre
    // ferait de la premiere entree trouvee une autorite qu'elle n'a pas.
    for (const forbidden of [
      "activeRunId(",
      "globalCurrentRun",
      "currentRun",
      "currentProcess",
      "singleActiveRun",
    ]) {
      assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister dans registry.ts`);
    }
  });

  it("le registre ne se vide jamais d'un coup", async () => {
    const text = code(await source("registry.ts"));

    // Une execution qui se termine ne doit retirer **que** son entree. Un
    // `clear()` emporterait les executions des autres repositories.
    assert.ok(!text.includes(".clear("), "aucun vidage global du registre");
  });

  it("l'annulation vise un identifiant, jamais « la courante »", async () => {
    const text = code(await source("cancel.ts"));

    for (const forbidden of ["activeRunId(", "cancelCurrent", "killAll", "currentProcess"]) {
      assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister dans cancel.ts`);
    }
    // L'arret passe par le registre, sur un `runId` recu.
    assert.ok(text.includes("registry.kill(runId)"), "l'arret cible le run demande");
  });

  it("le lancement derive la cle du repository, il ne la recoit pas", async () => {
    const text = code(await source("runs.ts"));

    // La cle vient de la racine reelle rendue par le systeme de fichiers. Un
    // champ de requete la portant serait une cle fournie par l'appelant.
    assert.ok(
      text.includes("repositoryLockKey(repository.root)"),
      "la cle vient de la racine resolue",
    );
    for (const forbidden of ["repositoryLockId", "request.repositoryKey", "lockKey:"]) {
      assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister dans runs.ts`);
    }
  });
});

describe("isolation entre executions simultanees", () => {
  const ID_A = "3f2504e0-4f89-41d3-9a0c-000000000101";
  const ID_B = "3f2504e0-4f89-41d3-9a0c-000000000102";
  const REPO_A = "d:/depots/alpha";
  const REPO_B = "d:/depots/beta";

  function twoActive(): ClaudeRunRegistry {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A, REPO_A);
    registry.register(ID_B, REPO_B);
    registry.start(ID_A, new Date("2026-08-28T10:00:00.000Z"));
    registry.start(ID_B, new Date("2026-08-28T10:00:01.000Z"));
    return registry;
  }

  it("garde deux executions actives en meme temps", () => {
    const registry = twoActive();

    assert.deepEqual(registry.activeRunIds(), [ID_A, ID_B]);
    assert.equal(registry.size(), 2);
    assert.equal(registry.snapshot(ID_A)?.status, "RUNNING");
    assert.equal(registry.snapshot(ID_B)?.status, "RUNNING");
  });

  it("ne melange jamais les evenements de deux executions", () => {
    const registry = twoActive();

    // Emission entrelacee, comme deux processus reels l'ecriraient.
    for (let index = 1; index <= 3; index += 1) {
      registry.appendEvents(ID_A, [
        {
          kind: CLAUDE_RUN_EVENT_KIND.TOOL_STARTED,
          label: `A-${String(index)}`,
          detail: null,
          toolName: "Read",
          isError: false,
        },
      ]);
      registry.appendEvents(ID_B, [
        {
          kind: CLAUDE_RUN_EVENT_KIND.TOOL_STARTED,
          label: `B-${String(index)}`,
          detail: null,
          toolName: "Read",
          isError: false,
        },
      ]);
    }

    const eventsA = registry.getEvents(ID_A, 0, 50)?.events ?? [];
    const eventsB = registry.getEvents(ID_B, 0, 50)?.events ?? [];

    assert.deepEqual(
      eventsA.map((event) => event.label),
      ["A-1", "A-2", "A-3"],
    );
    assert.deepEqual(
      eventsB.map((event) => event.label),
      ["B-1", "B-2", "B-3"],
    );
    // Les numeros sont attribues par execution : deux flux simultanes ne
    // partagent pas un compteur.
    assert.deepEqual(
      eventsA.map((event) => event.sequence),
      [1, 2, 3],
    );
    assert.deepEqual(
      eventsB.map((event) => event.sequence),
      [1, 2, 3],
    );
  });

  it("n'arrete que le processus vise", () => {
    const registry = twoActive();
    const killed: string[] = [];
    registry.attachKill(ID_A, () => killed.push(ID_A));
    registry.attachKill(ID_B, () => killed.push(ID_B));

    assert.equal(registry.kill(ID_A), true);

    assert.deepEqual(killed, [ID_A]);
    assert.equal(registry.snapshot(ID_B)?.status, "RUNNING");
  });

  it("laisse l'autre execution intacte quand la premiere est annulee", () => {
    const registry = twoActive();

    assert.equal(registry.requestCancellation(ID_A).ok, true);
    registry.finish(ID_A, "CANCELLED");

    assert.equal(registry.snapshot(ID_A)?.status, "CANCELLED");
    assert.equal(registry.snapshot(ID_B)?.status, "RUNNING");
    assert.deepEqual(registry.activeRunIds(), [ID_B]);
    // Le repository libere accepte une nouvelle execution ; l'autre non.
    assert.equal(registry.activeRunIdForRepository(REPO_A), null);
    assert.equal(registry.activeRunIdForRepository(REPO_B), ID_B);
  });

  it("laisse l'autre execution intacte quand la premiere echoue", () => {
    const registry = twoActive();
    registry.finish(ID_A, "FAILED", { errorCode: "CLAUDE_EXIT_NONZERO" });

    assert.equal(registry.snapshot(ID_B)?.status, "RUNNING");
    assert.deepEqual(registry.activeRunIds(), [ID_B]);
  });

  it("garde le contexte de chaque execution separe", () => {
    const registry = twoActive();
    registry.attachContext(ID_A, { repositoryRoot: REPO_A, headBefore: "a".repeat(40) });
    registry.attachContext(ID_B, { repositoryRoot: REPO_B, headBefore: "b".repeat(40) });

    assert.equal(registry.context(ID_A)?.repositoryRoot, REPO_A);
    assert.equal(registry.context(ID_B)?.repositoryRoot, REPO_B);
    assert.equal(registry.repositoryKey(ID_A), REPO_A);
    assert.equal(registry.repositoryKey(ID_B), REPO_B);
  });
});
