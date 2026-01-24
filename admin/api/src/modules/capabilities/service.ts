import type { Capabilities } from "@workadventure/messages";
import type { PrismaClient } from "@prisma/client";
import { config } from "../../config/env";

export async function getCapabilities(db: PrismaClient): Promise<Capabilities> {
    const [livekitCount, iceCount] = await Promise.all([
        db.livekitConfig.count(),
        db.iceConfig.count(),
    ]);

    const hasIce = Boolean(config.STUN_SERVER || config.TURN_SERVER || iceCount > 0);
    const hasLivekit = Boolean(
        (config.LIVEKIT_HOST && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET) || livekitCount > 0
    );

    return {
        "api/companion/list": "v1",
        "api/woka/list": "v1",
        "api/domain/verify": config.allowedDomains.length > 0 || config.ADMIN_PUBLIC_URL ? "v1" : undefined,
        "api/save-name": "v1",
        "api/save-textures": "v1",
        "api/livekit/credentials": hasLivekit ? "v1" : undefined,
        "api/ice-servers": hasIce ? "v1" : undefined,
    };
}
