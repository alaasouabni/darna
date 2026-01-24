-- CreateTable
CREATE TABLE "World" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "defaultRoomId" TEXT,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "roomUrl" TEXT NOT NULL,
    "mapUrl" TEXT,
    "wamUrl" TEXT,
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "visitCardUrl" TEXT,
    "chatId" TEXT,
    "characterTextureIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companionTextureId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastRoomUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberTag" (
    "memberId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "MemberTag_pkey" PRIMARY KEY ("memberId","tag")
);

-- CreateTable
CREATE TABLE "WorldTag" (
    "worldId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "WorldTag_pkey" PRIMARY KEY ("worldId","tag")
);

-- CreateTable
CREATE TABLE "RoomTag" (
    "roomId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "RoomTag_pkey" PRIMARY KEY ("roomId","tag")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "reportedMemberId" TEXT NOT NULL,
    "reporterMemberId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ban" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "targetIdentifier" TEXT NOT NULL,
    "ipAddress" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ban_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WokaCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "worldId" TEXT,

    CONSTRAINT "WokaCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WokaTexture" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tintable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WokaTexture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanionCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "worldId" TEXT,

    CONSTRAINT "CompanionCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanionTexture" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "behavior" TEXT,

    CONSTRAINT "CompanionTexture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivekitConfig" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,

    CONSTRAINT "LivekitConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IceConfig" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "stunUrls" TEXT[],
    "turnUrls" TEXT[],
    "turnUser" TEXT,
    "turnPassword" TEXT,
    "turnStaticAuthSecret" TEXT,

    CONSTRAINT "IceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "World_slug_key" ON "World"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Room_roomUrl_key" ON "Room"("roomUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Member_externalId_key" ON "Member"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "LoginToken_token_key" ON "LoginToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "LivekitConfig_worldId_key" ON "LivekitConfig"("worldId");

-- CreateIndex
CREATE UNIQUE INDEX "IceConfig_worldId_key" ON "IceConfig"("worldId");

-- AddForeignKey
ALTER TABLE "World" ADD CONSTRAINT "World_defaultRoomId_fkey" FOREIGN KEY ("defaultRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTag" ADD CONSTRAINT "MemberTag_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldTag" ADD CONSTRAINT "WorldTag_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomTag" ADD CONSTRAINT "RoomTag_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedMemberId_fkey" FOREIGN KEY ("reportedMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterMemberId_fkey" FOREIGN KEY ("reporterMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginToken" ADD CONSTRAINT "LoginToken_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginToken" ADD CONSTRAINT "LoginToken_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WokaTexture" ADD CONSTRAINT "WokaTexture_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "WokaCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanionTexture" ADD CONSTRAINT "CompanionTexture_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CompanionCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivekitConfig" ADD CONSTRAINT "LivekitConfig_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IceConfig" ADD CONSTRAINT "IceConfig_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
