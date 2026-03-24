import { EnvironmentVariables } from "./EnvironmentVariableValidator";

const envChecking = EnvironmentVariables.safeParse(process.env);

// Will break the process if an error happens
if (!envChecking.success) {
    console.error("\n\n\n-----------------------------------------");
    console.error("FATAL ERRORS FOUND IN ENVIRONMENT VARIABLES!!!");
    console.error("-----------------------------------------\n");

    const formattedError = envChecking.error.format();

    for (const [name, value] of Object.entries(formattedError)) {
        if (Array.isArray(value)) {
            continue;
        }

        for (const error of value._errors) {
            console.error(`For variable "${name}": ${error}`);
        }
    }

    console.error("\n-----------------------------------------\n\n\n");

    process.exit(1);
}

const env: EnvironmentVariables = envChecking.data;

export const PLAY_URL = env.PLAY_URL;
export const MINIMUM_DISTANCE = env.MINIMUM_DISTANCE;
export const GROUP_RADIUS = env.GROUP_RADIUS;
export const ADMIN_API_URL = env.ADMIN_API_URL;
export const ADMIN_API_RETRY_DELAY = parseInt(process.env.ADMIN_API_RETRY_DELAY || "500");
export const ADMIN_API_TOKEN = env.ADMIN_API_TOKEN;
export const CPU_OVERHEAT_THRESHOLD = env.CPU_OVERHEAT_THRESHOLD;
export const JITSI_URL = env.JITSI_URL;
export const JITSI_ISS = env.JITSI_ISS;
export const SECRET_JITSI_KEY = env.SECRET_JITSI_KEY;
export const BBB_URL = env.BBB_URL;
export const BBB_SECRET = env.BBB_SECRET;
export const ENABLE_MAP_EDITOR = env.ENABLE_MAP_EDITOR;
export const HTTP_PORT = env.HTTP_PORT;
export const GRPC_PORT = env.GRPC_PORT;
export const MAX_PER_GROUP = env.MAX_PER_GROUP;
export const REDIS_HOST = env.REDIS_HOST;
export const REDIS_PORT = env.REDIS_PORT;
export const REDIS_PASSWORD = env.REDIS_PASSWORD;
export const STORE_VARIABLES_FOR_LOCAL_MAPS = env.STORE_VARIABLES_FOR_LOCAL_MAPS;
export const PROMETHEUS_AUTHORIZATION_TOKEN = env.PROMETHEUS_AUTHORIZATION_TOKEN;
export const PROMETHEUS_PORT = env.PROMETHEUS_PORT === env.HTTP_PORT ? 0 : env.PROMETHEUS_PORT;
export const MAP_STORAGE_URL = env.MAP_STORAGE_URL;
export const PUBLIC_MAP_STORAGE_URL = env.PUBLIC_MAP_STORAGE_URL;
export const PUBLIC_MAP_STORAGE_PREFIX = PUBLIC_MAP_STORAGE_URL ? new URL(PUBLIC_MAP_STORAGE_URL).pathname : undefined;
export const INTERNAL_MAP_STORAGE_URL = env.INTERNAL_MAP_STORAGE_URL;
export const PLAYER_VARIABLES_MAX_TTL = env.PLAYER_VARIABLES_MAX_TTL;
export const ENABLE_CHAT = env.ENABLE_CHAT;
export const ENABLE_CHAT_UPLOAD = env.ENABLE_CHAT_UPLOAD;
export const ENABLE_TELEMETRY = env.ENABLE_TELEMETRY;
export const SECURITY_EMAIL = env.SECURITY_EMAIL;
export const TELEMETRY_URL = env.TELEMETRY_URL;

export const SENTRY_DSN = env.SENTRY_DSN;
export const SENTRY_ENVIRONMENT = env.SENTRY_ENVIRONMENT;
export const SENTRY_RELEASE = env.SENTRY_RELEASE;
export const SENTRY_TRACES_SAMPLE_RATE = env.SENTRY_TRACES_SAMPLE_RATE;

export const GRPC_MAX_MESSAGE_SIZE = env.GRPC_MAX_MESSAGE_SIZE;

export const LIVEKIT_HOST: string | undefined = env.LIVEKIT_HOST;
export const LIVEKIT_API_KEY: string | undefined = env.LIVEKIT_API_KEY;
export const LIVEKIT_API_SECRET: string | undefined = env.LIVEKIT_API_SECRET;

export const MAX_USERS_FOR_WEBRTC = env.MAX_USERS_FOR_WEBRTC;

