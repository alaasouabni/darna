import type { Room } from "@prisma/client";
import { config } from "../config/env";
import { parseRoomPath } from "./room-url";

export type MapResolution = {
    mapUrl?: string;
    wamUrl?: string;
    redirectUrl?: string;
    editable?: boolean;
    path: string;
};

function ensureTrailingSlash(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
}

function buildPublicMapStorageUrl(path: string): string | undefined {
    if (!config.PUBLIC_MAP_STORAGE_URL) {
        return undefined;
    }
    const base = ensureTrailingSlash(config.PUBLIC_MAP_STORAGE_URL);
    return new URL(path, base).toString();
}

function buildExternalMapUrl(path: string, protocol: string): string | undefined {
    const match = /\/_\/[^/]+\/(.+)/.exec(path);
    if (!match) {
        return undefined;
    }
    return `${protocol}//${match[1]}`;
}

export function resolveMapFromPlayUri(playUri: string, room?: Room | null): MapResolution {
    const url = new URL(playUri);
    const parsed = parseRoomPath(url.pathname);

    if (parsed.kind === "map-storage") {
        if (parsed.path.endsWith(".tmj")) {
            return {
                path: parsed.path,
                redirectUrl: url.toString().replace(".tmj", ".wam"),
            };
        }

        const mapPath = parsed.path.replace("/~/", "");
        return {
            path: parsed.path,
            wamUrl: buildPublicMapStorageUrl(mapPath),
            editable: config.ENABLE_MAP_EDITOR,
        };
    }

    if (parsed.kind === "external") {
        return {
            path: parsed.path,
            mapUrl: buildExternalMapUrl(parsed.path, url.protocol),
            editable: false,
        };
    }

    if (room) {
        return {
            path: parsed.path,
            mapUrl: room.mapUrl ?? undefined,
            wamUrl: room.wamUrl ?? undefined,
            editable: Boolean(room.wamUrl) && config.ENABLE_MAP_EDITOR,
        };
    }

    return { path: parsed.path };
}
