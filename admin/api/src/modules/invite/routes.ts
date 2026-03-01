import { randomBytes } from "crypto";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "../../config/env";
import { errorData } from "../../lib/error-response";
import { parseRoomPath } from "../../lib/room-url";
import { requireAdminAuth } from "../../plugins/auth";

const createInviteBody = z.object({
    playUri: z.string().url(),
    ttlHours: z.coerce.number().int().positive().max(24 * 30).optional(),
    maxUses: z.coerce.number().int().min(0).max(10000).optional(),
    allowedEmail: z.string().email().optional(),
    revokeExisting: z.boolean().optional(),
});

const tokenParams = z.object({
    token: z.string(),
});

const listInvitesQuery = z.object({
    worldSlug: z.string().optional(),
    roomUrl: z.string().optional(),
    status: z.enum(["all", "active", "expired", "revoked", "limit_reached"]).default("active"),
    take: z.coerce.number().int().min(1).max(500).default(100),
    skip: z.coerce.number().int().min(0).default(0),
});

function computeInviteStatus(invite: {
    revokedAt: Date | null;
    expiresAt: Date;
    maxUses: number | null;
    useCount: number;
}): "active" | "expired" | "revoked" | "limit_reached" {
    if (invite.revokedAt) {
        return "revoked";
    }
    if (invite.expiresAt <= new Date()) {
        return "expired";
    }
    if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
        return "limit_reached";
    }
    return "active";
}

function resolveCreatorExternalIds(auth: {
    kind: "service" | "user" | "anonymous";
    user?: { email?: string | null; subject: string };
}): string[] {
    if (auth.kind !== "user" || !auth.user) {
        return [];
    }
    const identifiers: string[] = [];
    if (auth.user.email && auth.user.email.trim()) {
        identifiers.push(auth.user.email.trim());
    }
    if (auth.user.subject && auth.user.subject.trim()) {
        identifiers.push(auth.user.subject.trim());
    }
    return Array.from(new Set(identifiers));
}

function getInviteUrl(invite: {
    token: string;
    room: { roomUrl: string } | null;
    world: { domain: string | null };
}): string | null {
    if (!invite.room?.roomUrl) {
        return null;
    }

    const worldDomain = invite.world.domain?.trim();
    if (!worldDomain) {
        return null;
    }

    return `https://${worldDomain}${invite.room.roomUrl}?invite=${invite.token}`;
}

