import type { FastifyCorsOptions } from "@fastify/cors";
import type { AppConfig } from "../config/env";

export function buildCorsOptions(config: AppConfig): FastifyCorsOptions {
    if (!config.allowedOrigins.length) {
        return { origin: true, credentials: true };
    }

    return {
        origin: (origin, cb) => {
            if (!origin) {
                cb(null, true);
                return;
            }
            if (config.allowedOrigins.includes(origin)) {
                cb(null, true);
                return;
            }
            cb(new Error("Origin not allowed"), false);
        },
        credentials: true,
    };
}