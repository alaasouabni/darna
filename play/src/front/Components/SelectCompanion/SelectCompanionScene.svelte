<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { Game } from "../../Phaser/Game/Game";
    import type { SelectCompanionScene } from "../../Phaser/Login/SelectCompanionScene";
    import { SelectCompanionSceneName } from "../../Phaser/Login/SelectCompanionScene";
    import { collectionsSizeStore, selectedCollection } from "../../Stores/SelectCharacterSceneStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { IconChevronLeft, IconChevronRight } from "@wa-icons";
    import { inGameProfileEditStore } from "../../Stores/ProfileEditStore";
    import { selectCompanionPreviewFrameStore, selectCompanionReadyStore } from "../../Stores/SelectCompanionStore";
    import XIcon from "../Icons/XIcon.svelte";

    export let game: Game;

    const selectCompanionScene = game.scene.getScene(SelectCompanionSceneName) as SelectCompanionScene;

    /*function selectLeft() {
        selectCompanionScene.moveToLeft();
    }

    function selectRight() {
        selectCompanionScene.moveToRight();
    }*/

    function noCompanion() {
        selectCompanionScene.noCompagnion().catch((e) => console.error(e));
    }

    function selectCompanion() {
        selectCompanionScene.selectCompanion().catch((e) => console.error(e));
    }

    function selectLeftCollection() {
        selectCompanionScene.selectPreviousCompanionCollection();
    }

    function selectRightCollection() {
        selectCompanionScene.selectNextCompanionCollection();
    }

    let previewFrameEl: HTMLDivElement | null = null;
    let maskEl: HTMLDivElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    function updatePreviewFrameRect() {
        if (!previewFrameEl || !maskEl) return;
        const rect = previewFrameEl.getBoundingClientRect();
        selectCompanionPreviewFrameStore.set({
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
        });
        maskEl.style.setProperty("--hole-left", `${Math.max(0, rect.left)}px`);
        maskEl.style.setProperty("--hole-top", `${Math.max(0, rect.top)}px`);
        maskEl.style.setProperty("--hole-width", `${Math.max(0, rect.width)}px`);
        maskEl.style.setProperty("--hole-height", `${Math.max(0, rect.height)}px`);
    }

    onMount(() => {
        updatePreviewFrameRect();
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(updatePreviewFrameRect);
            if (previewFrameEl) {
                resizeObserver.observe(previewFrameEl);
            }
        }
        window.addEventListener("resize", updatePreviewFrameRect);
        requestAnimationFrame(updatePreviewFrameRect);
    });

    onDestroy(() => {
        resizeObserver?.disconnect();
        window.removeEventListener("resize", updatePreviewFrameRect);
        selectCompanionPreviewFrameStore.set(null);
    });

    $: if ($selectCompanionReadyStore) {
        requestAnimationFrame(() => {
            updatePreviewFrameRect();
            requestAnimationFrame(updatePreviewFrameRect);
        });
    }
</script>

