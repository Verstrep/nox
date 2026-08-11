-- TASK-015 — Review Architecte assistee d'une execution.
--
-- Migration ecrite a la main, et **purement additive**, pour la meme raison
-- qu'en TASK-011, TASK-012 et TASK-014 : Prisma regenere toujours une table
-- SQLite plutot que d'en alterer une, et proposait donc de reconstruire `Run` —
-- table temporaire, copie, DROP, renommage — pour ajouter un compteur muni
-- d'une valeur par defaut constante. `Run` porte l'historique reel des
-- executions ; on ne le recopie pas pour une colonne.
--
-- Aucune donnee existante n'est mise en jeu : les executions deja enregistrees
-- demarrent leur numerotation d'analyses a 1, ce qui est exactement ce qu'on
-- veut — aucune d'elles n'a jamais ete analysee.

-- Compteur d'analyses Architecte, borne et jamais decremente.
ALTER TABLE "Run" ADD COLUMN "nextArchitectReviewSequence" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ArchitectRunReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerVerdict" TEXT,
    "finalVerdict" TEXT,
    "blockersJson" TEXT,
    "summary" TEXT,
    "findingsJson" TEXT,
    "feedback" TEXT,
    "providerResponseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArchitectRunReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ArchitectRunReview_runId_sequence_idx" ON "ArchitectRunReview"("runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectRunReview_runId_sequence_key" ON "ArchitectRunReview"("runId", "sequence");
