-- CreateEnum
CREATE TYPE "GrammarStudyStatus" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'MASTERED');

-- CreateEnum
CREATE TYPE "GrammarLessonStatus" AS ENUM ('GENERATED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReadingMode" AS ENUM ('RSVP', 'PACED', 'CHUNKING', 'BENCHMARK');

-- AlterTable
ALTER TABLE "LearningItem" ADD COLUMN "sourceKey" TEXT;

-- CreateTable
CREATE TABLE "BookReadingSession" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startPage" INTEGER,
    "endPage" INTEGER,
    "pagesRead" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookReadingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarProgress" (
    "id" TEXT NOT NULL,
    "learningItemId" TEXT NOT NULL,
    "status" "GrammarStudyStatus" NOT NULL DEFAULT 'NEW',
    "curriculumOrder" INTEGER NOT NULL DEFAULT 0,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapseCount" INTEGER NOT NULL DEFAULT 0,
    "isLeech" BOOLEAN NOT NULL DEFAULT false,
    "introducedAt" TIMESTAMP(3),
    "lastStudiedAt" TIMESTAMP(3),
    "lastRating" "ReviewRating",
    "totalCorrect" INTEGER NOT NULL DEFAULT 0,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GrammarProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarLesson" (
    "id" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "levelLabel" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "grammarItemIds" JSONB NOT NULL,
    "vocabulary" JSONB NOT NULL DEFAULT '[]',
    "status" "GrammarLessonStatus" NOT NULL DEFAULT 'GENERATED',
    "response" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrammarLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeforcesProfile" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "displayName" TEXT,
    "rating" INTEGER,
    "maxRating" INTEGER,
    "rank" TEXT,
    "maxRank" TEXT,
    "avatarUrl" TEXT,
    "contribution" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CodeforcesProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeforcesSubmission" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "codeforcesId" BIGINT NOT NULL,
    "contestId" INTEGER,
    "problemIndex" TEXT NOT NULL,
    "problemName" TEXT NOT NULL,
    "problemRating" INTEGER,
    "problemTags" JSONB NOT NULL DEFAULT '[]',
    "verdict" TEXT,
    "participantType" TEXT,
    "programmingLanguage" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "timeConsumedMillis" INTEGER,
    "memoryConsumedBytes" BIGINT,
    CONSTRAINT "CodeforcesSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeforcesRatingChange" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "contestId" INTEGER NOT NULL,
    "contestName" TEXT NOT NULL,
    "contestRank" INTEGER NOT NULL,
    "oldRating" INTEGER NOT NULL,
    "newRating" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CodeforcesRatingChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeedReadingPassage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "text" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "answerKey" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'llm',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpeedReadingPassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeedReadingSession" (
    "id" TEXT NOT NULL,
    "passageId" TEXT NOT NULL,
    "mode" "ReadingMode" NOT NULL,
    "wpm" INTEGER NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "fontSize" INTEGER NOT NULL,
    "punctuationPause" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSec" INTEGER NOT NULL,
    "correctAnswers" INTEGER NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "responseTimeMs" INTEGER NOT NULL,
    "estimatedRetention" DOUBLE PRECISION NOT NULL,
    "recommendedNextWpm" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "retentionDueAt" TIMESTAMP(3),
    "retentionCompletedAt" TIMESTAMP(3),
    "retentionAccuracy" DOUBLE PRECISION,
    "retentionAnswers" JSONB,
    CONSTRAINT "SpeedReadingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookReadingSession_bookId_readAt_idx" ON "BookReadingSession"("bookId", "readAt");
CREATE UNIQUE INDEX "GrammarProgress_learningItemId_key" ON "GrammarProgress"("learningItemId");
CREATE INDEX "GrammarProgress_status_dueAt_idx" ON "GrammarProgress"("status", "dueAt");
CREATE INDEX "GrammarProgress_curriculumOrder_idx" ON "GrammarProgress"("curriculumOrder");
CREATE INDEX "GrammarLesson_scheduledFor_status_idx" ON "GrammarLesson"("scheduledFor", "status");
CREATE UNIQUE INDEX "CodeforcesProfile_handle_key" ON "CodeforcesProfile"("handle");
CREATE INDEX "CodeforcesSubmission_profileId_submittedAt_idx" ON "CodeforcesSubmission"("profileId", "submittedAt");
CREATE INDEX "CodeforcesSubmission_profileId_problemRating_idx" ON "CodeforcesSubmission"("profileId", "problemRating");
CREATE UNIQUE INDEX "CodeforcesSubmission_profileId_codeforcesId_key" ON "CodeforcesSubmission"("profileId", "codeforcesId");
CREATE INDEX "CodeforcesRatingChange_profileId_updatedAt_idx" ON "CodeforcesRatingChange"("profileId", "updatedAt");
CREATE UNIQUE INDEX "CodeforcesRatingChange_profileId_contestId_key" ON "CodeforcesRatingChange"("profileId", "contestId");
CREATE INDEX "SpeedReadingPassage_category_difficulty_idx" ON "SpeedReadingPassage"("category", "difficulty");
CREATE INDEX "SpeedReadingSession_completedAt_idx" ON "SpeedReadingSession"("completedAt");
CREATE INDEX "SpeedReadingSession_retentionDueAt_retentionCompletedAt_idx" ON "SpeedReadingSession"("retentionDueAt", "retentionCompletedAt");
CREATE UNIQUE INDEX "LearningItem_courseId_itemType_sourceKey_key" ON "LearningItem"("courseId", "itemType", "sourceKey");

-- AddForeignKey
ALTER TABLE "BookReadingSession" ADD CONSTRAINT "BookReadingSession_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrammarProgress" ADD CONSTRAINT "GrammarProgress_learningItemId_fkey" FOREIGN KEY ("learningItemId") REFERENCES "LearningItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodeforcesSubmission" ADD CONSTRAINT "CodeforcesSubmission_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CodeforcesProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodeforcesRatingChange" ADD CONSTRAINT "CodeforcesRatingChange_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CodeforcesProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpeedReadingSession" ADD CONSTRAINT "SpeedReadingSession_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "SpeedReadingPassage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