{#if $inGameProfileEditStore}
    <div class="fixed inset-0 z-40 flex items-center justify-center pointer-events-auto">
        <div bind:this={maskEl} class="modal-dim" aria-hidden="true">
            <div class="mask-block mask-top" />
            <div class="mask-block mask-left" />
            <div class="mask-block mask-right" />
            <div class="mask-block mask-bottom" />
        </div>
        <div
            class="modal-shell relative z-10 w-[min(760px,90vw)] border border-slate-500/30 rounded-xl shadow-2xl"
        >
            <div class="relative z-10 p-6">
            <button
                type="button"
                aria-label="Close"
                class="absolute right-3 top-3 h-9 w-9 rounded-full hover:bg-white/10 flex items-center justify-center"
                on:click|preventDefault={() => selectCompanionScene.closeScene()}
            >
                <XIcon classList="h-4 w-4" />
            </button>
            <section class="text-center mb-4">
                <span class="text-white text-lg bold">
                    {$LL.companion.select.title()}
                </span>
            </section>
            <section class="flex justify-center mb-4">
                <div
                    class="w-[min(72vw,400px)] rounded-xl border border-slate-400/30 bg-transparent p-3 shadow-[0_12px_24px_rgba(0,0,0,0.35)]"
                >
                    <div
                        bind:this={previewFrameEl}
                        class="relative w-full aspect-[4/3] rounded-lg border border-white/15 bg-transparent shadow-none"
                    >
                        {#if !$selectCompanionReadyStore}
                            <div class="absolute inset-0 flex items-center justify-center text-sm text-slate-200/80">
                                Loading companions…
                            </div>
                        {/if}
                    </div>
                </div>
            </section>
            <section class="category flex flex-row justify-center mb-6">
                {#if $collectionsSizeStore > 1 && $selectedCollection}
                    <button class="light mr-2 selectCharacterButton" on:click|preventDefault={selectLeftCollection}>
                        <IconChevronLeft />
                    </button>
                    <strong class="category-text">{$selectedCollection}</strong>
                    <button class="outline ml-2 selectCharacterButton" on:click|preventDefault={selectRightCollection}>
                        <IconChevronRight />
                    </button>
                {/if}
            </section>
            <div class="action-panel">
                <section class="action flex flex-col-reverse md:flex-row items-center space-y-2 md:space-y-0 md:space-x-4 justify-between">
                    <button
                        class="btn btn-light btn-lg btn-ghost w-full md:w-1/2 block selectCompanionSceneFormBack"
                        on:click|preventDefault={noCompanion}>{$LL.companion.select.any()}</button
                    >
                    <button
                        type="submit"
                        class="btn btn-secondary btn-lg w-full md:w-1/2 block selectCompanionSceneFormSubmit"
                        on:click|preventDefault={() => analyticsClient.selectCompanion()}
                        on:click|preventDefault={selectCompanion}>{$LL.companion.select.continue()}</button
                    >
                </section>
            </div>
            </div>
        </div>
    </div>
{:else}
    <section class="text-center absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-[calc(50%+20vh)] h-16">
        <span class="text-white text-lg bold">
            {$LL.companion.select.title()}
        </span>
    </section>
    <section class="category flex flex-row justify-center">
        {#if $collectionsSizeStore > 1 && $selectedCollection}
            <button class="light mr-2 selectCharacterButton" on:click|preventDefault={selectLeftCollection}>
                <IconChevronLeft />
            </button>
            <strong class="category-text">{$selectedCollection}</strong>
            <button class="outline ml-2 selectCharacterButton" on:click|preventDefault={selectRightCollection}>
                <IconChevronRight />
            </button>
        {/if}
    </section>
    <div
        class="fixed bottom-0 w-full bg-contrast/80 backdrop-blur-md border border-solid border-t border-b-0 border-x-0 border-white/10"
    >
        <section
            class="action container m-auto p-4 flex flex-col-reverse md:flex-row items-center space-y-2 md:space-y-0 md:space-x-4 justify-between"
        >
            <button
                class="btn btn-light btn-lg btn-ghost w-full md:w-1/2 block selectCompanionSceneFormBack"
                on:click|preventDefault={noCompanion}>{$LL.companion.select.any()}</button
            >
            <button
                type="submit"
                class="btn btn-secondary btn-lg w-full md:w-1/2 block selectCompanionSceneFormSubmit"
                on:click|preventDefault={() => analyticsClient.selectCompanion()}
                on:click|preventDefault={selectCompanion}>{$LL.companion.select.continue()}</button
            >
        </section>
    </div>
{/if}

<!--<form class="selectCompanionScene">-->
<!--    <section class="text-center">-->
<!--        <h2 class="text-white text-2xl">{$LL.companion.select.title()}</h2>-->
<!--        {#if $collectionsSizeStore > 1 && $selectedCollection}-->
<!--            <button-->
<!--                class="outline mr-2 selectCompanionCollectionButton selectCharacterButtonLeft"-->
<!--                on:click|preventDefault={selectLeftCollection}-->
<!--            >-->
<!--                &lt;-->
<!--            </button>-->
<!--            <strong class="category-text">{$selectedCollection}</strong>-->
<!--            <button-->
<!--                class="outline ml-2 selectCompanionCollectionButton selectCompanionButtonRight"-->
<!--                on:click|preventDefault={selectRightCollection}-->
<!--            >-->
<!--                &gt;-->
<!--            </button>-->
<!--        {/if}-->
<!--        <button class="outline selectCharacterButton selectCharacterButtonLeft" on:click|preventDefault={selectLeft}>-->
<!--            &lt;-->
<!--        </button>-->
<!--        <button class="outline selectCharacterButton selectCharacterButtonRight" on:click|preventDefault={selectRight}>-->
<!--            &gt;-->
<!--        </button>-->
<!--    </section>-->
<!--    <section class="action flex flex-row justify-center">-->
<!--        <button class="outline mr-2 selectCompanionSceneFormBack" on:click|preventDefault={noCompanion}-->
<!--            >{$LL.companion.select.any()}</button-->
<!--        >-->
<!--        <button-->
<!--            type="submit"-->
<!--            class="light ml-2 selectCompanionSceneFormSubmit"-->
<!--            on:click|preventDefault={() => analyticsClient.selectWoka()}-->
<!--            on:click|preventDefault={selectCompanion}>{$LL.companion.select.continue()}</button-->
<!--        >-->
<!--    </section>-->

<!--</form>-->
<style lang="scss">
    button {
        pointer-events: auto;
    }
    .modal-shell {
        background: transparent;
    }
    .modal-dim {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }
    .mask-block {
        position: absolute;
        background: rgba(15, 23, 42, 0.9);
    }
    .mask-top {
        left: 0;
        top: 0;
        width: 100%;
        height: var(--hole-top, 0px);
    }
    .mask-bottom {
        left: 0;
        top: calc(var(--hole-top, 0px) + var(--hole-height, 0px));
        width: 100%;
        height: calc(100% - (var(--hole-top, 0px) + var(--hole-height, 0px)));
    }
    .mask-left {
        left: 0;
        top: var(--hole-top, 0px);
        width: var(--hole-left, 0px);
        height: var(--hole-height, 0px);
    }
    .mask-right {
        left: calc(var(--hole-left, 0px) + var(--hole-width, 0px));
        top: var(--hole-top, 0px);
        width: calc(100% - (var(--hole-left, 0px) + var(--hole-width, 0px)));
        height: var(--hole-height, 0px);
    }
    .action-panel {
        margin-top: 1.5rem;
        padding: 0.75rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(15, 23, 42, 0.9);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
    }
</style>
