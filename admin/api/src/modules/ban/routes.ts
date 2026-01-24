import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errorData } from "../../lib/error-response";
import { normalizeRoomPath } from "../../lib/room-url";
import { requireAdminAuth } from "../../plugins/auth";

const getQuerySchema = z.object({
    ipAddress: z.string(),
    token: z.string(),
    roomUrl: z.string(),
});

const postBodySchema = z.object({
    uuidToBan: z.string(),
    playUri: z.string(),
    name: z.string(),
    message: z.string(),
    byUserUuid: z.string(),
});

const listQuerySchema = z.object({
    worldSlug: z.string().optional(),
    activeOnly: z.string().optional(),
    take: z.coerce.number().default(50),
    skip: z.coerce.number().default(0),
});

export async function banRoutes(app: FastifyInstance) {
    app.get("/bans", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = listQuerySchema.parse(request.query);
        const activeOnly = query.activeOnly === undefined || query.activeOnly === "true" || query.activeOnly === "1";
        const now = new Date();
        const where = {
            ...(query.worldSlug ? { world: { slug: query.worldSlug } } : {}),
            ...(activeOnly ? { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } : {}),
        };

        const [total, bans] = await Promise.all([
            app.db.ban.count({ where }),
            app.db.ban.findMany({
                where,
                include: { world: true, createdByMember: true },
                orderBy: { createdAt: "desc" },
                take: query.take,
                skip: query.skip,
            }),
        ]);

        reply.send({
            total,
            bans: bans.map((ban) => ({
                id: ban.id,
                worldSlug: ban.world.slug,
                targetIdentifier: ban.targetIdentifier,
                reason: ban.reason ?? null,
                expiresAt: ban.expiresAt ? ban.expiresAt.toISOString() : null,
                createdAt: ban.createdAt.toISOString(),
                createdBy: ban.createdByMember
                    ? {
                          id: ban.createdByMember.externalId,
                          email: ban.createdByMember.email ?? null,
                      }
                    : null,
            })),
        });
    });

    app.get("/ban", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = getQuerySchema.parse(request.query);
        const roomPath = normalizeRoomPath(query.roomUrl);
        const room = await app.db.room.findUnique({
            where: { roomUrl: roomPath },
            include: { world: true },
        });

        if (!room) {
            reply.send({ is_banned: false, message: "" });
            return;
        }

        const now = new Date();
        const ban = await app.db.ban.findFirst({
            where: {
                worldId: room.worldId,
                AND: [
                    {
                        OR: [
                            { targetIdentifier: query.token },
                            { ipAddress: query.ipAddress },
                        ],
                    },
                    {
                        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                    },
                ],
            },
            orderBy: { createdAt: "desc" },
        });

        if (!ban) {
            reply.send({ is_banned: false, message: "" });
            return;
        }

        reply.send({ is_banned: true, message: ban.reason ?? "You are banned." });
    });

    app.post("/ban", { preHandler: requireAdminAuth }, async (request, reply) => {
        const body = postBodySchema.parse(request.body);
        const roomPath = normalizeRoomPath(body.playUri);
        const room = await app.db.room.findUnique({
            where: { roomUrl: roomPath },
            include: { world: true },
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

        let createdByMemberId: string | null = null;
        if (body.byUserUuid) {
            const member = await app.db.member.upsert({
                where: { externalId: body.byUserUuid },
                update: {},
                create: { externalId: body.byUserUuid },
            });
            createdByMemberId = member.id;
        }

        await app.db.ban.create({
            data: {
                worldId: room.worldId,
                targetIdentifier: body.uuidToBan,
                reason: body.message,
                createdByMemberId,
            },
        });

        reply.code(200).send(true);
    });
}
