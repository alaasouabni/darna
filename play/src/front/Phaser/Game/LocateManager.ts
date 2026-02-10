import type { LocatePositionMessage as LocatePositionMessageProto } from "@workadventure/messages";
import { get } from "svelte/store";
import type { RoomConnection } from "../../Connection/RoomConnection";
import type { RemotePlayer } from "../Entity/RemotePlayer";
import { wokaMenuStore, wokaMenuProgressStore } from "../../Stores/WokaMenuStore";
import LL from "../../../i18n/i18n-svelte";
import type { CameraManager } from "./CameraManager";
import type { GameScene } from "./GameScene";

/**
 * LocateManager handles the locate position feature, managing camera positioning,
 * progress tracking, and user activation when locating a remote player.
 * It ensures smooth camera transitions without glitches during player creation/update cycles.
 */
export class LocateManager {
    private locatePositionInterval: ReturnType<typeof setInterval> | undefined = undefined;
    private locatePositionTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
    private locatePositionClearProgressTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
    private wokaMenuStoreUnsubscriber?: () => void;
    private followingRemoteUserUuid: string | null = null;
    // Internal handoff guard: locate flow briefly closes then reopens the same menu.
    // We must not reset camera follow during that intermediate close.
    private suppressNextFollowResetOnMenuClose = false;

    constructor(private scene: GameScene, private cameraManager: CameraManager, private connection: RoomConnection) {
        this.subscribeToLocatePositionMessages();
        this.subscribeToWokaMenuStore();
        wokaMenuProgressStore.set(undefined);
    }

    public destroy(): void {
        this.clearAllTimeouts();
        this.wokaMenuStoreUnsubscriber?.();
        wokaMenuProgressStore.set(undefined);
    }

    private subscribeToLocatePositionMessages(): void {
        // The locatePositionMessageStream stream is completed in the RoomConnection. No need to unsubscribe.
        //eslint-disable-next-line rxjs/no-ignored-subscription, svelte/no-ignored-unsubscribe
        this.connection.locatePositionMessageStream.subscribe((message) => {
            this.handleLocatePositionMessage(message);
        });
    }

    private subscribeToWokaMenuStore(): void {
        // Subscribe to woka menu store for locate flow handoff/follow behavior.
        this.wokaMenuStoreUnsubscriber = wokaMenuStore.subscribe((value) => {
            if (value === undefined) {
                if (this.suppressNextFollowResetOnMenuClose) {
                    this.suppressNextFollowResetOnMenuClose = false;
                    return;
                }
                if (this.followingRemoteUserUuid) {
                    // Keep camera on the located user when card is closed.
                    // We still consume the flag to avoid carrying it to future clears.
                    wokaMenuStore.consumeSkipFollowResetOnNextClear();
                    this.followingRemoteUserUuid = null;
                }
                return;
            }

            // Do not auto-follow on hover-based cards (personal area hover).
            if (value.source !== "locate") {
                return;
            }

            if (value.userUuid !== undefined && value.userUuid !== "") {
                this.cameraManager.followRemotePlayer(value.userUuid);
                this.followingRemoteUserUuid = value.userUuid;
            }
        });
    }

