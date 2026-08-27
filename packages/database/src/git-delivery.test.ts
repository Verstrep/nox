/**
 * Reservation, verrou et lecture d'une livraison Git.
 *
 * ## Ce que ce fichier prouve
 *
 * Que la reservation est un **verrou persistant** : dix constatations
 * simultanees de « tache terminee » n'obtiennent qu'une seule livraison, et donc
 * au plus un commit. Que la prise de main sur une ecriture est elle aussi un
 * verrou : deux reprises simultanees ne peuvent pas engager deux commits.
 *
 * Que la politique par defaut d'un projet est `MANUAL`, y compris pour un projet
 * cree avant TASK-029 — appliquer la migration ne doit accorder aucun droit que
 * personne n'a demande.
 *
 * Et qu'un echec de push ne fait jamais disparaitre le commit local.
 *
 * ## Ce que ce fichier n'ecrit jamais
 *
 * Aucune commande Git. Tous ces tests travaillent sur une base SQLite isolee
 * dans un dossier temporaire ; aucun repository n'est ouvert, aucun commit n'est
 * cree, aucun push n'est tente.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DELIVERY_POLICY,
  DELIVERY_STATUS,
  DELIVERY_TRIGGER,
  REVIEW_DECISION_SOURCE,
  TASK_PRIORITY,
} from "@nox/shared";

import {
  claimDelivery,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  findCompletionRun,
  getBlockingDelivery,
  getDeliveryForRun,
  getGitDelivery,
  getLatestDeliveryForTask,
  listProjectDeliveries,
  parseCandidate,
  readProjectDeliveryPolicy,
  recordDeliveryCommit,
  recordDeliveryFailure,
  recordDeliveryPush,
  reserveGitDelivery,
  setProjectDeliveryPolicy,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "../dist/index.js";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

let workspace: string;
let db: DatabaseClient;
let counter = 0;

const HEAD = "a".repeat(40);
const FINGERPRINT = "b".repeat(64);
const COMMIT = "c".repeat(40);

async function applyMigrations(file: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sqlite = new DatabaseSync(file);
  try {
    for (const directory of directories) {
      sqlite.exec(await readFile(path.join(MIGRATIONS_DIR, directory, "migration.sql"), "utf8"));
    }
  } finally {
    sqlite.close();
  }
}

/** Un projet, une tache terminee, et l'execution qui l'a conclue. */
async function newValidatedWork(): Promise<{
  projectId: string;
  taskId: string;
  runId: string;
}> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  const task = await createTask(db, {
    projectId: project.id,
    title: `Tache ${String(counter)}`,
    objective: "Objectif.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: ["Verifiable"],
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(task !== null);

  const run = await createRun(db, {
    taskId: task.id,
    projectId: project.id,
    prompt: "Prompt de test.",
    promptSha256: "d".repeat(64),
    runnerRunId: `33333333-3333-4333-8333-${String(counter).padStart(12, "0")}`,
  });
  assert.ok(run.ok);
  await db.run.update({ where: { id: run.run.id }, data: { status: "COMPLETED" } });
  await db.runReviewDecision.create({
    data: { runId: run.run.id, source: REVIEW_DECISION_SOURCE.AUTOMATED },
  });
  await db.task.update({ where: { id: task.id }, data: { status: "COMPLETED" } });

  return { projectId: project.id, taskId: task.id, runId: run.run.id };
}

async function reserve(
  work: { projectId: string; taskId: string; runId: string },
  policy: (typeof DELIVERY_POLICY)[keyof typeof DELIVERY_POLICY] = DELIVERY_POLICY.AUTO_COMMIT,
) {
  return reserveGitDelivery(db, {
    projectId: work.projectId,
    taskId: work.taskId,
    sourceRunId: work.runId,
    sourceDecisionId: null,
    policy,
    trigger: DELIVERY_TRIGGER.AUTOMATIC,
    expectedHead: HEAD,
    expectedBranch: "main",
    candidateFingerprint: FINGERPRINT,
    candidate: [{ code: " M", path: "src/app.ts" }],
    upstreamRemote: "origin",
    upstreamRef: "refs/heads/main",
    buildCommitMessage: (id) => `TASK-001: titre\n\nNOX-Delivery: ${id}\n`,
  });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-delivery-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("politique de livraison d'un projet", () => {
  it("vaut MANUAL a la creation", async () => {
    // Le seul fait d'appliquer la migration ne doit accorder aucun droit : un
    // projet neuf, comme un projet existant, ne livre rien tant que personne ne
    // l'a demande.
    const work = await newValidatedWork();
    assert.equal(await readProjectDeliveryPolicy(db, work.projectId), DELIVERY_POLICY.MANUAL);
  });

  it("vaut MANUAL pour un projet inconnu", async () => {
    assert.equal(await readProjectDeliveryPolicy(db, "projet-inexistant"), DELIVERY_POLICY.MANUAL);
  });

  it("s'enregistre, et dit quand rien n'a change", async () => {
    const work = await newValidatedWork();
    const first = await setProjectDeliveryPolicy(db, work.projectId, DELIVERY_POLICY.AUTO_COMMIT);
    assert.deepEqual(first, { ok: true, policy: DELIVERY_POLICY.AUTO_COMMIT, changed: true });

    const again = await setProjectDeliveryPolicy(db, work.projectId, DELIVERY_POLICY.AUTO_COMMIT);
    assert.deepEqual(again, { ok: true, policy: DELIVERY_POLICY.AUTO_COMMIT, changed: false });
  });

  it("refuse un projet inconnu", async () => {
    assert.deepEqual(
      await setProjectDeliveryPolicy(db, "projet-inexistant", DELIVERY_POLICY.AUTO_COMMIT),
      { ok: false, reason: "not_found" },
    );
  });

  it("ne defait rien en revenant a MANUAL", async () => {
    // Changer la politique ne gouverne que ce qui n'a pas encore eu lieu : ni
    // annulation, ni reset, ni suppression d'un historique de livraison.
    const work = await newValidatedWork();
    const reserved = await reserve(work, DELIVERY_POLICY.AUTO_COMMIT_PUSH);
    assert.ok(reserved.ok);
    await recordDeliveryCommit(db, reserved.delivery.id, {
      commitSha: COMMIT,
      status: DELIVERY_STATUS.COMMITTED,
    });

    await setProjectDeliveryPolicy(db, work.projectId, DELIVERY_POLICY.MANUAL);

    const after = await getGitDelivery(db, reserved.delivery.id);
    assert.equal(after?.commitSha, COMMIT);
    // La politique **enregistree** reste celle qui a decide de l'ecriture.
    assert.equal(after?.policy, DELIVERY_POLICY.AUTO_COMMIT_PUSH);
  });
});

describe("execution qui porte le travail valide", () => {
  it("designe l'execution dont la review a conclu la tache", async () => {
    const work = await newValidatedWork();
    const completion = await findCompletionRun(db, work.taskId);
    assert.equal(completion?.runId, work.runId);
    assert.equal(completion?.status, "COMPLETED");
    assert.equal(completion?.decisionSource, REVIEW_DECISION_SOURCE.AUTOMATED);
  });

  it("ne designe rien pour une tache sans decision de review", async () => {
    // Un `Mark done` a la main : aucun travail valide, donc aucun candidat sur.
    counter += 1;
    const project = await createProject(db, {
      name: `Projet nu ${String(counter)}`,
      description: null,
      repositoryPath: path.join(workspace, `nu-${String(counter)}`),
    });
    const task = await createTask(db, {
      projectId: project.id,
      title: "Tache sans execution",
      objective: "Objectif.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Verifiable"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(task !== null);
    assert.equal(await findCompletionRun(db, task.id), null);
  });
});

describe("reservation", () => {
  it("cree une livraison, avec son message fige", async () => {
    const work = await newValidatedWork();
    const reserved = await reserve(work);
    assert.ok(reserved.ok);
    assert.equal(reserved.created, true);
    assert.equal(reserved.delivery.status, DELIVERY_STATUS.PENDING);
    assert.equal(reserved.delivery.attempt, 0);
    assert.ok(reserved.delivery.commitMessage.includes(reserved.delivery.id));
    assert.deepEqual([...reserved.delivery.candidate], [{ code: " M", path: "src/app.ts" }]);
  });

  it("rend la meme livraison a dix constatations simultanees", async () => {
    // Le verrou est l'index unique `(taskId, sourceRunId)`, pas une lecture
    // suivie d'une ecriture : c'est ce qui garantit « un commit au plus ».
    const work = await newValidatedWork();
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(work)));

    const ids = new Set<string>();
    let created = 0;
    for (const result of results) {
      assert.ok(result.ok);
      ids.add(result.delivery.id);
      if (result.created) {
        created += 1;
      }
    }
    assert.equal(ids.size, 1);
    assert.equal(created, 1);
    assert.equal(await db.gitDelivery.count({ where: { taskId: work.taskId } }), 1);
  });

  it("se relit par execution, par tache et par projet", async () => {
    const work = await newValidatedWork();
    const reserved = await reserve(work);
    assert.ok(reserved.ok);

    assert.equal((await getDeliveryForRun(db, work.taskId, work.runId))?.id, reserved.delivery.id);
    assert.equal((await getLatestDeliveryForTask(db, work.taskId))?.id, reserved.delivery.id);
    assert.equal((await listProjectDeliveries(db, work.projectId)).length, 1);
  });

  it("relit un candidat illisible comme une liste vide", () => {
    assert.deepEqual(parseCandidate("pas du json"), []);
    assert.deepEqual(parseCandidate('{"code":" M"}'), []);
    assert.deepEqual(parseCandidate('[{"code":" M","path":"a.ts"},{"nope":1}]'), [
      { code: " M", path: "a.ts" },
    ]);
  });
});

describe("verrou d'ecriture", () => {
  it("n'accorde la main qu'une fois", async () => {
    // Deux reprises simultanees lisent le meme compteur ; une seule reussit a
    // l'incrementer. Sans cela, deux commits identiques pourraient naitre.
    const work = await newValidatedWork();
    const reserved = await reserve(work);
    assert.ok(reserved.ok);

    const claims = await Promise.all(
      Array.from({ length: 10 }, () =>
        claimDelivery(db, {
          deliveryId: reserved.delivery.id,
          expectedAttempt: 0,
          from: [DELIVERY_STATUS.PENDING],
          to: DELIVERY_STATUS.COMMITTING,
        }),
      ),
    );
    assert.equal(claims.filter((claim) => claim.ok).length, 1);
    assert.equal((await getGitDelivery(db, reserved.delivery.id))?.attempt, 1);
  });

  it("refuse une prise de main depuis un statut interdit", async () => {
    const work = await newValidatedWork();
    const reserved = await reserve(work);
    assert.ok(reserved.ok);
    await recordDeliveryCommit(db, reserved.delivery.id, {
      commitSha: COMMIT,
      status: DELIVERY_STATUS.COMMITTED,
    });

    const claimed = await claimDelivery(db, {
      deliveryId: reserved.delivery.id,
      expectedAttempt: 0,
      from: [DELIVERY_STATUS.PENDING],
      to: DELIVERY_STATUS.COMMITTING,
    });
    assert.deepEqual(claimed, { ok: false, reason: "busy" });
  });

  it("ne recule jamais, meme apres un echec", async () => {
    const work = await newValidatedWork();
    const reserved = await reserve(work);
    assert.ok(reserved.ok);

    await claimDelivery(db, {
      deliveryId: reserved.delivery.id,
      expectedAttempt: 0,
      from: [DELIVERY_STATUS.PENDING],
      to: DELIVERY_STATUS.COMMITTING,
    });
    await recordDeliveryFailure(db, reserved.delivery.id, {
      status: DELIVERY_STATUS.BLOCKED,
      errorCode: "DELIVERY_REPOSITORY_CHANGED",
      errorMessage: "Le repository a change.",
    });

    const after = await getGitDelivery(db, reserved.delivery.id);
    assert.equal(after?.attempt, 1);
    assert.equal(after?.status, DELIVERY_STATUS.BLOCKED);
    assert.equal(after?.errorCode, "DELIVERY_REPOSITORY_CHANGED");
  });
});

describe("commit et push", () => {
  it("enregistre le commit, puis le push", async () => {
    const work = await newValidatedWork();
    const reserved = await reserve(work, DELIVERY_POLICY.AUTO_COMMIT_PUSH);
    assert.ok(reserved.ok);

    const committed = await recordDeliveryCommit(db, reserved.delivery.id, {
      commitSha: COMMIT,
      status: DELIVERY_STATUS.COMMITTED,
    });
    assert.equal(committed?.commitSha, COMMIT);
    assert.notEqual(committed?.committedAt, null);
    assert.equal(committed?.pushedAt, null);

    const pushed = await recordDeliveryPush(db, reserved.delivery.id, {
      remote: "origin",
      remoteRef: "refs/heads/main",
    });
    assert.equal(pushed?.status, DELIVERY_STATUS.DELIVERED);
    assert.notEqual(pushed?.pushedAt, null);
  });

  it("ne redate pas un commit reconcilie apres panne", async () => {
    // Un commit deja cree lors d'une tentative dont la reponse s'est perdue
    // garde son heure : lui donner celle d'aujourd'hui ferait mentir
    // l'historique sur le moment ou le travail a ete livre.
    const work = await newValidatedWork();
    const reserved = await reserve(work);
    assert.ok(reserved.ok);

    const first = await recordDeliveryCommit(db, reserved.delivery.id, {
      commitSha: COMMIT,
      status: DELIVERY_STATUS.COMMITTED,
    });
    const again = await recordDeliveryCommit(db, reserved.delivery.id, {
      commitSha: COMMIT,
      status: DELIVERY_STATUS.COMMITTED,
    });
    assert.equal(first?.committedAt?.getTime(), again?.committedAt?.getTime());
  });

  it("conserve le commit local quand le push echoue", async () => {
    // « Le commit existe, le push a echoue » est un etat exact. Le reduire a
    // « echec » ferait proposer une reprise complete — qui creerait un second
    // commit.
    const work = await newValidatedWork();
    const reserved = await reserve(work, DELIVERY_POLICY.AUTO_COMMIT_PUSH);
    assert.ok(reserved.ok);
    await recordDeliveryCommit(db, reserved.delivery.id, {
      commitSha: COMMIT,
      status: DELIVERY_STATUS.COMMITTED,
    });

    const failed = await recordDeliveryFailure(db, reserved.delivery.id, {
      status: DELIVERY_STATUS.COMMITTED,
      errorCode: "DELIVERY_PUSH_REJECTED",
      errorMessage: "non-fast-forward",
    });
    assert.equal(failed?.commitSha, COMMIT);
    assert.notEqual(failed?.committedAt, null);
    assert.equal(failed?.status, DELIVERY_STATUS.COMMITTED);
  });
});

describe("livraison bloquante pour la file", () => {
  it("ne bloque jamais en mode manuel", async () => {
    // `MANUAL` confie la question au preflight Git existant : la file continue
    // exactement comme avant TASK-029.
    const work = await newValidatedWork();
    const reserved = await reserve(work, DELIVERY_POLICY.MANUAL);
    assert.ok(reserved.ok);
    assert.equal(await getBlockingDelivery(db, work.projectId), null);
  });

  it("bloque tant qu'un AUTO_COMMIT n'a pas commite", async () => {
    const work = await newValidatedWork();
    const reserved = await reserve(work, DELIVERY_POLICY.AUTO_COMMIT);
    assert.ok(reserved.ok);
    assert.equal((await getBlockingDelivery(db, work.projectId))?.id, reserved.delivery.id);

    await recordDeliveryCommit(db, reserved.delivery.id, {
      commitSha: COMMIT,
      status: DELIVERY_STATUS.COMMITTED,
    });
    assert.equal(await getBlockingDelivery(db, work.projectId), null);
  });

  it("bloque un AUTO_COMMIT_PUSH tant que le push n'a pas abouti", async () => {
    const work = await newValidatedWork();
    const reserved = await reserve(work, DELIVERY_POLICY.AUTO_COMMIT_PUSH);
    assert.ok(reserved.ok);
    await recordDeliveryCommit(db, reserved.delivery.id, {
      commitSha: COMMIT,
      status: DELIVERY_STATUS.COMMITTED,
    });
    // Le commit ne suffit pas : la politique exige que le travail soit parti.
    assert.equal((await getBlockingDelivery(db, work.projectId))?.id, reserved.delivery.id);

    await recordDeliveryPush(db, reserved.delivery.id, {
      remote: "origin",
      remoteRef: "refs/heads/main",
    });
    assert.equal(await getBlockingDelivery(db, work.projectId), null);
  });

  it("ne bloque rien quand aucune livraison n'existe", async () => {
    const work = await newValidatedWork();
    assert.equal(await getBlockingDelivery(db, work.projectId), null);
  });
});
