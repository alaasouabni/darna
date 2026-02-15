import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MapsCacheFileFormat } from "@workadventure/map-editor";
import { errorData } from "../../lib/error-response";
import { requireAdminAuth } from "../../plugins/auth";
import { config } from "../../config/env";
import { extractWorldSlug, normalizeRoomPath, parseRoomPath } from "../../lib/room-url";

const sameWorldQuery = z.object({
    roomUrl: z.string(),
    tags: z.string().optional(),
    bypassTagFilter: z.string().optional(),
    includeInactive: z.string().optional(),
});

const tagsQuery = z.object({
    roomUrl: z.string(),
});

const worldTagsQuery = z.object({
    playUri: z.string(),
    searchText: z.string().optional(),
});

const roomStateParams = z.object({
    roomId: z.string().uuid(),
});

const roomStateBody = z.object({
    isActive: z.boolean(),
    replacementDefaultRoomId: z.string().uuid().optional(),
});

const worldSlugParams = z.object({
    worldSlug: z.string(),
});

const worldRoomsQuery = z.object({
    includeInactive: z.string().optional(),
});

const worldDefaultBody = z.object({
    roomId: z.string().uuid(),
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

function parseBooleanFlag(value?: string): boolean {
    return value === "true" || value === "1";
}

function getRoomDisplayName(entry: { metadata: unknown; slug: string }): string {
    if (entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)) {
        const metadataName = (entry.metadata as Record<string, unknown>).name;
        if (typeof metadataName === "string" && metadataName.trim()) {
            return metadataName;
        }
    }
    return entry.slug;
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
        const metadata =
            value?.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
                ? (value.metadata as Record<string, unknown>)
                : undefined;
        const name = typeof metadata?.name === "string" ? metadata.name : path;
        return {
            id: path,
            name,
            roomUrl: `/~/${path}`,
            wamUrl,
            tags: [],
            isActive: true,
            isDefault: false,
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
        const bypass = parseBooleanFlag(query.bypassTagFilter);
        const includeInactive = parseBooleanFlag(query.includeInactive);
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
            where: includeInactive ? { worldId: room.worldId } : { worldId: room.worldId, isActive: true },
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
            const tags = new Set<string>(entry.tags);
            entry.tagsTable.forEach((tag) => tags.add(tag.tag));
            return {
                id: entry.id,
                name: getRoomDisplayName(entry),
                roomUrl: entry.roomUrl,
                wamUrl: entry.wamUrl ?? undefined,
                tags: Array.from(tags).sort(),
                isActive: entry.isActive,
                isDefault: entry.id === room.world.defaultRoomId,
            };
        });

        reply.send(result);
    });

    app.patch("/room/:roomId/state", { preHandler: requireAdminAuth }, async (request, reply) => {
        const params = roomStateParams.parse(request.params);
        const body = roomStateBody.parse(request.body);

        const room = await app.db.room.findUnique({
            where: { id: params.roomId },
            include: { world: true },
        });

        if (!room) {
            reply.code(404).send(
                errorData(
                    "ROOM_NOT_FOUND",
                    "Room not found",
                    "The requested room does not exist.",
                    `No room found for id ${params.roomId}.`
                )
            );
            return;
        }

        const isDefaultRoom = room.world.defaultRoomId === room.id;
        let replacementRoom:
            | {
                  id: string;
                  worldId: string;
                  roomUrl: string;
                  isActive: boolean;
              }
            | null = null;

        if (body.replacementDefaultRoomId) {
            replacementRoom = await app.db.room.findUnique({
                where: { id: body.replacementDefaultRoomId },
                select: { id: true, worldId: true, roomUrl: true, isActive: true },
            });

            if (!replacementRoom) {
                reply.code(404).send(
                    errorData(
                        "REPLACEMENT_ROOM_NOT_FOUND",
                        "Replacement room not found",
                        "The replacement default room does not exist.",
                        `No room found for id ${body.replacementDefaultRoomId}.`
                    )
                );
                return;
            }

            if (replacementRoom.worldId !== room.worldId) {
                reply.code(400).send(
                    errorData(
                        "REPLACEMENT_ROOM_WRONG_WORLD",
                        "Replacement room mismatch",
                        "The replacement default room must belong to the same world.",
                        `Room ${replacementRoom.id} does not belong to world ${room.world.slug}.`
                    )
                );
                return;
            }

            if (!replacementRoom.isActive) {
                reply.code(409).send(
                    errorData(
                        "REPLACEMENT_ROOM_INACTIVE",
                        "Replacement room inactive",
                        "The replacement default room must be active.",
                        `Room ${replacementRoom.roomUrl} is inactive.`
                    )
                );
                return;
            }
        }

        if (!body.isActive && isDefaultRoom && !replacementRoom) {
            reply.code(409).send(
                errorData(
                    "DEFAULT_ROOM_DEACTIVATION_REQUIRES_REPLACEMENT",
                    "Replacement default required",
                    "Choose an active replacement default room before deactivating the current default room.",
                    `Room ${room.roomUrl} is currently the world's default room.`
                )
            );
            return;
        }

        if (!body.isActive && replacementRoom?.id === room.id) {
            reply.code(409).send(
                errorData(
                    "INVALID_REPLACEMENT_DEFAULT",
                    "Invalid replacement default",
                    "You cannot select the same room as replacement when deactivating it.",
                    `Room ${room.roomUrl} cannot replace itself as default while being deactivated.`
                )
            );
            return;
        }

        const updated = await app.db.$transaction(async (tx) => {
            const updatedRoom = await tx.room.update({
                where: { id: room.id },
                data: { isActive: body.isActive },
                select: { id: true, roomUrl: true, isActive: true, worldId: true },
            });

            let nextDefaultRoomId = room.world.defaultRoomId ?? null;

            if (replacementRoom) {
                nextDefaultRoomId = replacementRoom.id;
            }

            if (nextDefaultRoomId !== room.world.defaultRoomId) {
                await tx.world.update({
                    where: { id: room.worldId },
                    data: { defaultRoomId: nextDefaultRoomId },
                });
            }

            return {
                room: updatedRoom,
                worldSlug: room.world.slug,
                defaultRoomId: nextDefaultRoomId,
            };
        });

        reply.send({
            status: "ok",
            roomId: updated.room.id,
            roomUrl: updated.room.roomUrl,
            isActive: updated.room.isActive,
            worldSlug: updated.worldSlug,
            defaultRoomId: updated.defaultRoomId,
        });
    });

    app.get("/world/:worldSlug/rooms", { preHandler: requireAdminAuth }, async (request, reply) => {
        const params = worldSlugParams.parse(request.params);
        const query = worldRoomsQuery.parse(request.query);
        const includeInactive = parseBooleanFlag(query.includeInactive);

        const world = await app.db.world.findUnique({
            where: { slug: params.worldSlug },
            select: { id: true, slug: true, defaultRoomId: true },
        });

        if (!world) {
            reply.code(404).send(
                errorData(
                    "WORLD_NOT_FOUND",
                    "World not found",
                    "The requested world does not exist.",
                    `No world found for slug ${params.worldSlug}.`
                )
            );
            return;
        }

        const rooms = await app.db.room.findMany({
            where: includeInactive ? { worldId: world.id } : { worldId: world.id, isActive: true },
            include: { tagsTable: true },
            orderBy: { slug: "asc" },
        });

        reply.send(
            rooms.map((entry) => {
                const tags = new Set<string>(entry.tags);
                entry.tagsTable.forEach((tag) => tags.add(tag.tag));
                return {
                    id: entry.id,
                    name: getRoomDisplayName(entry),
                    roomUrl: entry.roomUrl,
                    wamUrl: entry.wamUrl ?? undefined,
                    tags: Array.from(tags).sort(),
                    isActive: entry.isActive,
                    isDefault: entry.id === world.defaultRoomId,
                };
            })
        );
    });

    app.get("/world/:worldSlug/default-room", { preHandler: requireAdminAuth }, async (request, reply) => {
        const params = worldSlugParams.parse(request.params);

        const world = await app.db.world.findUnique({
            where: { slug: params.worldSlug },
            include: { defaultRoom: true },
        });

        if (!world) {
            reply.code(404).send(
                errorData(
                    "WORLD_NOT_FOUND",
                    "World not found",
                    "The requested world does not exist.",
                    `No world found for slug ${params.worldSlug}.`
                )
            );
            return;
        }

        reply.send({
            worldId: world.id,
            worldSlug: world.slug,
            defaultRoom: world.defaultRoom
                ? {
                      id: world.defaultRoom.id,
                      name: getRoomDisplayName(world.defaultRoom),
                      roomUrl: world.defaultRoom.roomUrl,
                      isActive: world.defaultRoom.isActive,
                  }
                : null,
        });
    });

    app.put("/world/:worldSlug/default-room", { preHandler: requireAdminAuth }, async (request, reply) => {
        const params = worldSlugParams.parse(request.params);
        const body = worldDefaultBody.parse(request.body);

        const world = await app.db.world.findUnique({
            where: { slug: params.worldSlug },
            select: { id: true, slug: true },
        });

        if (!world) {
            reply.code(404).send(
                errorData(
                    "WORLD_NOT_FOUND",
                    "World not found",
                    "The requested world does not exist.",
                    `No world found for slug ${params.worldSlug}.`
                )
            );
            return;
        }

        const room = await app.db.room.findUnique({
            where: { id: body.roomId },
        });

        if (!room) {
            reply.code(404).send(
                errorData(
                    "ROOM_NOT_FOUND",
                    "Room not found",
                    "The requested room does not exist.",
                    `No room found for id ${body.roomId}.`
                )
            );
            return;
        }

        if (room.worldId !== world.id) {
            reply.code(400).send(
                errorData(
                    "ROOM_WRONG_WORLD",
                    "Room does not belong to world",
                    "The selected room belongs to a different world.",
                    `Room ${room.roomUrl} does not belong to world ${world.slug}.`
                )
            );
            return;
        }

        if (!room.isActive) {
            reply.code(409).send(
                errorData(
                    "DEFAULT_ROOM_INACTIVE",
                    "Default room must be active",
                    "You cannot set an inactive room as default.",
                    `Room ${room.roomUrl} is inactive.`
                )
            );
            return;
        }

        await app.db.world.update({
            where: { id: world.id },
            data: { defaultRoomId: room.id },
        });

        reply.send({
            status: "ok",
            worldId: world.id,
            worldSlug: world.slug,
            defaultRoom: {
                id: room.id,
                name: getRoomDisplayName(room),
                roomUrl: room.roomUrl,
                isActive: room.isActive,
            },
        });
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
