export type ParsedRoomPath = {
    path: string;
    kind: "root" | "map-storage" | "external" | "managed" | "unknown";
};

export function normalizeRoomPath(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        return "/";
    }

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        try {
            return normalizeRoomPath(new URL(trimmed).pathname);
        } catch {
            return "/";
        }
    }

    let path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    if (path.length > 1 && path.endsWith("/")) {
        path = path.slice(0, -1);
    }

    return path;
}

export function parseRoomPath(input: string): ParsedRoomPath {
    const path = normalizeRoomPath(input);
    if (path === "/") {
        return { path, kind: "root" };
    }
    if (path.startsWith("/~/")) {
        return { path, kind: "map-storage" };
    }
    if (path.startsWith("/_/")) {
        return { path, kind: "external" };
    }
    if (path.startsWith("/@/")) {
        return { path, kind: "managed" };
    }
    return { path, kind: "unknown" };
}

export function extractWorldSlug(path: string): string | null {
    const segments = normalizeRoomPath(path).split("/").filter(Boolean);
    if (segments[0] !== "@") {
        return null;
    }
    if (segments.length >= 3) {
        return segments[2];
    }
    if (segments.length >= 2) {
        return segments[1];
    }
    return null;
}
