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
    import XIcon from "../Icons/XIcon.svelte";
    import WokaSelectScene from "./WokaSelectScene.svelte";
    import WokaCustomizeScene from "./WokaCustomizeScene.svelte";

    let buildOwnWoka = false;
    let error: string | null = null;

    async function saveAndContinue(texturesId: string[]) {
        error = null; // Reset error message
        try {
            if (!areCharacterTexturesValid(texturesId)) {
                error = "Invalid character textures";
                return;
            }

            analyticsClient.validationWoka("SelectWoka");
            gameManager.setCharacterTextureIds(texturesId);
            await connectionManager.saveTextures(texturesId);
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
