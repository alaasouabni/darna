import { createHash, randomBytes, randomUUID } from "crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "../../config/env";
import { errorData } from "../../lib/error-response";
import { parseRoomPath } from "../../lib/room-url";
import { requireAdminAuth, requireServiceAuth } from "../../plugins/auth";

const inviteModeSchema = z.enum(["member_onboarding", "guest_access"]);
const inviteUsageCountModeSchema = z.enum(["unique_guest", "every_claim"]);

const createInviteBody = z.object({
    playUri: z.string().url(),
    ttlHours: z.coerce.number().int().positive().max(24 * 30).optional(),
    expiresAt: z.string().datetime().optional(),
    maxUses: z.coerce.number().int().min(0).max(10000).optional(),
    guestSessionTtlHours: z.coerce.number().int().positive().max(24 * 30).optional(),
    guestSessionDeadlineAt: z.string().datetime().optional(),
    mode: inviteModeSchema.optional(),
    usageCountMode: inviteUsageCountModeSchema.optional(),
    allowedEmail: z.string().email().optional(),
    revokeExisting: z.boolean().optional(),
});

const tokenParams = z.object({
    token: z.string(),
});

const listInvitesQuery = z.object({
    worldSlug: z.string().optional(),
    roomUrl: z.string().optional(),
    mode: inviteModeSchema.optional(),
    status: z.enum(["all", "active", "expired", "revoked", "limit_reached"]).default("active"),
    take: z.coerce.number().int().min(1).max(500).default(100),
    skip: z.coerce.number().int().min(0).default(0),
});

const resolveInviteQuery = z.object({
    playUri: z.string().url().optional(),
});

const claimGuestBody = z.object({
    playUri: z.string().url(),
    nickname: z.string().trim().min(1).max(64).optional(),
    characterTextureIds: z.array(z.string()).max(32).optional(),
    companionTextureId: z.string().max(256).optional(),
    continuityToken: z.string().trim().min(16).max(256).optional(),
});

