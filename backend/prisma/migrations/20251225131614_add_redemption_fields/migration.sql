-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserMedia" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "blockedAt" DATETIME,
    "permanentBlock" BOOLEAN NOT NULL DEFAULT false,
    "softBlockUntil" DATETIME,
    "redemptionAttempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UserMedia_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_UserMedia" ("id", "mediaId", "status", "updatedAt", "userId") SELECT "id", "mediaId", "status", "updatedAt", "userId" FROM "UserMedia";
DROP TABLE "UserMedia";
ALTER TABLE "new_UserMedia" RENAME TO "UserMedia";
CREATE UNIQUE INDEX "UserMedia_userId_mediaId_key" ON "UserMedia"("userId", "mediaId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
