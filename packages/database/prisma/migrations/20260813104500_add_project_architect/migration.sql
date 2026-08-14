-- Conversation Architecte principale, durable, par projet.
--
-- Purement additive : trois colonnes et deux index, aucune table reconstruite.
-- `Project`, `ArchitectSession` et `ArchitectGeneration` portent toutes trois de
-- l'historique reel — projets suivis, conversations passees, appels factures —
-- et un `DROP TABLE` ne se justifie pas pour ajouter des colonnes facultatives.
--
-- ## `Project.mainArchitectSessionId`
--
-- Pointeur vers la conversation principale. La garantie « au plus une par
-- projet » est structurelle : une ligne de `Project` ne porte qu'une valeur.
-- L'index unique, lui, garantit qu'une meme session n'est la conversation
-- principale que d'un seul projet.
--
-- Pas de cle etrangere : la declarer creerait un cycle
-- `Project → ArchitectSession → Project` en actions referentielles. Elle ne
-- protegerait de rien d'atteignable — aucune session Architecte n'est jamais
-- supprimee dans NOX, et une conversation principale n'est ni supprimable ni
-- reinitialisable.
--
-- ## `ArchitectSession.kind`
--
-- `TASK_DESIGN_LEGACY` par defaut, ce qui decrit exactement les sessions deja
-- enregistrees : ouvertes pour concevoir une tache, fermees en la creant. La
-- valeur par defaut n'est pas un repli, c'est la verite historique.
--
-- ## `ArchitectGeneration.appliedTaskId`
--
-- L'index unique descend d'un cran : il portait sur la session, il porte
-- desormais aussi sur la generation. Une conversation projet peut creer
-- plusieurs taches au fil du temps ; une proposition n'en cree jamais deux, y
-- compris sur double clic concurrent.
--
-- L'index unique de `ArchitectSession.appliedTaskId` reste en place : il
-- continue de proteger les sessions historiques, dont le comportement ne change
-- pas.
--
-- SQLite accepte une clause `REFERENCES` dans un `ALTER TABLE ADD COLUMN` tant
-- que la valeur par defaut est `NULL`. La cle etrangere vers `Task` est donc
-- reelle, avec la meme action `RESTRICT` que celle de la session.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "mainArchitectSessionId" TEXT;

-- AlterTable
ALTER TABLE "ArchitectSession" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TASK_DESIGN_LEGACY';

-- AlterTable
ALTER TABLE "ArchitectGeneration" ADD COLUMN "appliedTaskId" TEXT REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArchitectGeneration" ADD COLUMN "taskClaimedAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "Project_mainArchitectSessionId_key" ON "Project"("mainArchitectSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectGeneration_appliedTaskId_key" ON "ArchitectGeneration"("appliedTaskId");
