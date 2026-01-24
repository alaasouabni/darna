import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errorData } from "../../lib/error-response";
import { getCompanionDetails, getWokaDetails } from "../../lib/catalogs";
import { requireAdminAuth } from "../../plugins/auth";

const saveNameBody = z.object({
    playUri: z.string(),
    userIdentifier: z.string(),
    name: z.string(),
});

const saveTexturesBody = z.object({
    playUri: z.string(),
    userIdentifier: z.string(),
    textures: z.array(z.string()),
});

const saveCompanionBody = z.object({
    playUri: z.string(),
    userIdentifier: z.string(),
    texture: z.string().nullable(),
});

export async function saveRoutes(app: FastifyInstance) {
    app.post("/save-name", { preHandler: requireAdminAuth }, async (request, reply) => {
        const body = saveNameBody.parse(request.body);

        await app.db.member.upsert({
            where: { externalId: body.userIdentifier },
            update: { displayName: body.name },
            create: { externalId: body.userIdentifier, displayName: body.name },
        });

        reply.code(204).send();
    });

    app.post("/save-textures", { preHandler: requireAdminAuth }, async (request, reply) => {
        const body = saveTexturesBody.parse(request.body);
        const details = getWokaDetails(body.textures);

        if (!details) {
            reply.code(404).send(
                errorData(
                    "TEXTURE_NOT_FOUND",
                    "Texture not found",
                    "Some textures could not be resolved.",
                    "Ensure all texture IDs exist in the catalog."
                )
            );
            return;
        }

        await app.db.member.upsert({
            where: { externalId: body.userIdentifier },
            update: { characterTextureIds: body.textures },
            create: { externalId: body.userIdentifier, characterTextureIds: body.textures },
        });

        reply.code(204).send();
    });

    app.post("/save-companion-texture", { preHandler: requireAdminAuth }, async (request, reply) => {
        const body = saveCompanionBody.parse(request.body);

        if (body.texture && !getCompanionDetails(body.texture)) {
            reply.code(404).send(
                errorData(
                    "COMPANION_NOT_FOUND",
                    "Companion not found",
                    "The companion texture could not be resolved.",
                    "Ensure the companion ID exists in the catalog."
                )
            );
            return;
        }

        await app.db.member.upsert({
            where: { externalId: body.userIdentifier },
            update: { companionTextureId: body.texture },
            create: { externalId: body.userIdentifier, companionTextureId: body.texture },
        });

        reply.code(204).send();
    });
}
