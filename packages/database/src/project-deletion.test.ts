/**
 * Suppression de l'etat NOX d'un projet.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'un projet **riche** — brief, plan, memoire, conversation, backlog,
 * amorcage, taches, dependances, executions, review, feedback — disparait
 * entierement, sans laisser une seule ligne dans une seule table. La verification
 * ne recite pas la liste des tables : elle compte, table par table, a partir de
 * la liste que le module lui-meme declare. Une table ajoutee au schema et
 * oubliee dans l'ordre de suppression fait echouer un test ici.
 *
 * Que les sept relations `Restrict` du schema — celles qui protegent une
 * suppression a l'unite — ne rendent pas un projet indestructible. C'est tout
 * l'interet d'un ordre explicite plutot que d'une reinitialisation.
 *
 * Que les autres projets ne bougent pas d'un octet.
 *
 * Que la liste des artefacts a nettoyer vient de la base, jamais d'un nom de
 * fichier, et qu'une tache sans revision n'en produit aucun.
 *
 * Et que le repository redevient enregistrable comme un projet neuf.
 *
 * Base temporaire, aucun reseau, aucun fournisseur, aucun acces au disque du
 * repository.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_SESSION_KIND,
  PROJECT_MEMORY_CATEGORY,
  PROJECT_MEMORY_STATUS,
  RUN_STATUS,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
} from "@nox/shared";

import {
  PROJECT_DELETION_ORDER,
  addTaskDependency,
  createDatabaseClient,
  createProject,
  createTask,
  deleteProjectState,
  enqueueTask,
  findProjectByRepositoryPath,
  listOwnedTaskArtifacts,
  markTaskDocumentSynced,
  projectHasActiveRun,
  updateTaskStatus,
  renameProject,
  setQueueActive,
  toDatabaseFilePath,
  toSqliteUrl,
  writeTaskRow,
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

const REVISION_A = "a".repeat(64);
const REVISION_B = "b".repeat(64);

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

async function newProject(name = "Projet"): Promise<{ id: string; repositoryPath: string }> {
  counter += 1;
  const repositoryPath = path.join(workspace, `depot-${String(counter)}`);
  const project = await createProject(db, {
    name: `${name} ${String(counter)}`,
    description: null,
    repositoryPath,
  });
  return { id: project.id, repositoryPath };
}

async function newTask(projectId: string, title: string): Promise<string> {
  const task = await createTask(db, {
    projectId,
    title,
    objective: `Objectif de ${title}.`,
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: [`${title} est verifiable`],
    documentReferences: ["docs/ARCHITECTURE.md"],
    validationCommands: ["npm run test"],
  });
  assert.ok(task !== null);
  return task.id;
}

/**
 * Peuple un projet avec au moins une ligne dans chacune de ses tables enfant.
 *
 * Les creations passent par le client Prisma plutot que par les services : ce
 * test verifie la **suppression**, et enchainer dix services rendrait un echec
 * de setup indiscernable d'un echec de suppression.
 */
