import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config/env";

const querySchema = z.object({
    roomUrl: z.string(),
});

const successResponse = { success: true } as const;

export async function roomApiRoutes(app: FastifyInstance) {
    app.get("/room-api/authorization", async (request, reply) => {
        const apiKey = request.headers["x-api-key"];
        querySchema.parse(request.query);

        if (!apiKey || typeof apiKey !== "string") {
            reply.send({
                success: false,
                error: "UNAUTHENTICATED",
                message: "Missing X-API-Key header.",
            });
            return;
        }

        if (!config.roomApiKeys.length || !config.roomApiKeys.includes(apiKey)) {
            reply.send({
                success: false,
                error: "UNAUTHENTICATED",
                message: "Invalid API key.",
            });
            return;
        }

        reply.send(successResponse);
    });
}