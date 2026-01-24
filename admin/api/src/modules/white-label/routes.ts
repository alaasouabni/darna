import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errorData } from "../../lib/error-response";
import { config } from "../../config/env";

const querySchema = z.object({
    host: z.string(),
});

export async function whiteLabelRoutes(app: FastifyInstance) {
    app.get("/white-label/cf-challenge", async (request, reply) => {
        const query = querySchema.parse(request.query);
        const world = await app.db.world.findFirst({ where: { domain: query.host } });

        let challenge: string | undefined;
        const settings = world?.settings as Record<string, unknown> | null | undefined;
        if (settings) {
            if (typeof settings.cfChallenge === "string") {
                challenge = settings.cfChallenge;
            } else if (
                settings.cfChallenges &&
                typeof settings.cfChallenges === "object" &&
                settings.cfChallenges !== null
            ) {
                const perHost = (settings.cfChallenges as Record<string, unknown>)[query.host];
                if (typeof perHost === "string") {
                    challenge = perHost;
                }
            }
        }

        if (!challenge) {
            challenge = config.CF_CHALLENGE_TOKEN ?? undefined;
        }

        if (!challenge) {
            reply.code(404).send(
                errorData(
                    "CHALLENGE_NOT_FOUND",
                    "Challenge not found",
                    "No challenge configured for this hostname.",
                    `No challenge token found for ${query.host}.`
                )
            );
            return;
        }

        reply.code(200).send(challenge);
    });
}
