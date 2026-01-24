import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildIceServers } from "../../lib/ice";
import { requireAdminAuth } from "../../plugins/auth";
import { normalizeRoomPath } from "../../lib/room-url";

const querySchema = z.object({
    roomUrl: z.string(),
    userIdentifier: z.string(),
});

export async function iceRoutes(app: FastifyInstance) {
    app.get("/ice-servers", { preHandler: requireAdminAuth }, async (request) => {
        // Debug: confirm handler execution in container logs.
        // TODO: remove after issue is resolved.
        // eslint-disable-next-line no-console
        console.log("[ice] handler-enter", request.url);
        request.log.info({ step: "handler-enter" }, "ice request");
        const query = querySchema.parse(request.query);
        const roomPath = normalizeRoomPath(query.roomUrl);
        const room = await app.db.room.findUnique({
            where: { roomUrl: roomPath },
            include: { world: { include: { iceConfig: true } } },
        });

        return buildIceServers(query.userIdentifier, room?.world.iceConfig);
    });
}
