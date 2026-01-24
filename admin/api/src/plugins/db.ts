import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

declare module "fastify" {
    interface FastifyInstance {
        db: PrismaClient;
    }
}

export const dbPlugin = fp(async (app) => {
    const db = new PrismaClient();
    app.decorate("db", db);

    app.addHook("onClose", async () => {
        await db.$disconnect();
    });
});