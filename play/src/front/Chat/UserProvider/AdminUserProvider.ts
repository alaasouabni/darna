import type { Readable, Writable } from "svelte/store";
import { readable, writable } from "svelte/store";
import type { ChatMember } from "@workadventure/messages";
import type { CharacterTextureMessage } from "@workadventure/messages";
import { AvailabilityStatus } from "@workadventure/messages";
import type { PartialChatUser } from "../Connection/ChatConnection";
import { RoomConnection } from "../../Connection/RoomConnection";
import { CharacterLayerManager } from "../../Phaser/Entity/CharacterLayerManager";
import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
import type { WokaData } from "../../Components/Woka/WokaTypes";
import { gameManager } from "../../Phaser/Game/GameManager";
import { localUserStore } from "../../Connection/LocalUserStore";
import {
    PROFILE_COMPANION_VARIABLE,
    PROFILE_NAME_VARIABLE,
    PROFILE_TEXTURES_VARIABLE,
} from "../../Connection/ProfileVariables";
import type { UserProviderInterface } from "./UserProviderInterface";

let wokaTexturesByIdPromise: Promise<Map<string, string>> | null = null;
const ADMIN_MEMBER_PROFILE_CACHE_TTL_MS = 60_000;
const ADMIN_MEMBER_EVENT_RETRY_DELAY_MS = 1_500;
const ADMIN_LIVE_PROFILE_FRESHNESS_MS = 15_000;

type CachedProfile = {
    name: string;
    updatedAt: number;
};

type CachedPictureStore = {
    store: Readable<string | undefined>;
    updatedAt: number;
};

type LiveProfile = {
    name?: string;
    characterTextures?: CharacterTextureMessage[];
    updatedAt: number;
};

const fetchWokaTexturesById = async (): Promise<Map<string, string>> => {
    if (wokaTexturesByIdPromise) {
        return wokaTexturesByIdPromise;
    }
    wokaTexturesByIdPromise = (async () => {
        const roomUrl = gameManager.currentStartedRoom.href;
        const response = await fetch(`${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}`, {
            headers: {
                Authorization: localUserStore.getAuthToken() || "",
            },
            credentials: "include",
        });
        if (!response.ok) {
            throw new Error("Failed to load Woka list");
        }
        const data: WokaData = await response.json();
        const byId = new Map<string, string>();
        for (const part of Object.values(data)) {
            for (const collection of part.collections) {
                for (const texture of collection.textures) {
                    if (texture.id && texture.url) {
                        byId.set(texture.id, texture.url);
                    }
                }
            }
        }
        return byId;
    })();
    return wokaTexturesByIdPromise;
};

export class AdminUserProvider implements UserProviderInterface {
    users: Writable<PartialChatUser[]>;
    private _setUsers: ((value: PartialChatUser[]) => void) | undefined;
    private wokaPictureStoreCache = new Map<string, CachedPictureStore>();
    private profileCache = new Map<string, CachedProfile>();
    private userUuidByUserId = new Map<number, string>();
    private liveProfileByUuid = new Map<string, LiveProfile>();
    private searchText = "";
    private refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    private refreshRetryTimeouts: ReturnType<typeof setTimeout>[] = [];

