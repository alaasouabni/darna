import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OpidWokaNamePolicy, isMapDetailsData } from "@workadventure/messages";
import { WAMMetadata } from "@workadventure/map-editor";
import { errorData, unauthorizedData } from "../../lib/error-response";
import { requireAdminAuth } from "../../plugins/auth";
import { normalizeRoomPath } from "../../lib/room-url";
import { resolveMapFromPlayUri } from "../../lib/map-utils";
import { config } from "../../config/env";

const querySchema = z.object({
    playUri: z.string(),
    userId: z.string().optional(),
    accessToken: z.string().optional(),
});

function buildThirdPartyConfig() {
    const thirdParty: { jitsi?: { url: string; iss?: string | null; secret?: string | null }; bbb?: { url: string; secret?: string | null } } =
        {};
    if (config.JITSI_URL) {
        thirdParty.jitsi = {
            url: config.JITSI_URL,
            iss: config.JITSI_ISS ?? null,
            secret: config.JITSI_SECRET ?? null,
        };
    }
    if (config.BBB_URL) {
        thirdParty.bbb = {
            url: config.BBB_URL,
            secret: config.BBB_SECRET ?? null,
        };
    }
    return Object.keys(thirdParty).length ? thirdParty : undefined;
}

function parseMapOverrides(settings: unknown) {
    if (!settings || typeof settings !== "object") {
        return {};
    }
    const candidate = (settings as Record<string, unknown>).mapDetails ?? settings;
    const parsed = isMapDetailsData.partial().safeParse(candidate);
    return parsed.success ? parsed.data : {};
}

export async function mapRoutes(app: FastifyInstance) {
    app.get("/map", { preHandler: requireAdminAuth }, async (request, reply) => {
        // /map reflects runtime room activation and default-room routing; do not cache responses.
        reply.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        reply.header("Pragma", "no-cache");
        reply.header("Expires", "0");
        reply.header("Vary", "Authorization, Accept-Language");

        const startedAt = Date.now();
        const logStep = (step: string, extra?: Record<string, unknown>) => {
            request.log.info({ step, ms: Date.now() - startedAt, ...extra }, "map request");
        };

        logStep("handler-enter");
        const query = querySchema.parse(request.query);
        logStep("query-parsed", { playUri: query.playUri });
        const roomPath = normalizeRoomPath(query.playUri);
        logStep("room-path", { roomPath });

        if (roomPath === "/") {
            const baseUrl = new URL(query.playUri);
            let redirectPath: string | null = null;

            const world = await app.db.world.findFirst({
                where: { domain: baseUrl.hostname },
                include: { defaultRoom: true },
            });
            logStep("world-lookup", { domain: baseUrl.hostname, worldId: world?.id ?? null });

            if (world?.defaultRoom?.isActive) {
                redirectPath = world.defaultRoom.roomUrl;
            }

            if (!redirectPath && world) {
                const fallbackRoom = await app.db.room.findFirst({
                    where: { worldId: world.id, isActive: true },
                    orderBy: { createdAt: "asc" },
                });
                logStep("fallback-room", { roomId: fallbackRoom?.id ?? null });
                redirectPath = fallbackRoom?.roomUrl ?? null;
            }

            if (redirectPath) {
                logStep("redirect", { redirectPath });
                baseUrl.pathname = redirectPath;
                reply.send({ redirectUrl: baseUrl.toString() });
                return;
            }
        }

        const room = await app.db.room.findUnique({
            where: { roomUrl: roomPath },
            include: { world: true },
        });
        logStep("room-lookup", { roomId: room?.id ?? null });

        if (room && !room.isActive) {
            reply.code(403).send(unauthorizedData("This room is currently inactive."));
            return;
        }

        const resolution = resolveMapFromPlayUri(query.playUri, room);
        logStep("map-resolution", {
            path: resolution.path,
            hasMapUrl: Boolean(resolution.mapUrl),
            hasWamUrl: Boolean(resolution.wamUrl),
        });
        if (resolution.redirectUrl) {
            logStep("resolution-redirect", { redirectUrl: resolution.redirectUrl });
            reply.send({ redirectUrl: resolution.redirectUrl });
            return;
        }

        if (resolution.path.startsWith("/@/") && !room) {
            reply.code(404).send(
                errorData(
                    "ROOM_NOT_FOUND",
                    "Room not found",
                    "The requested room does not exist.",
                    `No room found for path ${resolution.path}.`
                )
            );
            return;
        }

        if (!resolution.mapUrl && !resolution.wamUrl) {
            reply.code(404).send(
                errorData(
                    "MAP_NOT_FOUND",
                    "Map not found",
                    "The requested map could not be resolved.",
                    `No map available for ${resolution.path}.`
                )
            );
            return;
        }

        const opidPolicy = OpidWokaNamePolicy.safeParse(config.OPENID_WOKA_NAME_POLICY);
        const mapDefaults = {
            authenticationMandatory: config.DISABLE_ANONYMOUS,
            opidLogoutRedirectUrl: config.OPENID_LOGOUT_REDIRECT_URL ?? null,
            opidWokaNamePolicy: opidPolicy.success ? opidPolicy.data : null,
            enableChat: config.ENABLE_CHAT,
            enableChatUpload: config.ENABLE_CHAT_UPLOAD,
            enableChatOnlineList: config.ENABLE_CHAT_ONLINE_LIST,
            enableChatDisconnectedList: config.ENABLE_CHAT_DISCONNECTED_LIST,
            enableSay: config.ENABLE_SAY,
            enableIssueReport: config.ENABLE_ISSUE_REPORT || config.ENABLE_REPORT_ISSUES_MENU,
            canReport: config.ENABLE_ISSUE_REPORT || config.ENABLE_REPORT_ISSUES_MENU,
            reportIssuesUrl: config.REPORT_ISSUES_URL ?? null,
            entityCollectionsUrls: config.entityCollectionUrls.length ? config.entityCollectionUrls : undefined,
            enableMatrixChat: Boolean(
                config.MATRIX_PUBLIC_URI &&
                    config.MATRIX_API_URI &&
                    config.MATRIX_ADMIN_USER &&
                    config.MATRIX_ADMIN_PASSWORD &&
                    config.MATRIX_DOMAIN
            ),
            thirdParty: buildThirdPartyConfig(),
            showPoweredBy: true,
        };

        const overrides = parseMapOverrides(room?.world.settings ?? null);
        const metadata =
            room?.metadata && WAMMetadata.safeParse(room.metadata).success ? room.metadata : room?.metadata;

        const mapDetails = {
            ...mapDefaults,
            ...overrides,
            mapUrl: resolution.mapUrl ?? overrides.mapUrl,
            wamUrl: resolution.wamUrl ?? overrides.wamUrl,
            editable: resolution.editable ?? overrides.editable,
            group: overrides.group ?? room?.world.slug ?? null,
            metadata: metadata ?? overrides.metadata,
            roomName:
                overrides.roomName ??
                (metadata && typeof metadata === "object" ? (metadata as { name?: string }).name : null) ??
                room?.slug ??
                null,
            isLogged: overrides.isLogged ?? Boolean(query.userId || query.accessToken),
        };

        reply.send(mapDetails);
    });
}
