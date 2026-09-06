-- HOTFIX-005 : une proposition de mise a jour peut poser des regles durables
-- dans la memoire du projet, et doit donc etre refusee si la memoire a change
-- depuis qu'elle a ete produite.
--
-- Additif et reversible : une colonne nullable, aucune donnee reecrite, aucune
-- ligne supprimee. Les propositions anterieures gardent `NULL` — aucune ne
-- porte d'entree de memoire, donc aucune n'a rien a proteger.
ALTER TABLE "ArchitectProjectUpdate" ADD COLUMN "baseMemoryRevision" TEXT;
