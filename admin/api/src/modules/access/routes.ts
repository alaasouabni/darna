import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errorData, unauthorizedData } from "../../lib/error-response";
import { buildApplications } from "../../lib/applications";
import { getCompanionDetails, getWokaDetails } from "../../lib/catalogs";
import { decodeAccessToken } from "../../lib/jwt";
import { normalizeRoomPath } from "../../lib/room-url";
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

export async function accessRoutes(app: FastifyInstance) {
    app.get("/room/access", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = querySchema.parse(request.query);
        const roomPath = normalizeRoomPath(query.playUri);

        const room = await app.db.room.findUnique({
            where: { roomUrl: roomPath },
            include: { world: true, tagsTable: true },
        });

        if (!room) {
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

        if (!room.isActive) {
            reply.code(403).send(
                unauthorizedData("This room is currently inactive.")
            );
            return;
        }

        const tokenUser = query.accessToken ? await decodeAccessToken(query.accessToken) : null;
        const externalId = tokenUser?.email ?? query.userIdentifier;
        const identifierEmail = externalId.includes("@") ? externalId : null;

        const member = await app.db.member.upsert({
            where: { externalId },
            update: {
                email: tokenUser?.email ?? identifierEmail ?? undefined,
                displayName: tokenUser?.name ?? tokenUser?.preferredUsername ?? undefined,
                chatId: query.chatID ?? undefined,
                lastSeenAt: new Date(),
                lastRoomUrl: room.roomUrl,
            },
            create: {
                externalId,
                email: tokenUser?.email ?? identifierEmail,
                displayName: tokenUser?.name ?? tokenUser?.preferredUsername ?? null,
                chatId: query.chatID ?? null,
                lastSeenAt: new Date(),
                lastRoomUrl: room.roomUrl,
            },
        });

        const memberTags = await app.db.memberTag.findMany({
            where: { memberId: member.id },
        });

        const tagSet = new Set<string>();
        tokenUser?.tags.forEach((tag) => tagSet.add(tag));
        memberTags.forEach((tag) => tagSet.add(tag.tag));

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
            username: tokenUser?.name ?? member.displayName ?? null,
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
            world: room.world.name ?? room.world.slug,
            chatID: query.chatID ?? member.chatId ?? undefined,
        });
    });
}
