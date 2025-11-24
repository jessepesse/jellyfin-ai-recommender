-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "jellyfinUrl" TEXT,
    "jellyseerrUrl" TEXT,
    "jellyseerrApiKey" TEXT,
    "geminiApiKey" TEXT,
    "geminiModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash-lite',
    "isConfigured" BOOLEAN NOT NULL DEFAULT false
);
