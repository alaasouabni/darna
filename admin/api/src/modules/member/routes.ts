import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errorData } from "../../lib/error-response";
import { fetchKeycloakUsers } from "../../lib/keycloak-admin";
import { requireAdminAuth } from "../../plugins/auth";

const searchQuery = z.object({
    playUri: z.string().nullable().optional(),
    searchText: z.string(),
});

const chatIdBody = z.object({
    chatId: z.string(),
    userIdentifier: z.string(),
    roomUrl: z.string(),
});

const activeQuery = z.object({
    minutes: z.coerce.number().default(60),
    limit: z.coerce.number().default(50),
    searchText: z.string().optional(),
});

const keycloakQuery = z.object({
    searchText: z.string().optional(),
    first: z.coerce.number().default(0),
    max: z.coerce.number().default(50),
    enabled: z.string().optional(),
});

function serializeMember(member: {
    id: string;
    displayName: string | null;
    email: string | null;
    visitCardUrl: string | null;
    chatId: string | null;
    lastSeenAt: Date | null;
    lastRoomUrl: string | null;
}) {
    return {
        id: member.id,
        name: member.displayName ?? null,
        email: member.email ?? null,
        visitCardUrl: member.visitCardUrl ?? null,
        chatID: member.chatId ?? null,
        lastSeenAt: member.lastSeenAt ? member.lastSeenAt.toISOString() : null,
        lastRoomUrl: member.lastRoomUrl ?? null,
    };
}

function serializeMemberDetails(member: {
    id: string;
    displayName: string | null;
    email: string | null;
    visitCardUrl: string | null;
    chatId: string | null;
    lastSeenAt: Date | null;
    lastRoomUrl: string | null;
    externalId: string;
    tags: { tag: string }[];
    characterTextureIds: string[];
    companionTextureId: string | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        ...serializeMember(member),
        externalId: member.externalId,
        tags: member.tags.map((tag) => tag.tag),
        characterTextureIds: member.characterTextureIds,
        companionTextureId: member.companionTextureId ?? null,
        createdAt: member.createdAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
    };
}

export async function memberRoutes(app: FastifyInstance) {
    app.get("/members", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = searchQuery.parse(request.query);
        const searchText = query.searchText.trim();

        const members = await app.db.member.findMany({
            where: {
                OR: [
                    { email: { contains: searchText, mode: "insensitive" } },
                    { displayName: { contains: searchText, mode: "insensitive" } },
                    { externalId: { contains: searchText, mode: "insensitive" } },
                ],
            },
            orderBy: { displayName: "asc" },
            take: 50,
        });

        reply.send(members.map(serializeMember));
    });

    app.get("/members/:memberUUID", { preHandler: requireAdminAuth }, async (request, reply) => {
        const params = z.object({ memberUUID: z.string() }).parse(request.params);
        const member = await app.db.member.findFirst({
            where: {
                OR: [{ id: params.memberUUID }, { externalId: params.memberUUID }],
            },
            include: {
                tags: true,
            },
        });

        if (!member) {
            reply.code(404).send(
                errorData(
                    "MEMBER_NOT_FOUND",
                    "Member not found",
                    "The requested member does not exist.",
                    `No member found for identifier ${params.memberUUID}.`
                )
            );
            return;
        }

        reply.send(serializeMemberDetails(member));
    });

    app.put("/members/:userIdentifier/chatId", { preHandler: requireAdminAuth }, async (request, reply) => {
        const body = chatIdBody.parse(request.body);

        await app.db.member.upsert({
            where: { externalId: body.userIdentifier },
            update: { chatId: body.chatId },
            create: {
                externalId: body.userIdentifier,
                chatId: body.chatId,
            },
        });

        reply.code(200).send();
    });

    app.get("/members/active", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = activeQuery.parse(request.query);
        const since = new Date(Date.now() - query.minutes * 60 * 1000);

        const searchText = query.searchText?.trim();
        const where = {
            lastSeenAt: { gte: since },
            ...(searchText
                ? {
                      OR: [
                          { email: { contains: searchText, mode: "insensitive" } },
                          { displayName: { contains: searchText, mode: "insensitive" } },
                          { externalId: { contains: searchText, mode: "insensitive" } },
                      ],
                  }
                : {}),
        };

        const [total, members] = await Promise.all([
            app.db.member.count({ where }),
            app.db.member.findMany({
                where,
                orderBy: { lastSeenAt: "desc" },
                take: query.limit,
            }),
        ]);

        reply.send({
            total,
            members: members.map(serializeMember),
        });
    });

    app.get("/keycloak/users", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = keycloakQuery.parse(request.query);
        const enabled =
            query.enabled === undefined
                ? undefined
                : query.enabled === "true" || query.enabled === "1";
        const searchText = query.searchText?.trim() || undefined;

        try {
            const data = await fetchKeycloakUsers({
                searchText,
                first: query.first,
                max: query.max,
                enabled,
            });

            reply.send({
                total: data.total,
                users: data.users.map((user) => ({
                    id: user.id,
                    username: user.username ?? null,
                    email: user.email ?? null,
                    firstName: user.firstName ?? null,
                    lastName: user.lastName ?? null,
                    enabled: typeof user.enabled === "boolean" ? user.enabled : null,
                    createdAt: user.createdTimestamp
                        ? new Date(user.createdTimestamp).toISOString()
                        : null,
                })),
            });
        } catch (err) {
            reply.code(502).send(
                errorData(
                    "KEYCLOAK_ERROR",
                    "Keycloak error",
                    "Unable to fetch Keycloak users.",
                    err instanceof Error ? err.message : "Unknown error."
                )
            );
        }
    });
}
