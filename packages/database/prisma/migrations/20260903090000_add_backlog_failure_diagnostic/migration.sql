-- HOTFIX-001 : diagnostic sur d'un echec de planification.
--
-- Purement additive : deux colonnes nullables ajoutees a
-- `ArchitectBacklogGeneration` par `ALTER TABLE ADD COLUMN`. Aucune table n'est
-- reconstruite, aucune ligne existante n'est reecrite, aucune migration deja
-- appliquee n'est modifiee.
--
-- Aucune ligne n'est ecrite ici, et c'est le point important : les generations
-- deja enregistrees conservent leur statut, leur modele et leurs jetons, et
-- gardent `NULL` sur ces deux colonnes. `BACKLOG-001 FAILED gpt-5-mini` reste
-- exactement ce qu'elle etait ; l'ecran affiche « cause non enregistree » plutot
-- que de reconstruire apres coup une cause que personne n'a persistee.
ALTER TABLE "ArchitectBacklogGeneration" ADD COLUMN "errorField" TEXT;

ALTER TABLE "ArchitectBacklogGeneration" ADD COLUMN "errorDetail" TEXT;
