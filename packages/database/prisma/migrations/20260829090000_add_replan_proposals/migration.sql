-- TASK-032 : replanification des taches futures depuis la conversation projet.
--
-- Purement additive : une table creee, deux colonnes ajoutees a `Task` par
-- `ALTER TABLE ADD COLUMN`. Aucune table n'est reconstruite, aucune ligne
-- existante n'est reecrite, aucune migration deja appliquee n'est modifiee.
--
-- Aucune ligne n'est ecrite ici, et c'est le point le plus important de ce
-- fichier : appliquer cette migration ne cree, ne modifie et ne supprime aucune
-- tache, ne change aucun statut, ne touche a aucune file et n'ecrit rien dans
-- Git. Un projet existant se retrouve exactement dans l'etat ou il etait, avec
-- une capacite de plus qu'un humain doit declencher.
--
-- `planningOrder` reste `NULL` partout. C'est deliberat : l'ordre de
-- planification durable n'existait pas avant TASK-032, et le fabriquer ici a
-- partir d'un `sequence` reviendrait a inventer une intention que personne n'a
-- exprimee. Une valeur absente se lit comme « ordre historique », et le code
-- retombe alors sur l'ordre des codes de tache — deterministe, et vrai.
ALTER TABLE "Task" ADD COLUMN "planningOrder" INTEGER;

CREATE TABLE "ArchitectReplanProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectUpdateId" TEXT,

    -- `PENDING`, `APPLIED` ou `DISMISSED`. Aucun statut `STALE` : la peremption
    -- se derive de la comparaison des empreintes, elle ne se stocke pas.
    "status" TEXT NOT NULL,

    -- Justification ecrite pour l'utilisateur. Contenu, jamais instruction.
    "rationale" TEXT NOT NULL,

    -- Comptes derives de la cible, pour afficher une carte sans deserialiser.
    "targetCount" INTEGER NOT NULL,
    "newCount" INTEGER NOT NULL,

    -- `ReplanProposal` serialise, tel que le fournisseur l'a rendu. **Immuable.**
    "providerJson" TEXT NOT NULL,

    -- Cible reellement appliquee par l'humain. `null` tant que ce n'est pas fait.
    "appliedJson" TEXT,

    -- Revisions du brief et du plan **vues par le fournisseur**, capturees a la
    -- preparation du tour. Jamais relues apres l'appel.
    "baseBriefRevision" TEXT,
    "basePlanRevision" TEXT,

    -- Empreinte de l'etat de planification vu par le fournisseur : taches
    -- verrouillees, contrats modifiables, dependances, ordre, file. Comparee a
    -- l'application ; toute divergence refuse, jamais ne fusionne.
    "planningFingerprint" TEXT NOT NULL,

    "appliedAt" DATETIME,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchitectReplanProposal_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ArchitectGeneration" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchitectReplanProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchitectReplanProposal_projectUpdateId_fkey" FOREIGN KEY ("projectUpdateId") REFERENCES "ArchitectProjectUpdate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Un tour produit au plus une replanification.
CREATE UNIQUE INDEX "ArchitectReplanProposal_generationId_key" ON "ArchitectReplanProposal"("generationId");

-- Une mise a jour de projet est liee a au plus une replanification : les deux
-- forment alors **un** changement, applique ou ecarte d'un seul geste.
CREATE UNIQUE INDEX "ArchitectReplanProposal_projectUpdateId_key" ON "ArchitectReplanProposal"("projectUpdateId");

CREATE INDEX "ArchitectReplanProposal_projectId_createdAt_idx" ON "ArchitectReplanProposal"("projectId", "createdAt");

-- Provenance d'une tache creee par l'application d'un replan.
--
-- La colonne est nullable et le reste : une tache ecrite a la main, proposee par
-- une conversation ou issue d'un backlog n'en porte aucune. La cle etrangere est
-- ajoutee sans reconstruire la table, ce que SQLite autorise tant que la valeur
-- par defaut est NULL — et la table referencee existe deja, creee ci-dessus.
--
-- `Restrict`, comme les autres liens de provenance : une tache creee depuis une
-- replanification n'est pas supprimable tant que cette proposition la designe.
-- Retracer d'ou vient une tache vaut mieux qu'une suppression silencieuse.
ALTER TABLE "Task" ADD COLUMN "replanProposalId" TEXT REFERENCES "ArchitectReplanProposal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La provenance d'une tache creee par un replan, et l'ordre de planification.
CREATE INDEX "Task_replanProposalId_idx" ON "Task"("replanProposalId");
CREATE INDEX "Task_projectId_planningOrder_idx" ON "Task"("projectId", "planningOrder");
