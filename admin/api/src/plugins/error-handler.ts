import type { FastifyInstance } from "fastify";
import { errorData } from "../lib/error-response";

export function errorHandler(app: FastifyInstance) {
    app.setNotFoundHandler((request, reply) => {
        reply.code(404).send(
            errorData(
                "NOT_FOUND",
                "Not found",
                "The requested endpoint does not exist.",
                `No route matches ${request.method} ${request.url}.`
            )
        );
    });

    app.setErrorHandler((error, _request, reply) => {
        const status = error.statusCode ?? 500;
        reply.log.error(error);
        reply.code(status).send(
            errorData(
                "INTERNAL_ERROR",
                "Server error",
                "An unexpected error occurred.",
                error.message
            )
        );
    });
}