export async function inviteRoutes(app: FastifyInstance) {
    app.get("/invites", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = listInvitesQuery.parse(request.query);

        const where: Prisma.InviteTokenWhereInput = {
            ...(query.worldSlug
                ? {
                      world: {
                          is: {
                              slug: query.worldSlug,
                          },
                      },
                  }
                : {}),
            ...(query.roomUrl
                ? {
                      room: {
                          is: {
                              roomUrl: query.roomUrl,
                          },
                      },
                  }
                : {}),
        };

        if (query.status === "revoked") {
            where.revokedAt = { not: null };
        } else if (query.status === "expired") {
            where.revokedAt = null;
            where.expiresAt = { lte: new Date() };
        } else if (query.status === "active" || query.status === "limit_reached") {
            where.revokedAt = null;
            where.expiresAt = { gt: new Date() };
        }

        const rows = await app.db.inviteToken.findMany({
            where,
            include: {
                world: {
                    select: {
                        slug: true,
                        name: true,
                        domain: true,
                    },
                },
                room: {
                    select: {
                        roomUrl: true,
                        slug: true,
                    },
                },
                createdByMember: {
                    select: {
                        id: true,
                        displayName: true,
                        email: true,
                        externalId: true,
                    },
                },
                usedByMember: {
                    select: {
                        id: true,
                        displayName: true,
                        email: true,
                        externalId: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        const filteredRows =
            query.status === "all"
                ? rows
                : rows.filter((invite) => computeInviteStatus(invite) === query.status);
        const total = filteredRows.length;
        const pagedRows = filteredRows.slice(query.skip, query.skip + query.take);

        reply.send({
            total,
            items: pagedRows.map((invite) => ({
                token: invite.token,
                status: computeInviteStatus(invite),
                inviteUrl: getInviteUrl(invite),
                worldSlug: invite.world.slug,
                worldName: invite.world.name,
                worldDomain: invite.world.domain,
                roomUrl: invite.room?.roomUrl ?? null,
                roomSlug: invite.room?.slug ?? null,
                allowedEmail: invite.allowedEmail,
                maxUses: invite.maxUses,
                useCount: invite.useCount,
                remainingUses:
                    invite.maxUses === null ? null : Math.max(invite.maxUses - invite.useCount, 0),
                expiresAt: invite.expiresAt.toISOString(),
                revokedAt: invite.revokedAt?.toISOString() ?? null,
                createdAt: invite.createdAt.toISOString(),
                lastUsedAt: invite.lastUsedAt?.toISOString() ?? null,
                createdBy: invite.createdByMember
                    ? {
                          id: invite.createdByMember.id,
                          displayName: invite.createdByMember.displayName,
                          email: invite.createdByMember.email,
                          externalId: invite.createdByMember.externalId,
                      }
                    : null,
                usedBy: invite.usedByMember
                    ? {
                          id: invite.usedByMember.id,
                          displayName: invite.usedByMember.displayName,
                          email: invite.usedByMember.email,
                          externalId: invite.usedByMember.externalId,
                      }
                    : null,
            })),
        });
    });

    app.post("/invites", { preHandler: requireAdminAuth }, async (request, reply) => {
        const body = createInviteBody.parse(request.body);
        const parsed = parseRoomPath(body.playUri);

        const room = await app.db.room.findUnique({
            where: { roomUrl: parsed.path },
            include: {
                world: {
                    select: {
                        id: true,
                        slug: true,
                        name: true,
                    },
                },
            },
        });

        if (!room) {
            reply.code(404).send(
                errorData(
                    "ROOM_NOT_FOUND",
                    "Room not found",
                    "Unable to create invite",
                    `No managed room found for path ${parsed.path}.`
                )
            );
            return;
        }

        const ttlHours = body.ttlHours ?? config.INVITE_DEFAULT_TTL_HOURS;
        const maxUses = body.maxUses === 0 ? null : body.maxUses ?? config.INVITE_DEFAULT_MAX_USES;
        const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
        const allowedEmail = body.allowedEmail?.trim().toLowerCase() || null;

        let createdByMemberId: string | null = null;
        const creatorIds = resolveCreatorExternalIds(request.adminAuth);
        if (creatorIds.length > 0) {
            const creator = await app.db.member.findFirst({
                where: {
                    externalId: {
                        in: creatorIds,
                    },
                },
                select: { id: true },
            });
            createdByMemberId = creator?.id ?? null;
        }

        if (body.revokeExisting) {
            await app.db.inviteToken.updateMany({
                where: {
                    worldId: room.worldId,
                    roomId: room.id,
                    revokedAt: null,
                    expiresAt: { gt: new Date() },
                },
                data: {
                    revokedAt: new Date(),
                },
            });
        }

        let invite = null as
            | {
                  token: string;
                  expiresAt: Date;
                  maxUses: number | null;
              }
            | null;

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const token = randomBytes(32).toString("base64url");
            try {
                invite = await app.db.inviteToken.create({
                    data: {
                        token,
                        worldId: room.worldId,
                        roomId: room.id,
                        createdByMemberId,
                        allowedEmail,
                        maxUses,
                        expiresAt,
                    },
                    select: {
                        token: true,
                        expiresAt: true,
                        maxUses: true,
                    },
                });
                break;
            } catch (error) {
                if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
                    throw error;
                }
            }
        }

        if (!invite) {
            reply.code(500).send(
                errorData(
                    "INVITE_CREATION_FAILED",
                    "Invite creation failed",
                    "Unable to issue invite token",
                    "Could not generate a unique invitation token."
                )
            );
            return;
        }

        const inviteUrl = new URL(body.playUri);
        inviteUrl.searchParams.set("invite", invite.token);

        reply.send({
            token: invite.token,
            inviteUrl: inviteUrl.toString(),
            expiresAt: invite.expiresAt.toISOString(),
            maxUses: invite.maxUses,
            roomUrl: room.roomUrl,
            worldSlug: room.world.slug,
            worldName: room.world.name,
        });
    });

    app.get("/invites/:token/preview", async (request, reply) => {
        const params = tokenParams.parse(request.params);

        const invite = await app.db.inviteToken.findUnique({
            where: { token: params.token },
            include: {
                world: {
                    select: {
                        slug: true,
                        name: true,
                    },
                },
                room: {
                    select: {
                        roomUrl: true,
                        slug: true,
                    },
                },
            },
        });

        if (!invite) {
            reply.code(404).send(
                errorData(
                    "INVITE_NOT_FOUND",
                    "Invite not found",
                    "Invalid invitation",
                    "The invitation token is invalid."
                )
            );
            return;
        }

        const status = computeInviteStatus(invite);
        reply.send({
            status,
            expiresAt: invite.expiresAt.toISOString(),
            maxUses: invite.maxUses,
            useCount: invite.useCount,
            remainingUses: invite.maxUses === null ? null : Math.max(invite.maxUses - invite.useCount, 0),
            worldSlug: invite.world.slug,
            worldName: invite.world.name,
            roomUrl: invite.room?.roomUrl ?? null,
            roomSlug: invite.room?.slug ?? null,
        });
    });

    app.post("/invites/:token/revoke", { preHandler: requireAdminAuth }, async (request, reply) => {
        const params = tokenParams.parse(request.params);
        const now = new Date();

        const result = await app.db.inviteToken.updateMany({
            where: {
                token: params.token,
                revokedAt: null,
            },
            data: {
                revokedAt: now,
            },
        });

        if (result.count === 0) {
            reply.code(404).send(
                errorData(
                    "INVITE_NOT_FOUND",
                    "Invite not found",
                    "Unable to revoke invite",
                    "The invitation token does not exist or is already revoked."
                )
            );
            return;
        }

        reply.send({
            revoked: true,
            revokedAt: now.toISOString(),
        });
    });
}
