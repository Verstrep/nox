-- Memoire projet : entrees durables enregistrees explicitement par l'utilisateur.
--
-- Migration ecrite a la main, et purement additive.
--
-- Prisma proposait de reconstruire `Project` — table temporaire, copie, `DROP`,
-- renommage — pour ajouter un compteur muni d'une valeur par defaut constante.
-- `Project` porte tous les projets suivis, leurs chemins de repository et les
-- cles etrangeres de tout le reste : on ne le recopie pas pour une colonne.
-- SQLite sait faire cet ajout sur place, comme aux migrations de TASK-011,
-- TASK-012, TASK-014 et TASK-015.
ALTER TABLE "Project" ADD COLUMN "nextMemorySequence" INTEGER NOT NULL DEFAULT 1;

-- Le texte stocke est celui de l'utilisateur, jamais sa version sanitisee : ce
-- qui sera relu dans six mois doit etre ce qui a ete ecrit. La sanitation
-- s'applique a l'envoi vers l'Architecte, et c'est elle que la revision decrit.
CREATE TABLE "ProjectMemoryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rationale" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectMemoryEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Un numero est unique dans son projet, et ne bouge jamais.
CREATE UNIQUE INDEX "ProjectMemoryEntry_projectId_sequence_key" ON "ProjectMemoryEntry"("projectId", "sequence");

-- La page Memory et le constructeur de contexte lisent tous deux par projet et
-- par statut : c'est exactement cet index.
CREATE INDEX "ProjectMemoryEntry_projectId_status_idx" ON "ProjectMemoryEntry"("projectId", "status");
