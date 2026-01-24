import type { FastifyInstance } from "fastify";
import { z } from "zod";

const querySchema = z.object({
    token: z.string(),
});

export async function oauthRoutes(app: FastifyInstance) {
    app.get("/oauth/logout", async (request, reply) => {
        querySchema.parse(request.query);
        reply.code(200).send();
    });
}
