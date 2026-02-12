import type { Readable, Writable } from "svelte/store";
import { readable, writable } from "svelte/store";
import type { ChatMember } from "@workadventure/messages";
import { AvailabilityStatus } from "@workadventure/messages";
import type { PartialChatUser } from "../Connection/ChatConnection";
import type { RoomConnection } from "../../Connection/RoomConnection";
import type { UserProviderInterface } from "./UserProviderInterface";
import { CharacterLayerManager } from "../../Phaser/Entity/CharacterLayerManager";
import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
import type { WokaData } from "../../Components/Woka/WokaTypes";
import { gameManager } from "../../Phaser/Game/GameManager";
import { localUserStore } from "../../Connection/LocalUserStore";

let wokaTexturesByIdPromise: Promise<Map<string, string>> | null = null;

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
    private wokaPictureStoreCache = new Map<string, Readable<string | undefined>>();

    constructor(private connection: RoomConnection) {
        this.users = writable([] as PartialChatUser[], (set) => {
            this._setUsers = set;
            connection
                .queryChatMembers("")
                .then(({ members }) => {
                    set(this.mapChatMembersToChatUser(members));
                })
                .catch((error) => {
                    throw new Error("An error occurred while processing chat members: " + error);
                });
        });
    }

    private getPictureStoreForUuid(userUuid: string): Readable<string | undefined> {
        const cached = this.wokaPictureStoreCache.get(userUuid);
        if (cached) {
            return cached;
        }
        const store = readable<string | undefined>(undefined, (set) => {
            let cancelled = false;
            (async () => {
                const member = await this.connection.queryMember(userUuid);
                const ids = member.characterTextureIds ?? [];
                if (ids.length === 0) {
                    return;
                }
                const texturesById = await fetchWokaTexturesById();
                const textures = ids
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
        this.wokaPictureStoreCache.set(userUuid, store);
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
        return new Promise((res, rej) => {
            this.connection
                .queryChatMembers(searchText)
                .then(({ members }) => {
                    if (this._setUsers) {
                        this._setUsers(this.mapChatMembersToChatUser(members));
                        res();
                    }
                })
                .catch((error) => {
                    rej(new Error("An error occurred while processing chat members: " + error));
                });
        });
    }
}