    constructor(private connection: RoomConnection) {
        this.users = writable([] as PartialChatUser[], (set) => {
            this._setUsers = set;
            this.refreshMembers().catch((error) => {
                console.warn("Could not initialize admin chat members list", error);
            });
            return () => {
                this._setUsers = undefined;
                if (this.refreshTimeout !== undefined) {
                    clearTimeout(this.refreshTimeout);
                    this.refreshTimeout = undefined;
                }
                for (const timeout of this.refreshRetryTimeouts) {
                    clearTimeout(timeout);
                }
                this.refreshRetryTimeouts = [];
            };
        });

        // The userLeftMessageStream stream is completed in the RoomConnection. No need to unsubscribe.
        //eslint-disable-next-line rxjs/no-ignored-subscription, svelte/no-ignored-unsubscribe
        connection.userLeftMessageStream.subscribe((message) => {
            const userUuid = this.userUuidByUserId.get(message.userId);
            if (userUuid) {
                this.userUuidByUserId.delete(message.userId);
                this.liveProfileByUuid.delete(userUuid);
            }
            this.scheduleRefresh(true);
        });

        // The userJoinedMessageStream stream is completed in the RoomConnection. No need to unsubscribe.
        //eslint-disable-next-line rxjs/no-ignored-subscription, svelte/no-ignored-unsubscribe
        connection.userJoinedMessageStream.subscribe((message) => {
            this.userUuidByUserId.set(message.userId, message.userUuid);
            this.liveProfileByUuid.set(message.userUuid, {
                name: message.name,
                characterTextures: message.characterTextures as CharacterTextureMessage[],
                updatedAt: Date.now(),
            });
        });

        // The playerDetailsUpdatedMessageStream stream is completed in the RoomConnection. No need to unsubscribe.
        //eslint-disable-next-line rxjs/no-ignored-subscription, svelte/no-ignored-unsubscribe
        connection.playerDetailsUpdatedMessageStream.subscribe((message) => {
            const variableName = message.details?.setVariable?.name;
            if (
                variableName === PROFILE_NAME_VARIABLE ||
                variableName === PROFILE_TEXTURES_VARIABLE ||
                variableName === PROFILE_COMPANION_VARIABLE
            ) {
                const userUuid = this.userUuidByUserId.get(message.userId);
                if (userUuid && message.details?.setVariable) {
                    const rawValue = RoomConnection.unserializeVariable(message.details.setVariable.value);
                    const current = this.liveProfileByUuid.get(userUuid) ?? {
                        updatedAt: Date.now(),
                    };
                    if (variableName === PROFILE_NAME_VARIABLE && typeof rawValue === "string") {
                        current.name = rawValue.trim();
                    }
                    if (variableName === PROFILE_TEXTURES_VARIABLE && Array.isArray(rawValue)) {
                        const textures: CharacterTextureMessage[] = rawValue
                            .map((value) => {
                                if (typeof value === "string") {
                                    return { id: value, url: "" };
                                }
                                if (
                                    value &&
                                    typeof value === "object" &&
                                    "id" in value &&
                                    typeof value.id === "string"
                                ) {
                                    return {
                                        id: value.id,
                                        url:
                                            "url" in value && typeof value.url === "string"
                                                ? value.url
                                                : "",
                                    };
                                }
                                return undefined;
                            })
                            .filter((value): value is CharacterTextureMessage => value !== undefined);
                        if (textures.length > 0) {
                            current.characterTextures = textures;
                        }
                    }
                    current.updatedAt = Date.now();
                    this.liveProfileByUuid.set(userUuid, current);
                }
                this.scheduleRefresh(true);
            }
        });
    }

