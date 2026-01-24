import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MapsCacheFileFormat, WAMMetadata } from "@workadventure/map-editor";
import { errorData } from "../../lib/error-response";
import { requireAdminAuth } from "../../plugins/auth";
import { config } from "../../config/env";
import { extractWorldSlug, normalizeRoomPath, parseRoomPath } from "../../lib/room-url";

const sameWorldQuery = z.object({
    roomUrl: z.string(),
    tags: z.string().optional(),
    bypassTagFilter: z.string().optional(),
});

const tagsQuery = z.object({
    roomUrl: z.string(),
});

const worldTagsQuery = z.object({
    playUri: z.string(),
    searchText: z.string().optional(),
});

async function fetchMapStorageRooms() {
    if (!config.INTERNAL_MAP_STORAGE_URL || !config.PUBLIC_MAP_STORAGE_URL) {
        throw new Error("Map storage URLs are not configured.");
    }

    const response = await fetch(`${config.INTERNAL_MAP_STORAGE_URL}/maps`);
    if (!response.ok) {
        throw new Error(`Map storage responded with ${response.status}.`);
    }

    const data = await response.json();
    const maps = MapsCacheFileFormat.parse(data);
    const base = config.PUBLIC_MAP_STORAGE_URL.endsWith("/")
        ? config.PUBLIC_MAP_STORAGE_URL
        : `${config.PUBLIC_MAP_STORAGE_URL}/`;

    return Object.entries(maps.maps).map(([path, value]) => {
        const wamUrl = new URL(path, base).toString();
        const metadata = WAMMetadata.safeParse(value?.metadata ?? {}).success ? value?.metadata : undefined;
        const name = metadata?.name ?? path;
        return {
            name,
            roomUrl: `/~/${path}`,
            wamUrl,
            ...(metadata ?? {}),
        };
    });
}

export async function roomRoutes(app: FastifyInstance) {
    app.get("/room/sameWorld", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = sameWorldQuery.parse(request.query);
        const normalized = normalizeRoomPath(query.roomUrl);
        const parsed = parseRoomPath(normalized);
        const bypass = query.bypassTagFilter === "true" || query.bypassTagFilter === "1";
        const tags = query.tags ? query.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [];

        if (parsed.kind === "map-storage") {
            try {
                const rooms = await fetchMapStorageRooms();
                reply.send(rooms);
            } catch (err) {
                reply.code(500).send(
                    errorData(
                        "MAP_STORAGE_ERROR",
                        "Map storage error",
                        "Unable to list map-storage rooms.",
                        err instanceof Error ? err.message : "Unknown error."
                    )
                );
            }
            return;
        }

        const room = await app.db.room.findUnique({
            where: { roomUrl: normalized },
            include: { world: true },
        });

        if (!room) {
            reply.code(404).send(
                errorData(
                    "ROOM_NOT_FOUND",
                    "Room not found",
                    "The requested room does not exist.",
                    `No room found for path ${normalized}.`
                )
            );
            return;
        }

        const rooms = await app.db.room.findMany({
            where: { worldId: room.worldId, isActive: true },
            include: { tagsTable: true },
            orderBy: { slug: "asc" },
        });

        const filteredRooms = rooms.filter((entry) => {
            if (bypass) {
                return true;
            }

            const entryTags = new Set<string>(entry.tags);
            entry.tagsTable.forEach((tag) => entryTags.add(tag.tag));

            if (!tags.length) {
                return entryTags.size === 0;
            }

            return tags.some((tag) => entryTags.has(tag));
        });

        const result = filteredRooms.map((entry) => {
            const metadata = WAMMetadata.safeParse(entry.metadata ?? {}).success ? entry.metadata : undefined;
            return {
                name: metadata?.name ?? entry.slug,
                roomUrl: entry.roomUrl,
                wamUrl: entry.wamUrl ?? undefined,
                ...(metadata ?? {}),
            };
        });

        reply.send(result);
    });

    app.get("/room/tags", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = tagsQuery.parse(request.query);
        const normalized = normalizeRoomPath(query.roomUrl);
        const room = await app.db.room.findUnique({
            where: { roomUrl: normalized },
            include: { tagsTable: true },
        });

        if (!room) {
            reply.code(404).send(
                errorData(
                    "ROOM_NOT_FOUND",
                    "Room not found",
                    "The requested room does not exist.",
                    `No room found for path ${normalized}.`
                )
            );
            return;
        }

        const tags = new Set<string>(room.tags);
        room.tagsTable.forEach((tag) => tags.add(tag.tag));
        reply.send(Array.from(tags));
    });

    app.get("/world/tags", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = worldTagsQuery.parse(request.query);
        const normalized = normalizeRoomPath(query.playUri);

        let worldId: string | null = null;
        const room = await app.db.room.findUnique({
            where: { roomUrl: normalized },
            include: { world: true },
        });
        if (room?.world) {
            worldId = room.world.id;
        }

        if (!worldId) {
            const slug = extractWorldSlug(normalized);
            if (slug) {
                const world = await app.db.world.findUnique({ where: { slug } });
                worldId = world?.id ?? null;
            }
        }

        if (!worldId) {
            reply.send([]);
            return;
        }

        const [worldTags, rooms, roomTags] = await Promise.all([
            app.db.worldTag.findMany({ where: { worldId } }),
            app.db.room.findMany({ where: { worldId }, select: { tags: true } }),
            app.db.roomTag.findMany({ where: { room: { worldId } } }),
        ]);

        const tags = new Set<string>();
        worldTags.forEach((tag) => tags.add(tag.tag));
        rooms.forEach((entry) => entry.tags.forEach((tag) => tags.add(tag)));
        roomTags.forEach((tag) => tags.add(tag.tag));

        const searchText = query.searchText?.toLowerCase().trim();
        const result = Array.from(tags).filter((tag) =>
            searchText ? tag.toLowerCase().includes(searchText) : true
        );

        reply.send(result);
    });
}
