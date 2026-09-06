-- HOTFIX-006 : une execution qui echoue enregistre ce que NOX a observe de sa
-- terminaison, et de quoi localiser une divergence du dossier de travail.
--
-- Trois colonnes nullables, aucune donnee reecrite, aucune ligne supprimee.
--
-- `failureCategory` ne remplace pas `errorCode` : le code reste l'autorite du
-- contrat runner, stable et deja porte par les executions existantes. La
-- categorie repond a une autre question — « qu'est-ce qui a cede ? » —, et une
-- execution anterieure la laisse a NULL. Elle est alors **derivee** a la lecture
-- des faits deja enregistres, jamais reconstruite en base : reecrire une ligne
-- historique pour lui donner une valeur d'aujourd'hui ferait dire au passe ce
-- qu'il ne disait pas.
--
-- `workspaceEntries` accompagne `workspaceFingerprint`, sans jamais lui disputer
-- son role. L'empreinte decide d'une reprise ; ces entrees permettent seulement
-- de nommer les chemins d'un refus. NULL partout pour les executions
-- anterieures, et leur reprise reste exactement aussi possible qu'avant.
ALTER TABLE "Run" ADD COLUMN "failureCategory" TEXT;
ALTER TABLE "Run" ADD COLUMN "failureDetail" TEXT;
ALTER TABLE "Run" ADD COLUMN "workspaceEntries" TEXT;
