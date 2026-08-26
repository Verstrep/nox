-- TASK-028 : reservation persistante des corrections.
--
-- Purement additive : une seule table creee, aucune table reconstruite, aucune
-- colonne ajoutee a une table existante. Les relations inverses declarees dans
-- le schema Prisma ne produisent aucune colonne.
--
-- Aucune ligne n'est ecrite ici. Une execution de correction anterieure a
-- TASK-028 reste une correction sans source enregistree : lui en attribuer une
-- aujourd'hui inventerait une decision que personne n'a prise, et une file
-- laissee active avant cette migration ne doit rien declencher de ce fait.
CREATE TABLE "CorrectionAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "sourceBatchId" TEXT,
    "source" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "automatedAttempt" INTEGER,
    "status" TEXT NOT NULL,
    "refusalCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "launchedAt" DATETIME,
    "abandonedAt" DATETIME,
    "correctionRunId" TEXT,
    "feedbackId" TEXT,
    CONSTRAINT "CorrectionAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CorrectionAttempt_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CorrectionAttempt_correctionRunId_fkey" FOREIGN KEY ("correctionRunId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Le verrou de TASK-028 : deux reconciliations simultanees du meme echec
-- visent le meme rang sur la meme execution source, et une seule l'obtient.
CREATE UNIQUE INDEX "CorrectionAttempt_sourceRunId_attempt_key" ON "CorrectionAttempt"("sourceRunId", "attempt");

-- Une execution de correction n'est nee que d'une seule reservation.
CREATE UNIQUE INDEX "CorrectionAttempt_correctionRunId_key" ON "CorrectionAttempt"("correctionRunId");

CREATE INDEX "CorrectionAttempt_taskId_createdAt_idx" ON "CorrectionAttempt"("taskId", "createdAt");
CREATE INDEX "CorrectionAttempt_sourceRunId_idx" ON "CorrectionAttempt"("sourceRunId");

-- Ce qu'une validation a modifie, quand NOX a pu le nommer.
--
-- `ALTER TABLE ADD COLUMN` : aucune table reconstruite, aucune ligne existante
-- reecrite. Les lots anterieurs restent a `NULL`, c'est-a-dire « NOX ne sait
-- pas » — jamais « aucun fichier », qui serait une affirmation qu'on n'a pas.
ALTER TABLE "AutonomousValidationBatch" ADD COLUMN "mutatedFiles" TEXT;
