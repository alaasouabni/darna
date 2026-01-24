import crypto from "crypto";
import type { IceConfig } from "@prisma/client";
import { config } from "../config/env";

export type IceServer = {
    urls: string[];
    username?: string;
    credential?: string;
    credentialType?: "password" | "oauth";
};

const CREDENTIAL_VALIDITY_HOURS = 4;

type TurnCredentials = {
    username?: string;
    credential?: string;
};

function generateTurnCredentials(userId: string, secret: string): TurnCredentials {
    const timestamp = Math.floor(Date.now() / 1000) + CREDENTIAL_VALIDITY_HOURS * 3600;
    const username = `${timestamp}:${userId}`;
    const hmac = crypto.createHmac("sha1", secret);
    hmac.update(username);
    const credential = hmac.digest("base64");

    return { username, credential };
}

function resolveList(value?: string | string[] | null): string[] {
    if (!value) {
        return [];
    }
    if (Array.isArray(value)) {
        return value.map((item) => item.trim()).filter(Boolean);
    }
    return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function buildIceServers(userId: string, override?: IceConfig | null): IceServer[] {
    const servers: IceServer[] = [];
    const stunUrls = resolveList(override?.stunUrls ?? config.STUN_SERVER);
    const turnUrls = resolveList(override?.turnUrls ?? config.TURN_SERVER);
    const turnUser = override?.turnUser ?? config.TURN_USER;
    const turnPassword = override?.turnPassword ?? config.TURN_PASSWORD;
    const turnStaticAuthSecret = override?.turnStaticAuthSecret ?? config.TURN_STATIC_AUTH_SECRET;

    if (stunUrls.length) {
        servers.push({
            urls: stunUrls,
        });
    }

    if (turnUrls.length) {
        let credentials: TurnCredentials = {
            username: turnUser,
            credential: turnPassword,
        };

        if (turnStaticAuthSecret) {
            credentials = generateTurnCredentials(userId, turnStaticAuthSecret);
        }

        servers.push({
            urls: turnUrls,
            username: credentials.username,
            credential: credentials.credential,
            credentialType: "password",
        });
    }

    return servers;
}
