-- Review integree d'une execution : changements de fichiers et validations.
--
-- Cette migration est **purement additive**. Prisma proposait de reconstruire la
-- table `Run` (`CREATE new_Run` / `INSERT SELECT` / `DROP` / `RENAME`) pour y
-- ajouter trois colonnes ; le bloc a ete remplace par trois `ALTER TABLE ADD
-- COLUMN`, que SQLite accepte pour des colonnes nullables ou dotees d'un defaut
-- constant.
--
-- La raison n'est pas cosmetique : `Run` porte l'historique reel des executions
-- — prompts envoyes, comptes rendus, etats Git constates — et elle est
-- referencee par `RunEvent`. Un `DROP TABLE` sur une table de faits historiques
-- est une operation qu'on ne prend pas a la legere pour ajouter trois colonnes
-- facultatives.

-- AlterTable
ALTER TABLE "Run" ADD COLUMN "reviewCapturedAt" DATETIME;
ALTER TABLE "Run" ADD COLUMN "reviewErrorCode" TEXT;
ALTER TABLE "Run" ADD COLUMN "reviewOmittedFiles" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RunFileChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "previousPath" TEXT,
    "changeType" TEXT NOT NULL,
    "additions" INTEGER,
    "deletions" INTEGER,
    "isBinary" BOOLEAN NOT NULL DEFAULT false,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "isTruncated" BOOLEAN NOT NULL DEFAULT false,
    "patch" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunFileChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunValidationResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "exitCode" INTEGER,
    "summary" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunValidationResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RunFileChange_runId_position_idx" ON "RunFileChange"("runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RunFileChange_runId_position_key" ON "RunFileChange"("runId", "position");

-- CreateIndex
CREATE INDEX "RunValidationResult_runId_position_idx" ON "RunValidationResult"("runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RunValidationResult_runId_position_key" ON "RunValidationResult"("runId", "position");
