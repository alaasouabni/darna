import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SignJWT } from "jose";
import { config } from "../../config/env";
import { errorData } from "../../lib/error-response";
import { requireAdminUserAuth } from "../../plugins/auth";

const bodySchema = z.object({
    roomIds: z.array(z.string()).default([]),
});

export async function adminSocketsRoutes(app: FastifyInstance) {
    app.post("/token", { preHandler: requireAdminUserAuth }, async (request, reply) => {
        const body = bodySchema.parse(request.body);
        const user = request.adminAuth.user;

        if (!user) {
            reply.code(401).send(
                errorData(
                    "UNAUTHORIZED",
                    "Unauthorized",
                    "User token required",
                    "User token is missing or invalid."
                )
            );
            return;
        }

        if (!config.ADMIN_SOCKET_JWT_SECRET) {
            reply.code(500).send(
                errorData(
                    "ADMIN_SOCKET_NOT_CONFIGURED",
                    "Admin socket not configured",
                    "Missing admin socket secret",
                    "Define ADMIN_SOCKET_JWT_SECRET."
                )
            );
            return;
        }

        const token = await new SignJWT({
            roomIds: body.roomIds,
            roles: user.roles,
            tags: user.tags,
        })
            .setProtectedHeader({ alg: "HS256" })
            .setSubject(user.subject)
            .setIssuedAt()
            .setExpirationTime(`${config.ADMIN_SOCKET_TTL_SECONDS}s`)
            .setIssuer(config.ADMIN_PUBLIC_URL ?? "workadventure-admin")
            .sign(new TextEncoder().encode(config.ADMIN_SOCKET_JWT_SECRET));

        reply.send({
            token,
            expiresIn: config.ADMIN_SOCKET_TTL_SECONDS,
        });
    });
}
