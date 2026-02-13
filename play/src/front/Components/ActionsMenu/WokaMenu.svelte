<script lang="ts">
    import type { Unsubscriber } from "svelte/store";
    import { onDestroy } from "svelte";
    import { AvailabilityStatus } from "@workadventure/messages";
    import type { CharacterTextureMessage } from "@workadventure/messages";
    import { wokaMenuStore, wokaMenuProgressStore } from "../../Stores/WokaMenuStore";
    import ButtonClose from "../Input/ButtonClose.svelte";
    import VisitCard from "../VisitCard/VisitCard.svelte";
    import WokaFromUserId from "../Woka/WokaFromUserId.svelte";
    import WokaImage from "../Woka/WokaImage.svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { currentPlayerNameStore } from "../../Stores/CurrentPlayerProfileStore";
    import type { WokaData } from "../Woka/WokaTypes";
    import { getColorHexOfStatus, getStatusLabel } from "../../Utils/AvailabilityStatus";

    import type { WokaMenuAction, WokaMenuData } from "../../Stores/WokaMenuStore";

    let wokaMenuData: WokaMenuData | undefined;
    let sortedActions: WokaMenuAction[] | undefined;
    let remotePlayer: { chatID?: string } | undefined;

    let wokaMenuStoreUnsubscriber: Unsubscriber | null;
    let wokaDataCache: WokaData | undefined;
    let wokaDataPromise: Promise<WokaData> | undefined;
    let offlineSelectedTextures: Record<string, string> | null = null;
    let offlineWokaData: WokaData | null = null;
    let offlineWokaRequestId = 0;
    const OFFLINE_COLOR = "#94a3b8";
    const localUserUuid = localUserStore.getLocalUser()?.uuid;

    $: statusToDisplay = wokaMenuData?.availabilityStatus;
    $: isOfflineStatus = statusToDisplay === AvailabilityStatus.UNCHANGED;
    $: isLocalHoveredUser = !!(wokaMenuData?.userUuid && localUserUuid && wokaMenuData.userUuid === localUserUuid);
    $: displayedWokaName =
        isLocalHoveredUser && $currentPlayerNameStore ? $currentPlayerNameStore : wokaMenuData?.wokaName ?? "";
    $: statusLabel =
        statusToDisplay !== undefined
            ? isOfflineStatus
                ? $LL.actionbar.status.OFFLINE()
                : getStatusLabel(statusToDisplay)
            : "";
    $: statusColor =
        statusToDisplay !== undefined ? (isOfflineStatus ? OFFLINE_COLOR : getColorHexOfStatus(statusToDisplay)) : "";

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            closeActionsMenu();
        }
    }

    function closeActionsMenu(options?: { skipFollowReset?: boolean }) {
        wokaMenuStore.clear(options);
    }

    function closeActionsMenuFromClick(): void {
        closeActionsMenu();
    }

    function resetOfflineWokaPreview(): void {
        offlineSelectedTextures = null;
        offlineWokaData = null;
    }

    function updateOfflineWokaPreview(menuData: WokaMenuData | undefined): void {
        const hasOfflineTextures = menuData?.userId === -1 && (menuData?.characterTextures?.length ?? 0) > 0;
        if (!hasOfflineTextures) {
            offlineWokaRequestId += 1;
            resetOfflineWokaPreview();
            return;
        }

        const requestId = ++offlineWokaRequestId;
        const textures = menuData?.characterTextures ?? [];
        resetOfflineWokaPreview();
        void getWokaData()
            .then((data) => {
                if (requestId !== offlineWokaRequestId) {
                    return;
                }
                offlineWokaData = data;
                offlineSelectedTextures = mapTexturesToSelected(data, textures);
            })
            .catch((err) => {
                console.warn("Could not load Woka data for hover card", err);
            });
    }

    let buttonsLayout: "row" | "column" | "wrap" = "row";

    wokaMenuStoreUnsubscriber = wokaMenuStore.subscribe((value) => {
        wokaMenuData = value;
        updateOfflineWokaPreview(value);
        if (wokaMenuData) {
            remotePlayer = gameManager
                .getCurrentGameScene()
                .getRemotePlayersRepository()
                .getPlayers()
                .get(wokaMenuData.userId);
            sortedActions = [...wokaMenuData.actions.values()].sort((a, b) => {
                const ap = a.priority ?? 0;
                const bp = b.priority ?? 0;
                if (ap > bp) {
                    return -1;
                }
                if (ap < bp) {
                    return 1;
                } else {
                    return 0;
                }
            });
            const nbButtons = sortedActions.length + (wokaMenuData.wokaName ? 0 : 1) + (remotePlayer?.chatID ? 1 : 0);
            if (nbButtons < 4) {
                buttonsLayout = "row";
            } else {
                buttonsLayout = "wrap";
            }
        }
    });

    function getWokaData(): Promise<WokaData> {
        if (wokaDataCache !== undefined) {
            return Promise.resolve(wokaDataCache);
        }
        if (wokaDataPromise) {
            return wokaDataPromise;
        }
        const roomUrl = gameManager.currentStartedRoom.href;
        wokaDataPromise = fetch(`${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}`, {
            headers: {
                Authorization: localUserStore.getAuthToken() || "",
            },
            credentials: "include",
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error("Failed to load Woka data");
                }
                return response.json() as Promise<WokaData>;
            })
            .then((data) => {
                wokaDataCache = data;
                return data;
            })
            .finally(() => {
                wokaDataPromise = undefined;
            });

        return wokaDataPromise;
    }

    function mapTexturesToSelected(wokaData: WokaData, textures: CharacterTextureMessage[]): Record<string, string> {
        const ids = new Set(textures.map((t) => t.id));
        const selected: Record<string, string> = {};
        for (const [part, partData] of Object.entries(wokaData)) {
            for (const collection of partData.collections) {
                const match = collection.textures.find((t) => ids.has(t.id));
                if (match) {
                    selected[part] = match.id;
                    break;
                }
            }
        }
        return selected;
    }

    onDestroy(() => {
        offlineWokaRequestId += 1;
        if (wokaMenuStoreUnsubscriber) {
            wokaMenuStoreUnsubscriber();
        }
    });
