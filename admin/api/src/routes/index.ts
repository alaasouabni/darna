import type { FastifyInstance } from "fastify";
import { healthRoutes } from "../modules/health/routes";
import { capabilitiesRoutes } from "../modules/capabilities/routes";
import { domainRoutes } from "../modules/domain/routes";
import { mapRoutes } from "../modules/map/routes";
import { accessRoutes } from "../modules/access/routes";
import { roomRoutes } from "../modules/room/routes";
import { memberRoutes } from "../modules/member/routes";
import { chatRoutes } from "../modules/chat/routes";
import { wokaRoutes } from "../modules/woka/routes";
import { companionRoutes } from "../modules/companion/routes";
import { reportRoutes } from "../modules/report/routes";
import { banRoutes } from "../modules/ban/routes";
import { livekitRoutes } from "../modules/livekit/routes";
import { iceRoutes } from "../modules/ice/routes";
import { roomApiRoutes } from "../modules/room-api/routes";
import { loginRoutes } from "../modules/login/routes";
import { whiteLabelRoutes } from "../modules/white-label/routes";
import { oauthRoutes } from "../modules/oauth/routes";
import { adminSocketsRoutes } from "../modules/admin-sockets/routes";
import { saveRoutes } from "../modules/save/routes";

export async function registerRoutes(app: FastifyInstance) {
    app.register(healthRoutes, { prefix: "/healthz" });

    app.register(capabilitiesRoutes, { prefix: "/api" });
    app.register(domainRoutes, { prefix: "/api" });
    app.register(mapRoutes, { prefix: "/api" });
    app.register(accessRoutes, { prefix: "/api" });
    app.register(roomRoutes, { prefix: "/api" });
    app.register(memberRoutes, { prefix: "/api" });
    app.register(chatRoutes, { prefix: "/api" });
    app.register(wokaRoutes, { prefix: "/api" });
    app.register(companionRoutes, { prefix: "/api" });
    app.register(reportRoutes, { prefix: "/api" });
    app.register(banRoutes, { prefix: "/api" });
    app.register(livekitRoutes, { prefix: "/api" });
    app.register(iceRoutes, { prefix: "/api" });
    app.register(roomApiRoutes, { prefix: "/api" });
    app.register(loginRoutes, { prefix: "/api" });
    app.register(saveRoutes, { prefix: "/api" });
    app.register(adminSocketsRoutes, { prefix: "/api/admin-sockets" });

    app.register(whiteLabelRoutes);
    app.register(oauthRoutes);
}
