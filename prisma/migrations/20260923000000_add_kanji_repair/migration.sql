CREATE TABLE "KanjiRepairState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kanji" TEXT NOT NULL,
    "lastRepairedAt" TIMESTAMP(3) NOT NULL,
    "cooldownUntil" TIMESTAMP(3) NOT NULL,
    "repairCount" INTEGER NOT NULL DEFAULT 1,
    "lastRepairScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "performanceAtRepair" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KanjiRepairState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KanjiRepairState_userId_kanji_key" ON "KanjiRepairState"("userId", "kanji");
CREATE INDEX "KanjiRepairState_userId_cooldownUntil_idx" ON "KanjiRepairState"("userId", "cooldownUntil");

ALTER TABLE "KanjiRepairState"
ADD CONSTRAINT "KanjiRepairState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
