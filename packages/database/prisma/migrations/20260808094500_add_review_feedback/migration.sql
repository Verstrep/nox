-- Feedback de review et reprise ciblee d'une session Claude.
--
-- Comme la migration precedente, celle-ci est **purement additive** sur `Run` :
-- six `ALTER TABLE ADD COLUMN` plutot que la reconstruction complete que Prisma
-- propose. `Run` porte l'historique reel des executions et est referencee par
-- `RunEvent`, `RunFileChange` et `RunValidationResult` ; un `DROP TABLE` sur une
-- table de faits historiques ne se justifie pas pour ajouter des colonnes
-- facultatives.
--
-- Consequence assumee : la cle etrangere `parentRunId → Run(id)` n'existe pas au
-- niveau SQLite, `ALTER TABLE ADD COLUMN` ne sachant pas en creer. Elle ne
-- protegerait de toute facon contre rien d'atteignable : **aucune execution
-- n'est jamais supprimee dans NOX**, donc aucun parent ne peut disparaitre. La
-- garantie qui compte vraiment, elle, est bien posee : l'index unique sur
-- `parentRunId` interdit qu'une meme execution recoive deux corrections, y
-- compris sur double clic concurrent.
--
-- SQLite traite les `NULL` comme distincts dans un index unique : les executions
-- initiales, toutes `parentRunId = NULL`, coexistent sans se gener.

-- AlterTable
ALTER TABLE "Run" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'INITIAL';
ALTER TABLE "Run" ADD COLUMN "parentRunId" TEXT;
ALTER TABLE "Run" ADD COLUMN "resumedFromSessionId" TEXT;
ALTER TABLE "Run" ADD COLUMN "workspaceFingerprint" TEXT;
ALTER TABLE "Run" ADD COLUMN "workspaceFingerprintVersion" TEXT;
ALTER TABLE "Run" ADD COLUMN "workspaceFingerprintErrorCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Run_parentRunId_key" ON "Run"("parentRunId");

-- CreateTable
CREATE TABLE "ReviewFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "correctionRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" DATETIME,
    CONSTRAINT "ReviewFeedback_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewFeedback_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewFeedback_correctionRunId_fkey" FOREIGN KEY ("correctionRunId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewFeedback_correctionRunId_key" ON "ReviewFeedback"("correctionRunId");

-- CreateIndex
CREATE INDEX "ReviewFeedback_taskId_createdAt_idx" ON "ReviewFeedback"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewFeedback_sourceRunId_idx" ON "ReviewFeedback"("sourceRunId");
