CREATE TYPE "MandarinEntryKind" AS ENUM ('CHARACTER', 'WORD');

CREATE TABLE "MandarinBlueprintLevel" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "phase" INTEGER,
    "reportedNewCharacterCount" INTEGER NOT NULL,
    "reportedTotalCharacters" INTEGER NOT NULL,
    "reportedNewWordCount" INTEGER NOT NULL,
    "reportedTotalWords" INTEGER NOT NULL,
    "characters" JSONB NOT NULL DEFAULT '[]',
    "words" JSONB NOT NULL DEFAULT '[]',
    "sourceStats" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "pushError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MandarinBlueprintLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MandarinDictionaryEntry" (
    "id" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "kind" "MandarinEntryKind" NOT NULL,
    "traditional" TEXT,
    "pinyin" JSONB NOT NULL DEFAULT '[]',
    "definitions" JSONB NOT NULL DEFAULT '[]',
    "audioUrls" JSONB NOT NULL DEFAULT '[]',
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MandarinDictionaryEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MandarinBlueprintLevel_level_key" ON "MandarinBlueprintLevel"("level");
CREATE INDEX "MandarinBlueprintLevel_completedAt_idx" ON "MandarinBlueprintLevel"("completedAt");
CREATE INDEX "MandarinDictionaryEntry_kind_surface_idx" ON "MandarinDictionaryEntry"("kind", "surface");
CREATE UNIQUE INDEX "MandarinDictionaryEntry_surface_kind_key" ON "MandarinDictionaryEntry"("surface", "kind");
