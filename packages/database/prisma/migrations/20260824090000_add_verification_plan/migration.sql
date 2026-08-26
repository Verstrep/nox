-- Plan de verification d'une tache, et validation autonome apres execution.
--
-- ## Additive, et sans reconstruction
--
-- Prisma proposait de reconstruire "TaskAcceptanceCriterion" et
-- "TaskValidationCommand" — copie, DROP, RENAME — parce que le schema y ajoute
-- des relations. SQLite sait ajouter une colonne avec valeur par defaut sans
-- rien reconstruire : c'est ce qui est fait ici. Une reconstruction aurait
-- recopie l'historique de toutes les taches du projet pour ajouter deux
-- colonnes, et une reconstruction ratee laisse une table a moitie renommee.
--
-- ## Les defauts sont les defauts surs
--
-- `verificationMode = 'HUMAN'` et `executionMode = 'AGENT_ONLY'` : apres cette
-- migration, aucune tache historique n'a gagne le droit de se terminer toute
-- seule, et aucune commande enregistree n'est devenue executable sans
-- surveillance. C'est important pour les commandes du genre `npm run dev`, que
-- rien ne distingue en base d'un `npm test`.
--
-- `humanInstructions` reste nullable : une tache `DRAFT` a le droit d'etre
-- incomplete, et c'est `Mark ready` qui exigera l'instruction. Remplir les
-- lignes existantes d'un texte generique aurait invente une consigne que
-- personne n'a ecrite — et rendu les taches deja executees illisibles.
--
-- Aucune ligne n'est creee : pas de lien critere-commande, pas de lot de
-- validation. Une execution historique n'a donc aucun lot, ce qui se lit comme
-- « aucune validation autonome n'etait configuree » et jamais comme un echec.

ALTER TABLE "TaskAcceptanceCriterion" ADD COLUMN "verificationMode" TEXT NOT NULL DEFAULT 'HUMAN';
ALTER TABLE "TaskAcceptanceCriterion" ADD COLUMN "humanInstructions" TEXT;

ALTER TABLE "TaskValidationCommand" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'AGENT_ONLY';

-- Quelle commande prouve quel critere.
--
-- Une table plutot qu'une colonne, parce que la relation est un vrai
-- plusieurs-a-plusieurs : deux commandes peuvent prouver ensemble un critere, et
-- une commande peut en prouver plusieurs.
CREATE TABLE "TaskCriterionValidation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "criterionId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskCriterionValidation_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "TaskAcceptanceCriterion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskCriterionValidation_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "TaskValidationCommand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Declarer deux fois le meme lien est un double-clic, pas une double preuve.
CREATE UNIQUE INDEX "TaskCriterionValidation_criterionId_commandId_key" ON "TaskCriterionValidation"("criterionId", "commandId");
CREATE INDEX "TaskCriterionValidation_commandId_idx" ON "TaskCriterionValidation"("commandId");

-- Un passage de NOX sur les validations autonomes d'une execution.
--
-- C'est la reservation qui rend le lot idempotent : deux finalisations
-- concurrentes de la meme execution ne peuvent pas toutes les deux inserer une
-- ligne pour la meme tentative.
CREATE TABLE "AutonomousValidationBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "trackedStateBefore" TEXT,
    "trackedStateAfter" TEXT,
    CONSTRAINT "AutonomousValidationBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AutonomousValidationBatch_runId_attempt_key" ON "AutonomousValidationBatch"("runId", "attempt");
CREATE INDEX "AutonomousValidationBatch_runId_idx" ON "AutonomousValidationBatch"("runId");

-- Ce qu'une commande a rendu quand NOX l'a executee lui-meme.
--
-- Distincte de "RunValidationResult", qui enregistre ce que Claude Code a
-- rapporte avoir lance. Les deux coexistent volontairement : l'une est une
-- information, l'autre est une preuve.
CREATE TABLE "AutonomousValidationResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "commandId" TEXT,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "exitCode" INTEGER,
    "durationMs" INTEGER,
    "stdout" TEXT,
    "stdoutTruncated" BOOLEAN NOT NULL DEFAULT false,
    "stderr" TEXT,
    "stderrTruncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutonomousValidationResult_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AutonomousValidationBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AutonomousValidationResult_batchId_position_key" ON "AutonomousValidationResult"("batchId", "position");
CREATE INDEX "AutonomousValidationResult_batchId_idx" ON "AutonomousValidationResult"("batchId");
CREATE INDEX "AutonomousValidationResult_commandId_idx" ON "AutonomousValidationResult"("commandId");

-- Comment la review d'une execution a ete conclue, et par qui.
CREATE TABLE "RunReviewDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "overrideReason" TEXT,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunReviewDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RunReviewDecision_runId_key" ON "RunReviewDecision"("runId");
CREATE INDEX "RunReviewDecision_runId_idx" ON "RunReviewDecision"("runId");

-- Quels criteres humains ont ete explicitement confirmes.
--
-- Le detail compte autant que le geste : « validation humaine confirmee » sans
-- dire quoi ne se relit pas six mois plus tard.
CREATE TABLE "RunHumanCriterionConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionId" TEXT NOT NULL,
    "criterionId" TEXT,
    "criterionText" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunHumanCriterionConfirmation_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "RunReviewDecision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RunHumanCriterionConfirmation_decisionId_criterionText_key" ON "RunHumanCriterionConfirmation"("decisionId", "criterionText");
CREATE INDEX "RunHumanCriterionConfirmation_decisionId_idx" ON "RunHumanCriterionConfirmation"("decisionId");
