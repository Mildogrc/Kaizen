-- CreateEnum
CREATE TYPE "CourseCategory" AS ENUM ('LANGUAGE', 'MATH', 'CERTIFICATION', 'BOOK', 'SKILL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CourseTab" AS ENUM ('JAPANESE', 'CHINESE', 'MATH', 'SKILLS', 'BOOKS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('ACTIVE', 'PLANNED', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'PLANNED', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'BOOLEAN', 'ENUM', 'LIST', 'OBJECT', 'AUDIO', 'IMAGE', 'MARKDOWN', 'CODE', 'LATEX', 'JSON', 'DATE', 'URL');

-- CreateEnum
CREATE TYPE "PracticeType" AS ENUM ('FLASHCARD', 'CLOZE', 'RECOGNITION', 'PRODUCTION', 'MULTIPLE_CHOICE', 'FREE_RECALL', 'FILL_BLANK', 'TYPING_DRILL', 'MATCHING', 'ORDERING', 'PROOF_RECONSTRUCTION', 'PROBLEM_SOLVING', 'MISTAKE_REVIEW');

-- CreateEnum
CREATE TYPE "ReviewRating" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');

-- CreateEnum
CREATE TYPE "CardMaturity" AS ENUM ('NEW', 'LEARNING', 'YOUNG', 'MATURE');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "NodeLevel" AS ENUM ('FOUNDATION', 'CORE', 'ADVANCED', 'TARGET');

-- CreateEnum
CREATE TYPE "EdgeKind" AS ENUM ('PREREQUISITE', 'APPLICATION');

-- CreateEnum
CREATE TYPE "BookStatus" AS ENUM ('WANT_TO_READ', 'READING', 'FINISHED', 'PAUSED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "BookNoteKind" AS ENUM ('NOTE', 'QUOTE', 'SUMMARY', 'IDEA', 'CHARACTER', 'ARGUMENT', 'DEFINITION', 'FORMULA', 'PASSAGE', 'REFLECTION');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'VALIDATED', 'PARTIAL', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "CourseCategory" NOT NULL,
    "tab" "CourseTab" NOT NULL,
    "status" "CourseStatus" NOT NULL DEFAULT 'ACTIVE',
    "color" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseGoal" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "goalType" TEXT NOT NULL DEFAULT 'custom',
    "targetValue" INTEGER,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "targetDate" TIMESTAMP(3),
    "examLevelId" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoursePlan" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "goalId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoursePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseMilestone" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "planId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "metric" TEXT,
    "targetValue" INTEGER,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSchema" (
    "id" TEXT NOT NULL,
    "courseId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "category" "CourseCategory" NOT NULL DEFAULT 'CUSTOM',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentSchema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSchemaVersion" (
    "id" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentSchemaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSchemaField" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "fieldType" "FieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "validationRules" JSONB NOT NULL DEFAULT '{}',
    "enumOptions" JSONB,
    "exampleValue" JSONB,
    "defaultValue" JSONB,
    "importInstructions" TEXT,
    "llmInstructions" TEXT,

    CONSTRAINT "ContentSchemaField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningItem" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "schemaId" TEXT,
    "schemaVersionId" TEXT,
    "itemType" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "roadmapNodeId" TEXT,
    "sourceId" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeItem" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "learningItemId" TEXT,
    "roadmapNodeId" TEXT,
    "type" "PracticeType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flashcard" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "learningItemId" TEXT,
    "bookNoteId" TEXT,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flashcard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRecord" (
    "id" TEXT NOT NULL,
    "flashcardId" TEXT,
    "practiceItemId" TEXT,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapseCount" INTEGER NOT NULL DEFAULT 0,
    "lastRating" "ReviewRating",
    "lastReviewedAt" TIMESTAMP(3),
    "maturity" "CardMaturity" NOT NULL DEFAULT 'NEW',
    "isLeech" BOOLEAN NOT NULL DEFAULT false,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "flashcardId" TEXT,
    "practiceItemId" TEXT,
    "sessionId" TEXT,
    "rating" "ReviewRating",
    "correct" BOOLEAN,
    "answerGiven" TEXT,
    "timeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mistake" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "practiceItemId" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mistake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL DEFAULT 'balanced',
    "durationMin" INTEGER,
    "stats" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "schemaVersionId" TEXT,
    "sourceName" TEXT,
    "format" TEXT NOT NULL DEFAULT 'json',
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Roadmap" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Roadmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadmapNode" (
    "id" TEXT NOT NULL,
    "roadmapId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "branch" TEXT,
    "level" "NodeLevel" NOT NULL DEFAULT 'CORE',
    "isTarget" BOOLEAN NOT NULL DEFAULT false,
    "status" "NodeStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "RoadmapNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadmapEdge" (
    "id" TEXT NOT NULL,
    "roadmapId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "kind" "EdgeKind" NOT NULL DEFAULT 'PREREQUISITE',

    CONSTRAINT "RoadmapEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "category" TEXT,
    "status" "BookStatus" NOT NULL DEFAULT 'WANT_TO_READ',
    "startDate" TIMESTAMP(3),
    "finishDate" TIMESTAMP(3),
    "rating" INTEGER,
    "sourceLanguage" TEXT,
    "relatedCourseId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookNote" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "kind" "BookNoteKind" NOT NULL DEFAULT 'NOTE',
    "content" TEXT NOT NULL,
    "location" TEXT,
    "remember" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamLevel" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "description" TEXT,
    "targets" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ExamLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamObjective" (
    "id" TEXT NOT NULL,
    "examLevelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "targetCount" INTEGER,
    "description" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExamObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_LearningItemToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LearningItemToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_FlashcardToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FlashcardToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_BookToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BookToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");

-- CreateIndex
CREATE INDEX "CourseGoal_courseId_status_idx" ON "CourseGoal"("courseId", "status");

-- CreateIndex
CREATE INDEX "CourseMilestone_courseId_order_idx" ON "CourseMilestone"("courseId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ContentSchema_slug_key" ON "ContentSchema"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ContentSchemaVersion_schemaId_version_key" ON "ContentSchemaVersion"("schemaId", "version");

-- CreateIndex
CREATE INDEX "ContentSchemaField_versionId_order_idx" ON "ContentSchemaField"("versionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ContentSchemaField_versionId_name_key" ON "ContentSchemaField"("versionId", "name");

-- CreateIndex
CREATE INDEX "LearningItem_courseId_itemType_idx" ON "LearningItem"("courseId", "itemType");

-- CreateIndex
CREATE INDEX "PracticeItem_courseId_type_idx" ON "PracticeItem"("courseId", "type");

-- CreateIndex
CREATE INDEX "Flashcard_courseId_idx" ON "Flashcard"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRecord_flashcardId_key" ON "ReviewRecord"("flashcardId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRecord_practiceItemId_key" ON "ReviewRecord"("practiceItemId");

-- CreateIndex
CREATE INDEX "ReviewRecord_dueAt_isSuspended_idx" ON "ReviewRecord"("dueAt", "isSuspended");

-- CreateIndex
CREATE INDEX "Attempt_createdAt_idx" ON "Attempt"("createdAt");

-- CreateIndex
CREATE INDEX "Mistake_courseId_resolved_idx" ON "Mistake"("courseId", "resolved");

-- CreateIndex
CREATE INDEX "StudySession_date_idx" ON "StudySession"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Roadmap_slug_key" ON "Roadmap"("slug");

-- CreateIndex
CREATE INDEX "RoadmapNode_roadmapId_branch_idx" ON "RoadmapNode"("roadmapId", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "RoadmapNode_roadmapId_slug_key" ON "RoadmapNode"("roadmapId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "RoadmapEdge_fromNodeId_toNodeId_kind_key" ON "RoadmapEdge"("fromNodeId", "toNodeId", "kind");

-- CreateIndex
CREATE INDEX "Book_status_idx" ON "Book"("status");

-- CreateIndex
CREATE INDEX "BookNote_bookId_kind_idx" ON "BookNote"("bookId", "kind");

-- CreateIndex
CREATE INDEX "BookNote_remember_idx" ON "BookNote"("remember");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_slug_key" ON "Exam"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ExamLevel_examId_rank_key" ON "ExamLevel"("examId", "rank");

-- CreateIndex
CREATE INDEX "ExamObjective_examLevelId_idx" ON "ExamObjective"("examLevelId");

-- CreateIndex
CREATE INDEX "_LearningItemToTag_B_index" ON "_LearningItemToTag"("B");

-- CreateIndex
CREATE INDEX "_FlashcardToTag_B_index" ON "_FlashcardToTag"("B");

-- CreateIndex
CREATE INDEX "_BookToTag_B_index" ON "_BookToTag"("B");

-- AddForeignKey
ALTER TABLE "CourseGoal" ADD CONSTRAINT "CourseGoal_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseGoal" ADD CONSTRAINT "CourseGoal_examLevelId_fkey" FOREIGN KEY ("examLevelId") REFERENCES "ExamLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePlan" ADD CONSTRAINT "CoursePlan_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePlan" ADD CONSTRAINT "CoursePlan_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "CourseGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMilestone" ADD CONSTRAINT "CourseMilestone_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMilestone" ADD CONSTRAINT "CourseMilestone_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CoursePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentSchema" ADD CONSTRAINT "ContentSchema_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentSchemaVersion" ADD CONSTRAINT "ContentSchemaVersion_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "ContentSchema"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentSchemaField" ADD CONSTRAINT "ContentSchemaField_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentSchemaVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "ContentSchema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_schemaVersionId_fkey" FOREIGN KEY ("schemaVersionId") REFERENCES "ContentSchemaVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_roadmapNodeId_fkey" FOREIGN KEY ("roadmapNodeId") REFERENCES "RoadmapNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_learningItemId_fkey" FOREIGN KEY ("learningItemId") REFERENCES "LearningItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_roadmapNodeId_fkey" FOREIGN KEY ("roadmapNodeId") REFERENCES "RoadmapNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_learningItemId_fkey" FOREIGN KEY ("learningItemId") REFERENCES "LearningItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_bookNoteId_fkey" FOREIGN KEY ("bookNoteId") REFERENCES "BookNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_practiceItemId_fkey" FOREIGN KEY ("practiceItemId") REFERENCES "PracticeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_practiceItemId_fkey" FOREIGN KEY ("practiceItemId") REFERENCES "PracticeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mistake" ADD CONSTRAINT "Mistake_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mistake" ADD CONSTRAINT "Mistake_practiceItemId_fkey" FOREIGN KEY ("practiceItemId") REFERENCES "PracticeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_schemaVersionId_fkey" FOREIGN KEY ("schemaVersionId") REFERENCES "ContentSchemaVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roadmap" ADD CONSTRAINT "Roadmap_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadmapNode" ADD CONSTRAINT "RoadmapNode_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "Roadmap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadmapEdge" ADD CONSTRAINT "RoadmapEdge_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "Roadmap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadmapEdge" ADD CONSTRAINT "RoadmapEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "RoadmapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadmapEdge" ADD CONSTRAINT "RoadmapEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "RoadmapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_relatedCourseId_fkey" FOREIGN KEY ("relatedCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookNote" ADD CONSTRAINT "BookNote_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamLevel" ADD CONSTRAINT "ExamLevel_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamObjective" ADD CONSTRAINT "ExamObjective_examLevelId_fkey" FOREIGN KEY ("examLevelId") REFERENCES "ExamLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LearningItemToTag" ADD CONSTRAINT "_LearningItemToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "LearningItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LearningItemToTag" ADD CONSTRAINT "_LearningItemToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FlashcardToTag" ADD CONSTRAINT "_FlashcardToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FlashcardToTag" ADD CONSTRAINT "_FlashcardToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookToTag" ADD CONSTRAINT "_BookToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookToTag" ADD CONSTRAINT "_BookToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
