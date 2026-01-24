import { createRemoteJWKSet, decodeJwt, jwtVerify, errors, type JWTPayload } from "jose";
import { config } from "../config/env";

export type TokenUser = {
    subject: string;
    email?: string | null;
    name?: string | null;
    preferredUsername?: string | null;
    roles: string[];
    tags: string[];
    claims: JWTPayload;
};

const jwks = config.ADMIN_JWT_JWKS_URI ? createRemoteJWKSet(new URL(config.ADMIN_JWT_JWKS_URI)) : null;

const DEFAULT_ROLE_MAPPING: Record<string, string> = {
    "wa-admin": "admin",
    "wa-editor": "editor",
    "wa-moderator": "moderator",
    "wa-viewer": "viewer",
};

function parseRoleMapping(): Record<string, string> {
    if (!config.ADMIN_JWT_ROLE_MAPPING) {
        return DEFAULT_ROLE_MAPPING;
    }

    const mapping: Record<string, string> = {};
    for (const entry of config.ADMIN_JWT_ROLE_MAPPING.split(",")) {
        const trimmed = entry.trim();
        if (!trimmed) {
            continue;
        }
        const parts = trimmed.split(/[:=]/);
        if (parts.length !== 2) {
            continue;
        }
        const role = parts[0].trim();
        const tag = parts[1].trim();
        if (role && tag) {
            mapping[role] = tag;
        }
    }

    return Object.keys(mapping).length ? mapping : DEFAULT_ROLE_MAPPING;
}

function getPathValue(payload: JWTPayload, path: string): unknown {
    const segments = path.split(".").filter(Boolean);
    let current: unknown = payload;
    for (const segment of segments) {
        if (typeof current !== "object" || current === null) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

function extractRoles(payload: JWTPayload): string[] {
    const roles = new Set<string>();
    const realmAccess = (payload as Record<string, unknown>).realm_access as
        | { roles?: string[] }
        | undefined;
    if (realmAccess?.roles && Array.isArray(realmAccess.roles)) {
        realmAccess.roles.forEach((role) => roles.add(role));
    }

    const resourceAccess = (payload as Record<string, unknown>).resource_access as
        | Record<string, { roles?: string[] }>
        | undefined;
    if (resourceAccess && typeof resourceAccess === "object") {
        if (config.ADMIN_JWT_RESOURCE && resourceAccess[config.ADMIN_JWT_RESOURCE]?.roles) {
            resourceAccess[config.ADMIN_JWT_RESOURCE].roles?.forEach((role) => roles.add(role));
        } else {
            for (const value of Object.values(resourceAccess)) {
                value?.roles?.forEach((role) => roles.add(role));
            }
        }
    }

    if (config.adminJwtRoleClaims.length) {
        for (const claimPath of config.adminJwtRoleClaims) {
            const value = getPathValue(payload, claimPath);
            if (Array.isArray(value)) {
                value.forEach((role) => {
                    if (typeof role === "string") {
                        roles.add(role);
                    }
                });
            }
        }
    }

    return Array.from(roles);
}

function buildTokenUser(payload: JWTPayload): TokenUser {
    const roles = extractRoles(payload);
    const mapping = parseRoleMapping();
    const tags = roles
        .map((role) => mapping[role])
        .filter((tag): tag is string => Boolean(tag));

    return {
        subject: payload.sub ?? "",
        email: typeof payload.email === "string" ? payload.email : null,
        name: typeof payload.name === "string" ? payload.name : null,
        preferredUsername: typeof payload.preferred_username === "string" ? payload.preferred_username : null,
        roles,
        tags,
        claims: payload,
    };
}

export async function verifyAdminUserToken(token: string): Promise<TokenUser> {
    if (!jwks) {
        throw new Error("ADMIN_JWT_JWKS_URI is not configured.");
    }

    const { payload } = await jwtVerify(token, jwks, {
        issuer: config.ADMIN_JWT_ISSUER,
        audience: config.ADMIN_JWT_AUDIENCE,
    });

    return buildTokenUser(payload);
}

export async function decodeAccessToken(token: string): Promise<TokenUser | null> {
    if (!token) {
        return null;
    }

    if (!jwks) {
        try {
            return buildTokenUser(decodeJwt(token));
        } catch {
            return null;
        }
    }

    try {
        const { payload } = await jwtVerify(token, jwks, {
            issuer: config.ADMIN_JWT_ISSUER,
            audience: config.ADMIN_JWT_AUDIENCE,
        });
        return buildTokenUser(payload);
    } catch (err) {
        if (err instanceof errors.JWTExpired) {
            try {
                return buildTokenUser(decodeJwt(token));
            } catch {
                return null;
            }
        }
        return null;
    }
}
