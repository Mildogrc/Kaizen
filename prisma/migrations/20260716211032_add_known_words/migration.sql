-- AlterTable
ALTER TABLE "AnkiDeckMapping" ADD COLUMN     "countsKnownWords" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "KnownWord" (
    "id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "reading" TEXT,
    "strictKey" TEXT NOT NULL,
    "looseKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnownWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownWordStat" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "language" TEXT NOT NULL,
    "lower" INTEGER NOT NULL,
    "upper" INTEGER NOT NULL,
    "migakuCount" INTEGER NOT NULL DEFAULT 0,
    "ankiCount" INTEGER NOT NULL DEFAULT 0,
    "manualCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KnownWordStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnownWord_language_looseKey_idx" ON "KnownWord"("language", "looseKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnownWord_language_source_strictKey_key" ON "KnownWord"("language", "source", "strictKey");

-- CreateIndex
CREATE INDEX "KnownWordStat_language_date_idx" ON "KnownWordStat"("language", "date");

-- CreateIndex
CREATE UNIQUE INDEX "KnownWordStat_date_language_key" ON "KnownWordStat"("date", "language");
