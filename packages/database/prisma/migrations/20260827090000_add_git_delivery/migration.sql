-- TASK-029 : politique de livraison Git et candidat valide.
--
-- Purement additive : une table creee, une colonne ajoutee a `Project` par
-- `ALTER TABLE ADD COLUMN`. Aucune table n'est reconstruite, aucune ligne
-- existante n'est reecrite, aucune migration deja appliquee n'est modifiee.
--
-- Aucune ligne n'est ecrite ici, et c'est le point le plus important de ce
-- fichier : appliquer cette migration ne produit aucun commit, aucun push,
-- aucune livraison et aucun avancement de file. Tous les projets existants
-- recoivent `MANUAL` par la valeur par defaut de la colonne — le mode ou NOX
-- n'ecrit rien dans Git, exactement comme avant TASK-029.
--
-- Les livraisons passees ne sont pas reconstruites depuis l'historique Git : un
-- commit deja present dans le depot appartient au depot, pas a NOX.
ALTER TABLE "Project" ADD COLUMN "deliveryPolicy" TEXT NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "GitDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "sourceDecisionId" TEXT,
    "policy" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "expectedHead" TEXT NOT NULL,
    "expectedBranch" TEXT NOT NULL,
    "candidateFingerprint" TEXT NOT NULL,
    "candidateJson" TEXT NOT NULL,
    "upstreamRemote" TEXT,
    "upstreamRef" TEXT,
    "commitMessage" TEXT NOT NULL,
    "commitSha" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "committedAt" DATETIME,
    "pushedAt" DATETIME,
    CONSTRAINT "GitDelivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GitDelivery_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GitDelivery_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Le verrou de TASK-029 : dix constatations simultanees de « tache terminee »
-- visent la meme paire, et une seule obtient sa livraison. Un commit au plus.
CREATE UNIQUE INDEX "GitDelivery_taskId_sourceRunId_key" ON "GitDelivery"("taskId", "sourceRunId");

CREATE INDEX "GitDelivery_projectId_createdAt_idx" ON "GitDelivery"("projectId", "createdAt");
CREATE INDEX "GitDelivery_taskId_idx" ON "GitDelivery"("taskId");