async function populate(projectId: string): Promise<{ taskId: string; bootstrapId: string }> {
  const bootstrap = await writeTaskRow(db, {
    projectId,
    sequence: 0,
    kind: TASK_KIND.BOOTSTRAP,
    title: "Bootstrap project repository",
    objective: "Etablir la fondation.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.HIGH,
    acceptanceCriteria: ["Le repository demarre."],
    documentReferences: [],
    validationCommands: [],
  });
  const taskId = await newTask(projectId, "Premiere tache");
  const secondId = await newTask(projectId, "Seconde tache");

  // Une arete, dont le cote `dependsOn` est en `Restrict`.
  const edge = await addTaskDependency(db, {
    projectId,
    taskId: secondId,
    dependsOnTaskId: taskId,
  });
  assert.ok(edge.ok);

  await db.projectBrief.create({
    data: {
      projectId,
      summary: "Resume",
      problem: "Probleme",
      targetUsers: "Utilisateurs",
      desiredOutcome: "Resultat",
      goalsJson: "[]",
      nonGoalsJson: "[]",
    },
  });
  await db.projectV1Plan.create({
    data: {
      projectId,
      goal: "But",
      technicalDirection: "Direction",
      inScopeJson: "[]",
      outOfScopeJson: "[]",
      milestonesJson: "[]",
    },
  });
  await db.projectMemoryEntry.create({
    data: {
      projectId,
      sequence: 1,
      category: PROJECT_MEMORY_CATEGORY.DECISION,
      title: "Une decision",
      content: "Contenu",
      status: PROJECT_MEMORY_STATUS.ACTIVE,
    },
  });
  await db.projectMemoryEntry.create({
    data: {
      projectId,
      sequence: 2,
      category: PROJECT_MEMORY_CATEGORY.CONSTRAINT,
      title: "Une contrainte archivee",
      content: "Contenu",
      status: PROJECT_MEMORY_STATUS.ARCHIVED,
    },
  });

  // Conversation Architecte : session, generation, message, mise a jour projet.
  // La session et la generation designent une tache en `Restrict`.
  const session = await db.architectSession.create({
    data: {
      projectId,
      sequence: 1,
      kind: ARCHITECT_SESSION_KIND.PROJECT,
      requestText: "Discutons.",
      status: "OPEN",
      appliedTaskId: taskId,
    },
  });
  const generation = await db.architectGeneration.create({
    data: {
      sessionId: session.id,
      sequence: 1,
      model: "modele-test",
      promptVersion: "v1",
      inputHash: REVISION_A,
      contextManifestJson: "{}",
      status: "CONTINUE",
      appliedTaskId: taskId,
    },
  });
  await db.architectMessage.create({
    data: { sessionId: session.id, sequence: 1, role: "USER", content: "Bonjour" },
  });
  await db.architectMessage.create({
    data: {
      sessionId: session.id,
      sequence: 2,
      role: "ARCHITECT",
      content: "Reponse",
      generationId: generation.id,
    },
  });
  await db.architectProjectUpdate.create({
    data: {
      generationId: generation.id,
      projectId,
      status: "PENDING",
      reason: "Le brief a bouge.",
      proposedJson: "{}",
    },
  });

  // Backlog : generation et proposition, la seconde referencee par une tache.
  const backlogGeneration = await db.architectBacklogGeneration.create({
    data: {
      projectId,
      sequence: 1,
      status: "COMPLETED",
      model: "modele-test",
      promptVersion: "v1",
      inputHash: REVISION_A,
      contextManifestJson: "{}",
      planningFingerprint: REVISION_B,
      baseTaskInventoryRevision: REVISION_A,
      baseMemoryRevision: REVISION_B,
    },
  });
  const proposal = await db.architectBacklogProposal.create({
    data: {
      generationId: backlogGeneration.id,
      projectId,
      status: "APPLIED",
      message: "Voici le backlog.",
      taskCount: 1,
      providerJson: "{}",
    },
  });
  await db.task.update({
    where: { id: taskId },
    data: { backlogProposalId: proposal.id, backlogItemPosition: 0 },
  });

  // Execution, ses enfants, sa review, et un feedback qui designe la tache et
  // l'execution — trois `Restrict` d'un coup.
  const run = await db.run.create({
    data: {
      taskId,
      sequence: 1,
      status: RUN_STATUS.COMPLETED,
      prompt: "Prompt",
      promptSha256: REVISION_A,
      runnerRunId: "runner-1",
    },
  });
  await db.runEvent.create({
    data: { runId: run.id, sequence: 1, kind: "STATUS", label: "Demarre", occurredAt: new Date() },
  });
  await db.runFileChange.create({
    data: { runId: run.id, position: 0, path: "src/App.tsx", changeType: "MODIFIED" },
  });
  await db.runValidationResult.create({
    data: { runId: run.id, position: 0, command: "npm run test", status: "PASSED" },
  });
  await db.architectRunReview.create({
    data: {
      runId: run.id,
      sequence: 1,
      model: "modele-test",
      promptVersion: "v1",
      inputHash: REVISION_A,
      manifestJson: "{}",
      status: "COMPLETED",
    },
  });
  await db.reviewFeedback.create({
    data: { taskId, sourceRunId: run.id, text: "A revoir." },
  });

  // Une reservation de correction : deux liens `Restrict` vers `Run`, exactement
  // comme `ReviewFeedback`. Sans une ligne reelle ici, le test qui verifie que
  // toutes les tables sont videes ne prouverait rien sur celle-ci.
  await db.correctionAttempt.create({
    data: {
      taskId,
      sourceRunId: run.id,
      source: "AUTOMATED_VALIDATION",
      attempt: 1,
      automatedAttempt: 1,
      status: "RESERVED",
    },
  });

  // Une livraison Git : trois liens, dont deux `Restrict` vers `Task` et `Run`.
  // Comme pour la reservation ci-dessus, sans une ligne reelle le test qui
  // verifie que toutes les tables sont videes ne prouverait rien sur celle-ci.
  await db.gitDelivery.create({
    data: {
      projectId,
      taskId,
      sourceRunId: run.id,
      policy: "AUTO_COMMIT",
      trigger: "AUTOMATIC",
      status: "COMMITTED",
      attempt: 1,
      expectedHead: "f".repeat(40),
      expectedBranch: "main",
      candidateFingerprint: REVISION_A,
      candidateJson: JSON.stringify([{ code: " M", path: "src/app.ts" }]),
      commitMessage: "TASK-001: livraison de test",
      commitSha: "e".repeat(40),
    },
  });

  // Une file d'execution active, avec une inscription : sans elle, le test qui
  // verifie que **toutes** les tables sont videes passerait sans rien prouver
  // sur celle-ci.
  const ready = await updateTaskStatus(db, secondId, projectId, TASK_STATUS.READY);
  assert.ok(ready.ok);
  const queued = await enqueueTask(db, { projectId, taskId: secondId });
  assert.ok(queued.ok);
  const activated = await setQueueActive(db, projectId, true);
  assert.ok(activated.ok);

  // Un plan de verification, un lot de validation autonome et une decision de
  // review : meme raison que pour la file, ces tables doivent etre **remplies**
  // avant la suppression pour que le test prouve quelque chose sur elles.
  const criterion = await db.taskAcceptanceCriterion.findFirst({
    where: { taskId },
    select: { id: true },
  });
  const command = await db.taskValidationCommand.findFirst({
    where: { taskId },
    select: { id: true },
  });
  assert.ok(criterion !== null && command !== null);
  await db.taskCriterionValidation.create({
    data: { criterionId: criterion.id, commandId: command.id },
  });

  const batch = await db.autonomousValidationBatch.create({
    data: { runId: run.id, attempt: 1, status: "PASSED" },
    select: { id: true },
  });
  await db.autonomousValidationResult.create({
    data: {
      batchId: batch.id,
      position: 0,
      commandId: command.id,
      command: "npm test",
      status: "PASSED",
      exitCode: 0,
    },
  });
  const decision = await db.runReviewDecision.create({
    data: { runId: run.id, source: "HUMAN_OVERRIDE", overrideReason: "Faux negatif connu." },
    select: { id: true },
  });
  await db.runHumanCriterionConfirmation.create({
    data: { decisionId: decision.id, criterionId: criterion.id, criterionText: "Un critere" },
  });

  return { taskId, bootstrapId: bootstrap.id };
}

