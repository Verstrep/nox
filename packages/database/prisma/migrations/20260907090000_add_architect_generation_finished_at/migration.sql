-- HOTFIX-004 : duree reelle d'un tour d'Architecte.
--
-- Additif et reversible : une colonne nullable, aucune donnee reecrite, aucune
-- ligne supprimee. Les generations anterieures gardent `NULL` — leur duree n'a
-- jamais ete enregistree, et l'inventer serait pire que de ne rien afficher.
--
-- `ArchitectBacklogGeneration` possedait deja `finishedAt` ; c'est la
-- conversation qui n'en avait pas.
ALTER TABLE "ArchitectGeneration" ADD COLUMN "finishedAt" DATETIME;
