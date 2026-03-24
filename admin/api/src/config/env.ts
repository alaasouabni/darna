import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const EnvSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    ADMIN_PORT: z.coerce.number().default(3100),
    ADMIN_HOST: z.string().default("0.0.0.0"),
    ADMIN_PUBLIC_URL: z.string().url().optional(),
    ADMIN_API_TOKEN: z.string().optional(),
    ADMIN_ALLOWED_ORIGINS: z.string().optional(),
    ADMIN_ALLOWED_DOMAINS: z.string().optional(),
    ADMIN_LOG_LEVEL: z.string().default("info"),
    ADMIN_JWT_ISSUER: z.string().url().optional(),
    ADMIN_JWT_AUDIENCE: z.string().optional(),
    ADMIN_JWT_JWKS_URI: z.string().url().optional(),
    ADMIN_JWT_RESOURCE: z.string().optional(),
    ADMIN_JWT_ROLE_MAPPING: z.string().optional(),
    ADMIN_JWT_ROLE_CLAIMS: z.string().optional(),
    ADMIN_KEYCLOAK_URL: z.string().url().optional(),
    ADMIN_KEYCLOAK_REALM: z.string().optional(),
    ADMIN_KEYCLOAK_CLIENT_ID: z.string().optional(),
    ADMIN_KEYCLOAK_CLIENT_SECRET: z.string().optional(),
    ADMIN_SOCKET_JWT_SECRET: z.string().optional(),
    ADMIN_SOCKET_TTL_SECONDS: z.coerce.number().default(900),
    DATABASE_URL: z.string().optional(),
    ASSETS_BASE_URL: z.string().url().optional(),
    LIVEKIT_HOST: z.string().optional(),
    LIVEKIT_API_KEY: z.string().optional(),
    LIVEKIT_API_SECRET: z.string().optional(),
    STUN_SERVER: z.string().optional(),
    TURN_SERVER: z.string().optional(),
    TURN_USER: z.string().optional(),
    TURN_PASSWORD: z.string().optional(),
    TURN_STATIC_AUTH_SECRET: z.string().optional(),
    ROOM_API_KEYS: z.string().optional(),
    PUBLIC_MAP_STORAGE_URL: z.string().optional(),
    INTERNAL_MAP_STORAGE_URL: z.string().optional(),
    CF_CHALLENGE_TOKEN: z.string().optional(),
    START_ROOM_URL: z.string().optional(),
    ENABLE_MAP_EDITOR: z.coerce.boolean().default(false),
    MAP_EDITOR_ALLOW_ALL_USERS: z.coerce.boolean().default(false),
    MAP_EDITOR_ALLOWED_USERS: z.string().optional(),
    DISABLE_ANONYMOUS: z.coerce.boolean().default(false),
    INVITE_ONLY_ONBOARDING: z.coerce.boolean().default(false),
    INVITE_DEFAULT_MAX_USES: z.coerce.number().int().positive().default(50),
    INVITE_DEFAULT_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
    OPENID_WOKA_NAME_POLICY: z.string().optional(),
    OPENID_LOGOUT_REDIRECT_URL: z.string().optional(),
    ENABLE_CHAT: z.coerce.boolean().default(true),
    ENABLE_CHAT_UPLOAD: z.coerce.boolean().default(true),
    ENABLE_CHAT_ONLINE_LIST: z.coerce.boolean().default(true),
    ENABLE_CHAT_DISCONNECTED_LIST: z.coerce.boolean().default(true),
    ENABLE_SAY: z.coerce.boolean().default(true),
    ENABLE_ISSUE_REPORT: z.coerce.boolean().default(false),
    ENABLE_REPORT_ISSUES_MENU: z.coerce.boolean().default(false),
    REPORT_ISSUES_URL: z.string().optional(),
    ENTITY_COLLECTION_URLS: z.string().optional(),
    JITSI_URL: z.string().optional(),
    JITSI_ISS: z.string().optional(),
    JITSI_SECRET: z.string().optional(),
    BBB_URL: z.string().optional(),
    BBB_SECRET: z.string().optional(),
    MATRIX_API_URI: z.string().optional(),
    MATRIX_PUBLIC_URI: z.string().optional(),
    MATRIX_ADMIN_USER: z.string().optional(),
    MATRIX_ADMIN_PASSWORD: z.string().optional(),
    MATRIX_DOMAIN: z.string().optional(),
    KLAXOON_ENABLED: z.coerce.boolean().default(false),
    YOUTUBE_ENABLED: z.coerce.boolean().default(false),
    GOOGLE_DRIVE_ENABLED: z.coerce.boolean().default(false),
    GOOGLE_DOCS_ENABLED: z.coerce.boolean().default(false),
    GOOGLE_SHEETS_ENABLED: z.coerce.boolean().default(false),
    GOOGLE_SLIDES_ENABLED: z.coerce.boolean().default(false),
    ERASER_ENABLED: z.coerce.boolean().default(false),
    EXCALIDRAW_ENABLED: z.coerce.boolean().default(false),
    CARDS_ENABLED: z.coerce.boolean().default(false),
    TLDRAW_ENABLED: z.coerce.boolean().default(false),
    NOTETAKER_API_URL: z.string().url().default("http://back:8080"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

const raw = EnvSchema.parse(process.env);

const splitList = (value?: string): string[] =>
    value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];

function deriveKeycloakFromIssuer(issuer?: string) {
    if (!issuer) {
        return null;
    }

    try {
        const url = new URL(issuer);
        const parts = url.pathname.split("/").filter(Boolean);
        const realmIndex = parts.indexOf("realms");
        const realm = realmIndex >= 0 ? parts[realmIndex + 1] : parts[parts.length - 1];
        if (!realm) {
            return null;
        }
        return {
            url: url.origin,
            realm,
        };
    } catch {
        return null;
    }
}

const derivedKeycloak = deriveKeycloakFromIssuer(raw.ADMIN_JWT_ISSUER);
const adminKeycloakUrl = raw.ADMIN_KEYCLOAK_URL ?? derivedKeycloak?.url;
const adminKeycloakRealm = raw.ADMIN_KEYCLOAK_REALM ?? derivedKeycloak?.realm;

export const config = {
    ...raw,
    allowedOrigins: splitList(raw.ADMIN_ALLOWED_ORIGINS),
    allowedDomains: splitList(raw.ADMIN_ALLOWED_DOMAINS),
    roomApiKeys: splitList(raw.ROOM_API_KEYS),
    mapEditorAllowedUsers: splitList(raw.MAP_EDITOR_ALLOWED_USERS),
    adminJwtRoleClaims: splitList(raw.ADMIN_JWT_ROLE_CLAIMS),
    entityCollectionUrls: splitList(raw.ENTITY_COLLECTION_URLS),
    adminKeycloakUrl,
    adminKeycloakRealm,
};
