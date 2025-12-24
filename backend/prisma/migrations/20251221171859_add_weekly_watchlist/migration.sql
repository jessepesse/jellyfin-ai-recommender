-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movieProfile" TEXT,
    "tvProfile" TEXT
);

-- CreateTable
CREATE TABLE "Media" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "posterUrl" TEXT,
    "posterSourceUrl" TEXT,
    "overview" TEXT,
    "backdropUrl" TEXT,
    "backdropSourceUrl" TEXT,
    "voteAverage" REAL,
    "language" TEXT,
    "releaseYear" TEXT,
    "genres" TEXT,
    "keywords" TEXT,
    "director" TEXT,
    "topCast" TEXT,
    "tagline" TEXT,
    "similarIds" TEXT,
    "recommendationIds" TEXT,
    "enrichedAt" DATETIME
);

-- CreateTable
CREATE TABLE "UserMedia" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserMedia_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyWatchlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "movies" TEXT NOT NULL,
    "tvShows" TEXT NOT NULL,
    "tasteProfile" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weekStart" DATETIME NOT NULL,
    "weekEnd" DATETIME NOT NULL,
    CONSTRAINT "WeeklyWatchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SystemConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "jellyfinUrl" TEXT,
    "jellyseerrUrl" TEXT,
    "jellyseerrApiKey" TEXT,
    "geminiApiKey" TEXT,
    "geminiModel" TEXT NOT NULL DEFAULT 'gemini-3-flash-preview',
    "isConfigured" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_SystemConfig" ("geminiApiKey", "geminiModel", "id", "isConfigured", "jellyfinUrl", "jellyseerrApiKey", "jellyseerrUrl") SELECT "geminiApiKey", "geminiModel", "id", "isConfigured", "jellyfinUrl", "jellyseerrApiKey", "jellyseerrUrl" FROM "SystemConfig";
DROP TABLE "SystemConfig";
ALTER TABLE "new_SystemConfig" RENAME TO "SystemConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Media_tmdbId_key" ON "Media"("tmdbId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMedia_userId_mediaId_key" ON "UserMedia"("userId", "mediaId");

-- CreateIndex
CREATE INDEX "WeeklyWatchlist_userId_idx" ON "WeeklyWatchlist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyWatchlist_userId_weekStart_key" ON "WeeklyWatchlist"("userId", "weekStart");
