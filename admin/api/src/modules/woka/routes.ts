import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getWokaList } from "../../lib/catalogs";
import { requireAdminAuth } from "../../plugins/auth";

const querySchema = z.object({
    roomUrl: z.string(),
    uuid: z.string(),
});

export async function wokaRoutes(app: FastifyInstance) {
    app.get("/woka/list", { preHandler: requireAdminAuth }, async (request, reply) => {
        querySchema.parse(request.query);
        reply.send(getWokaList());
    });
}
