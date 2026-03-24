import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config/env";
import { errorData } from "../../lib/error-response";
import { requireAdminAuth } from "../../plugins/auth";

const notetakerConfigSchema = z.object({
  permissionPolicy: z.enum(["all_users", "selected_roles"]).optional(),
  allowedTags: z.array(z.string()).optional(),
  emailDigestEnabled: z.boolean().optional(),
  starterMustStay: z.boolean().optional(),
  allowAdminReadAll: z.boolean().optional(),
  transcriptRetentionDays: z.number().int().positive().optional(),
  summaryRetentionDays: z.number().int().positive().optional(),
});

async function proxyNotetakerRequest(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const adminToken = config.ADMIN_API_TOKEN?.trim();
  if (!adminToken) {
    throw new Error(
      "ADMIN_API_TOKEN is required to proxy AI notetaker configuration."
    );
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, 10000);

  try {
    return await fetch(`${config.NOTETAKER_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        ...(init?.headers ?? {}),
      },
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function notetakerRoutes(app: FastifyInstance) {
  app.get(
    "/notetaker/status",
    { preHandler: requireAdminAuth },
    async (_request, reply) => {
      try {
        const response = await proxyNotetakerRequest("/ai-notes/status");
        const payload = await response.json();

        if (!response.ok) {
          reply.code(response.status).send(payload);
          return;
        }

        reply.send(payload);
      } catch (error) {
        reply
          .code(502)
          .send(
            errorData(
              "NOTETAKER_PROXY_ERROR",
              "AI Notetaker backend unavailable",
              "Could not retrieve AI notetaker status.",
              error instanceof Error
                ? error.message
                : "Unknown error while contacting AI notetaker backend."
            )
          );
      }
    }
  );

  app.get(
    "/notetaker/config",
    { preHandler: requireAdminAuth },
    async (_request, reply) => {
      try {
        const response = await proxyNotetakerRequest("/ai-notes/config");
        const payload = await response.json();

        if (!response.ok) {
          reply.code(response.status).send(payload);
          return;
        }

        reply.send(payload);
      } catch (error) {
        reply
          .code(502)
          .send(
            errorData(
              "NOTETAKER_PROXY_ERROR",
              "AI Notetaker backend unavailable",
              "Could not retrieve AI notetaker config.",
              error instanceof Error
                ? error.message
                : "Unknown error while contacting AI notetaker backend."
            )
          );
      }
    }
  );

  app.put(
    "/notetaker/config",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      const body = notetakerConfigSchema.parse(request.body ?? {});

      try {
        const response = await proxyNotetakerRequest("/ai-notes/config", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const payload = await response.json();

        if (!response.ok) {
          reply.code(response.status).send(payload);
          return;
        }

        reply.send(payload);
      } catch (error) {
        reply
          .code(502)
          .send(
            errorData(
              "NOTETAKER_PROXY_ERROR",
              "AI Notetaker backend unavailable",
              "Could not update AI notetaker config.",
              error instanceof Error
                ? error.message
                : "Unknown error while contacting AI notetaker backend."
            )
          );
      }
    }
  );
}
