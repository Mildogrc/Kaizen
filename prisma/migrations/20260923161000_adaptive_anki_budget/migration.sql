ALTER TABLE "AnkiDeckMapping"
ADD COLUMN "adaptiveNewCards" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AnkiReviewLog"
ADD COLUMN "reviewType" INTEGER;

CREATE TABLE "AnkiAdaptiveBudgetState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "currentBudget" INTEGER NOT NULL,
    "reliableDataDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnkiAdaptiveBudgetState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnkiAdaptiveEvidenceDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ankiDay" TEXT NOT NULL,
    "reviewObservations" INTEGER NOT NULL DEFAULT 0,
    "reviewedCardCount" INTEGER NOT NULL DEFAULT 0,
    "reviewedCardIds" JSONB NOT NULL DEFAULT '[]',
    "lapsedCardIds" JSONB NOT NULL DEFAULT '[]',
    "reviewMinutes" DOUBLE PRECISION,
    "validTimeObservations" INTEGER NOT NULL DEFAULT 0,
    "reviewsDue" INTEGER,
    "reviewsCompleted" INTEGER NOT NULL DEFAULT 0,
    "completionRate" DOUBLE PRECISION,
    "retention" DOUBLE PRECISION,
    "reliable" BOOLEAN NOT NULL DEFAULT false,
    "dataAvailable" BOOLEAN NOT NULL DEFAULT true,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnkiAdaptiveEvidenceDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnkiAdaptiveBudgetDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ankiDay" TEXT NOT NULL,
    "previousBudget" INTEGER NOT NULL,
    "performanceTarget" INTEGER NOT NULL,
    "confidenceCeiling" INTEGER NOT NULL,
    "finalBudget" INTEGER NOT NULL,
    "windowRetention" DOUBLE PRECISION,
    "retentionAdjustment" INTEGER NOT NULL DEFAULT 0,
    "medianReviewMinutes" DOUBLE PRECISION,
    "reviewTimeAdjustment" INTEGER NOT NULL DEFAULT 0,
    "repeatLapseRate" DOUBLE PRECISION,
    "lapseAdjustment" INTEGER NOT NULL DEFAULT 0,
    "completionRate" DOUBLE PRECISION,
    "overdueCount" INTEGER NOT NULL DEFAULT 0,
    "backlogRatio" DOUBLE PRECISION,
    "reliableDataDays" INTEGER NOT NULL DEFAULT 0,
    "reliableWindowDays" INTEGER NOT NULL DEFAULT 0,
    "dueAtCalculation" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "allocation" JSONB NOT NULL DEFAULT '[]',
    "applyStatus" TEXT NOT NULL DEFAULT 'pending',
    "applyError" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastApplyAt" TIMESTAMP(3),
    CONSTRAINT "AnkiAdaptiveBudgetDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnkiAdaptiveDeckState" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "originalConfigId" TEXT NOT NULL,
    "managedConfigId" TEXT NOT NULL,
    "managedConfigName" TEXT NOT NULL,
    "lastAppliedBudget" INTEGER,
    "lastAppliedAt" TIMESTAMP(3),
    "restorePending" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnkiAdaptiveDeckState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnkiAdaptiveBudgetState_userId_key" ON "AnkiAdaptiveBudgetState"("userId");
CREATE UNIQUE INDEX "AnkiAdaptiveEvidenceDay_userId_ankiDay_key" ON "AnkiAdaptiveEvidenceDay"("userId", "ankiDay");
CREATE INDEX "AnkiAdaptiveEvidenceDay_userId_reliable_ankiDay_idx" ON "AnkiAdaptiveEvidenceDay"("userId", "reliable", "ankiDay");
CREATE UNIQUE INDEX "AnkiAdaptiveBudgetDecision_userId_ankiDay_key" ON "AnkiAdaptiveBudgetDecision"("userId", "ankiDay");
CREATE INDEX "AnkiAdaptiveBudgetDecision_userId_calculatedAt_idx" ON "AnkiAdaptiveBudgetDecision"("userId", "calculatedAt");
CREATE UNIQUE INDEX "AnkiAdaptiveDeckState_mappingId_key" ON "AnkiAdaptiveDeckState"("mappingId");

ALTER TABLE "AnkiAdaptiveBudgetState"
ADD CONSTRAINT "AnkiAdaptiveBudgetState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnkiAdaptiveEvidenceDay"
ADD CONSTRAINT "AnkiAdaptiveEvidenceDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnkiAdaptiveBudgetDecision"
ADD CONSTRAINT "AnkiAdaptiveBudgetDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnkiAdaptiveDeckState"
ADD CONSTRAINT "AnkiAdaptiveDeckState_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "AnkiDeckMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
