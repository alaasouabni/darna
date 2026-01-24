import { config } from "../config/env";

type KeycloakSettings = {
    baseUrl: string;
    realm: string;
    clientId: string;
    clientSecret: string;
};

type TokenResponse = {
    access_token: string;
    expires_in?: number;
};

export type KeycloakUser = {
    id: string;
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    createdTimestamp?: number;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

function getKeycloakSettings(): KeycloakSettings {
    const baseUrl = config.adminKeycloakUrl?.replace(/\/+$/, "");
    const realm = config.adminKeycloakRealm;
    const clientId = config.ADMIN_KEYCLOAK_CLIENT_ID;
    const clientSecret = config.ADMIN_KEYCLOAK_CLIENT_SECRET;

    if (!baseUrl || !realm || !clientId || !clientSecret) {
        throw new Error("Keycloak admin credentials are not configured.");
    }

    return {
        baseUrl,
        realm,
        clientId,
        clientSecret,
    };
}

async function getAdminToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
        return cachedToken.token;
    }

    const { baseUrl, realm, clientId, clientSecret } = getKeycloakSettings();
    const url = `${baseUrl}/realms/${realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
    });

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Keycloak token request failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as TokenResponse;
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 60;
    cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
    };

    return data.access_token;
}

async function keycloakFetch(path: string): Promise<Response> {
    const { baseUrl } = getKeycloakSettings();
    const token = await getAdminToken();
    return fetch(`${baseUrl}${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
}

export async function fetchKeycloakUsers(options: {
    searchText?: string;
    first: number;
    max: number;
    enabled?: boolean;
}) {
    const { realm } = getKeycloakSettings();
    const params = new URLSearchParams();
    params.set("first", String(options.first));
    params.set("max", String(options.max));
    params.set("briefRepresentation", "true");
    if (options.searchText) {
        params.set("search", options.searchText);
    }
    if (typeof options.enabled === "boolean") {
        params.set("enabled", options.enabled ? "true" : "false");
    }

    const countParams = new URLSearchParams();
    if (options.searchText) {
        countParams.set("search", options.searchText);
    }
    if (typeof options.enabled === "boolean") {
        countParams.set("enabled", options.enabled ? "true" : "false");
    }

    const [usersResponse, countResponse] = await Promise.all([
        keycloakFetch(`/admin/realms/${realm}/users?${params}`),
        keycloakFetch(`/admin/realms/${realm}/users/count${countParams.toString() ? `?${countParams}` : ""}`),
    ]);

    if (!usersResponse.ok) {
        const text = await usersResponse.text();
        throw new Error(`Keycloak users request failed: ${usersResponse.status} ${text}`);
    }

    if (!countResponse.ok) {
        const text = await countResponse.text();
        throw new Error(`Keycloak users count failed: ${countResponse.status} ${text}`);
    }

    const users = (await usersResponse.json()) as KeycloakUser[];
    const countJson = await countResponse.json();
    const total =
        typeof countJson === "number"
            ? countJson
            : typeof countJson === "object" && countJson !== null && "count" in countJson
            ? Number((countJson as { count: number }).count)
            : 0;

    return {
        total,
        users,
    };
}
