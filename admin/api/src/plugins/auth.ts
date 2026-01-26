import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config/env";
import { errorData, unauthorizedData } from "../lib/error-response";
import { verifyAdminUserToken, type TokenUser } from "../lib/jwt";

export type AdminAuthKind = "service" | "user" | "anonymous";

export type AdminAuthContext = {
    kind: AdminAuthKind;
    token?: string;
    user?: TokenUser;
    error?: string;
};

const ADMIN_JWT_VERIFY_TIMEOUT_MS = 5000;

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

declare module "fastify" {
    interface FastifyRequest {
        adminAuth: AdminAuthContext;
    }
}

export const authPlugin: FastifyPluginAsync = fp(async (app) => {
    app.decorateRequest("adminAuth", { kind: "anonymous" } as AdminAuthContext);

    app.addHook("onRequest", async (request) => {
        const headerValue = request.headers.authorization;
        const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
        if (!header) {
            request.adminAuth = { kind: "anonymous" };
            return;
        }

        const trimmed = header.trim();
        if (!trimmed) {
            request.adminAuth = { kind: "anonymous" };
            return;
        }

        const adminToken = config.ADMIN_API_TOKEN?.trim();
        request.log.info(
            {
                authStage: "start",
                hasAuthHeader: Boolean(trimmed),
                adminTokenSet: Boolean(adminToken),
                isBearer: trimmed.toLowerCase().startsWith("bearer "),
                isServiceTokenMatch: Boolean(adminToken && trimmed === adminToken),
                isBearerServiceTokenMatch: Boolean(
                    adminToken &&
                        trimmed.toLowerCase().startsWith("bearer ") &&
                        trimmed.slice(7).trim() === adminToken
                ),
            },
            "auth check"
        );
        if (adminToken && trimmed === adminToken) {
            request.adminAuth = { kind: "service" };
            request.log.info({ authStage: "resolved", kind: "service" }, "auth check");
            return;
        }

        const lower = trimmed.toLowerCase();
        if (adminToken && lower.startsWith("bearer ") && trimmed.slice(7).trim() === adminToken) {
            request.adminAuth = { kind: "service" };
            request.log.info({ authStage: "resolved", kind: "service" }, "auth check");
            return;
        }

        if (lower.startsWith("bearer ")) {
            const token = trimmed.slice(7).trim();
            try {
                request.log.info({ authStage: "verify-start" }, "auth check");
                const user = await withTimeout(
                    verifyAdminUserToken(token),
                    ADMIN_JWT_VERIFY_TIMEOUT_MS,
                    "Access token verification timed out."
                );
                request.adminAuth = { kind: "user", token, user };
                request.log.info({ authStage: "resolved", kind: "user" }, "auth check");
            } catch (err) {
                const message = err instanceof Error ? err.message : "Invalid access token.";
                request.adminAuth = { kind: "user", token, error: message };
                request.log.info({ authStage: "resolved", kind: "user", error: message }, "auth check");
            }
            return;
        }

        request.adminAuth = { kind: "anonymous" };
        request.log.info({ authStage: "resolved", kind: "anonymous" }, "auth check");
    });
});

export function requireServiceAuth(request: FastifyRequest, reply: FastifyReply) {
    if (request.adminAuth.kind !== "service") {
        reply.code(401).send(unauthorizedData("Service token required."));
        return;
    }
}

function isAdminUser(user?: TokenUser): boolean {
    return Boolean(user && user.tags.includes("admin"));
}

export function requireUserAuth(request: FastifyRequest, reply: FastifyReply) {
    if (request.adminAuth.kind !== "user") {
        reply.code(401).send(unauthorizedData("User token required."));
        return;
    }

    if (!request.adminAuth.user) {
        const details = request.adminAuth.error ?? "Invalid user token.";
        reply.code(401).send(unauthorizedData(details));
        return;
    }
}

export function requireAdminUserAuth(request: FastifyRequest, reply: FastifyReply) {
    if (request.adminAuth.kind !== "user") {
        reply.code(401).send(unauthorizedData("User token required."));
        return;
    }

    if (!request.adminAuth.user) {
        const details = request.adminAuth.error ?? "Invalid user token.";
        reply.code(401).send(unauthorizedData(details));
        return;
    }

    if (!isAdminUser(request.adminAuth.user)) {
        reply.code(403).send(
            errorData(
                "FORBIDDEN",
                "Forbidden",
                "Missing admin role",
                "Assign a workadventure admin role in Keycloak to access this API."
            )
        );
        return;
    }
}

export function requireAdminAuth(
    request: FastifyRequest,
    reply: FastifyReply,
    done?: (err?: Error) => void
) {
    request.log.info(
        {
            authStage: "prehandler",
            kind: request.adminAuth.kind,
            replySent: reply.sent,
            headersSent: reply.raw.headersSent,
        },
        "auth check"
    );
    if (request.adminAuth.kind === "service") {
        if (done) {
            done();
            return;
        }
        return;
    }

    if (request.adminAuth.kind !== "user") {
        reply.code(401).send(unauthorizedData("Admin token required."));
        return;
    }

    if (!request.adminAuth.user) {
        const details = request.adminAuth.error ?? "Invalid user token.";
        reply.code(401).send(unauthorizedData(details));
        return;
    }

    if (!isAdminUser(request.adminAuth.user)) {
        reply.code(403).send(
            errorData(
                "FORBIDDEN",
                "Forbidden",
                "Missing admin role",
                "Assign a workadventure admin role in Keycloak to access this API."
            )
        );
        return;
    }

    if (done) {
        done();
    }
}