const refreshGuestBody = z.object({
    guestSessionId: z.string().uuid(),
    refreshToken: z.string().min(32),
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

const GUEST_SUFFIX = " (guest)";

function normalizeNickname(rawNickname: string): string {
    const sanitized = rawNickname.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
    const base = sanitized.replace(/\s*\(guest\)\s*$/i, "").trim().slice(0, 48);
    if (!base) {
        return `Guest-${randomUUID().slice(0, 8)}${GUEST_SUFFIX}`;
    }
    return `${base}${GUEST_SUFFIX}`;
}

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function generateOpaqueToken(byteLength = 48): string {
    return randomBytes(byteLength).toString("base64url");
}

function addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function resolveGuestSessionTtlHours(guestSessionTtlHours?: number | null): number {
    return guestSessionTtlHours ?? config.GUEST_SESSION_TTL_HOURS;
}

function resolveGuestSessionExpiresAt(args: {
    now: Date;
    guestSessionTtlHours?: number | null;
    guestSessionDeadlineAt?: Date | null;
}): Date {
    if (args.guestSessionDeadlineAt) {
        return args.guestSessionDeadlineAt;
    }
    return addHours(args.now, resolveGuestSessionTtlHours(args.guestSessionTtlHours));
}

type GuestClaimResult =
    | {
          ok: true;
          data: {
              userIdentifier: string;
              username: string | null;
              guestSessionId: string;
              refreshToken: string;
              inviteTokenId: string;
              worldSlug: string;
              roomUrl: string | null;
              expiresAt: string;
          };
      }
    | {
          ok: false;
          statusCode: number;
          code: string;
          details: string;
      };

function inviteError(statusCode: number, code: string, details: string): GuestClaimResult {
    return {
        ok: false,
        statusCode,
        code,
        details,
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise.finally(() => {
            if (timer) {
                clearTimeout(timer);
            }
        }),
        new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
    ]);
}

async function claimGuestInvite(args: {
    app: FastifyInstance;
    inviteToken: string;
    payload: z.infer<typeof claimGuestBody>;
    sourceIp?: string;
    userAgent?: string;
    logger?: FastifyBaseLogger;
}): Promise<GuestClaimResult> {
    const { app, inviteToken, payload, sourceIp, userAgent, logger } = args;
    const token = inviteToken.trim();
    if (!token) {
        return inviteError(400, "INVITE_INVALID", "The invitation token is missing or invalid.");
    }

    if (!config.INVITE_ONLY_GUEST_ENABLED) {
        return inviteError(403, "GUEST_INVITE_DISABLED", "Guest invite onboarding is currently disabled.");
    }

    const parsed = parseRoomPath(payload.playUri);
    const expectedRoomPath = parsed.path;
    const now = new Date();
    const normalizedNickname = payload.nickname ? normalizeNickname(payload.nickname) : null;
    const continuityToken = payload.continuityToken?.trim();
    const continuityHash = continuityToken ? hashToken(continuityToken) : null;
    const startedAt = Date.now();
    const logStep = (step: string, extra?: Record<string, unknown>) => {
        logger?.info({ step, elapsedMs: Date.now() - startedAt, ...extra }, "claim-guest");
    };
    const logStepError = (step: string, error: unknown, extra?: Record<string, unknown>) => {
        logger?.error({ step, elapsedMs: Date.now() - startedAt, error, ...extra }, "claim-guest");
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            logStep("attempt_start", { attempt: attempt + 1 });
            const invite = await app.db.inviteToken.findUnique({
                where: { token },
                include: {
                    world: {
                        select: {
                            slug: true,
                        },
                    },
                    room: {
                        select: {
                            roomUrl: true,
                        },
                    },
                },
            });
            logStep("invite_lookup_done", { attempt: attempt + 1, inviteFound: Boolean(invite) });

            if (!invite) {
                return inviteError(404, "INVITE_NOT_FOUND", "This invitation link is invalid.");
            }

            if (invite.mode !== "guest_access") {
                return inviteError(
                    403,
                    "INVITE_MODE_MISMATCH",
                    "This invitation link cannot be used for guest access."
                );
            }

            if (invite.revokedAt) {
                return inviteError(403, "INVITE_REVOKED", "This invitation link has been revoked.");
            }

            if (invite.expiresAt <= now) {
                return inviteError(403, "INVITE_EXPIRED", "This invitation link has expired.");
            }

            if (invite.room?.roomUrl && invite.room.roomUrl !== expectedRoomPath) {
                return inviteError(403, "INVITE_SCOPE_MISMATCH", "This invitation link is not valid for this room.");
            }

            if (invite.guestSessionDeadlineAt && invite.guestSessionDeadlineAt <= now) {
                return inviteError(
                    403,
                    "GUEST_SESSION_WINDOW_EXPIRED",
                    "This invitation no longer allows new guest sessions."
                );
            }

            const guestExpiresAt = resolveGuestSessionExpiresAt({
                now,
                guestSessionTtlHours: invite.guestSessionTtlHours,
                guestSessionDeadlineAt: invite.guestSessionDeadlineAt,
            });

            if (invite.usageCountMode === "unique_guest" && continuityHash) {
                const existingRedemption = await app.db.inviteRedemption.findUnique({
                    where: {
                        inviteTokenId_continuityHash: {
                            inviteTokenId: invite.id,
                            continuityHash,
                        },
                    },
                    select: {
                        member: {
                            select: {
                                id: true,
                                externalId: true,
                                displayName: true,
                                disabledAt: true,
                                guestExpiresAt: true,
                            },
                        },
                    },
                });
                logStep("existing_redemption_lookup_done", {
                    attempt: attempt + 1,
                    found: Boolean(existingRedemption?.member),
                });

                if (
                    existingRedemption?.member &&
                    !existingRedemption.member.disabledAt &&
                    (!existingRedemption.member.guestExpiresAt || existingRedemption.member.guestExpiresAt > now)
                ) {
                    const refreshToken = generateOpaqueToken();
                    const session = await app.db.guestSession.create({
                        data: {
                            memberId: existingRedemption.member.id,
                            inviteTokenId: invite.id,
                            refreshTokenHash: hashToken(refreshToken),
                            expiresAt: guestExpiresAt,
                            lastSeenAt: now,
                        },
                        select: {
                            id: true,
                        },
                    });
                    logStep("existing_guest_session_created", { attempt: attempt + 1 });

                    await app.db.member
                        .update({
                            where: { id: existingRedemption.member.id },
                            data: {
                                lastSeenAt: now,
                                guestExpiresAt,
                                lastRoomUrl: expectedRoomPath,
                            },
                        })
                        .catch(() => undefined);

                    await app.db.inviteRedemption
                        .updateMany({
                            where: {
                                inviteTokenId: invite.id,
                                memberId: existingRedemption.member.id,
                            },
                            data: {
                                lastSeenAt: now,
                                sourceIp: sourceIp ? sourceIp.slice(0, 128) : null,
                                userAgent: userAgent ? userAgent.slice(0, 512) : null,
                            },
                        })
                        .catch(() => undefined);

                    await app.db.inviteToken
                        .update({
                            where: { id: invite.id },
                            data: {
                                lastUsedAt: now,
                                usedByMemberId: existingRedemption.member.id,
                            },
                        })
                        .catch(() => undefined);
                    logStep("existing_guest_reused", { attempt: attempt + 1 });

                    return {
                        ok: true as const,
                        data: {
                            userIdentifier: existingRedemption.member.externalId,
                            username: existingRedemption.member.displayName ?? normalizedNickname,
                            guestSessionId: session.id,
                            refreshToken,
                            inviteTokenId: invite.id,
                            worldSlug: invite.world.slug,
                            roomUrl: invite.room?.roomUrl ?? null,
                            expiresAt: guestExpiresAt.toISOString(),
                        },
                    };
                }
            }

            if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
                return inviteError(
                    403,
                    "INVITE_LIMIT_REACHED",
                    "This invitation link reached its maximum number of uses."
                );
            }

            const inviteUpdateResult = await app.db.inviteToken.updateMany({
                where: {
                    id: invite.id,
                    revokedAt: null,
                    expiresAt: { gt: now },
                    useCount: invite.useCount,
                },
                data: {
                    useCount: { increment: 1 },
                    lastUsedAt: now,
                },
            });
            logStep("invite_counter_update_done", {
                attempt: attempt + 1,
                updatedRows: inviteUpdateResult.count,
            });

            if (inviteUpdateResult.count !== 1) {
                continue;
            }

            const member = await app.db.member.create({
                data: {
                    externalId: `guest:${invite.id}:${randomUUID()}`,
                    displayName: normalizedNickname,
                    characterTextureIds: payload.characterTextureIds ?? [],
                    companionTextureId: payload.companionTextureId ?? null,
                    isGuest: true,
                    guestExpiresAt,
                    inviteTokenId: invite.id,
                    lastSeenAt: now,
                    lastRoomUrl: expectedRoomPath,
                },
                select: {
                    id: true,
                    externalId: true,
                    displayName: true,
                },
            });
            logStep("guest_member_created", { attempt: attempt + 1, memberId: member.id });

            await app.db.inviteRedemption.create({
                data: {
                    inviteTokenId: invite.id,
                    memberId: member.id,
                    continuityHash: invite.usageCountMode === "unique_guest" ? continuityHash : null,
                    sourceIp: sourceIp ? sourceIp.slice(0, 128) : null,
                    userAgent: userAgent ? userAgent.slice(0, 512) : null,
                    claimedAt: now,
                    lastSeenAt: now,
                },
            });
            logStep("invite_redemption_created", { attempt: attempt + 1, memberId: member.id });

            const refreshToken = generateOpaqueToken();
            const session = await app.db.guestSession.create({
                data: {
                    memberId: member.id,
                    inviteTokenId: invite.id,
                    refreshTokenHash: hashToken(refreshToken),
                    expiresAt: guestExpiresAt,
                    lastSeenAt: now,
                },
                select: {
                    id: true,
                },
            });
            logStep("guest_session_created", { attempt: attempt + 1, sessionId: session.id });

            await app.db.inviteToken
                .update({
                    where: { id: invite.id },
                    data: { usedByMemberId: member.id },
                })
                .catch(() => undefined);
            logStep("invite_last_user_updated", { attempt: attempt + 1, memberId: member.id });

            return {
                ok: true as const,
                data: {
                    userIdentifier: member.externalId,
                    username: member.displayName ?? normalizedNickname,
                    guestSessionId: session.id,
                    refreshToken,
                    inviteTokenId: invite.id,
                    worldSlug: invite.world.slug,
                    roomUrl: invite.room?.roomUrl ?? null,
                    expiresAt: guestExpiresAt.toISOString(),
                },
            };
        } catch (error) {
            logStepError("attempt_failed", error, { attempt: attempt + 1 });
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                continue;
            }
            throw error;
        }
    }

    return inviteError(
        409,
        "INVITE_CONCURRENCY_CONFLICT",
        "This invitation is being consumed concurrently. Please retry in a moment."
    );
}

