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

const createRoomBody = z.object({
    roomUrl: z.string(),
    playUri: z.string().optional(),
    worldSlug: z.string().optional(),
    worldName: z.string().optional(),
    worldDomain: z.string().optional(),
    wamUrl: z.string().optional(),
    name: z.string().optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    isActive: z.boolean().optional(),
});

function normalizeTags(input?: string | string[]): string[] {
    if (!input) {
        return [];
    }
    const raw = Array.isArray(input) ? input : input.split(",");
    return raw.map((tag) => tag.trim()).filter(Boolean);
}

function extractMapStorageSlug(path: string): string | null {
    const segments = normalizeRoomPath(path).split("/").filter(Boolean);
    if (segments[0] !== "~") {
        return null;
    }
    return segments[1] ?? null;
}

function extractRoomSlug(path: string): string {
    const segments = normalizeRoomPath(path).split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "room";
}

function inferDomain(playUri?: string): string | null {
    if (!playUri) {
        return null;
    }
    try {
        return new URL(playUri).host;
    } catch {
        return null;
    }
}

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
    app.post("/room", { preHandler: requireAdminAuth }, async (request, reply) => {
        const body = createRoomBody.parse(request.body);
        const normalized = normalizeRoomPath(body.roomUrl);
        const parsed = parseRoomPath(normalized);
        const tags = normalizeTags(body.tags);
        const tagsProvided = typeof body.tags !== "undefined";

        const inferredSlug =
            parsed.kind === "map-storage"
                ? extractMapStorageSlug(normalized)
                : extractWorldSlug(normalized);
        const worldSlug = body.worldSlug?.trim() || inferredSlug;
        if (!worldSlug) {
            reply.code(400).send(
                errorData(
                    "WORLD_SLUG_REQUIRED",
                    "World slug required",
                    "Provide a world slug or a room URL that contains it.",
                    "Unable to infer world slug from room URL."
                )
            );
            return;
        }

        const existingWorld = await app.db.world.findUnique({ where: { slug: worldSlug } });
        const worldDomain = body.worldDomain?.trim() || inferDomain(body.playUri) || existingWorld?.domain || null;
        if (!existingWorld && !worldDomain) {
            reply.code(400).send(
                errorData(
                    "WORLD_DOMAIN_REQUIRED",
                    "World domain required",
                    "Provide a world domain or a Play URL with a domain.",
                    "Unable to infer world domain."
                )
            );
            return;
        }

        const worldName = body.worldName?.trim() || existingWorld?.name || worldSlug;
        const world = existingWorld
            ? await app.db.world.update({
                  where: { id: existingWorld.id },
                  data: {
                      ...(body.worldName ? { name: worldName } : {}),
                      ...(body.worldDomain ? { domain: worldDomain ?? existingWorld.domain } : {}),
                  },
              })
            : await app.db.world.create({
                  data: { slug: worldSlug, name: worldName, domain: worldDomain ?? "" },
              });

        const roomSlug = extractRoomSlug(normalized);
        const room = await app.db.$transaction(async (tx) => {
            const entry = await tx.room.upsert({
                where: { roomUrl: normalized },
                create: {
                    worldId: world.id,
                    slug: roomSlug,
                    roomUrl: normalized,
                    wamUrl: body.wamUrl ?? null,
                    tags: tagsProvided ? tags : [],
                    isActive: body.isActive ?? true,
                    metadata: body.name ? { name: body.name } : undefined,
                },
                update: {
                    worldId: world.id,
                    slug: roomSlug,
                    wamUrl: body.wamUrl ?? undefined,
                    ...(tagsProvided ? { tags } : {}),
                    ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
                },
            });

            if (tagsProvided) {
                await tx.roomTag.deleteMany({ where: { roomId: entry.id } });
                if (tags.length) {
                    await tx.roomTag.createMany({
                        data: tags.map((tag) => ({ roomId: entry.id, tag })),
                        skipDuplicates: true,
                    });
                }
            }

            if (body.name) {
                const nextMetadata =
                    entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
                        ? { ...(entry.metadata as Record<string, unknown>), name: body.name }
                        : { name: body.name };
                await tx.room.update({
                    where: { id: entry.id },
                    data: { metadata: nextMetadata },
                });
            }

            return entry;
        });

        reply.send({
            status: "ok",
            roomUrl: room.roomUrl,
            worldSlug: world.slug,
            roomId: room.id,
        });
    });

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

            if (entryTags.size === 0) {
                return true;
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
