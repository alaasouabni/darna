import { buildApp } from "./app";
import { config } from "./config/env";

const app = buildApp();

app.listen({ port: config.ADMIN_PORT, host: config.ADMIN_HOST })
    .then((address) => {
        app.log.info(`Admin API listening at ${address}`);
    })
    .catch((err) => {
        app.log.error(err, "Failed to start admin API");
        process.exit(1);
    });