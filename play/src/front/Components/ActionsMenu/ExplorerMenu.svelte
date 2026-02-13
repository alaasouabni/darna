<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { get } from "svelte/store";
    import type { AreaData, PersonalAreaPropertyData } from "@workadventure/map-editor";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { mapEditorModeStore, mapExplorationModeStore } from "../../Stores/MapEditorStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import LL from "../../../i18n/i18n-svelte";
    import { IconFocusCentered, IconLock, IconLockOpen, IconMapSearch, IconMinus, IconPlus } from "@wa-icons";

    let personalAreaData: AreaData | null = null;
    let personalAreaProperty: PersonalAreaPropertyData | null = null;
    let canTogglePersonalDeskLock = false;
    let isPersonalDeskLocked = false;
    let personalDeskCheckInterval: ReturnType<typeof setInterval> | null = null;

    function resetPersonalDeskState() {
        personalAreaData = null;
        personalAreaProperty = null;
        canTogglePersonalDeskLock = false;
        isPersonalDeskLocked = false;
    }

    function updatePersonalDeskState() {
        const userUUID = localUserStore.getLocalUser()?.uuid;
        const gameScene = gameManager.getCurrentGameScene();
        if (!userUUID || !gameScene) {
            resetPersonalDeskState();
            return;
        }

        const gameMapFrontWrapper = gameScene.getGameMapFrontWrapper();
        const personalAreas =
            gameMapFrontWrapper.areasManager?.getAreasByPropertyType("personalAreaPropertyData") ?? [];

        resetPersonalDeskState();

        for (const area of personalAreas) {
            const property = area.areaData.properties.find(
                (areaProperty): areaProperty is PersonalAreaPropertyData =>
                    areaProperty.type === "personalAreaPropertyData"
            );

            if (property && property.ownerId === userUUID) {
                const currentPlayer = gameScene.CurrentPlayer;
                const isInside =
                    !!currentPlayer &&
                    gameMapFrontWrapper.isInsideAreaByCoordinates(
                        {
                            x: area.areaData.x,
                            y: area.areaData.y,
                            width: area.areaData.width,
                            height: area.areaData.height,
                        },
                        { x: currentPlayer.x, y: currentPlayer.y }
                    );

                if (isInside) {
                    personalAreaData = area.areaData;
                    personalAreaProperty = property;
                    canTogglePersonalDeskLock = true;
                    isPersonalDeskLocked = property.locked ?? false;
                }
                return;
            }
        }
    }

    async function togglePersonalDeskLock() {
        if (!personalAreaData || !personalAreaProperty) {
            updatePersonalDeskState();
            if (!personalAreaData || !personalAreaProperty) {
                warningMessageStore.addWarningMessage(get(LL).actionbar.personalDesk.errorNotFound(), {
                    closable: true,
                });
                return;
            }
        }

        const gameScene = gameManager.getCurrentGameScene();
        const mapEditorModeManager = gameScene?.getMapEditorModeManager();
        if (!mapEditorModeManager) {
            warningMessageStore.addWarningMessage(get(LL).actionbar.personalDesk.errorUnclaiming(), { closable: true });
            return;
        }

        const nextLocked = !(personalAreaProperty.locked ?? false);
        await mapEditorModeManager.setPersonalAreaLock(personalAreaData, nextLocked);
        isPersonalDeskLocked = nextLocked;
        updatePersonalDeskState();
    }

    onMount(() => {
        updatePersonalDeskState();
        personalDeskCheckInterval = setInterval(updatePersonalDeskState, 1500);
    });

    onDestroy(() => {
        if (personalDeskCheckInterval) clearInterval(personalDeskCheckInterval);
    });

    function zoomIn() {
        analyticsClient.clickToZoomIn();

        const scene = gameManager.getCurrentGameScene();
        scene.zoomByFactor(1.2, true);
    }

    function zoomOut() {
        analyticsClient.clickToZoomOut();

        const scene = gameManager.getCurrentGameScene();
        scene.zoomByFactor(0.8, true);
    }

    function openMapExplorer() {
        analyticsClient.clickTopOpenMapExplorer();

        mapEditorModeStore.switchMode(true);
        gameManager.getCurrentGameScene().getMapEditorModeManager().equipTool(EditorToolName.ExploreTheRoom);
    }

    function centerToUser() {
        analyticsClient.clickCenterToUser();

        mapEditorModeStore.switchMode(false);
        gameManager.getCurrentGameScene().getMapEditorModeManager().equipTool(EditorToolName.CloseMapEditor);
    }
</script>

<div
    class="absolute bottom-2 right-2 bg-contrast/80 rounded pointer-events-auto p-1 backdrop-blur hover:bg-contrast/100"
    data-testid="actions-explorer"
>
    <div class="flex flex-col justify-center gap-2">
        {#if canTogglePersonalDeskLock}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="group flex justify-center items-center p-1 rounded hover:bg-white/30 cursor-pointer"
                on:click={togglePersonalDeskLock}
            >
                {#if isPersonalDeskLocked}
                    <IconLock />
                    <div
                        class="-right-60 opacity-0 group-hover:opacity-90 group-hover:right-11 absolute bg-contrast backdrop-blur text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                    >
                        {$LL.actionbar.personalDesk.unlock()}
                    </div>
                {:else}
                    <IconLockOpen />
                    <div
                        class="-right-60 opacity-0 group-hover:opacity-90 group-hover:right-11 absolute bg-contrast backdrop-blur text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                    >
                        {$LL.actionbar.personalDesk.lock()}
                    </div>
                {/if}
            </div>
        {/if}
        <div class="flex flex-col justify-center gap-1">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="group flex justify-center items-center p-1 rounded hover:bg-white/30 cursor-pointer"
                on:click={zoomIn}
            >
                <IconPlus />
                <div
                    class="-right-60 opacity-0 group-hover:opacity-90 group-hover:right-11 absolute bg-contrast backdrop-blur text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                >
                    {$LL.mapEditor.explorer.zoomIn()}
                </div>
            </div>
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="group flex justify-center items-center p-1 rounded hover:bg-white/30 cursor-pointer"
                on:click={zoomOut}
            >
                <IconMinus />
                <div
                    class="-right-60 opacity-0 group-hover:opacity-90 group-hover:right-11 absolute bg-contrast backdrop-blur text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                >
                    {$LL.mapEditor.explorer.zoomOut()}
                </div>
            </div>
        </div>
        {#if $mapExplorationModeStore === false}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="group flex justify-center items-center p-1 rounded hover:bg-white/30 cursor-pointer"
                on:click={openMapExplorer}
            >
                <IconMapSearch />
                <div
                    class="-right-60 opacity-0 group-hover:opacity-90 group-hover:right-11 absolute bg-contrast backdrop-blur text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                >
                    {$LL.mapEditor.explorer.title()}
                </div>
            </div>
        {:else}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="group flex justify-center items-center p-1 rounded hover:bg-white/30 cursor-pointer"
                on:click={centerToUser}
            >
                <IconFocusCentered />
                <div
                    class="-right-60 opacity-0 group-hover:opacity-90 group-hover:right-11 absolute bg-contrast backdrop-blur text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                >
                    {$LL.mapEditor.explorer.showMyLocation()}
                </div>
            </div>
        {/if}
    </div>
</div>
