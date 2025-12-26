-- CreateTable
CREATE TABLE "RedemptionCandidates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "candidates" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weekStart" DATETIME NOT NULL,
    "weekEnd" DATETIME NOT NULL,
    CONSTRAINT "RedemptionCandidates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RedemptionCandidates_userId_idx" ON "RedemptionCandidates"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionCandidates_userId_weekStart_key" ON "RedemptionCandidates"("userId", "weekStart");