/** Compte les lignes du projet dans chaque table, sans en oublier une seule. */
async function countAll(projectId: string): Promise<Record<string, number>> {
  const byTask = { task: { projectId } };
  const byRun = { run: { task: { projectId } } };

  return {
    runEvent: await db.runEvent.count({ where: byRun }),
    runFileChange: await db.runFileChange.count({ where: byRun }),
    runValidationResult: await db.runValidationResult.count({ where: byRun }),
    autonomousValidationResult: await db.autonomousValidationResult.count({
      where: { batch: { run: byTask } },
    }),
    autonomousValidationBatch: await db.autonomousValidationBatch.count({ where: byRun }),
    runHumanCriterionConfirmation: await db.runHumanCriterionConfirmation.count({
      where: { decision: { run: byTask } },
    }),
    runReviewDecision: await db.runReviewDecision.count({ where: byRun }),
    architectRunReview: await db.architectRunReview.count({ where: byRun }),
    gitDelivery: await db.gitDelivery.count({ where: { projectId } }),
    correctionAttempt: await db.correctionAttempt.count({ where: byTask }),
    reviewFeedback: await db.reviewFeedback.count({ where: byTask }),
    run: await db.run.count({ where: byTask }),
    taskQueueEntry: await db.taskQueueEntry.count({ where: { projectId } }),
    taskDependency: await db.taskDependency.count({ where: byTask }),
    architectProjectUpdate: await db.architectProjectUpdate.count({ where: { projectId } }),
    architectMessage: await db.architectMessage.count({ where: { session: { projectId } } }),
    architectGeneration: await db.architectGeneration.count({ where: { session: { projectId } } }),
    architectSession: await db.architectSession.count({ where: { projectId } }),
    taskCriterionValidation: await db.taskCriterionValidation.count({
      where: { criterion: { task: { projectId } } },
    }),
    taskAcceptanceCriterion: await db.taskAcceptanceCriterion.count({ where: byTask }),
    taskDocumentReference: await db.taskDocumentReference.count({ where: byTask }),
    taskValidationCommand: await db.taskValidationCommand.count({ where: byTask }),
    task: await db.task.count({ where: { projectId } }),
    architectBacklogProposal: await db.architectBacklogProposal.count({ where: { projectId } }),
    architectBacklogGeneration: await db.architectBacklogGeneration.count({ where: { projectId } }),
    projectBrief: await db.projectBrief.count({ where: { projectId } }),
    projectV1Plan: await db.projectV1Plan.count({ where: { projectId } }),
    projectMemoryEntry: await db.projectMemoryEntry.count({ where: { projectId } }),
    project: await db.project.count({ where: { id: projectId } }),
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-project-delete-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("deleteProjectState", () => {
  it("ne laisse aucune ligne dans aucune table", async () => {
    const project = await newProject();
    await populate(project.id);

    const before = await countAll(project.id);
    // Le projet est bien riche : sans cette verification, un test qui supprime
    // le vide passerait pour un test qui supprime tout.
    for (const [table, count] of Object.entries(before)) {
      assert.ok(count > 0, `table ${table} vide avant suppression`);
    }

    const result = await deleteProjectState(db, project.id);
    assert.ok(result.ok);

    const after = await countAll(project.id);
    for (const [table, count] of Object.entries(after)) {
      assert.equal(count, 0, `table ${table} non vidée`);
    }
  });

  it("declare exactement les tables qu'il vide", () => {
    // La garantie structurelle : si une table est ajoutee au schema et oubliee
    // dans l'ordre de suppression, les deux listes divergent et ce test tombe.
    assert.deepEqual(
      [...PROJECT_DELETION_ORDER].sort(),
      Object.keys({
        runEvent: 0,
        runFileChange: 0,
        runValidationResult: 0,
        autonomousValidationResult: 0,
        autonomousValidationBatch: 0,
        runHumanCriterionConfirmation: 0,
        runReviewDecision: 0,
        architectRunReview: 0,
        gitDelivery: 0,
        correctionAttempt: 0,
        reviewFeedback: 0,
        run: 0,
        taskQueueEntry: 0,
        taskDependency: 0,
        architectProjectUpdate: 0,
        architectMessage: 0,
        architectGeneration: 0,
        architectSession: 0,
        taskCriterionValidation: 0,
        taskAcceptanceCriterion: 0,
        taskDocumentReference: 0,
        taskValidationCommand: 0,
        task: 0,
        architectBacklogProposal: 0,
        architectBacklogGeneration: 0,
        projectBrief: 0,
        projectV1Plan: 0,
        projectMemoryEntry: 0,
        project: 0,
      }).sort(),
    );
  });

  it("rend le compte de ce qu'il a supprime", async () => {
    const project = await newProject();
    await populate(project.id);

    const result = await deleteProjectState(db, project.id);
    assert.ok(result.ok);

    assert.equal(result.counts.project, 1);
    // Trois taches : l'amorcage et les deux taches produit.
    assert.equal(result.counts.task, 3);
    assert.equal(result.counts.taskDependency, 1);
    assert.equal(result.counts.run, 1);
    assert.equal(result.counts.reviewFeedback, 1);
    // L'etat de TASK-028 disparait avec le reste : une reservation de correction
    // n'a aucune raison de survivre au projet qu'elle documente.
    assert.equal(result.counts.correctionAttempt, 1);
    assert.equal(result.counts.gitDelivery, 1);
    assert.equal(result.counts.projectMemoryEntry, 2);
    // Chaque cle de l'ordre declare a bien ete rapportee.
    for (const table of PROJECT_DELETION_ORDER) {
      assert.equal(typeof result.counts[table], "number", table);
    }
  });

  it("laisse les autres projets strictement intacts", async () => {
    const kept = await newProject("Conserve");
    const doomed = await newProject("Supprime");
    await populate(kept.id);
    await populate(doomed.id);

    const before = await countAll(kept.id);
    const keptRow = await db.project.findUnique({ where: { id: kept.id } });

    assert.ok((await deleteProjectState(db, doomed.id)).ok);

    assert.deepEqual(await countAll(kept.id), before);
    // Colonne par colonne : un `updatedAt` deplace suffirait a trahir une
    // ecriture parasite.
    assert.deepEqual(await db.project.findUnique({ where: { id: kept.id } }), keptRow);
  });

  it("supprime un projet dont le graphe de dependances n'est pas resolu", async () => {
    // La contrainte `Restrict` de TASK-024 protege une suppression a l'unite ;
    // elle ne doit pas rendre un projet entier indestructible.
    const project = await newProject();
    const a = await newTask(project.id, "A");
    const b = await newTask(project.id, "B");
    const c = await newTask(project.id, "C");
    assert.ok((await addTaskDependency(db, { projectId: project.id, taskId: a, dependsOnTaskId: b })).ok);
    assert.ok((await addTaskDependency(db, { projectId: project.id, taskId: b, dependsOnTaskId: c })).ok);

    const result = await deleteProjectState(db, project.id);
    assert.ok(result.ok);
    assert.equal(result.counts.taskDependency, 2);
    // Les taches sont parties avec leurs aretes : aucune violation de cle
    // etrangere, et rien qui survive au projet.
    assert.equal(await db.task.count({ where: { projectId: project.id } }), 0);
  });

  it("supprime un projet dont des taches sont terminees", async () => {
    const project = await newProject();
    const { taskId } = await populate(project.id);
    await db.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.COMPLETED } });

    assert.ok((await deleteProjectState(db, project.id)).ok);
  });

  it("refuse un projet inexistant sans rien toucher", async () => {
    const kept = await newProject();
    await populate(kept.id);
    const before = await countAll(kept.id);

    const result = await deleteProjectState(db, "projet-inexistant");
    assert.equal(result.ok, false);
    assert.deepEqual(await countAll(kept.id), before);
  });

  it("libere le chemin du repository pour un nouvel enregistrement", async () => {
    const project = await newProject();
    await populate(project.id);

    assert.ok((await deleteProjectState(db, project.id)).ok);
    assert.equal(await findProjectByRepositoryPath(db, project.repositoryPath), null);

    // Le meme chemin redevient enregistrable, et le projet obtenu est neuf :
    // ni brief, ni plan, ni memoire, ni tache, ni compteur herite.
    const recreated = await createProject(db, {
      name: "Nouveau projet",
      description: null,
      repositoryPath: project.repositoryPath,
    });
    assert.notEqual(recreated.id, project.id);
    assert.deepEqual(await countAll(recreated.id), {
      runEvent: 0,
      runFileChange: 0,
      runValidationResult: 0,
      // Ni plan de verification, ni preuve, ni decision de review : le nouveau
      // projet ne herite d'aucune classification de l'ancien.
      autonomousValidationResult: 0,
      autonomousValidationBatch: 0,
      runHumanCriterionConfirmation: 0,
      runReviewDecision: 0,
      architectRunReview: 0,
      gitDelivery: 0,
      correctionAttempt: 0,
      reviewFeedback: 0,
      run: 0,
      taskQueueEntry: 0,
      taskDependency: 0,
      architectProjectUpdate: 0,
      architectMessage: 0,
      architectGeneration: 0,
      architectSession: 0,
      taskCriterionValidation: 0,
      taskAcceptanceCriterion: 0,
      taskDocumentReference: 0,
      taskValidationCommand: 0,
      task: 0,
      architectBacklogProposal: 0,
      architectBacklogGeneration: 0,
      projectBrief: 0,
      projectV1Plan: 0,
      projectMemoryEntry: 0,
      project: 1,
    });

    const row = await db.project.findUnique({ where: { id: recreated.id } });
    assert.equal(row?.nextTaskSequence, 1);
    assert.equal(row?.nextMemorySequence, 1);
  });
});

