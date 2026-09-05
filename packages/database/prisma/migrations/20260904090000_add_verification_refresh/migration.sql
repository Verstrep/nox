-- TASK-033 : rafraichissement des plans de verification apres un amorcage.
--
-- Purement additive : une seule table nouvelle, aucune colonne ajoutee a une
-- table existante, aucune table reconstruite, aucune ligne reecrite, aucune
-- migration deja appliquee modifiee.
--
-- Aucune ligne n'est ecrite ici, et c'est le point important : appliquer cette
-- migration ne declenche aucun appel au fournisseur, ne modifie aucune tache,
-- ne change aucun plan de verification et ne fait avancer aucune file. Un
-- projet deja amorce ne recoit pas retroactivement un rafraichissement — il
-- n'en existait pas, et en fabriquer un supposerait de connaitre un etat de
-- planification que personne n'a enregistre.
--
-- `projectId, planningFingerprint` est unique : c'est la contrainte qui porte
-- l'idempotence. Un meme etat de planification ne peut produire qu'une ligne,
-- donc au plus un appel au fournisseur, quelles que soient les concurrences.
CREATE TABLE "VerificationRefresh" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "bootstrapTaskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "planningFingerprint" TEXT NOT NULL,
    "providerResponseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "errorCode" TEXT,
    "errorField" TEXT,
    "errorDetail" TEXT,
    "providerJson" TEXT,
    "appliedJson" TEXT,
    "changedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "automatedCount" INTEGER NOT NULL DEFAULT 0,
    "humanCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "VerificationRefresh_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VerificationRefresh_bootstrapTaskId_fkey" FOREIGN KEY ("bootstrapTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "VerificationRefresh_projectId_createdAt_idx" ON "VerificationRefresh"("projectId", "createdAt");

CREATE UNIQUE INDEX "VerificationRefresh_projectId_planningFingerprint_key" ON "VerificationRefresh"("projectId", "planningFingerprint");
