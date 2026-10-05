CREATE TABLE "YouTubePlaylist" (
    "id" TEXT NOT NULL,
    "youtubePlaylistId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "channelTitle" TEXT,
    "thumbnailUrl" TEXT,
    "customImageUrl" TEXT,
    "imagePrompt" TEXT,
    "currentVideoId" TEXT,
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "currentSeconds" INTEGER NOT NULL DEFAULT 0,
    "status" "CourseStatus" NOT NULL DEFAULT 'ACTIVE',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "metadataSource" TEXT NOT NULL DEFAULT 'youtube-page',
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "YouTubePlaylist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "YouTubePlaylistItem" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "durationSeconds" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "watchedSeconds" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "YouTubePlaylistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YouTubePlaylist_youtubePlaylistId_key" ON "YouTubePlaylist"("youtubePlaylistId");
CREATE INDEX "YouTubePlaylist_status_updatedAt_idx" ON "YouTubePlaylist"("status", "updatedAt");
CREATE UNIQUE INDEX "YouTubePlaylistItem_playlistId_position_key" ON "YouTubePlaylistItem"("playlistId", "position");
CREATE INDEX "YouTubePlaylistItem_playlistId_youtubeVideoId_idx" ON "YouTubePlaylistItem"("playlistId", "youtubeVideoId");
CREATE INDEX "YouTubePlaylistItem_playlistId_completed_idx" ON "YouTubePlaylistItem"("playlistId", "completed");

ALTER TABLE "YouTubePlaylistItem"
ADD CONSTRAINT "YouTubePlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "YouTubePlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
