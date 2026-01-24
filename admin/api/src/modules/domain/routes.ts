import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config/env";
import { requireAdminAuth } from "../../plugins/auth";

const querySchema = z.object({
    uri: z.string().url(),
});

function isAllowedDomain(uri: string): boolean {
    const host = new URL(uri).hostname;

    if (config.allowedDomains.length > 0) {
        return config.allowedDomains.includes(host);
    }

    if (config.ADMIN_PUBLIC_URL) {
        return new URL(config.ADMIN_PUBLIC_URL).hostname === host;
    }

    return false;
}

export async function domainRoutes(app: FastifyInstance) {
    app.get("/domain/verify", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = querySchema.parse(request.query);
        const allowed = isAllowedDomain(query.uri);

        if (allowed) {
            reply.code(204).send();
            return;
        }

        reply.code(403).send();
    });
}