    private handleLocatePositionMessage(message: LocatePositionMessageProto): void {
        if (!message.position) {
            return;
        }

        // Clear any existing locate position intervals/timeouts
        this.clearAllTimeouts();

        // Set camera to exploration mode and center on the position
        this.cameraManager.setExplorationMode();
        this.cameraManager.centerCameraOn({
            x: message.position.x,
            y: message.position.y,
        });

        // Get user data to initialize woka menu
        const userData = this.scene.getRemotePlayersRepository().getPlayers().get(message.userId);
        const userName = userData?.name ?? get(LL).locate.userSearching();
        const userUuid = userData?.userUuid ?? "";
        const visitCardUrl = userData?.visitCardUrl ?? undefined;

        // Initialize woka menu with progress
        wokaMenuStore.initialize(
            userName,
            -1,
            userUuid,
            visitCardUrl || undefined,
            "locate",
            undefined,
            userData?.availabilityStatus
        );

        // Set up progress messages with fun explanations
        const progressMessages = [
            get(LL).locate.progressMessages.scanning(),
            get(LL).locate.progressMessages.lookingAround(),
            get(LL).locate.progressMessages.checkingCorners(),
            get(LL).locate.progressMessages.stillSearching(),
            get(LL).locate.progressMessages.maybeHiding(),
            get(LL).locate.progressMessages.searchingWorld(),
            get(LL).locate.progressMessages.almostThere(),
            get(LL).locate.progressMessages.gettingCloser(),
            get(LL).locate.progressMessages.justMomentMore(),
            get(LL).locate.progressMessages.finalCheck(),
        ];

        let progressStep = 0;
        wokaMenuProgressStore.set({
            progress: 0,
            message: progressMessages[0],
        });

        // During 10 seconds, every second, check if the remote user is created and can be located
        this.locatePositionInterval = setInterval(() => {
            progressStep++;
            const progressPercent = Math.min((progressStep / 10) * 100, 90);
            const messageIndex = Math.min(
                Math.floor((progressStep / 10) * progressMessages.length),
                progressMessages.length - 1
            );

            wokaMenuProgressStore.set({
                progress: progressPercent,
                message: progressMessages[messageIndex],
            });

            const remoteUser = this.findRemotePlayer(message.userId);
            if (remoteUser) {
                this.clearAllTimeouts();
                this.activateRemoteUser(remoteUser);
            }
        }, 1000);

        this.locatePositionTimeout = setTimeout(() => {
            this.clearAllTimeouts();
            const remoteUser = this.findRemotePlayer(message.userId);
            if (!remoteUser) {
                // Show error message with fun explanation
                wokaMenuProgressStore.set({
                    progress: 100,
                    message: get(LL).locate.errorMessage(),
                });

                // Clear progress after 3 seconds
                this.locatePositionClearProgressTimeout = setTimeout(() => {
                    wokaMenuProgressStore.set(undefined);
                    // We try to find the remote last one time to stay focused on the remote player
                    const remoteUser = this.findRemotePlayer(message.userId);
                    if (remoteUser) {
                        this.activateRemoteUser(remoteUser);
                    } else {
                        wokaMenuStore.clear();
                    }
                    this.locatePositionClearProgressTimeout = undefined;
                }, 3000);
            } else {
                wokaMenuProgressStore.set(undefined);
                this.activateRemoteUser(remoteUser);
            }
        }, 10000);
    }

    private findRemotePlayer(userId: number): RemotePlayer | undefined {
        return Array.from(this.scene.MapPlayersByKey.values()).find((player: RemotePlayer) => player.userId === userId);
    }

    private activateRemoteUser(remoteUser: RemotePlayer): void {
        // Delay activation to allow Phaser to update player state and avoid camera animation glitch
        // This ensures smooth camera transition when the player is created/updated/recreated
        setTimeout(() => {
            // Locate flow opens an interim menu with source=locate.
            // RemotePlayer.activate() toggles the menu; if same user is already open it closes it.
            // Close+reopen intentionally to get full remote-player actions without snapping camera back.
            const openedMenu = get(wokaMenuStore);
            const isLocateInterimMenu =
                openedMenu !== undefined &&
                openedMenu.source === "locate" &&
                openedMenu.userUuid === remoteUser.userUuid;

            if (isLocateInterimMenu) {
                this.suppressNextFollowResetOnMenuClose = true;
                remoteUser.activate(); // closes interim locate menu
            }

            remoteUser.activate(); // opens regular remote-player menu with actions
            wokaMenuProgressStore.set(undefined);
        }, 300);
    }

    private clearAllTimeouts(): void {
        if (this.locatePositionInterval !== undefined) {
            clearInterval(this.locatePositionInterval);
            this.locatePositionInterval = undefined;
        }
        if (this.locatePositionTimeout !== undefined) {
            clearTimeout(this.locatePositionTimeout);
            this.locatePositionTimeout = undefined;
        }
        if (this.locatePositionClearProgressTimeout !== undefined) {
            clearTimeout(this.locatePositionClearProgressTimeout);
            this.locatePositionClearProgressTimeout = undefined;
        }
    }
}