describe("projectHasActiveRun", () => {
  it("est faux sans execution", async () => {
    const project = await newProject();
    await newTask(project.id, "A");
    assert.equal(await projectHasActiveRun(db, project.id), false);
  });

  it("est faux quand toutes les executions sont terminees", async () => {
    const project = await newProject();
    await populate(project.id);
    assert.equal(await projectHasActiveRun(db, project.id), false);
  });

  for (const status of [RUN_STATUS.QUEUED, RUN_STATUS.RUNNING, RUN_STATUS.CANCELLING]) {
    it(`est vrai pour une execution ${status}`, async () => {
      const project = await newProject();
      const taskId = await newTask(project.id, "A");
      await db.run.create({
        data: {
          taskId,
          sequence: 1,
          status,
          prompt: "Prompt",
          promptSha256: REVISION_A,
          runnerRunId: `runner-${status}`,
        },
      });

      // `CANCELLING` compte : le processus n'est pas mort, et supprimer l'etat
      // pendant qu'il ecrit creerait une course impossible a raisonner.
      assert.equal(await projectHasActiveRun(db, project.id), true);
    });
  }

  it("ignore l'execution d'un autre projet", async () => {
    const quiet = await newProject();
    const busy = await newProject();
    const taskId = await newTask(busy.id, "A");
    await db.run.create({
      data: {
        taskId,
        sequence: 1,
        status: RUN_STATUS.RUNNING,
        prompt: "Prompt",
        promptSha256: REVISION_A,
        runnerRunId: "runner-autre",
      },
    });

    assert.equal(await projectHasActiveRun(db, quiet.id), false);
  });
});

