import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errorData } from "../../lib/error-response";
import { extractWorldSlug, normalizeRoomPath } from "../../lib/room-url";
import { requireAdminAuth } from "../../plugins/auth";

const bodySchema = z.object({
    reportedUserUuid: z.string(),
    reportedUserComment: z.string(),
    reporterUserUuid: z.string(),
    reportWorldSlug: z.string(),
});

const listQuerySchema = z.object({
    status: z.string().optional(),
    worldSlug: z.string().optional(),
    take: z.coerce.number().default(50),
    skip: z.coerce.number().default(0),
});

const updateParamsSchema = z.object({
    id: z.string(),
});

const updateBodySchema = z.object({
    status: z.enum(["open", "banned", "rejected", "resolved"]),
});

export async function reportRoutes(app: FastifyInstance) {
    app.get("/reports", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = listQuerySchema.parse(request.query);
        const statuses = query.status
            ? query.status.split(",").map((status) => status.trim()).filter(Boolean)
            : [];
        const where = {
            ...(statuses.length ? { status: { in: statuses } } : {}),
            ...(query.worldSlug ? { world: { slug: query.worldSlug } } : {}),
        };

        const [total, reports] = await Promise.all([
            app.db.report.count({ where }),
            app.db.report.findMany({
                where,
                include: {
                    world: true,
                    reportedMember: true,
                    reporterMember: true,
                },
                orderBy: { createdAt: "desc" },
                take: query.take,
                skip: query.skip,
            }),
        ]);

        reply.send({
            total,
            reports: reports.map((report) => ({
                id: report.id,
                worldSlug: report.world.slug,
                status: report.status,
                comment: report.comment,
                createdAt: report.createdAt.toISOString(),
                updatedAt: report.updatedAt.toISOString(),
                reportedMember: {
                    id: report.reportedMember.externalId,
                    email: report.reportedMember.email ?? null,
                },
                reporterMember: {
                    id: report.reporterMember.externalId,
                    email: report.reporterMember.email ?? null,
                },
            })),
        });
    });

    app.patch("/report/:id", { preHandler: requireAdminAuth }, async (request, reply) => {
        const params = updateParamsSchema.parse(request.params);
        const body = updateBodySchema.parse(request.body);

        const report = await app.db.report.findUnique({ where: { id: params.id } });
        if (!report) {
            reply.code(404).send(
                errorData(
                    "REPORT_NOT_FOUND",
                    "Report not found",
                    "The requested report does not exist.",
                    `No report found for id ${params.id}.`
                )
            );
            return;
        }

        await app.db.report.update({
            where: { id: params.id },
            data: { status: body.status },
        });

        reply.send({ status: "ok" });
    });

    app.post("/report", { preHandler: requireAdminAuth }, async (request, reply) => {
        const body = bodySchema.parse(request.body);
        const worldHint = body.reportWorldSlug.trim();
        let world = await app.db.world.findUnique({ where: { slug: worldHint } });

        if (!world) {
            const normalizedPath = normalizeRoomPath(worldHint);
            const extractedSlug = extractWorldSlug(normalizedPath);
            if (extractedSlug) {
                world = await app.db.world.findUnique({ where: { slug: extractedSlug } });
            }
            if (!world) {
                const room = await app.db.room.findUnique({
                    where: { roomUrl: normalizedPath },
                    include: { world: true },
                });
                world = room?.world ?? null;
            }
        }

        if (!world) {
            reply.code(404).send(
                errorData(
                    "WORLD_NOT_FOUND",
                    "World not found",
                    "The requested world does not exist.",
                    `No world found for slug or room ${body.reportWorldSlug}.`
                )
            );
            return;
        }

        const [reportedMember, reporterMember] = await Promise.all([
            app.db.member.upsert({
                where: { externalId: body.reportedUserUuid },
                update: {},
                create: { externalId: body.reportedUserUuid },
            }),
            app.db.member.upsert({
                where: { externalId: body.reporterUserUuid },
                update: {},
                create: { externalId: body.reporterUserUuid },
            }),
        ]);

        await app.db.report.create({
            data: {
                worldId: world.id,
                reportedMemberId: reportedMember.id,
                reporterMemberId: reporterMember.id,
                comment: body.reportedUserComment,
                status: "open",
            },
        });

        reply.code(200).send();
    });
}
