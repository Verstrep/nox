-- TASK-014 — Conversation Architecte persistante.
--
-- Migration ecrite a la main, et **purement additive**. Prisma proposait de
-- reconstruire `ArchitectSession` — table temporaire, copie, DROP, renommage —
-- pour la seule raison qu'il regenere toujours une table SQLite plutot que d'en
-- alterer une. Or SQLite accepte parfaitement `ADD COLUMN` pour une colonne
-- nullable, et pour une colonne NOT NULL munie d'une valeur par defaut
-- constante. Aucune donnee de TASK-013 n'a donc a etre recopiee, et aucune
-- session existante n'est mise en jeu.
--
-- Meme analyse qu'en TASK-011 et TASK-012 : une reconstruction de table
-- historique se relit ligne par ligne avant d'etre acceptee, jamais parce que
-- l'outil l'a proposee.

-- Un tour, et l'empreinte du contexte avec lequel il a ete produit.
ALTER TABLE "ArchitectGeneration" ADD COLUMN "turnState" TEXT;
ALTER TABLE "ArchitectGeneration" ADD COLUMN "contextFingerprint" TEXT;

-- Les sessions existantes restent en version 1 : elles n'ont jamais enregistre
-- de messages, et NOX ne leur en fabrique pas.
ALTER TABLE "ArchitectSession" ADD COLUMN "conversationVersion" INTEGER NOT NULL DEFAULT 1;

-- Brouillon du prochain tour : texte, empreinte et manifest de l'apercu.
ALTER TABLE "ArchitectSession" ADD COLUMN "pendingMessageText" TEXT;
ALTER TABLE "ArchitectSession" ADD COLUMN "pendingContextFingerprint" TEXT;
ALTER TABLE "ArchitectSession" ADD COLUMN "pendingContextManifestJson" TEXT;
ALTER TABLE "ArchitectSession" ADD COLUMN "pendingPreparedAt" DATETIME;

-- CreateTable
CREATE TABLE "ArchitectMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "generationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArchitectMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ArchitectSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchitectMessage_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ArchitectGeneration" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ArchitectMessage_sessionId_sequence_idx" ON "ArchitectMessage"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectMessage_sessionId_sequence_key" ON "ArchitectMessage"("sessionId", "sequence");
