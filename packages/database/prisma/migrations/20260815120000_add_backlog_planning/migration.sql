-- TASK-022 : planification du backlog de V1.
--
-- Purement additive. Deux tables creees, cinq colonnes nullables ou pourvues
-- d'une valeur par defaut ajoutees a des tables existantes, trois index poses.
-- Aucune table n'est reconstruite, aucune colonne existante n'est modifiee,
-- aucune donnee n'est reecrite.
--
-- Une base contenant deja des projets, des taches, des executions, des
-- conversations Architecte, de la memoire, un brief, un plan et des
-- propositions de mise a jour traverse cette migration sans qu'aucune ligne ne
-- change.

-- Une planification : un appel au fournisseur, et ce qu'il a rendu.
--
-- Elle appartient au projet, pas a une conversation : un backlog repond a
-- l'etat du projet, jamais au dernier message ecrit.
CREATE TABLE "ArchitectBacklogGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "contextManifestJson" TEXT NOT NULL,
    "planningFingerprint" TEXT NOT NULL,
    "baseBriefRevision" TEXT,
    "basePlanRevision" TEXT,
    "baseTaskInventoryRevision" TEXT NOT NULL,
    "baseMemoryRevision" TEXT NOT NULL,
    "providerResponseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ArchitectBacklogGeneration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ArchitectBacklogGeneration_projectId_sequence_key" ON "ArchitectBacklogGeneration"("projectId", "sequence");

CREATE INDEX "ArchitectBacklogGeneration_projectId_createdAt_idx" ON "ArchitectBacklogGeneration"("projectId", "createdAt");

-- Le backlog propose. Au plus un par planification : l'unicite est
-- structurelle, pas verifiee a l'ecriture.
CREATE TABLE "ArchitectBacklogProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "taskCount" INTEGER NOT NULL,
    "providerJson" TEXT NOT NULL,
    "appliedJson" TEXT,
    "appliedAt" DATETIME,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArchitectBacklogProposal_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ArchitectBacklogGeneration" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchitectBacklogProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ArchitectBacklogProposal_generationId_key" ON "ArchitectBacklogProposal"("generationId");

CREATE INDEX "ArchitectBacklogProposal_projectId_createdAt_idx" ON "ArchitectBacklogProposal"("projectId", "createdAt");

-- Compteur de planifications. Comme `nextTaskSequence`, il ne recule jamais :
-- un numero deja attribue ne peut pas designer deux backlogs.
ALTER TABLE "Project" ADD COLUMN "nextBacklogSequence" INTEGER NOT NULL DEFAULT 1;

-- Verrou d'appel : au plus une planification en vol par projet.
ALTER TABLE "Project" ADD COLUMN "activeBacklogGenerationId" TEXT;

-- Verrou de decision : au plus une proposition en attente par projet.
ALTER TABLE "Project" ADD COLUMN "pendingBacklogProposalId" TEXT;

CREATE UNIQUE INDEX "Project_activeBacklogGenerationId_key" ON "Project"("activeBacklogGenerationId");

CREATE UNIQUE INDEX "Project_pendingBacklogProposalId_key" ON "Project"("pendingBacklogProposalId");

-- Provenance d'une tache creee par l'application d'un backlog.
--
-- Les deux colonnes sont nullables, et le restent : une tache ecrite a la main
-- ou proposee par une conversation n'en porte aucune. La cle etrangere est
-- ajoutee sans reconstruire la table, ce que SQLite autorise tant que la valeur
-- par defaut est NULL.
ALTER TABLE "Task" ADD COLUMN "backlogProposalId" TEXT REFERENCES "ArchitectBacklogProposal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Task" ADD COLUMN "backlogItemPosition" INTEGER;

CREATE INDEX "Task_backlogProposalId_backlogItemPosition_idx" ON "Task"("backlogProposalId", "backlogItemPosition");