    private scheduleRefresh(clearPictureCache: boolean): void {
        if (clearPictureCache) {
            this.wokaPictureStoreCache.clear();
            this.profileCache.clear();
        }
        if (this.refreshTimeout !== undefined) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this.refreshMembers().catch((error) => {
                console.warn("Could not refresh admin chat members list", error);
            });
            this.refreshTimeout = undefined;
        }, 200);

        for (const timeout of this.refreshRetryTimeouts) {
            clearTimeout(timeout);
        }
        // Retry a couple of times after event-driven updates to handle backend eventual consistency.
        const retryDelays = [ADMIN_MEMBER_EVENT_RETRY_DELAY_MS, 5_000];
        this.refreshRetryTimeouts = retryDelays.map((delay) =>
            setTimeout(() => {
                this.refreshMembers().catch((error) => {
                    console.warn("Could not retry admin chat members list refresh", error);
                });
            }, delay)
        );
    }

    private async refreshMembers(searchText: string = this.searchText): Promise<void> {
        if (!this._setUsers) {
            return;
        }
        const { members } = await this.connection.queryChatMembers(searchText);
        const now = Date.now();
        const membersWithResolvedNames = await Promise.all(
            members.map(async (member) => {
                if (!member.uuid) {
                    return member;
                }
                const liveProfile = this.liveProfileByUuid.get(member.uuid);
                const hasFreshLiveName =
                    liveProfile?.name &&
                    Date.now() - liveProfile.updatedAt < ADMIN_LIVE_PROFILE_FRESHNESS_MS;
                if (hasFreshLiveName) {
                    return {
                        ...member,
                        wokaName: liveProfile.name,
                    };
                }
                const cachedProfile = this.profileCache.get(member.uuid);
                const isFresh =
                    cachedProfile !== undefined && now - cachedProfile.updatedAt < ADMIN_MEMBER_PROFILE_CACHE_TTL_MS;
                if (isFresh) {
                    return {
                        ...member,
                        wokaName: cachedProfile.name,
                    };
                }
                try {
                    const fullMember = await this.connection.queryMember(member.uuid);
                    const resolvedName = fullMember.name?.trim() || member.wokaName || "";
                    this.profileCache.set(member.uuid, {
                        name: resolvedName,
                        updatedAt: Date.now(),
                    });
                    return {
                        ...member,
                        wokaName: resolvedName,
                    };
                } catch (error) {
                    if (cachedProfile) {
                        return {
                            ...member,
                            wokaName: cachedProfile.name,
                        };
                    }
                    console.warn("Could not resolve member profile for disconnected list", error);
                    return member;
                }
            })
        );
        this._setUsers?.(this.mapChatMembersToChatUser(membersWithResolvedNames));
    }

    private getPictureStoreForUuid(userUuid: string): Readable<string | undefined> {
        const cached = this.wokaPictureStoreCache.get(userUuid);
        if (cached && Date.now() - cached.updatedAt < ADMIN_MEMBER_PROFILE_CACHE_TTL_MS) {
            return cached.store;
        }
        const store = readable<string | undefined>(undefined, (set) => {
            let cancelled = false;
            (async () => {
                const liveProfile = this.liveProfileByUuid.get(userUuid);
                const hasFreshLiveTextures =
                    !!liveProfile &&
                    !!liveProfile.characterTextures &&
                    liveProfile.characterTextures.length > 0 &&
                    Date.now() - liveProfile.updatedAt < ADMIN_LIVE_PROFILE_FRESHNESS_MS;
                const ids = hasFreshLiveTextures ? liveProfile?.characterTextures?.map((texture) => texture.id) ?? [] : [];
                let texturesFromLiveProfile: CharacterTextureMessage[] = [];
                if (ids.length > 0) {
                    const texturesById = await fetchWokaTexturesById();
                    texturesFromLiveProfile = liveProfile?.characterTextures
                        ?.map((texture) => ({
                            id: texture.id,
                            url: texture.url || texturesById.get(texture.id) || "",
                        }))
                        .filter((texture) => texture.url.length > 0) ?? [];
                }
                if (texturesFromLiveProfile.length > 0) {
                    const wokaBase64 = await CharacterLayerManager.wokaBase64(texturesFromLiveProfile);
                    if (!cancelled) {
                        set(wokaBase64);
                    }
                    return;
                }

                const member = await this.connection.queryMember(userUuid);
                const memberTextureIds = member.characterTextureIds ?? [];
                const idsFromMember = memberTextureIds.length > 0 ? memberTextureIds : ids;
                this.profileCache.set(userUuid, {
                    name: member.name?.trim() || this.profileCache.get(userUuid)?.name || "",
                    updatedAt: Date.now(),
                });
                if (member.name?.trim()) {
                    const currentLiveProfile = this.liveProfileByUuid.get(userUuid) ?? { updatedAt: Date.now() };
                    currentLiveProfile.name = member.name.trim();
                    currentLiveProfile.updatedAt = Date.now();
                    this.liveProfileByUuid.set(userUuid, currentLiveProfile);
                }
                const idsToRender = idsFromMember;
                if (idsToRender.length === 0) {
                    return;
                }
                const texturesById = await fetchWokaTexturesById();
                const textures = idsToRender
                    .map((id) => {
                        const url = texturesById.get(id);
                        return url ? { id, url } : null;
                    })
                    .filter((texture): texture is { id: string; url: string } => texture !== null);
                if (textures.length === 0) {
                    return;
                }
                const wokaBase64 = await CharacterLayerManager.wokaBase64(textures);
                if (!cancelled) {
                    set(wokaBase64);
                }
            })().catch((error) => {
                console.warn("Could not load Woka avatar for user list", error);
            });
            return () => {
                cancelled = true;
            };
        });
        this.wokaPictureStoreCache.set(userUuid, {
            store,
            updatedAt: Date.now(),
        });
        return store;
    }

    private mapChatMembersToChatUser(chatMembers: ChatMember[]): PartialChatUser[] {
        return chatMembers.reduce((userAcc, currentMember) => {
            if (currentMember.chatId)
                userAcc.push({
                    availabilityStatus: writable(AvailabilityStatus.UNCHANGED),
                    pictureStore: currentMember.uuid
                        ? this.getPictureStoreForUuid(currentMember.uuid)
                        : readable<string | undefined>(undefined),
                    chatId: currentMember.chatId,
                    roomName: undefined,
                    playUri: undefined,
                    username: currentMember.wokaName,
                    isAdmin: currentMember.tags.includes("admin"),
                    isMember: currentMember.tags.includes("member"),
                    uuid: currentMember.uuid,
                    color: undefined,
                    spaceUserId: undefined,
                });
            return userAcc;
        }, [] as PartialChatUser[]);
    }

    setFilter(searchText: string): Promise<void> {
        this.searchText = searchText;
        return this.refreshMembers(searchText);
    }
}
