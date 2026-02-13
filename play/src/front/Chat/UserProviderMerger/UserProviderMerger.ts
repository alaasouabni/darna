import { AvailabilityStatus } from "@workadventure/messages";
import type { Readable } from "svelte/store";
import { derived, get, writable } from "svelte/store";
import type { UserProviderInterface } from "../UserProvider/UserProviderInterface";
import type { AnyKindOfUser, ChatId, ChatUser, PartialAnyKindOfUser, UserUuid } from "../Connection/ChatConnection";

/**
 * Merges several UserProviders into one store that sorts users by room.
 */
export type playUri = string;

export class UserProviderMerger {
    usersByRoomStore: Readable<
        Map<
            playUri | undefined,
            {
                roomName: string | undefined;
                users: ChatUser[];
            }
        >
    >;

    constructor(private userProviders: UserProviderInterface[]) {
        this.usersByRoomStore = derived(
            this.userProviders.map((up) => up.users),
            (users) => {
                const usersByChatId = new Map<ChatId | UserUuid, PartialAnyKindOfUser[]>();

                // Step one: sort users by chatId
                for (const usersList of users) {
                    for (const user of usersList) {
                        const uniqueId = (user.chatId as ChatId) ?? (user.uuid as UserUuid);
                        if (!uniqueId) {
                            throw new Error("Impossible. A user must have at least a chatId or a uuid.");
                        }
                        const chatUserList = usersByChatId.get(uniqueId);
                        if (!chatUserList) {
                            usersByChatId.set(uniqueId, [user]);
                        } else {
                            chatUserList.push(user);
                        }
                    }
                }

                // Step 2: merge users with same chatId
                const mergedUsers = new Map<ChatId | UserUuid, AnyKindOfUser>();
                for (const chatUserList of usersByChatId.values()) {
                    const mergedUser = chatUserList.reduce((acc, user) => {
                        const incomingAvailability = user.availabilityStatus
                            ? get(user.availabilityStatus)
                            : AvailabilityStatus.UNCHANGED;
                        const shouldPreferIncoming =
                            Boolean(user.playUri || user.spaceUserId) &&
                            incomingAvailability !== AvailabilityStatus.UNCHANGED;
                        return {
                            chatId: user.chatId || acc.chatId,
                            uuid: user.uuid || acc.uuid,
                            username: shouldPreferIncoming ? user.username || acc.username : acc.username || user.username,
                            availabilityStatus: shouldPreferIncoming
                                ? user.availabilityStatus || acc.availabilityStatus
                                : acc.availabilityStatus || user.availabilityStatus,
                            pictureStore: shouldPreferIncoming
                                ? user.pictureStore || acc.pictureStore
                                : acc.pictureStore || user.pictureStore,
                            roomName: user.roomName || acc.roomName,
                            playUri: user.playUri || acc.playUri,
                            isAdmin: user.isAdmin || acc.isAdmin,
                            isMember: user.isMember || acc.isMember,
                            visitCardUrl: shouldPreferIncoming
                                ? user.visitCardUrl || acc.visitCardUrl
                                : acc.visitCardUrl || user.visitCardUrl,
                            color: shouldPreferIncoming ? user.color || acc.color : acc.color || user.color,
                            spaceUserId: user.spaceUserId || acc.spaceUserId,
                        } as AnyKindOfUser;
                    });

                    const defaultUser = {
                        chatId: undefined,
                        username: "",
                        pictureStore: writable(undefined),
                        roomName: undefined,
                        playUri: undefined,
                        color: undefined,
                        spaceUserId: undefined,
                    };

                    const fullUser = {
                        ...defaultUser,
                        ...mergedUser,
                        username: mergedUser.username ?? "",
                        availabilityStatus: mergedUser.availabilityStatus ?? writable(AvailabilityStatus.UNCHANGED),
                    };

                    mergedUsers.set(
                        (mergedUser.chatId as ChatId | undefined) ?? (mergedUser.uuid as UserUuid),
                        fullUser
                    );
                }

                // Step 3: sort users by room
                const usersByRoom = new Map<
                    playUri | undefined,
                    {
                        roomName: string | undefined;
                        users: AnyKindOfUser[];
                    }
                >();
                for (const user of mergedUsers.values()) {
                    const playUri = user.playUri;
                    const usersInRoom = usersByRoom.get(playUri);
                    if (usersInRoom) {
                        usersInRoom.users.push(user);
                    } else {
                        usersByRoom.set(playUri, {
                            roomName: user.roomName,
                            users: [user],
                        });
                    }
                }

                return usersByRoom;
            },
            new Map()
        );
    }

    setFilter(searchText: string): Promise<void[]> {
        return Promise.all(this.userProviders.map((userProvider) => userProvider.setFilter(searchText)));
    }
}
