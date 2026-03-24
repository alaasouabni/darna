import { z } from "zod";
import {
    AbsoluteOrRelativeUrl,
    BoolAsString,
    emptyStringToUndefined,
    PositiveIntAsString,
    toBool,
    toNumber,
} from "@workadventure/shared-utils/src/EnvironmentVariables/EnvironmentVariableUtils";

export const EnvironmentVariables = z.object({
    PLAY_URL: z.string().url().describe("Public URL of the play/frontend service"),
    MINIMUM_DISTANCE: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 64))
        .describe("Minimum distance (in pixels) before users are considered to be in proximity. Defaults to 64"),
    GROUP_RADIUS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 48))
        .describe("Radius (in pixels) of a group/bubble. Defaults to 48"),
    ADMIN_API_URL: AbsoluteOrRelativeUrl.optional()
        .transform(emptyStringToUndefined)
        .describe("URL of the admin API for centralized configuration"),
    ADMIN_API_TOKEN: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .describe("Authentication token for the admin API"),
    CPU_OVERHEAT_THRESHOLD: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 80))
        .describe(
            "CPU usage threshold (in %) that triggers dropping intermediate movement packets to ease to CPU load. Defaults to 80"
        ),
    JITSI_URL: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .describe("URL of the Jitsi Meet server for video conferencing"),
    JITSI_ISS: z.string().optional().transform(emptyStringToUndefined).describe("Jitsi JWT issuer for authentication"),
    SECRET_JITSI_KEY: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .describe("Secret key for Jitsi JWT token generation"),
    BBB_URL: z
        .string()
        .url()
        .or(z.literal(""))
        .optional()
        .transform(emptyStringToUndefined)
        .describe("BigBlueButton server URL for video conferencing"),
    BBB_SECRET: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .describe("BigBlueButton shared secret for API authentication"),
    ENABLE_MAP_EDITOR: BoolAsString.optional()
        .transform((val) => toBool(val, false))
        .describe("Enable the built-in map editor. Defaults to false"),
    HTTP_PORT: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 8080))
        .describe("HTTP port for the back service. Defaults to 8080"),
    GRPC_PORT: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 50051))
        .describe("gRPC port for the back service. Defaults to 50051"),
    MAX_PER_GROUP: PositiveIntAsString.optional()
        .or(z.string().max(0))
        .transform((val) => toNumber(val, 4))
        .describe("Maximum number of users in a bubble/group. Defaults to 4"),
    REDIS_HOST: z.string().optional().transform(emptyStringToUndefined).describe("Redis server hostname or IP address"),
    REDIS_PORT: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 6379))
        .describe("Redis server port. Defaults to 6379"),
    REDIS_PASSWORD: z.string().optional().transform(emptyStringToUndefined).describe("Redis authentication password"),
    STORE_VARIABLES_FOR_LOCAL_MAPS: BoolAsString.optional()
        .transform((val) => toBool(val, false))
        .describe(
            "If true, store player variables even for local maps (not recommended for production). Defaults to false"
        ),
    PROMETHEUS_AUTHORIZATION_TOKEN: z.string().optional().describe("The token to access the Prometheus metrics."),
    PROMETHEUS_PORT: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 0))
        .describe(
            "The port to access the Prometheus metrics. If not set, the default port is used AND an authorization token is required."
        ),
    MAP_STORAGE_URL: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .describe(
            'The URL to the gRPC endpoint of the map-storage server (for instance: "map-storage.example.com:50053")'
        ),
    PUBLIC_MAP_STORAGE_URL: z
        .string()
        .url()
        .optional()
        .transform(emptyStringToUndefined)
        .describe('The public URL to the map-storage server (for instance: "https://map-storage.example.com")'),
    INTERNAL_MAP_STORAGE_URL: AbsoluteOrRelativeUrl.optional()
        .transform(emptyStringToUndefined)
        .describe('The internal URL to the map-storage server (for instance: "https://map-storage:3000")'),
    PLAYER_VARIABLES_MAX_TTL: z
        .string()
        .optional()
        .transform((val) => toNumber(val, -1))
        .describe(`The maximum time to live of player variables for logged players, expressed in seconds (no limit by default).
Use "-1" for infinity.
Note that anonymous players don't have any TTL limit because their data is stored in local storage, not in Redis database.
`),
    ENABLE_CHAT: BoolAsString.optional()
        .transform((val) => toBool(val, true))
        .describe("Enable/disable the chat feature. Defaults to true"),
    ENABLE_CHAT_UPLOAD: BoolAsString.optional()
        .transform((val) => toBool(val, true))
        .describe("Enable/disable file upload in chat. Defaults to true"),
    ENABLE_TELEMETRY: BoolAsString.optional()
        .transform((val) => toBool(val, true))
        .describe(
            "By default, WorkAdventure will send telemetry usage once a day. This data contains the version of WorkAdventure used and very rough usage (max number of users...). The statistics collected through telemetry can provide developers valuable insights into WorkAdventure versions that are actually used. No personal user data is sent. Please keep this setting to true unless your WorkAdventure installation is 'secret'."
        ),
    SECURITY_EMAIL: z
        .string()
        .email()
        .optional()
        .describe(
            'This email address will be notified if your WorkAdventure version contains a known security flaw. ENABLE_TELEMETRY must be set to "true" for this.'
        ),
    TELEMETRY_URL: z
        .string()
        .optional()
        .default("https://stats.workadventu.re")
        .describe("URL where telemetry data is sent."),
    SENTRY_DSN: z.string().optional().describe("If set, WorkAdventure will send errors to Sentry"),
    SENTRY_RELEASE: z
        .string()
        .optional()
        .describe("The Sentry release we target. Only used if SENTRY_DSN is configured."),
    SENTRY_TRACES_SAMPLE_RATE: z
        .string()
        .optional()
        .transform((val) => toNumber(val, 0.1))
        .describe("The Sentry traces sample rate. Only used if SENTRY_DSN is configured. Defaults to 0.1"),
    SENTRY_ENVIRONMENT: z
        .string()
        .optional()
        .describe("The Sentry environnement we target. Only used if SENTRY_DSN is configured."),
    GRPC_MAX_MESSAGE_SIZE: PositiveIntAsString.optional()
        .or(z.string().max(0))
        .transform((val) => toNumber(val, 20 * 1024 * 1024)) // Default to 20 MB
        .describe("The maximum size of a gRPC message. Defaults to 20 MB."),
    LIVEKIT_HOST: z.string().optional().describe("The Livekit host."),
    LIVEKIT_API_KEY: z.string().optional().describe("The Livekit API key."),
    LIVEKIT_API_SECRET: z.string().optional().describe("The Livekit API secret."),
    MAX_USERS_FOR_WEBRTC: PositiveIntAsString.optional()
        .or(z.string().max(0))
        .transform((val) => toNumber(val, 4))
        .describe("The maximum number of users for WebRTC."),
    AI_NOTETAKER_ENABLED: BoolAsString.optional()
        .transform((val) => toBool(val, false))
        .describe("Enable AI notetaker backend endpoints and services. Defaults to false."),
    AI_NOTETAKER_PERMISSION_POLICY: z
        .enum(["all_users", "selected_roles"])
        .optional()
        .default("all_users")
        .describe("Who can start/stop AI notetaker: all users or selected roles."),
    AI_NOTETAKER_ALLOWED_TAGS: z
        .string()
        .optional()
        .transform((value) =>
            value
                ? value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter((tag) => tag.length > 0)
                : []
        )
        .describe("Comma-separated tags authorized when AI_NOTETAKER_PERMISSION_POLICY=selected_roles."),
    AI_NOTETAKER_EMAIL_DIGEST_ENABLED: BoolAsString.optional()
        .transform((val) => toBool(val, false))
        .describe("Enable post-session digest job enqueuing for AI notetaker."),
    AI_NOTETAKER_STARTER_MUST_STAY: BoolAsString.optional()
        .transform((val) => toBool(val, false))
        .describe("Auto-stop note sessions if the user who started the session leaves the room."),
    AI_NOTETAKER_ALLOW_ADMIN_READ_ALL: BoolAsString.optional()
        .transform((val) => toBool(val, false))
        .describe("Allow users with admin tag to read all note sessions (disabled by default)."),
    AI_NOTETAKER_TRANSCRIPT_RETENTION_DAYS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 90))
        .describe("Transcript retention in days before transcript segments are purged. Defaults to 90."),
    AI_NOTETAKER_SUMMARY_RETENTION_DAYS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 180))
        .describe("Session retention in days before summaries/sessions are deleted. Defaults to 180."),
    AI_NOTETAKER_SUMMARY_REFRESH_SEGMENTS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 10))
        .describe("Refresh rolling summary after this many new transcript segments. Defaults to 10."),
    MISTRAL_API_KEY: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .describe("API key used to access Mistral services."),
    MISTRAL_BASE_URL: z
        .string()
        .url()
        .optional()
        .transform(emptyStringToUndefined)
        .default("https://api.mistral.ai")
        .describe("Base URL for Mistral API."),
    MISTRAL_CHAT_MODEL: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .default("mistral-small-latest")
        .describe("Mistral chat model used for meeting summary generation."),
    MISTRAL_TRANSCRIPTION_MODEL: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .default("voxtral-mini-latest")
        .describe("Mistral audio transcription model used for AI notetaker speech chunks."),
    MISTRAL_SUMMARY_MAX_CHARS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 20000))
        .describe("Maximum transcript size (in characters) sent to Mistral for summary generation. Defaults to 20000."),
    AI_NOTETAKER_IDLE_WARNING_MS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 5 * 60 * 1000))
        .describe("Silence duration (ms) before entering idle warning state. Defaults to 300000."),
    AI_NOTETAKER_IDLE_AUTO_STOP_MS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 2 * 60 * 1000))
        .describe("Additional silence duration (ms) after warning before auto-stop. Defaults to 120000."),
    AI_NOTETAKER_PARTICIPANT_TIMEOUT_MS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 2 * 60 * 1000))
        .describe("Presence timeout (ms) used to infer room emptiness. Defaults to 120000."),
    AI_NOTETAKER_MAINTENANCE_INTERVAL_MS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 15000))
        .describe("Background maintenance interval (ms) for AI notetaker lifecycle checks. Defaults to 15000."),
    AI_NOTETAKER_BOT_INGESTION_ENABLED: BoolAsString.optional()
        .transform((val) => toBool(val, true))
        .describe("Enable in-process LiveKit bot ingestion for AI notetaker sessions. Defaults to true."),
    AI_NOTETAKER_BOT_SYNC_INTERVAL_MS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 10000))
        .describe("Interval (ms) for syncing participant audio tracks with LiveKit egress streams. Defaults to 10000."),
    AI_NOTETAKER_BOT_CHUNK_FLUSH_MS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 4000))
        .describe("Interval (ms) used to flush buffered bot audio chunks to transcription. Defaults to 4000."),
    AI_NOTETAKER_BOT_MAX_CHUNK_BYTES: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 256000))
        .describe("Maximum buffered audio size (bytes) before forcing a transcription flush. Defaults to 256000."),
    AI_NOTETAKER_BOT_INGESTION_WS_PORT: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 8091))
        .describe("WebSocket port for receiving LiveKit bot egress audio streams. Defaults to 8091."),
    AI_NOTETAKER_BOT_INGESTION_WS_HOST: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .default("0.0.0.0")
        .describe("Host binding for bot ingestion WebSocket server. Defaults to 0.0.0.0."),
    AI_NOTETAKER_BOT_INGESTION_WS_PUBLIC_URL: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .default("ws://back:8091/ai-notetaker/ingest")
        .describe("Public WS URL used by LiveKit egress to push track audio for AI notetaker."),
    AI_NOTETAKER_BOT_INGESTION_TOKEN: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .describe("Optional shared token appended to bot ingestion WS URL and required by ingestion endpoint."),
    AI_NOTETAKER_BOT_TRACK_MIME_TYPE: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .default("audio/x-raw")
        .describe("Mime type emitted by LiveKit track websocket egress. Defaults to audio/x-raw (pcm_s16le)."),
    AI_NOTETAKER_AUDIO_STORAGE_DIR: z
        .string()
        .optional()
        .transform(emptyStringToUndefined)
        .default("/tmp/ai-notetaker-audio")
        .describe("Directory where temporary AI notetaker audio artifacts are stored."),
    AI_NOTETAKER_AUDIO_STORAGE_SOFT_LIMIT_BYTES: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 20 * 1024 * 1024 * 1024))
        .describe("Soft limit for temporary AI notetaker audio storage in bytes. Defaults to 20GB."),
    AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 25 * 1024 * 1024 * 1024))
        .describe("Hard cap for temporary AI notetaker audio storage in bytes. Defaults to 25GB."),
    AI_NOTETAKER_AUDIO_RETENTION_SUCCESS_HOURS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 24))
        .describe("Retention duration in hours for successfully transcribed audio artifacts. Defaults to 24."),
    AI_NOTETAKER_AUDIO_RETENTION_FAILED_HOURS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 24 * 7))
        .describe("Retention duration in hours for failed/unprocessed audio artifacts. Defaults to 168 (7 days)."),
    AI_NOTETAKER_POST_MEETING_TRANSCRIPTION_ENABLED: BoolAsString.optional()
        .transform((val) => toBool(val, true))
        .describe("Enable full-artifact post-meeting transcription pass before final summary. Defaults to true."),
    AI_NOTETAKER_DELIVERY_INTERVAL_MS: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 10000))
        .describe("Delivery queue polling interval (ms) for AI notetaker digest jobs. Defaults to 10000."),
    AI_NOTETAKER_DELIVERY_MAX_RETRIES: PositiveIntAsString.optional()
        .transform((val) => toNumber(val, 5))
        .describe("Maximum retry attempts before moving AI notetaker digest jobs to dead-letter queue. Defaults to 5."),
    AI_NOTETAKER_DIGEST_WEBHOOK_URL: AbsoluteOrRelativeUrl.optional()
        .transform(emptyStringToUndefined)
        .describe("Optional webhook endpoint receiving finalized AI notetaker digest payloads."),
});

export type EnvironmentVariables = z.infer<typeof EnvironmentVariables>;
