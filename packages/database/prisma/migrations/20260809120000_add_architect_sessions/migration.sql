-- Architecte NOX : sessions et generations.
--
-- Migration **purement additive** : deux nouvelles tables, aucune colonne ajoutee
-- ni modifiee sur les tables existantes. Les relations declarees cote `Project`
-- et `Task` dans le schema Prisma sont des relations inverses : elles ne creent
-- aucune colonne, seules les cles etrangeres portees par `ArchitectSession` en
-- produisent.
--
-- `ArchitectSession.appliedTaskId` est en `RESTRICT`, comme `Run → Task` : une
-- session documente la creation d'une tache, et une tache liee a une session ne
-- doit pas pouvoir disparaitre en laissant cette trace pointer dans le vide.
-- L'index unique associe est la garantie centrale de TASK-013 : **une session
-- cree une tache, jamais deux**, y compris sur double clic concurrent. SQLite
-- traite les `NULL` comme distincts, donc toutes les sessions non appliquees
-- coexistent sans se gener.
--
-- `ArchitectGeneration → ArchitectSession` est en `CASCADE` : une generation ne
-- raconte rien sans sa session, et rien d'autre ne la referencera jamais.

-- CreateTable
CREATE TABLE "ArchitectSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requestText" TEXT NOT NULL,
    "clarificationText" TEXT,
    "status" TEXT NOT NULL,
    "nextGenerationSequence" INTEGER NOT NULL DEFAULT 1,
    "appliedTaskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArchitectSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchitectSession_appliedTaskId_fkey" FOREIGN KEY ("appliedTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArchitectGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "contextManifestJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "proposalJson" TEXT,
    "questionsJson" TEXT,
    "providerResponseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArchitectGeneration_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ArchitectSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectSession_appliedTaskId_key" ON "ArchitectSession"("appliedTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectSession_projectId_sequence_key" ON "ArchitectSession"("projectId", "sequence");

-- CreateIndex
CREATE INDEX "ArchitectSession_projectId_createdAt_idx" ON "ArchitectSession"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectGeneration_sessionId_sequence_key" ON "ArchitectGeneration"("sessionId", "sequence");

-- CreateIndex
CREATE INDEX "ArchitectGeneration_sessionId_sequence_idx" ON "ArchitectGeneration"("sessionId", "sequence");
