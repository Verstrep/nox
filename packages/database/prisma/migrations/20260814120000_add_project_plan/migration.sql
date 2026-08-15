-- TASK-021 : brief produit, plan de V1, et propositions de mise a jour.
--
-- Purement additive : trois tables creees, aucune table existante reconstruite,
-- aucune colonne modifiee, aucune donnee touchee. Une base contenant deja des
-- projets, des taches, des conversations et de la memoire traverse cette
-- migration sans qu'aucune ligne ne change.

-- Brief produit. Au plus un par projet : l'unicite est structurelle, pas
-- verifiee a l'ecriture.
CREATE TABLE "ProjectBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "targetUsers" TEXT NOT NULL,
    "desiredOutcome" TEXT NOT NULL,
    "goalsJson" TEXT NOT NULL,
    "nonGoalsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectBrief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectBrief_projectId_key" ON "ProjectBrief"("projectId");

-- Plan de V1.
CREATE TABLE "ProjectV1Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "technicalDirection" TEXT NOT NULL,
    "inScopeJson" TEXT NOT NULL,
    "outOfScopeJson" TEXT NOT NULL,
    "milestonesJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectV1Plan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectV1Plan_projectId_key" ON "ProjectV1Plan"("projectId");

-- Mise a jour proposee par un tour de l'Architecte. Au plus une par generation :
-- un tour propose un etat cible, pas une suite de correctifs.
CREATE TABLE "ArchitectProjectUpdate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "proposedJson" TEXT NOT NULL,
    "baseBriefRevision" TEXT,
    "basePlanRevision" TEXT,
    "appliedAt" DATETIME,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArchitectProjectUpdate_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ArchitectGeneration" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchitectProjectUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ArchitectProjectUpdate_generationId_key" ON "ArchitectProjectUpdate"("generationId");

CREATE INDEX "ArchitectProjectUpdate_projectId_createdAt_idx" ON "ArchitectProjectUpdate"("projectId", "createdAt");
