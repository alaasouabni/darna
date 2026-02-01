<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { Unsubscriber } from "svelte/store";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { currentPlayerWokaStore } from "../../Stores/CurrentPlayerWokaStore";
    import Woka from "./Woka.svelte";

    export let userId: number | string;
    export let placeholderSrc: string;
    export let customWidth: string;

    let src: string;
    let unsubscribe: Unsubscriber | undefined;

    onMount(() => {
        let playerWokaPictureStore;
        if (userId === -1) {
            playerWokaPictureStore = currentPlayerWokaStore;
        } else if (Number.isInteger(userId)) {
            const gameScene = gameManager.getCurrentGameScene();
            playerWokaPictureStore = gameScene.MapPlayersByKey.getNestedStore(
                userId as number,
                (item) => item.pictureStore
            );
        } else {
            const gameScene = gameManager.getCurrentGameScene();
            // eslint-disable-next-line svelte/require-store-reactive-access
            playerWokaPictureStore = [...gameScene.MapPlayersByKey].find(
                ([, player]) => player.userUuid === (userId as string)
            )?.[1].pictureStore;
        }

        src = placeholderSrc;
        unsubscribe = playerWokaPictureStore?.subscribe((source) => {
            src = source ?? placeholderSrc;
        });
    });
    onDestroy(() => {
        if (unsubscribe) unsubscribe();
    });
</script>

{#if src}
    <Woka {src} {customWidth} />
{/if}
