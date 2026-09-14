-- CreateEnum
CREATE TYPE "TrackVerdict" AS ENUM ('CONFIRMED', 'FALSE_POSITIVE');

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "alt" DOUBLE PRECISION NOT NULL,
    "classification" TEXT,
    "timestampUs" DOUBLE PRECISION NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verdict" "TrackVerdict",
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "trackId" TEXT,
    "cameraId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Track_receivedAt_idx" ON "Track"("receivedAt");

-- CreateIndex
CREATE INDEX "Track_trackId_idx" ON "Track"("trackId");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");
