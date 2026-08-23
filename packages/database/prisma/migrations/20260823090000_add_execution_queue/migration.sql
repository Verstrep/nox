-- File d'execution d'un projet.
--
-- Additive : deux colonnes ajoutees a "Project" avec une valeur par defaut, et
-- une table creee. Aucune table existante n'est reconstruite, aucune donnee
-- n'est lue ni reecrite.
--
-- Un projet deja en base traverse cette migration avec une file **vide** et
-- **en pause** : `executionQueueActive` vaut 0, `nextQueueSequence` vaut 1, et
-- aucune tache n'y est inscrite. Rien ne peut donc partir du seul fait de la
-- migration.

ALTER TABLE "Project" ADD COLUMN "executionQueueActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "nextQueueSequence" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "TaskQueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskQueueEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskQueueEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Une tache n'apparait qu'une fois dans la file de son projet : la seconde
-- inscription est un double-clic, pas une erreur.
CREATE UNIQUE INDEX "TaskQueueEntry_projectId_taskId_key" ON "TaskQueueEntry"("projectId", "taskId");

-- Et une fois dans NOX tout court : une tache appartient a un seul projet, donc
-- a une seule file. Cet index sert aussi les lectures « cette tache est-elle
-- inscrite ? », que l'index composite ci-dessus ne peut pas servir.
CREATE UNIQUE INDEX "TaskQueueEntry_taskId_key" ON "TaskQueueEntry"("taskId");

-- La file se lit toujours dans l'ordre, et toujours pour un projet.
CREATE INDEX "TaskQueueEntry_projectId_sequence_idx" ON "TaskQueueEntry"("projectId", "sequence");