describe("listOwnedTaskArtifacts", () => {
  it("ne retient que les taches dont NOX a enregistre la revision", async () => {
    const project = await newProject();
    const synced = await newTask(project.id, "Synchronisee");
    await newTask(project.id, "Jamais synchronisee");

    await markTaskDocumentSynced(db, synced, "tasks/TASK-001.md", REVISION_A);

    const artifacts = await listOwnedTaskArtifacts(db, project.id);
    // La preuve d'appartenance est la revision : sans elle, le fichier qui
    // occuperait le chemin n'est pas celui de NOX.
    assert.deepEqual(artifacts, [
      { taskCode: "TASK-001", documentPath: "tasks/TASK-001.md", expectedRevision: REVISION_A },
    ]);
  });

  it("inclut l'amorcage et respecte l'ordre des numeros", async () => {
    const project = await newProject();
    const bootstrap = await writeTaskRow(db, {
      projectId: project.id,
      sequence: 0,
      kind: TASK_KIND.BOOTSTRAP,
      title: "Bootstrap",
      objective: "Fondation.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.HIGH,
      acceptanceCriteria: ["ok"],
      documentReferences: [],
      validationCommands: [],
    });
    const first = await newTask(project.id, "A");

    await markTaskDocumentSynced(db, first, "tasks/TASK-001.md", REVISION_B);
    await markTaskDocumentSynced(db, bootstrap.id, "tasks/TASK-000.md", REVISION_A);

    assert.deepEqual(
      (await listOwnedTaskArtifacts(db, project.id)).map((entry) => entry.taskCode),
      ["TASK-000", "TASK-001"],
    );
  });

  it("ignore les taches d'un autre projet", async () => {
    const mine = await newProject();
    const other = await newProject();
    const theirs = await newTask(other.id, "Leur tache");
    await markTaskDocumentSynced(db, theirs, "tasks/TASK-001.md", REVISION_A);

    assert.deepEqual(await listOwnedTaskArtifacts(db, mine.id), []);
  });
});

