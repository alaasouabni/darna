<script lang="ts">
    import { onDestroy } from "svelte";
    import type { Unsubscriber } from "svelte/store";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import type { PictureStore } from "../../Stores/PictureStore";
    import { currentPlayerCompanionStore } from "../../Stores/CurrentPlayerCompanionStore";

    export let userId: number;
    export let placeholderSrc: string;
    export let width = "62px";
    export let height = "62px";

    let src = placeholderSrc;
    let unsubscribe: Unsubscriber | undefined;

    if (userId === -1) {
        unsubscribe = currentPlayerCompanionStore.subscribe((source) => {
            src = source ?? placeholderSrc;
        });
    } else {
        const gameScene = gameManager.getCurrentGameScene();
        const companionWokaPictureStore: PictureStore | undefined = gameScene.MapPlayersByKey.getNestedStore(
            userId,
            (item) => item.companion?.pictureStore
        );
        if (companionWokaPictureStore) {
            unsubscribe = companionWokaPictureStore.subscribe((source) => {
                src = source ?? placeholderSrc;
            });
        }
    }

    onDestroy(() => {
        if (unsubscribe) unsubscribe();
    });
</script>

<img {src} alt="" draggable="false" style="--theme-width: {width}; --theme-height: {height}" />

<style>
    img {
        display: inline-block;
        pointer-events: auto;
        width: var(--theme-width);
        height: var(--theme-height);
        margin: 0;
        padding: 0;
        position: static;
        left: 0;
        bottom: 0;
        right: 0;
        top: 0;
        image-rendering: pixelated;
    }
</style>