export async function inviteRoutes(app: FastifyInstance) {
    app.get("/invites/:token/resolve", { preHandler: requireServiceAuth }, async (request, reply) => {
        const params = tokenParams.parse(request.params);
        const query = resolveInviteQuery.parse(request.query);
        const invite = await app.db.inviteToken.findUnique({
            where: { token: params.token },
            select: {
                mode: true,
                revokedAt: true,
                expiresAt: true,
                maxUses: true,
                useCount: true,
                room: {
                    select: {
                        roomUrl: true,
                    },
                },
                world: {
                    select: {
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
                    "Unable to resolve invite",
                    "The invitation token does not exist."
                )
            );
            return;
        }

        const status = computeInviteStatus(invite);
        const expectedRoomUrl = invite.room?.roomUrl ?? null;
        const roomPathFromQuery = query.playUri ? parseRoomPath(query.playUri).path : null;
        const roomMatches = roomPathFromQuery && expectedRoomUrl ? roomPathFromQuery === expectedRoomUrl : null;

        reply.send({
            mode: invite.mode,
            status,
            roomUrl: expectedRoomUrl,
            worldSlug: invite.world.slug,
            roomMatches,
        });
    });

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
            ...(query.mode
                ? {
                      mode: query.mode,
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
                mode: invite.mode,
                usageCountMode: invite.usageCountMode,
                guestSessionTtlHours: invite.guestSessionTtlHours,
                guestSessionDeadlineAt: invite.guestSessionDeadlineAt?.toISOString() ?? null,
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
        const expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + ttlHours * 60 * 60 * 1000);
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
            reply.code(400).send(
                errorData(
                    "INVITE_INVALID_EXPIRY",
                    "Invalid expiration",
                    "Unable to create invite",
                    "The invitation expiration date must be in the future."
                )
            );
            return;
        }
        const mode = body.mode ?? "member_onboarding";
        const usageCountMode = body.usageCountMode ?? config.INVITE_DEFAULT_USAGE_COUNT_MODE;
        const guestSessionDeadlineAtRaw =
            mode === "guest_access" && body.guestSessionDeadlineAt ? new Date(body.guestSessionDeadlineAt) : null;
        if (
            guestSessionDeadlineAtRaw &&
            (!Number.isFinite(guestSessionDeadlineAtRaw.getTime()) || guestSessionDeadlineAtRaw <= new Date())
        ) {
            reply.code(400).send(
                errorData(
                    "INVITE_INVALID_GUEST_SESSION_DEADLINE",
                    "Invalid guest session deadline",
                    "Unable to create invite",
                    "Guest session deadline must be in the future."
                )
            );
            return;
        }
        if (mode === "guest_access" && guestSessionDeadlineAtRaw && body.guestSessionTtlHours !== undefined) {
            reply.code(400).send(
                errorData(
                    "INVITE_INVALID_GUEST_SESSION_POLICY",
                    "Invalid guest session policy",
                    "Unable to create invite",
                    "Set either guest session duration or deadline, not both."
                )
            );
            return;
        }
        const guestSessionTtlHours =
            mode === "guest_access" && !guestSessionDeadlineAtRaw
                ? body.guestSessionTtlHours ?? config.GUEST_SESSION_TTL_HOURS
                : null;
        const guestSessionDeadlineAt = mode === "guest_access" ? guestSessionDeadlineAtRaw : null;
        const allowedEmail = mode === "member_onboarding" ? body.allowedEmail?.trim().toLowerCase() || null : null;

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
                  mode: "member_onboarding" | "guest_access";
                  usageCountMode: "unique_guest" | "every_claim";
                  guestSessionTtlHours: number | null;
                  guestSessionDeadlineAt: Date | null;
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
                        mode,
                        usageCountMode,
                        guestSessionTtlHours,
                        guestSessionDeadlineAt,
                        expiresAt,
                    },
                    select: {
                        token: true,
                        expiresAt: true,
                        maxUses: true,
                        mode: true,
                        usageCountMode: true,
                        guestSessionTtlHours: true,
                        guestSessionDeadlineAt: true,
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
            mode: invite.mode,
            usageCountMode: invite.usageCountMode,
            guestSessionTtlHours: invite.guestSessionTtlHours,
            guestSessionDeadlineAt: invite.guestSessionDeadlineAt?.toISOString() ?? null,
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
            mode: invite.mode,
            usageCountMode: invite.usageCountMode,
            guestSessionTtlHours: invite.guestSessionTtlHours,
            guestSessionDeadlineAt: invite.guestSessionDeadlineAt?.toISOString() ?? null,
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

    app.post("/invites/:token/claim-guest", { preHandler: requireServiceAuth }, async (request, reply) => {
        request.log.info({ route: "claim-guest", stage: "handler_enter", url: request.url }, "claim-guest request");
        const params = tokenParams.parse(request.params);
        request.log.info({ route: "claim-guest", stage: "params_parsed", tokenPrefix: params.token.slice(0, 8) }, "claim-guest request");
        const body = claimGuestBody.parse(request.body);
        const sourceIp = request.headers["x-forwarded-for"]?.toString() ?? request.ip;
        const userAgent = request.headers["user-agent"]?.toString();
        request.log.info(
            {
                route: "claim-guest",
                tokenPrefix: params.token.slice(0, 8),
                hasContinuityToken: Boolean(body.continuityToken),
                hasCharacterTextures: Boolean(body.characterTextureIds?.length),
                hasCompanionTexture: Boolean(body.companionTextureId),
            },
            "claim-guest request"
        );

        const claimResult = await withTimeout(
            claimGuestInvite({
                app,
                inviteToken: params.token,
                payload: body,
                sourceIp,
                userAgent,
                logger: request.log,
            }),
            15000,
            "Timed out while claiming guest invite."
        ).catch((error) => {
            request.log.error({ error, route: "claim-guest", tokenPrefix: params.token.slice(0, 8) }, "claim-guest timeout");
            return inviteError(
                504,
                "INVITE_CLAIM_TIMEOUT",
                "Guest invite claim timed out. Please retry in a moment."
            );
        });

        if (!claimResult.ok) {
            reply
                .code(claimResult.statusCode)
                .send(
                    errorData(
                        claimResult.code,
                        "Invalid invitation",
                        "Unable to claim guest invite",
                        claimResult.details
                    )
                );
            return;
        }

        reply.send({
            userIdentifier: claimResult.data.userIdentifier,
            username: claimResult.data.username,
            guestSessionId: claimResult.data.guestSessionId,
            refreshToken: claimResult.data.refreshToken,
            inviteTokenId: claimResult.data.inviteTokenId,
            worldSlug: claimResult.data.worldSlug,
            roomUrl: claimResult.data.roomUrl,
            expiresAt: claimResult.data.expiresAt,
        });
    });

    app.post("/guest/refresh", { preHandler: requireServiceAuth }, async (request, reply) => {
        if (!config.INVITE_ONLY_GUEST_ENABLED) {
            reply
                .code(403)
                .send(
                    errorData(
                        "GUEST_INVITE_DISABLED",
                        "Guest access disabled",
                        "Unable to refresh guest session",
                        "Guest invite onboarding is currently disabled."
                    )
                );
            return;
        }

        const body = refreshGuestBody.parse(request.body);
        const now = new Date();
        const nextRefreshToken = generateOpaqueToken();
        const nextRefreshTokenHash = hashToken(nextRefreshToken);
        const currentRefreshTokenHash = hashToken(body.refreshToken);
        const sessionTtlSource = await app.db.guestSession.findUnique({
            where: { id: body.guestSessionId },
            select: {
                inviteToken: {
                    select: {
                        guestSessionTtlHours: true,
                        guestSessionDeadlineAt: true,
                    },
                },
            },
        });
        if (
            sessionTtlSource?.inviteToken?.guestSessionDeadlineAt &&
            sessionTtlSource.inviteToken.guestSessionDeadlineAt <= now
        ) {
            reply
                .code(403)
                .send(
                    errorData(
                        "GUEST_EXPIRED",
                        "Guest access expired",
                        "Unable to refresh guest session",
                        "This guest session can no longer be extended."
                    )
                );
            return;
        }
        const nextExpiresAt = resolveGuestSessionExpiresAt({
            now,
            guestSessionTtlHours: sessionTtlSource?.inviteToken?.guestSessionTtlHours,
            guestSessionDeadlineAt: sessionTtlSource?.inviteToken?.guestSessionDeadlineAt,
        });

        const sessionUpdate = await app.db.guestSession.updateMany({
            where: {
                id: body.guestSessionId,
                refreshTokenHash: currentRefreshTokenHash,
                revokedAt: null,
                expiresAt: { gt: now },
            },
            data: {
                refreshTokenHash: nextRefreshTokenHash,
                expiresAt: nextExpiresAt,
                lastSeenAt: now,
            },
        });

        if (sessionUpdate.count !== 1) {
            reply
                .code(401)
                .send(
                    errorData(
                        "GUEST_SESSION_INVALID",
                        "Invalid guest session",
                        "Unable to refresh guest session",
                        "The guest session is invalid or expired."
                    )
                );
            return;
        }

        const session = await app.db.guestSession.findUnique({
            where: { id: body.guestSessionId },
            include: {
                member: {
                    select: {
                        id: true,
                        externalId: true,
                        displayName: true,
                        isGuest: true,
                        disabledAt: true,
                        guestExpiresAt: true,
                    },
                },
                inviteToken: {
                    select: {
                        id: true,
                        guestSessionTtlHours: true,
                    },
                },
            },
        });

        if (!session || !session.member.isGuest) {
            reply
                .code(401)
                .send(
                    errorData(
                        "GUEST_SESSION_INVALID",
                        "Invalid guest session",
                        "Unable to refresh guest session",
                        "The guest session does not belong to a valid guest member."
                    )
                );
            return;
        }

        if (session.member.disabledAt || (session.member.guestExpiresAt && session.member.guestExpiresAt <= now)) {
            await app.db.guestSession
                .updateMany({
                    where: { id: session.id, revokedAt: null },
                    data: { revokedAt: now },
                })
                .catch(() => undefined);
            reply
                .code(403)
                .send(
                    errorData(
                        "GUEST_EXPIRED",
                        "Guest access expired",
                        "Unable to refresh guest session",
                        "This guest account has expired or was disabled."
                    )
                );
            return;
        }

        await app.db.member
            .update({
                where: { id: session.member.id },
                data: {
                    lastSeenAt: now,
                },
            })
            .catch(() => undefined);

        if (session.inviteToken?.id) {
            await app.db.inviteRedemption
                .updateMany({
                    where: {
                        inviteTokenId: session.inviteToken.id,
                        memberId: session.member.id,
                    },
                    data: {
                        lastSeenAt: now,
                    },
                })
                .catch(() => undefined);
        }

        reply.send({
            userIdentifier: session.member.externalId,
            username: session.member.displayName,
            guestSessionId: session.id,
            refreshToken: nextRefreshToken,
            expiresAt: nextExpiresAt.toISOString(),
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

    const cleanupIntervalMs = config.GUEST_CLEANUP_INTERVAL_MINUTES * 60 * 1000;
    const cleanupTimer = setInterval(async () => {
        const now = new Date();
        const guestRetentionCutoff = new Date(now.getTime() - config.GUEST_MEMBER_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const inviteAuditRetentionCutoff = new Date(
            now.getTime() - config.INVITE_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000
        );

        try {
            await app.db.member.updateMany({
                where: {
                    isGuest: true,
                    disabledAt: null,
                    guestExpiresAt: {
                        lte: now,
                    },
                },
                data: {
                    disabledAt: now,
                },
            });

            await app.db.guestSession.deleteMany({
                where: {
                    OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: now } }],
                },
            });

            await app.db.member.deleteMany({
                where: {
                    isGuest: true,
                    disabledAt: {
                        lte: guestRetentionCutoff,
                    },
                },
            });

            await app.db.inviteRedemption.deleteMany({
                where: {
                    claimedAt: {
                        lt: inviteAuditRetentionCutoff,
                    },
                },
            });
        } catch (error) {
            app.log.error({ error }, "Guest invite cleanup failed");
        }
    }, cleanupIntervalMs);

    cleanupTimer.unref();

    app.addHook("onClose", async () => {
        clearInterval(cleanupTimer);
    });
}