export const AI_NOTETAKER_ENABLED: boolean = env.AI_NOTETAKER_ENABLED;
export const AI_NOTETAKER_PERMISSION_POLICY: "all_users" | "selected_roles" = env.AI_NOTETAKER_PERMISSION_POLICY;
export const AI_NOTETAKER_ALLOWED_TAGS: string[] = env.AI_NOTETAKER_ALLOWED_TAGS;
export const AI_NOTETAKER_EMAIL_DIGEST_ENABLED: boolean = env.AI_NOTETAKER_EMAIL_DIGEST_ENABLED;
export const AI_NOTETAKER_STARTER_MUST_STAY: boolean = env.AI_NOTETAKER_STARTER_MUST_STAY;
export const AI_NOTETAKER_ALLOW_ADMIN_READ_ALL: boolean = env.AI_NOTETAKER_ALLOW_ADMIN_READ_ALL;
export const AI_NOTETAKER_TRANSCRIPT_RETENTION_DAYS: number = env.AI_NOTETAKER_TRANSCRIPT_RETENTION_DAYS;
export const AI_NOTETAKER_SUMMARY_RETENTION_DAYS: number = env.AI_NOTETAKER_SUMMARY_RETENTION_DAYS;
export const AI_NOTETAKER_SUMMARY_REFRESH_SEGMENTS: number = env.AI_NOTETAKER_SUMMARY_REFRESH_SEGMENTS;
export const AI_NOTETAKER_IDLE_WARNING_MS: number = env.AI_NOTETAKER_IDLE_WARNING_MS;
export const AI_NOTETAKER_IDLE_AUTO_STOP_MS: number = env.AI_NOTETAKER_IDLE_AUTO_STOP_MS;
export const AI_NOTETAKER_PARTICIPANT_TIMEOUT_MS: number = env.AI_NOTETAKER_PARTICIPANT_TIMEOUT_MS;
export const AI_NOTETAKER_MAINTENANCE_INTERVAL_MS: number = env.AI_NOTETAKER_MAINTENANCE_INTERVAL_MS;
export const AI_NOTETAKER_BOT_INGESTION_ENABLED: boolean = env.AI_NOTETAKER_BOT_INGESTION_ENABLED;
export const AI_NOTETAKER_BOT_SYNC_INTERVAL_MS: number = env.AI_NOTETAKER_BOT_SYNC_INTERVAL_MS;
export const AI_NOTETAKER_BOT_CHUNK_FLUSH_MS: number = env.AI_NOTETAKER_BOT_CHUNK_FLUSH_MS;
export const AI_NOTETAKER_BOT_MAX_CHUNK_BYTES: number = env.AI_NOTETAKER_BOT_MAX_CHUNK_BYTES;
export const AI_NOTETAKER_BOT_INGESTION_WS_PORT: number = env.AI_NOTETAKER_BOT_INGESTION_WS_PORT;
export const AI_NOTETAKER_BOT_INGESTION_WS_HOST: string | undefined = env.AI_NOTETAKER_BOT_INGESTION_WS_HOST;
export const AI_NOTETAKER_BOT_INGESTION_WS_PUBLIC_URL: string | undefined = env.AI_NOTETAKER_BOT_INGESTION_WS_PUBLIC_URL;
export const AI_NOTETAKER_BOT_INGESTION_TOKEN: string | undefined = env.AI_NOTETAKER_BOT_INGESTION_TOKEN;
export const AI_NOTETAKER_BOT_TRACK_MIME_TYPE: string | undefined = env.AI_NOTETAKER_BOT_TRACK_MIME_TYPE;
export const AI_NOTETAKER_AUDIO_STORAGE_DIR: string | undefined = env.AI_NOTETAKER_AUDIO_STORAGE_DIR;
export const AI_NOTETAKER_AUDIO_STORAGE_SOFT_LIMIT_BYTES: number = env.AI_NOTETAKER_AUDIO_STORAGE_SOFT_LIMIT_BYTES;
export const AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES: number = env.AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES;
export const AI_NOTETAKER_AUDIO_RETENTION_SUCCESS_HOURS: number = env.AI_NOTETAKER_AUDIO_RETENTION_SUCCESS_HOURS;
export const AI_NOTETAKER_AUDIO_RETENTION_FAILED_HOURS: number = env.AI_NOTETAKER_AUDIO_RETENTION_FAILED_HOURS;
export const AI_NOTETAKER_POST_MEETING_TRANSCRIPTION_ENABLED: boolean = env.AI_NOTETAKER_POST_MEETING_TRANSCRIPTION_ENABLED;
export const AI_NOTETAKER_DELIVERY_INTERVAL_MS: number = env.AI_NOTETAKER_DELIVERY_INTERVAL_MS;
export const AI_NOTETAKER_DELIVERY_MAX_RETRIES: number = env.AI_NOTETAKER_DELIVERY_MAX_RETRIES;
export const AI_NOTETAKER_DIGEST_WEBHOOK_URL: string | undefined = env.AI_NOTETAKER_DIGEST_WEBHOOK_URL;

export const MISTRAL_API_KEY: string | undefined = env.MISTRAL_API_KEY;
export const MISTRAL_BASE_URL: string | undefined = env.MISTRAL_BASE_URL;
export const MISTRAL_CHAT_MODEL: string | undefined = env.MISTRAL_CHAT_MODEL;
export const MISTRAL_TRANSCRIPTION_MODEL: string | undefined = env.MISTRAL_TRANSCRIPTION_MODEL;
export const MISTRAL_SUMMARY_MAX_CHARS: number = env.MISTRAL_SUMMARY_MAX_CHARS;


