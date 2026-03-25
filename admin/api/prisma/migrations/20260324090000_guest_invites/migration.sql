-- CreateEnum
CREATE TYPE "InviteMode" AS ENUM ('member_onboarding', 'guest_access');

-- CreateEnum
CREATE TYPE "InviteUsageCountMode" AS ENUM ('unique_guest', 'every_claim');

-- AlterTable
ALTER TABLE "InviteToken"
ADD COLUMN "mode" "InviteMode" NOT NULL DEFAULT 'member_onboarding',
ADD COLUMN "usageCountMode" "InviteUsageCountMode" NOT NULL DEFAULT 'unique_guest';

-- AlterTable
ALTER TABLE "Member"
ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "guestExpiresAt" TIMESTAMP(3),
ADD COLUMN "disabledAt" TIMESTAMP(3),
ADD COLUMN "inviteTokenId" TEXT;

-- CreateTable
CREATE TABLE "InviteRedemption" (
    "id" TEXT NOT NULL,
    "inviteTokenId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "continuityHash" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceIp" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "InviteRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "inviteTokenId" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InviteRedemption_inviteTokenId_memberId_key" ON "InviteRedemption"("inviteTokenId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "InviteRedemption_inviteTokenId_continuityHash_key" ON "InviteRedemption"("inviteTokenId", "continuityHash");

-- CreateIndex
CREATE INDEX "InviteRedemption_inviteTokenId_claimedAt_idx" ON "InviteRedemption"("inviteTokenId", "claimedAt");

-- CreateIndex
CREATE INDEX "InviteRedemption_memberId_idx" ON "InviteRedemption"("memberId");

-- CreateIndex
CREATE INDEX "GuestSession_memberId_expiresAt_idx" ON "GuestSession"("memberId", "expiresAt");

-- CreateIndex
CREATE INDEX "GuestSession_expiresAt_idx" ON "GuestSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Member_isGuest_guestExpiresAt_idx" ON "Member"("isGuest", "guestExpiresAt");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_inviteTokenId_fkey" FOREIGN KEY ("inviteTokenId") REFERENCES "InviteToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteRedemption" ADD CONSTRAINT "InviteRedemption_inviteTokenId_fkey" FOREIGN KEY ("inviteTokenId") REFERENCES "InviteToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteRedemption" ADD CONSTRAINT "InviteRedemption_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_inviteTokenId_fkey" FOREIGN KEY ("inviteTokenId") REFERENCES "InviteToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
