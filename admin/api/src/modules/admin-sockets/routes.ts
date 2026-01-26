import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SignJWT } from "jose";
import { config } from "../../config/env";
import { errorData } from "../../lib/error-response";
import { requireAdminUserAuth } from "../../plugins/auth";

const bodySchema = z.object({
    roomIds: z.array(z.string()).default([]),
});

const querySchema = z.object({
    roomId: z.string().optional(),
    roomIds: z.union([z.string(), z.array(z.string())]).optional(),
});

const ADMIN_SOCKET_SIGN_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise.finally(() => {
            if (timer) {
                clearTimeout(timer);
            }
        }),
        new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        }),
    ]);
}

export async function adminSocketsRoutes(app: FastifyInstance) {
    const normalizeRoomIds = (value?: string | string[]): string[] => {
        if (!value) {
            return [];
        }
        const values = Array.isArray(value) ? value : [value];
        return values
            .flatMap((item) => item.split(","))
            .map((item) => item.trim())
            .filter(Boolean);
    };

    const issueToken = async (request: FastifyRequest, reply: FastifyReply, roomIds: string[]) => {
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

        request.log.info(
            { phase: "admin-sockets:token", roomCount: roomIds.length },
            "admin socket token"
        );

        let token: string;
        try {
            request.log.info({ phase: "admin-sockets:sign-start" }, "admin socket token");
            token = await withTimeout(
                new SignJWT({
                    authorizedRoomIds: roomIds,
                    roles: user.roles,
                    tags: user.tags,
                })
                    .setProtectedHeader({ alg: "HS256" })
                    .setSubject(user.subject)
                    .setIssuedAt()
                    .setExpirationTime(`${config.ADMIN_SOCKET_TTL_SECONDS}s`)
                    .setIssuer(config.ADMIN_PUBLIC_URL ?? "workadventure-admin")
                    .sign(new TextEncoder().encode(config.ADMIN_SOCKET_JWT_SECRET)),
                ADMIN_SOCKET_SIGN_TIMEOUT_MS,
                "Admin socket token signing timed out."
            );
            request.log.info({ phase: "admin-sockets:sign-end" }, "admin socket token");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Admin socket token signing failed.";
            request.log.error({ err: message }, "admin socket token");
            reply.code(500).send(
                errorData(
                    "ADMIN_SOCKET_TOKEN_FAILED",
                    "Admin socket error",
                    "Unable to issue admin socket token",
                    message
                )
            );
            return;
        }

        reply.send({
            token,
            expiresIn: config.ADMIN_SOCKET_TTL_SECONDS,
        });
    };

    app.get("/token", { preHandler: requireAdminUserAuth }, async (request, reply) => {
        request.log.info({ phase: "admin-sockets:handler-enter", method: request.method }, "admin socket token");
        const query = querySchema.parse(request.query);
        const roomIds = normalizeRoomIds(query.roomIds ?? query.roomId);
        request.log.info(
            { phase: "admin-sockets:handler-parsed", roomCount: roomIds.length },
            "admin socket token"
        );
        await issueToken(request, reply, roomIds);
    });

    app.post("/token", { preHandler: requireAdminUserAuth }, async (request, reply) => {
        request.log.info({ phase: "admin-sockets:handler-enter", method: request.method }, "admin socket token");
        const body = bodySchema.parse(request.body);
        request.log.info(
            { phase: "admin-sockets:handler-parsed", roomCount: body.roomIds.length },
            "admin socket token"
        );
        await issueToken(request, reply, body.roomIds);
    });
}
