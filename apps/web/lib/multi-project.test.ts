/**
 * Ce que l'orchestration multi-projets garantit, et ce qu'elle n'a pas ajoute.
 *
 * ## Pourquoi ce fichier lit des sources
 *
 * Parce que les garanties de TASK-031 sont pour moitie des absences : aucune
 * file globale, aucun ordonnanceur, aucun avancement qui choisirait un autre
 * projet, aucun demarrage au boot. Une absence ne se voit pas en lancant le code
 * une fois — elle revient un jour par commodite, sous un nom raisonnable.
 *
 * Le parcours reel — deux projets qui travaillent en meme temps, chacun avec ses
 * validations, ses corrections et sa livraison — est verifie par le test
 * fonctionnel, avec un vrai runner et de vrais repositories.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function source(file: string): Promise<string> {
  return readFile(path.join(HERE, file), "utf8");
}

/** Le code seul : les entetes nomment ce qu'ils refusent, et c'est voulu. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
}

describe("aucune file ni ordonnanceur global", () => {
  it("le dispatcher n'avance qu'une file nommee", async () => {
    const text = code(await source("queue.ts"));

    // `advanceQueue(db, projectId)` : le projet est un parametre, jamais un
    // choix fait dans la fonction. Une variante « premiere file active »
    // pourrait avancer un projet que personne n'a demande.
    assert.ok(text.includes("export async function advanceQueue("), "advanceQueue existe");
    for (const forbidden of [
      "advanceFirstActiveQueue",
      "advanceAllQueues",
      "advanceActiveQueues",
      "listActiveQueues",
      "GlobalTaskQueue",
      "GlobalQueueEntry",
      "SuperQueue",
    ]) {
      assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister`);
    }
  });

  it("le dispatcher ne lit jamais les projets en bloc", async () => {
    const text = code(await source("queue.ts"));

    // Lire la liste des projets ici serait le premier pas vers un ordonnanceur :
    // il faudrait ensuite en choisir un.
    for (const forbidden of ["listProjects(", "findMany(", "project.findMany"]) {
      assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister dans queue.ts`);
    }
  });

  it("n'introduit ni priorite, ni equite, ni plafond global", async () => {
    for (const file of ["queue.ts", "task-lifecycle.ts", "run-launch.ts", "correction-launch.ts"]) {
      const text = code(await source(file));
      for (const forbidden of [
        "MAX_GLOBAL_RUNS",
        "MAX_CONCURRENT_RUNS",
        "roundRobin",
        "fairShare",
        "workerPool",
        "priorityScheduler",
      ]) {
        assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister dans ${file}`);
      }
    }
  });

  it("la fin d'une tache n'avance que la file de son projet", async () => {
    const text = code(await source("task-lifecycle.ts"));

    // La provenance est conservee de bout en bout : ce qui est livre puis avance
    // est le projet de la tache qui vient de se terminer.
    assert.ok(text.includes("advanceQueue(db, input.projectId)"), "la file avancee est nommee");
    assert.ok(
      text.includes("deliverQuietly(db, input.projectId, input.taskId)"),
      "la livraison vise le meme projet",
    );
  });
});

describe("aucun demarrage implicite", () => {
  it("aucun module d'orchestration ne s'execute au chargement", async () => {
    for (const file of ["queue.ts", "task-lifecycle.ts", "run-launch.ts", "correction-launch.ts"]) {
      const text = code(await source(file));
      for (const forbidden of ["setInterval(", "setTimeout(", "process.on(", "queueMicrotask("]) {
        assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister dans ${file}`);
      }
    }
  });

  it("aucune activation automatique d'une file", async () => {
    const text = code(await source("queue.ts"));

    // La seule ecriture d'autorisation autorisee ici est la **fermeture** d'une
    // file devenue vide. Ouvrir une autorisation demande un geste humain.
    assert.ok(text.includes("setQueueActive(db, projectId, false)"), "la fermeture existe");
    assert.ok(!text.includes("setQueueActive(db, projectId, true)"), "aucune ouverture automatique");
  });
});

describe("exclusion par repository, pas par projet", () => {
  it("la creation d'une execution compte les executions du repository", async () => {
    const text = code(
      await readFile(
        path.join(HERE, "..", "..", "..", "packages", "database", "src", "runs.ts"),
        "utf8",
      ),
    );

    assert.ok(
      text.includes("countActiveRepositoryRuns(tx, input.projectId, row.id)"),
      "le comptage porte sur le repository",
    );
    // Un verrou en memoire ne survivrait ni a un redemarrage, ni a deux
    // processus : la serialisation doit rester persistante.
    for (const forbidden of ["inMemoryCurrentRun", "globalCurrentRun", "activeRunLock"]) {
      assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister`);
    }
  });

  it("une correction suit exactement la meme exclusion", async () => {
    const text = code(
      await readFile(
        path.join(
          HERE,
          "..",
          "..",
          "..",
          "packages",
          "database",
          "src",
          "correction-attempts.ts",
        ),
        "utf8",
      ),
    );

    assert.ok(
      text.includes("countActiveRepositoryRuns(tx, owner.projectId, run.id)"),
      "une correction est une execution comme une autre",
    );
  });
});
