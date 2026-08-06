-- CreateTable
CREATE TABLE "Run" (
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
    CONSTRAINT "Run_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "context" TEXT,
    "outOfScope" TEXT,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "documentPath" TEXT NOT NULL,
    "documentRevision" TEXT,
    "documentSyncStatus" TEXT NOT NULL,
    "documentSyncError" TEXT,
    "nextRunSequence" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("context", "createdAt", "documentPath", "documentRevision", "documentSyncError", "documentSyncStatus", "id", "objective", "outOfScope", "priority", "projectId", "sequence", "status", "title", "updatedAt") SELECT "context", "createdAt", "documentPath", "documentRevision", "documentSyncError", "documentSyncStatus", "id", "objective", "outOfScope", "priority", "projectId", "sequence", "status", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");
CREATE UNIQUE INDEX "Task_projectId_sequence_key" ON "Task"("projectId", "sequence");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Run_taskId_status_idx" ON "Run"("taskId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Run_taskId_sequence_key" ON "Run"("taskId", "sequence");
