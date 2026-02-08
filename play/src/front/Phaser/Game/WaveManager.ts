import type { Subscription } from "rxjs";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { CharacterTextureMessage } from "@workadventure/messages";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { localUserStore } from "../../Connection/LocalUserStore";
import { notificationPlayingStore } from "../../Stores/NotificationStore";
import type { ReceiveEventEvent } from "../../Api/Events/ReceiveEventEvent";
import type { RemotePlayersRepository } from "./RemotePlayersRepository";
import { CharacterLayerManager } from "../Entity/CharacterLayerManager";

export const WAVE_EVENT_NAME = "wa.wave.v1";

const WAVE_PER_TARGET_COOLDOWN_MS = 8_000;
const WAVE_GLOBAL_WINDOW_MS = 30_000;
const WAVE_GLOBAL_MAX_EVENTS = 5;
const WAVE_DEDUPE_WINDOW_MS = 60_000;
const WAVE_AVATAR_CACHE_TTL_MS = 10 * 60_000;
const WAVE_AVATAR_CACHE_MAX_SIZE = 100;

const wavePayloadSchema = z.object({
    waveId: z.string().min(1),
    sentAt: z.number(),
    senderUuid: z.string(),
    senderName: z.string().optional(),
    source: z.string().optional(),
});

type WavePayload = z.infer<typeof wavePayloadSchema>;

export class WaveManager {
    private readonly targetCooldowns = new Map<number, number>();
    private readonly seenWaveIds = new Map<string, number>();
    private readonly waveAvatarCache = new Map<string, { icon: string; lastUsedAt: number }>();
    private globalWaveTimestamps: number[] = [];
    private readonly receivedEventSubscription: Subscription;

    constructor(
        private readonly roomConnection: RoomConnection,
        private readonly remotePlayersRepository: RemotePlayersRepository,
        private readonly onWaveReceived?: () => void
    ) {
        this.receivedEventSubscription = this.roomConnection.receivedEventMessageStream.subscribe((event) => {
            this.handleReceivedEvent(event);
        });
    }

    public async sendWave(targetUserId: number, targetUserUuid: string, targetUserName: string): Promise<void> {
        const localUserId = this.roomConnection.getUserId();
        if (targetUserId === localUserId) {
            return;
        }

        const now = Date.now();
        this.cleanupCooldownState(now);

        const nextAllowedAt = this.targetCooldowns.get(targetUserId) ?? 0;
        if (now < nextAllowedAt) {
            notificationPlayingStore.playNotification("Please wait before waving this user again.");
            return;
        }

        if (this.globalWaveTimestamps.length >= WAVE_GLOBAL_MAX_EVENTS) {
            notificationPlayingStore.playNotification("You are waving too fast. Please slow down.");
            return;
        }

        const payload: WavePayload = {
            waveId: uuidv4(),
            sentAt: now,
            senderUuid: localUserStore.getLocalUser()?.uuid ?? "",
            senderName: localUserStore.getName() ?? "",
            source: "woka-menu",
        };

        try {
            await this.roomConnection.emitScriptableEvent(WAVE_EVENT_NAME, payload, [targetUserId]);
            this.targetCooldowns.set(targetUserId, now + WAVE_PER_TARGET_COOLDOWN_MS);
            this.globalWaveTimestamps.push(now);
            const icon = await this.resolveWaveIconForUserId(targetUserId);
            notificationPlayingStore.playNotification(
                `Wave sent to ${targetUserName}.`,
                icon
            );
        } catch (error) {
            console.warn("Could not send wave event", {
                error,
                targetUserId,
                targetUserUuid,
            });
            notificationPlayingStore.playNotification("Could not send wave. Please try again.");
        }
    }

    public destroy(): void {
        this.receivedEventSubscription.unsubscribe();
        this.targetCooldowns.clear();
        this.seenWaveIds.clear();
        this.waveAvatarCache.clear();
        this.globalWaveTimestamps = [];
    }

    private handleReceivedEvent(event: ReceiveEventEvent): void {
        if (event.name !== WAVE_EVENT_NAME || event.senderId === undefined) {
            return;
        }

        if (event.senderId === this.roomConnection.getUserId()) {
            return;
        }

        const parsedPayload = wavePayloadSchema.safeParse(event.data);
        if (!parsedPayload.success) {
            console.warn("Ignoring malformed wave event payload", parsedPayload.error);
            return;
        }

        const now = Date.now();
        this.cleanupSeenWaveIds(now);

        if (this.seenWaveIds.has(parsedPayload.data.waveId)) {
            return;
        }
        this.seenWaveIds.set(parsedPayload.data.waveId, now);

        const senderName = this.resolveSenderName(event.senderId, parsedPayload.data);
        void this.notifyIncomingWave(senderName, event.senderId);
    }

