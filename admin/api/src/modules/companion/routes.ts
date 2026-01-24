import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getCompanionList } from "../../lib/catalogs";
import { requireAdminAuth } from "../../plugins/auth";

const querySchema = z.object({
    roomUrl: z.string(),
    uuid: z.string(),
});

export async function companionRoutes(app: FastifyInstance) {
    app.get("/companion/list", { preHandler: requireAdminAuth }, async (request, reply) => {
        // Debug: confirm handler execution in container logs.
        // TODO: remove after issue is resolved.
        // eslint-disable-next-line no-console
        console.log("[companion] handler-enter", request.url);
        request.log.info({ step: "handler-enter" }, "companion request");
        querySchema.parse(request.query);
        reply.send(getCompanionList());
    });
}
