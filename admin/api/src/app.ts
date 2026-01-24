import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config } from "./config/env";
import { loggerOptions } from "./config/logger";
import { authPlugin } from "./plugins/auth";
import { buildCorsOptions } from "./plugins/cors";
import { dbPlugin } from "./plugins/db";
import { errorHandler } from "./plugins/error-handler";
import { registerRoutes } from "./routes";

export function buildApp() {
    const app = Fastify({ logger: loggerOptions });

    app.register(helmet);
    app.register(cors, buildCorsOptions(config));
    app.register(sensible);
    app.register(dbPlugin);
    app.register(authPlugin);
    app.register(registerRoutes);

    errorHandler(app);

    return app;
}