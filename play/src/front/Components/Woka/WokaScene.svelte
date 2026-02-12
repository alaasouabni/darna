<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { SelectCharacterSceneName } from "../../Phaser/Login/SelectCharacterScene";
    import { areCharacterTexturesValid } from "../../Connection/LocalUserUtils";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { selectCharacterSceneVisibleStore } from "../../Stores/SelectCharacterStore";
    import { inGameProfileEditStore } from "../../Stores/ProfileEditStore";
    import { EnableCameraSceneName } from "../../Phaser/Login/EnableCameraScene";
    import { lazyLoadPlayerCharacterTextures } from "../../Phaser/Entity/PlayerTexturesLoadingManager";
    import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import type { WokaData } from "./WokaTypes";
    import type { WokaTextureDescriptionInterface } from "../../Phaser/Entity/PlayerTextures";
    import { PROFILE_TEXTURES_VARIABLE } from "../../Connection/ProfileVariables";
    import XIcon from "../Icons/XIcon.svelte";
    import WokaSelectScene from "./WokaSelectScene.svelte";
    import WokaCustomizeScene from "./WokaCustomizeScene.svelte";

    let buildOwnWoka = false;
    let error: string | null = null;
    let wokaDataCache: WokaData | undefined;

    async function getWokaData(): Promise<WokaData> {
        if (wokaDataCache !== undefined) {
            return wokaDataCache;
        }
        const roomUrl = gameManager.currentStartedRoom.href;
        const response = await fetch(`${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}`, {
            headers: {
                Authorization: localUserStore.getAuthToken() || "",
            },
            credentials: "include",
        });
        if (!response.ok) {
            throw new Error("Failed to load Woka data");
        }
        const data = (await response.json()) as WokaData;
        wokaDataCache = data;
        return data;
    }

    function mapTextureIdsToDescriptors(wokaData: WokaData, texturesId: string[]): WokaTextureDescriptionInterface[] {
        const textureById = new Map<string, string>();
        for (const layer of Object.values(wokaData)) {
            for (const collection of layer.collections) {
                for (const texture of collection.textures) {
                    textureById.set(texture.id, texture.url);
                }
            }
        }
        return texturesId
            .map((id) => {
                const url = textureById.get(id);
                return url ? { id, url } : undefined;
            })
            .filter((texture): texture is WokaTextureDescriptionInterface => texture !== undefined);
    }

    async function saveAndContinue(texturesId: string[]) {
        error = null; // Reset error message
        try {
            if (!areCharacterTexturesValid(texturesId)) {
                error = "Invalid character textures";
                return;
            }

            analyticsClient.validationWoka("SelectWoka");
            gameManager.setCharacterTextureIds(texturesId);

            let descriptors: WokaTextureDescriptionInterface[] | null = null;
            try {
                const wokaData = await getWokaData();
                descriptors = mapTextureIdsToDescriptors(wokaData, texturesId);
            } catch (e) {
                console.warn("Could not fetch Woka data for profile update", e);
            }

            await connectionManager.saveTextures(
                texturesId,
                descriptors && descriptors.length > 0 ? descriptors : undefined
            );
            if ($inGameProfileEditStore) {
                try {
                    const scene = gameManager.getCurrentGameScene();
                    if (descriptors && descriptors.length > 0) {
                        await lazyLoadPlayerCharacterTextures(scene.superLoad, descriptors);
                        scene.CurrentPlayer?.updateTextures(descriptors.map((texture) => texture.id));
                        scene.setProfileVariable(PROFILE_TEXTURES_VARIABLE, descriptors);
                        scene.syncLocalUserSpaceProfile({ characterTextures: descriptors });
                    } else {
                        scene.CurrentPlayer?.updateTextures(texturesId);
                    }
                } catch (e) {
                    console.warn("Could not update textures in scene", e);
                }
            }
            selectCharacterSceneVisibleStore.set(false);
            gameManager.tryToStopScene(SelectCharacterSceneName);
            if ($inGameProfileEditStore) {
                inGameProfileEditStore.set(false);
                return;
            }
            gameManager.tryResumingGame(EnableCameraSceneName);
        } catch (err) {
            console.error("Error saving textures:", err);
            error = "Failed to save character customization";
        }
    }

    function closeInGameModal() {
        selectCharacterSceneVisibleStore.set(false);
        gameManager.tryToStopScene(SelectCharacterSceneName);
        inGameProfileEditStore.set(false);
        buildOwnWoka = false;
    }

    // Function to handle keyboard navigation
    function useKeyboardNavigation(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            buildOwnWoka = false; // Go back to the selection scene
        }
    }

    let mounted = false;

    onMount(() => {
        mounted = true;
        // Get the current textures
        const currentTextures = gameManager.getCharacterTextureIds();
        if (currentTextures && currentTextures.length > 1) {
            buildOwnWoka = true; // If there are textures, we assume the user wants to customize their Woka
        }
        // Add keyboard navigation listener
        window.addEventListener("keydown", useKeyboardNavigation);
    });

    onDestroy(() => {
        mounted = false;
        // Clean up the scene visibility store when the component is destroyed
        selectCharacterSceneVisibleStore.set(false);
        inGameProfileEditStore.set(false);
        // Remove keyboard navigation listener
        window.removeEventListener("keydown", useKeyboardNavigation);
    });
</script>

{#if mounted}
    {#if $inGameProfileEditStore}
        <div class="fixed inset-0 z-40 flex items-center justify-center pointer-events-auto">
            <div class="absolute inset-0 bg-black/45" />
            <div
                class="relative z-10 w-[min(1100px,92vw)] h-[min(820px,88vh)] bg-contrast/90 border border-white/10 rounded-xl shadow-xl overflow-hidden"
            >
                <button
                    type="button"
                    aria-label="Close"
                    class="absolute right-3 top-3 h-9 w-9 rounded-full hover:bg-white/10 flex items-center justify-center"
                    on:click|preventDefault={closeInGameModal}
                >
                    <XIcon classList="h-4 w-4" />
                </button>
                <div class="h-full w-full overflow-auto overflow-x-hidden">
                    <div class="w-full max-w-[900px] mx-auto px-6 py-6 overflow-x-hidden">
                        {#if buildOwnWoka}
                            <WokaCustomizeScene back={() => (buildOwnWoka = false)} {saveAndContinue} inGame />
                        {:else}
                            <WokaSelectScene customize={() => (buildOwnWoka = true)} {saveAndContinue} inGame />
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    {:else}
        {#if buildOwnWoka}
            <WokaCustomizeScene back={() => (buildOwnWoka = false)} {saveAndContinue} />
        {:else}
            <WokaSelectScene customize={() => (buildOwnWoka = true)} {saveAndContinue} />
        {/if}
    {/if}
{/if}

{#if error}
    <p class="text-center text-danger-800 p-0 m-0">{error}</p>
{/if}
