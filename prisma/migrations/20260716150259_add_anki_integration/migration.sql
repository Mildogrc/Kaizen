-- CreateEnum
CREATE TYPE "AnkiCardState" AS ENUM ('NEW', 'LEARNING', 'YOUNG', 'MATURE', 'SUSPENDED', 'BURIED');

-- CreateTable
CREATE TABLE "AnkiDeckMapping" (
    "id" TEXT NOT NULL,
    "deckName" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "schemaId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnkiDeckMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnkiCardSnapshot" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "ankiCardId" BIGINT NOT NULL,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "state" "AnkiCardState" NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "dueAt" TIMESTAMP(3),
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "isLeech" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnkiCardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnkiReviewLog" (
    "id" TEXT NOT NULL,
    "ankiReviewId" BIGINT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "ankiCardId" BIGINT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "rating" INTEGER NOT NULL,
    "intervalAfterDays" INTEGER NOT NULL DEFAULT 0,
    "intervalBeforeDays" INTEGER NOT NULL DEFAULT 0,
    "timeMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnkiReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnkiSyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "decksSynced" INTEGER NOT NULL DEFAULT 0,
    "cardsSynced" INTEGER NOT NULL DEFAULT 0,
    "reviewsAdded" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "AnkiSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnkiDeckMapping_deckName_key" ON "AnkiDeckMapping"("deckName");

-- CreateIndex
CREATE INDEX "AnkiDeckMapping_courseId_idx" ON "AnkiDeckMapping"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "AnkiCardSnapshot_ankiCardId_key" ON "AnkiCardSnapshot"("ankiCardId");

-- CreateIndex
CREATE INDEX "AnkiCardSnapshot_mappingId_state_idx" ON "AnkiCardSnapshot"("mappingId", "state");

-- CreateIndex
CREATE INDEX "AnkiCardSnapshot_mappingId_dueAt_idx" ON "AnkiCardSnapshot"("mappingId", "dueAt");

-- CreateIndex
CREATE INDEX "AnkiReviewLog_mappingId_reviewedAt_idx" ON "AnkiReviewLog"("mappingId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnkiReviewLog_ankiReviewId_ankiCardId_key" ON "AnkiReviewLog"("ankiReviewId", "ankiCardId");

-- CreateIndex
CREATE INDEX "AnkiSyncRun_startedAt_idx" ON "AnkiSyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "AnkiDeckMapping" ADD CONSTRAINT "AnkiDeckMapping_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnkiDeckMapping" ADD CONSTRAINT "AnkiDeckMapping_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "ContentSchema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnkiCardSnapshot" ADD CONSTRAINT "AnkiCardSnapshot_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "AnkiDeckMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnkiReviewLog" ADD CONSTRAINT "AnkiReviewLog_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "AnkiDeckMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
