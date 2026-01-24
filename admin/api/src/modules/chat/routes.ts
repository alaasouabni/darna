import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminAuth } from "../../plugins/auth";

const querySchema = z.object({
    playUri: z.string(),
    searchText: z.string().optional(),
});

export async function chatRoutes(app: FastifyInstance) {
    app.get("/chat/members", { preHandler: requireAdminAuth }, async (request, reply) => {
        const query = querySchema.parse(request.query);
        const searchText = query.searchText?.trim() ?? "";

        const whereClause = searchText
            ? {
                  OR: [
                      { email: { contains: searchText, mode: "insensitive" } },
                      { displayName: { contains: searchText, mode: "insensitive" } },
                      { externalId: { contains: searchText, mode: "insensitive" } },
                  ],
              }
            : {};

        const [members, total] = await Promise.all([
            app.db.member.findMany({
                where: whereClause,
                include: { tags: true },
                orderBy: { displayName: "asc" },
                take: 50,
            }),
            app.db.member.count({ where: whereClause }),
        ]);

        reply.send({
            total,
            members: members.map((member) => ({
                uuid: member.externalId,
                wokaName: member.displayName ?? undefined,
                email: member.email ?? undefined,
                chatId: member.chatId ?? undefined,
                tags: member.tags.map((tag) => tag.tag),
            })),
        });
    });
}
