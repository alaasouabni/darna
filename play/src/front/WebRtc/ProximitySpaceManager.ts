import type { Subscription } from "rxjs";
import Debug from "debug";
import * as Sentry from "@sentry/svelte";
import { AbortError } from "@workadventure/shared-utils/src/Abort/AbortError";
import { get } from "svelte/store";
import type { RoomConnection } from "../Connection/RoomConnection";
import type { ProximityChatRoom } from "../Chat/Connection/Proximity/ProximityChatRoom";
import { livekitMeetingRoomSpaceNameStore, personalAreaSpaceNameStore } from "../Stores/GameStore";

const debug = Debug("ProximitySpaceManager");

export class ProximitySpaceManager {
    private joinSpaceRequestMessageSubscription: Subscription;
    private leaveSpaceRequestMessageSubscription: Subscription;
    private personalAreaSubscription: (() => void) | undefined;
    private livekitMeetingRoomSubscription: (() => void) | undefined;
    private pendingJoinRequest:
        | {
              spaceName: string;
              propertiesToSync: string[];
          }
        | undefined;
    private isInPersonalArea = false;
    private isInLivekitMeetingRoom = false;
    private isResuming = false;
    private isStatusBlocked = false;

    public constructor(roomConnection: RoomConnection, private proximityChatRoom: ProximityChatRoom) {
        this.isInPersonalArea = get(personalAreaSpaceNameStore) !== null;
        this.isInLivekitMeetingRoom = get(livekitMeetingRoomSpaceNameStore) !== null;
        this.personalAreaSubscription = personalAreaSpaceNameStore.subscribe((spaceName) => {
            const wasInIsolatedSpace = this.isInIsolatedSpace();
            this.isInPersonalArea = spaceName !== null;
            this.resumePendingJoinIfNeeded(wasInIsolatedSpace);
        });

        this.livekitMeetingRoomSubscription = livekitMeetingRoomSpaceNameStore.subscribe((spaceName) => {
            const wasInIsolatedSpace = this.isInIsolatedSpace();
            this.isInLivekitMeetingRoom = spaceName !== null;
            this.resumePendingJoinIfNeeded(wasInIsolatedSpace);
        });

        this.joinSpaceRequestMessageSubscription = roomConnection.joinSpaceRequestMessage.subscribe(
            ({ spaceName, propertiesToSync }) => {
                if (this.isStatusBlocked) {
                    this.pendingJoinRequest = undefined;
                    return;
                }
                if (this.isInIsolatedSpace() || this.isResuming) {
                    this.pendingJoinRequest = { spaceName, propertiesToSync };
                    return;
                }
                this.proximityChatRoom.joinSpace(spaceName, propertiesToSync).catch((e) => {
                    if (e instanceof AbortError) {
                        debug("Join space aborted. The user left the space before finalizing the join", e);
                        return;
                    }
                    console.error(e);
                    Sentry.captureException(e);
                });
            }
        );

        this.leaveSpaceRequestMessageSubscription = roomConnection.leaveSpaceRequestMessage.subscribe(
            ({ spaceName }) => {
                if (this.isStatusBlocked) {
                    if (this.pendingJoinRequest?.spaceName === spaceName) {
                        this.pendingJoinRequest = undefined;
                    }
                    return;
                }
                if (this.isInIsolatedSpace() || this.isResuming) {
                    if (this.pendingJoinRequest?.spaceName === spaceName) {
                        this.pendingJoinRequest = undefined;
                    }
                    return;
                }
                this.proximityChatRoom.leaveSpace(spaceName).catch((e) => {
                    console.error("Error while leaving space", e);
                    Sentry.captureException(e);
                });
            }
        );
    }

    public destroy() {
        this.joinSpaceRequestMessageSubscription.unsubscribe();
        this.leaveSpaceRequestMessageSubscription.unsubscribe();
        this.personalAreaSubscription?.();
        this.livekitMeetingRoomSubscription?.();
    }

    public setStatusBlocked(blocked: boolean): void {
        this.isStatusBlocked = blocked;
        if (blocked) {
            this.pendingJoinRequest = undefined;
        }
    }

    private isInIsolatedSpace(): boolean {
        return this.isInPersonalArea || this.isInLivekitMeetingRoom;
    }

    private resumePendingJoinIfNeeded(wasInIsolatedSpace: boolean): void {
        if (!wasInIsolatedSpace || this.isInIsolatedSpace()) {
            return;
        }

        const pending = this.pendingJoinRequest;
        this.pendingJoinRequest = undefined;
        if (!pending) {
            return;
        }

        this.isResuming = true;
        this.proximityChatRoom
            .joinSpace(pending.spaceName, pending.propertiesToSync)
            .catch((e) => {
                if (e instanceof AbortError) {
                    debug("Join space aborted after isolated space", e);
                    return;
                }
                console.error(e);
                Sentry.captureException(e);
            })
            .finally(() => {
                this.isResuming = false;
            });
    }
}
