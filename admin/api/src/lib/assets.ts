import { config } from "../config/env";

const DEFAULT_ASSET_BASE = "";

function ensureTrailingSlash(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
}

export function resolveAssetUrl(url: string): string {
    if (!url) {
        return url;
    }

    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//")) {
        return url;
    }

    const base = config.ASSETS_BASE_URL ?? DEFAULT_ASSET_BASE;
    if (!base) {
        return url;
    }

    return new URL(url, ensureTrailingSlash(base)).toString();
}