</script>

<svelte:window on:keydown={onKeyDown} />

{#if wokaMenuData}
    <div
        class="m-auto my-0 h-fit min-h-fit max-w-lg min-w-48 max-sm:max-w-[89%] z-50 bg-contrast/80 transition-all backdrop-blur rounded-lg pointer-events-auto overflow-hidden md:mr-0"
        data-testid="actions-menu"
    >
        <div>
            <div class="w-full bg-cover relative">
                <div class="absolute top-2 right-2">
                    <ButtonClose on:click={closeActionsMenuFromClick} />
                </div>

                <div class="flex items-center justify-center p-2">
                    <div class="text-white flex flex-col justify-center items-center font-bold text-xl">
                        {#if isLocalHoveredUser}
                            <div
                                id="woka"
                                class=" bt-3 overflow-hidden mt-9 border w-fit h-fit pt-3 rounded-lg cursor-not-allowed bg-[rgb(103,185,133)]"
                            >
                                <WokaFromUserId
                                    userId={-1}
                                    placeholderSrc="/assets/placeholder-woka.png"
                                    customWidth="4rem"
                                />
                            </div>
                        {:else if wokaMenuData.userId != undefined && wokaMenuData.userId != -1}
                            <div
                                id="woka"
                                class=" bt-3 overflow-hidden mt-9 border w-fit h-fit pt-3 rounded-lg cursor-not-allowed bg-[rgb(103,185,133)]"
                            >
                                <WokaFromUserId
                                    userId={wokaMenuData.userId}
                                    placeholderSrc="/assets/placeholder-woka.png"
                                    customWidth="4rem"
                                />
                            </div>
                        {:else if offlineSelectedTextures && offlineWokaData}
                            <div
                                id="woka"
                                class=" bt-3 overflow-hidden mt-9 border w-fit h-fit pt-3 rounded-lg cursor-not-allowed bg-[rgb(103,185,133)]"
                            >
                                <WokaImage
                                    selectedTextures={offlineSelectedTextures}
                                    wokaData={offlineWokaData}
                                    canvasSize={64}
                                />
                            </div>
                        {:else}
                            <div
                                id="woka"
                                class=" bt-3 overflow-hidden mt-9 border w-fit h-fit pt-3 rounded-lg cursor-not-allowed bg-[rgb(103,185,133)]"
                            >
                                <img src="/assets/placeholder-woka.png" alt="" class="w-16 h-16" />
                            </div>
                        {/if}
                        <div class="mt-[24px] flex flex-col items-center gap-2">
                            <h3 class="text-center">{displayedWokaName}</h3>
                            {#if statusToDisplay !== undefined}
                                <div
                                    class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/80"
                                >
                                    <span
                                        class="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white/10"
                                        style="background-color: {statusColor}"
                                    />
                                    {statusLabel}
                                </div>
                            {/if}
                        </div>
                    </div>
                </div>

                {#if wokaMenuData.visitCardUrl}
                    <VisitCard
                        visitCardUrl={wokaMenuData.visitCardUrl}
                        isEmbedded={true}
                        showSendMessageButton={false}
                    />
                {/if}

                {#if $wokaMenuProgressStore}
                    <div class="px-4 pb-4 pt-2">
                        <div class="w-full bg-white/10 rounded-full h-2 mb-2">
                            <div
                                class="bg-primary h-2 rounded-full transition-all duration-300"
                                style="width: {$wokaMenuProgressStore.progress}%"
                            />
                        </div>
                        <p class="text-white/80 text-sm text-center animate-pulse">
                            {$wokaMenuProgressStore.message}
                        </p>
                    </div>
                {/if}
            </div>
        </div>

        {#if sortedActions}
            <div
                class="flex items-center bg-contrast w-full justify-center"
                class:margin-close={!wokaMenuData.wokaName}
                class:flex-row={buttonsLayout === "row"}
                class:flex-wrap={buttonsLayout === "wrap"}
            >
                {#each sortedActions ?? [] as action (action.uuid)}
                    <button
                        type="button"
                        data-testid={action.testId}
                        class="btn btn-light btn-ghost text-nowrap justify-center my-2 mx-1 min-w-0 {action.style ??
                            ''}"
                        class:mx-2={buttonsLayout === "column"}
                        on:click={() => analyticsClient.clickPropertyMapEditor(action.actionName, action.style)}
                        on:click|preventDefault={() => {
                            if (action.closeMenuOnClick !== false) {
                                closeActionsMenu({ skipFollowReset: action.preserveCameraOnClose === true });
                            }
                            action.callback();
                        }}
                    >
                        <span class="flex flex-row gap-1 items-center justify-center">
                            {#if action.actionIcon && typeof action.actionIcon === "string"}
                                <div class="w-6 h-6">
                                    <img src={action.actionIcon} class="w-full h-full" alt="" />
                                </div>
                            {:else if action.actionIcon && typeof action.actionIcon === "function"}
                                <svelte:component this={action.actionIcon} class="w-6 h-6" />
                            {/if}
                            {action.actionName}
                        </span>
                    </button>
                {/each}

                {#if !wokaMenuData.wokaName}
                    <button
                        type="button"
                        class="btn btn-light btn-ghost text-nowrap justify-center my-2 mx-1 w-fit"
                        on:click|preventDefault|stopPropagation={closeActionsMenuFromClick}
                    >
                        {$LL.actionbar.close()}
                    </button>
                {/if}
            </div>
        {/if}
    </div>
{/if}

<style lang="scss">
</style>
