import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errorData } from "../../lib/error-response";
import { resolveMapFromPlayUri } from "../../lib/map-utils";
import { normalizeRoomPath } from "../../lib/room-url";
import { requireServiceAuth } from "../../plugins/auth";

const paramsSchema = z.object({
    organizationMemberToken: z.string(),
});

const querySchema = z.object({
    playUri: z.string().optional(),
});

export async function loginRoutes(app: FastifyInstance) {
    app.get("/login-url/:organizationMemberToken", { preHandler: requireServiceAuth }, async (request, reply) => {
        const params = paramsSchema.parse(request.params);
        const query = querySchema.parse(request.query);

        const loginToken = await app.db.loginToken.findUnique({
            where: { token: params.organizationMemberToken },
            include: { member: true, room: true },
        });

        if (!loginToken || loginToken.expiresAt <= new Date()) {
            reply.code(404).send(
                errorData(
                    "LOGIN_TOKEN_INVALID",
                    "Invalid token",
                    "The login token is invalid or expired.",
                    "Request a new login link from the administrator."
                )
            );
            return;
        }

        const roomUrl = query.playUri
            ? new URL(loginToken.room.roomUrl, query.playUri).toString()
            : loginToken.room.roomUrl;
        let mapUrlStart = loginToken.room.mapUrl ?? loginToken.room.wamUrl ?? "";

        if (query.playUri) {
            const normalized = normalizeRoomPath(query.playUri);
            if (normalized === roomUrl) {
                const resolution = resolveMapFromPlayUri(query.playUri, loginToken.room);
                mapUrlStart = resolution.mapUrl ?? resolution.wamUrl ?? mapUrlStart;
            }
        }

        await app.db.loginToken.delete({ where: { token: params.organizationMemberToken } });

        reply.send({
            userUuid: loginToken.member.externalId,
            email: loginToken.member.email ?? null,
            roomUrl,
            mapUrlStart,
            messages: [],
        });
    });
}