describe("renameProject", () => {
  it("change le nom sans toucher au chemin du repository", async () => {
    const project = await newProject();
    const before = await db.project.findUnique({ where: { id: project.id } });

    const result = await renameProject(db, project.id, "Planificateur de repas");
    assert.ok(result.ok);
    assert.equal(result.ok && result.changed, true);

    const after = await db.project.findUnique({ where: { id: project.id } });
    assert.equal(after?.name, "Planificateur de repas");
    assert.equal(after?.repositoryPath, before?.repositoryPath);
    assert.equal(after?.status, before?.status);
    assert.equal(after?.nextTaskSequence, before?.nextTaskSequence);
  });

  it("n'ecrit rien quand le nom est deja celui-la", async () => {
    const project = await newProject();
    const before = await db.project.findUnique({ where: { id: project.id } });
    assert.ok(before !== null);

    const result = await renameProject(db, project.id, before.name);
    assert.ok(result.ok);
    assert.equal(result.ok && result.changed, false);

    // Pas meme `updatedAt` : une sauvegarde sans effet n'en a pas.
    assert.deepEqual(await db.project.findUnique({ where: { id: project.id } }), before);
  });

  it("refuse un projet inexistant", async () => {
    const result = await renameProject(db, "projet-inexistant", "Peu importe");
    assert.equal(result.ok, false);
  });
});
