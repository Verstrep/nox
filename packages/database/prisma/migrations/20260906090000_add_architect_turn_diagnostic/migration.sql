-- HOTFIX-003 : diagnostic sur d'un tour d'Architecte qui a echoue.
--
-- Meme forme, meme raison et meme portee que HOTFIX-001, qui avait donne ces
-- deux colonnes a `ArchitectBacklogGeneration` : la conversation projet etait
-- restee sans diagnostic, et le second pilote reel l'a paye. Deux tours
-- consecutifs ont echoue sur la meme phrase generique, sans que rien
-- d'enregistre ne permette de distinguer quatre causes de code differentes.
--
-- Purement additive : deux colonnes nullables ajoutees par
-- `ALTER TABLE ADD COLUMN`. Aucune table n'est reconstruite, aucune ligne
-- existante n'est reecrite, aucune migration deja appliquee n'est modifiee.
--
-- Aucune ligne n'est ecrite ici, et c'est le point important : les generations
-- deja enregistrees conservent leur statut, leur modele, leurs jetons et leur
-- code d'erreur, et gardent `NULL` sur ces deux colonnes. Les tours 8 et 9 du
-- pilote TicketPulse restent exactement ce qu'ils etaient ; l'ecran affichera
-- « cause non enregistree » plutot que de reconstruire apres coup une cause que
-- personne n'a persistee.
ALTER TABLE "ArchitectGeneration" ADD COLUMN "errorField" TEXT;

ALTER TABLE "ArchitectGeneration" ADD COLUMN "errorDetail" TEXT;