    private resolveSenderName(senderId: number, payload: WavePayload): string {
        const remotePlayer = this.remotePlayersRepository.getPlayers().get(senderId);
        if (remotePlayer?.name) {
            return remotePlayer.name;
        }

        if (payload.senderName && payload.senderName.trim().length > 0) {
            return payload.senderName;
        }

        return "Someone";
    }

    private async notifyIncomingWave(senderName: string, senderUserId: number): Promise<void> {
        const icon = await this.resolveWaveIconForUserId(senderUserId);
        notificationPlayingStore.playNotification(`${senderName} waved at you.`, icon);
        this.onWaveReceived?.();
    }

    private async resolveWaveIconForUserId(userId: number): Promise<string | undefined> {
        const remotePlayer = this.remotePlayersRepository.getPlayers().get(userId);
        if (!remotePlayer?.characterTextures || remotePlayer.characterTextures.length === 0) {
            return undefined;
        }

        const now = Date.now();
        this.cleanupWaveAvatarCache(now);

        const characterTextures = remotePlayer.characterTextures as unknown as CharacterTextureMessage[];
        const textureFingerprint = this.getCharacterTextureFingerprint(characterTextures);
        const cacheKey = `${userId}:${textureFingerprint}`;
        const cachedEntry = this.waveAvatarCache.get(cacheKey);
        if (cachedEntry) {
            cachedEntry.lastUsedAt = now;
            return cachedEntry.icon;
        }

        try {
            const renderedIcon = await CharacterLayerManager.wokaBase64(characterTextures);
            this.waveAvatarCache.set(cacheKey, {
                icon: renderedIcon,
                lastUsedAt: now,
            });
            this.enforceWaveAvatarCacheSizeLimit();
            return renderedIcon;
        } catch (error) {
            console.warn("Could not render wave icon from character textures", { userId, error });
            return undefined;
        }
    }

    private cleanupCooldownState(now: number): void {
        this.globalWaveTimestamps = this.globalWaveTimestamps.filter(
            (timestamp) => now - timestamp <= WAVE_GLOBAL_WINDOW_MS
        );

        for (const [userId, allowedAt] of this.targetCooldowns) {
            if (allowedAt <= now) {
                this.targetCooldowns.delete(userId);
            }
        }
    }

    private cleanupSeenWaveIds(now: number): void {
        for (const [waveId, seenAt] of this.seenWaveIds) {
            if (now - seenAt > WAVE_DEDUPE_WINDOW_MS) {
                this.seenWaveIds.delete(waveId);
            }
        }
    }

    private getCharacterTextureFingerprint(characterTextures: CharacterTextureMessage[]): string {
        return characterTextures
            .map((texture, index) => {
                if (typeof texture === "string") {
                    return `${index}:id=${texture}`;
                }

                const id = typeof texture?.id === "string" ? texture.id : "";
                const url = typeof texture?.url === "string" ? texture.url : "";
                return `${index}:id=${id};url=${url}`;
            })
            .join("|");
    }

    private cleanupWaveAvatarCache(now: number): void {
        for (const [cacheKey, cacheEntry] of this.waveAvatarCache) {
            if (now - cacheEntry.lastUsedAt > WAVE_AVATAR_CACHE_TTL_MS) {
                this.waveAvatarCache.delete(cacheKey);
            }
        }
    }

    private enforceWaveAvatarCacheSizeLimit(): void {
        while (this.waveAvatarCache.size > WAVE_AVATAR_CACHE_MAX_SIZE) {
            let oldestKey: string | undefined;
            let oldestLastUsedAt = Number.POSITIVE_INFINITY;

            for (const [cacheKey, cacheEntry] of this.waveAvatarCache) {
                if (cacheEntry.lastUsedAt < oldestLastUsedAt) {
                    oldestLastUsedAt = cacheEntry.lastUsedAt;
                    oldestKey = cacheKey;
                }
            }

            if (!oldestKey) {
                break;
            }
            this.waveAvatarCache.delete(oldestKey);
        }
    }
}
