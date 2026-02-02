import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errorData, unauthorizedData } from "../../lib/error-response";
import { buildApplications } from "../../lib/applications";
import { getCompanionDetails, getWokaDetails } from "../../lib/catalogs";
import { decodeAccessToken } from "../../lib/jwt";
import { normalizeRoomPath, parseRoomPath } from "../../lib/room-url";
import { config } from "../../config/env";
import { requireAdminAuth } from "../../plugins/auth";

const querySchema = z.object({
    userIdentifier: z.string(),
    accessToken: z.string().optional(),
    playUri: z.string(),
    ipAddress: z.string(),
    characterTextureIds: z.union([z.string(), z.array(z.string())]).optional(),
    companionTextureId: z.string().optional(),
    chatID: z.string().optional(),
});

function normalizeArray(value?: string | string[]): string[] {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function extractMapStorageSlug(path: string): string | null {
    const segments = normalizeRoomPath(path).split("/").filter(Boolean);
    if (segments[0] !== "~") {
        return null;
    }
    return segments[1] ?? null;
}

export async function accessRoutes(app: FastifyInstance) {
    app.get("/room/access", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = querySchema.parse(request.query);
        const parsedRoom = parseRoomPath(query.playUri);
        const roomPath = parsedRoom.path;

        const room = await app.db.room.findUnique({
            where: { roomUrl: roomPath },
            include: { world: true, tagsTable: true },
        });

        const mapStorageSlug = parsedRoom.kind === "map-storage" ? extractMapStorageSlug(roomPath) : null;
        const mapStorageWorld = mapStorageSlug
            ? await app.db.world.findUnique({ where: { slug: mapStorageSlug } })
            : null;

        if (!room && parsedRoom.kind !== "map-storage") {
            reply.code(404).send(
                errorData(
                    "ROOM_NOT_FOUND",
                    "Room not found",
                    "The requested room does not exist.",
                    `No room found for path ${roomPath}.`
                )
            );
            return;
        }

        if (room && !room.isActive) {
            reply.code(403).send(
                unauthorizedData("This room is currently inactive.")
            );
            return;
        }

        const tokenUser = query.accessToken ? await decodeAccessToken(query.accessToken) : null;
        const tokenExpiresAt =
            tokenUser?.claims?.exp && Number.isFinite(tokenUser.claims.exp)
                ? Number(tokenUser.claims.exp)
                : null;
        const tokenExpired = tokenExpiresAt !== null ? tokenExpiresAt < Math.floor(Date.now() / 1000) : false;

        if (config.DISABLE_ANONYMOUS) {
            if (!tokenUser || tokenExpired || !tokenUser.email) {
                reply.code(401).send(
                    unauthorizedData("Authentication required. Please sign in again.")
                );
                return;
            }
        }

        const externalId = (tokenUser?.email ?? query.userIdentifier).trim();
        if (!externalId || externalId === "-") {
            reply.code(401).send(
                unauthorizedData("Authentication required. Please sign in again.")
            );
            return;
        }

        const identifierEmail = externalId.includes("@") ? externalId : null;

        const now = new Date();
        const banWorldId = room?.worldId ?? mapStorageWorld?.id ?? null;
        const ban = banWorldId
            ? await app.db.ban.findFirst({
                  where: {
                      worldId: banWorldId,
                      AND: [
                          {
                              OR: [
                                  { targetIdentifier: externalId },
                                  ...(query.ipAddress ? [{ ipAddress: query.ipAddress }] : []),
                              ],
                          },
                          {
                              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                          },
                      ],
                  },
                  orderBy: { createdAt: "desc" },
              })
            : null;

        if (ban) {
            reply.code(403).send(
                unauthorizedData(ban.reason ?? "You are banned.")
            );
            return;
        }

        const existingMember = await app.db.member.findUnique({ where: { externalId } });
        const displayNameFromToken = tokenUser?.name ?? tokenUser?.preferredUsername ?? null;

        const updateData: Record<string, unknown> = {
            email: tokenUser?.email ?? identifierEmail ?? undefined,
            chatId: query.chatID ?? undefined,
            lastSeenAt: new Date(),
            lastRoomUrl: room?.roomUrl ?? roomPath,
        };

        if (existingMember?.displayName == null && displayNameFromToken) {
            updateData.displayName = displayNameFromToken;
        }

        const member = existingMember
            ? await app.db.member.update({
                  where: { externalId },
                  data: updateData,
              })
            : await app.db.member.create({
                  data: {
                      externalId,
                      email: tokenUser?.email ?? identifierEmail,
                      displayName: displayNameFromToken,
                      chatId: query.chatID ?? null,
                      lastSeenAt: new Date(),
                      lastRoomUrl: room?.roomUrl ?? roomPath,
                  },
              });

        if (tokenUser?.tags.length) {
            await app.db.memberTag.createMany({
                data: tokenUser.tags.map((tag) => ({
                    memberId: member.id,
                    tag,
                })),
                skipDuplicates: true,
            });
        }

        const memberTags = await app.db.memberTag.findMany({
            where: { memberId: member.id },
        });

        const tagSet = new Set<string>();
        tokenUser?.tags.forEach((tag) => tagSet.add(tag));
        memberTags.forEach((tag) => tagSet.add(tag.tag));

        if (room) {
            const roomTags = new Set<string>(room.tags);
            room.tagsTable.forEach((tag) => roomTags.add(tag.tag));

            if (roomTags.size > 0) {
                const hasAccess = Array.from(roomTags).some((tag) => tagSet.has(tag));
                if (!hasAccess) {
                    reply.code(403).send(
                        unauthorizedData("You do not have the required tags to access this room.")
                    );
                    return;
                }
            }
        }

        const canEdit =
            config.ENABLE_MAP_EDITOR &&
            (config.MAP_EDITOR_ALLOW_ALL_USERS ||
                config.mapEditorAllowedUsers.includes(externalId) ||
                tagSet.has("admin") ||
                tagSet.has("editor"));

        const requestedTextures = normalizeArray(query.characterTextureIds);
        const resolvedTextures =
            requestedTextures.length > 0 ? requestedTextures : member.characterTextureIds;

        let characterTextures = resolvedTextures.length ? getWokaDetails(resolvedTextures) : undefined;
        const isCharacterTexturesValid = Boolean(characterTextures && characterTextures.length);
        if (!characterTextures) {
            characterTextures = [];
        }

        const requestedCompanion = query.companionTextureId ?? member.companionTextureId ?? undefined;
        const companionTexture = requestedCompanion ? getCompanionDetails(requestedCompanion) : undefined;
        const isCompanionTextureValid = requestedCompanion ? Boolean(companionTexture) : true;

        if (requestedTextures.length > 0 && isCharacterTexturesValid) {
            await app.db.member.update({
                where: { id: member.id },
                data: { characterTextureIds: requestedTextures },
            });
        }

        if (requestedCompanion && isCompanionTextureValid) {
            await app.db.member.update({
                where: { id: member.id },
                data: { companionTextureId: requestedCompanion },
            });
        }

        const fallbackEmail = externalId.includes("@") ? externalId : null;

        reply.send({
            status: "ok",
            email: tokenUser?.email ?? member.email ?? fallbackEmail,
            username: member.displayName ?? tokenUser?.name ?? null,
            userUuid: externalId,
            tags: Array.from(tagSet),
            visitCardUrl: member.visitCardUrl ?? null,
            isCharacterTexturesValid,
            characterTextures,
            isCompanionTextureValid,
            companionTexture,
            messages: [],
            userRoomToken: undefined,
            activatedInviteUser: true,
            applications: buildApplications(),
            canEdit,
            world:
                room?.world.name ??
                room?.world.slug ??
                mapStorageWorld?.name ??
                mapStorageWorld?.slug ??
                mapStorageSlug ??
                "unknown",
            chatID: query.chatID ?? member.chatId ?? undefined,
        });
    });
}
