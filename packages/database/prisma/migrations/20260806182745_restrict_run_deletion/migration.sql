-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "promptSha256" TEXT NOT NULL,
    "runnerRunId" TEXT NOT NULL,
    "claudeSessionId" TEXT,
    "resultText" TEXT,
    "stderrTail" TEXT,
    "exitCode" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "durationApiMs" INTEGER,
    "numTurns" INTEGER,
    "reportedCostUsd" REAL,
    "gitBranch" TEXT,
    "gitUpstream" TEXT,
    "gitHeadBefore" TEXT,
    "gitHeadAfter" TEXT,
    "gitDiffStat" TEXT,
    "changedFiles" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Run_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("changedFiles", "claudeSessionId", "createdAt", "durationApiMs", "durationMs", "errorCode", "errorMessage", "exitCode", "finishedAt", "gitBranch", "gitDiffStat", "gitHeadAfter", "gitHeadBefore", "gitUpstream", "id", "numTurns", "prompt", "promptSha256", "reportedCostUsd", "resultText", "runnerRunId", "sequence", "startedAt", "status", "stderrTail", "taskId", "updatedAt") SELECT "changedFiles", "claudeSessionId", "createdAt", "durationApiMs", "durationMs", "errorCode", "errorMessage", "exitCode", "finishedAt", "gitBranch", "gitDiffStat", "gitHeadAfter", "gitHeadBefore", "gitUpstream", "id", "numTurns", "prompt", "promptSha256", "reportedCostUsd", "resultText", "runnerRunId", "sequence", "startedAt", "status", "stderrTail", "taskId", "updatedAt" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE INDEX "Run_taskId_status_idx" ON "Run"("taskId", "status");
CREATE UNIQUE INDEX "Run_taskId_sequence_key" ON "Run"("taskId", "sequence");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
