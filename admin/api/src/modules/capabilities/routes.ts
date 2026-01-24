import type { FastifyInstance } from "fastify";
import { getCapabilities } from "./service";
import { requireAdminAuth } from "../../plugins/auth";

export async function capabilitiesRoutes(app: FastifyInstance) {
    app.get("/capabilities", async () => {
        return getCapabilities(app.db);
    });

    app.get("/debug/ping", { preHandler: requireAdminAuth }, async (request, reply) => {
        request.log.info({ step: "handler-enter" }, "debug request");
        reply.send({ ok: true, timestamp: new Date().toISOString() });
    });

    app.get("/debug/nopre", async (_request, reply) => {
        reply.send({ ok: true, note: "no preHandler" });
    });

    app.get(
        "/debug/pre",
        {
            preHandler: (_request, _reply, done) => {
                done();
            },
        },
        async (_request, reply) => {
            reply.send({ ok: true, note: "noop preHandler" });
        }
    );
}
