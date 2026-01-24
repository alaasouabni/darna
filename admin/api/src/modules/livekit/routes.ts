import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config/env";
import { requireAdminAuth } from "../../plugins/auth";
import { errorData } from "../../lib/error-response";
import { normalizeRoomPath } from "../../lib/room-url";

export async function livekitRoutes(app: FastifyInstance) {
    app.get("/livekit/credentials", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = z.object({ playUri: z.string() }).parse(request.query);
        const roomPath = normalizeRoomPath(query.playUri);

        const room = await app.db.room.findUnique({
            where: { roomUrl: roomPath },
            include: { world: { include: { livekitConfig: true } } },
        });

        const livekitConfig = room?.world.livekitConfig;
        const livekitHost = livekitConfig?.host ?? config.LIVEKIT_HOST;
        const livekitApiKey = livekitConfig?.apiKey ?? config.LIVEKIT_API_KEY;
        const livekitApiSecret = livekitConfig?.apiSecret ?? config.LIVEKIT_API_SECRET;

        if (!livekitHost || !livekitApiKey || !livekitApiSecret) {
            reply.code(404).send(
                errorData(
                    "LIVEKIT_NOT_CONFIGURED",
                    "Livekit not configured",
                    "Missing Livekit configuration",
                    "Define Livekit settings on the world or set LIVEKIT_HOST, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET."
                )
            );
            return;
        }

        reply.send({
            livekitHost,
            livekitApiKey,
            livekitApiSecret,
        });
    });
}
