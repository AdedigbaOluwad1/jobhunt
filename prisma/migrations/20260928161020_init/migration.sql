-- CreateTable
CREATE TABLE "Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "department" TEXT,
    "employmentType" TEXT,
    "salaryText" TEXT,
    "url" TEXT NOT NULL,
    "applyUrl" TEXT,
    "descriptionText" TEXT NOT NULL,
    "postedAt" DATETIME,
    "contentHash" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "duplicateOfId" INTEGER,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "filterStatus" TEXT NOT NULL,
    "filterReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "statusNote" TEXT,
    "statusUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobId" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "roleSummary" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "niceToHave" TEXT NOT NULL,
    "stack" TEXT NOT NULL,
    "seniority" TEXT NOT NULL,
    "yearsExperienceMin" INTEGER,
    "remotePolicy" TEXT NOT NULL,
    "locationRestriction" TEXT,
    "matchScore" INTEGER NOT NULL,
    "matchReasons" TEXT NOT NULL,
    "gaps" TEXT NOT NULL,
    "redFlags" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Extraction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Application" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobId" INTEGER NOT NULL,
    "cvPdfPath" TEXT NOT NULL,
    "tailoredJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME,
    "notes" TEXT,
    CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "lastFetchedAt" DATETIME,
    "lastOk" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "lastJobCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "stats" TEXT
);

-- CreateIndex
CREATE INDEX "Job_status_filterStatus_idx" ON "Job"("status", "filterStatus");

-- CreateIndex
CREATE INDEX "Job_dedupeKey_idx" ON "Job"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Job_source_board_externalId_key" ON "Job"("source", "board", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Extraction_jobId_key" ON "Extraction"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceState_source_board_key" ON "SourceState"("source", "board");
