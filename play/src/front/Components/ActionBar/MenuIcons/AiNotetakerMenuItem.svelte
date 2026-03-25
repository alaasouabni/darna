<script lang="ts">
    import { onMount } from "svelte";
    import { openModal } from "svelte-modals";
    import ActionBarButton from "../ActionBarButton.svelte";
    import PenIcon from "../../Icons/PenIcon.svelte";
    import AiNotetakerQuickControlModal from "../../Notetaker/AiNotetakerQuickControlModal.svelte";
    import {
        notetakerAvailableStore,
        notetakerCanManageStore,
        notetakerControls,
        notetakerLoadingStore,
        notetakerRuntimeStateStore,
    } from "../../../Stores/NotetakerStore";
    import { livekitMeetingRoomSpaceNameStore } from "../../../Stores/GameStore";

    onMount(() => {
        notetakerControls.bootstrapNotetaker();

        const unsubscribeMeetingSpace = livekitMeetingRoomSpaceNameStore.subscribe((spaceName) => {
            void notetakerControls.refreshCurrentSession(spaceName ?? undefined);
        });

        return () => {
            unsubscribeMeetingSpace();
        };
    });

    function isSessionRunning() {
        const state = $notetakerRuntimeStateStore;
        return state === "starting" || state === "active" || state === "idle-warning" || state === "stopping";
    }

    function onAiNotetakerClick() {
        openModal(AiNotetakerQuickControlModal, {});
    }

    $: tooltip = isSessionRunning()
        ? "Open AI notes controls (active)"
        : $notetakerCanManageStore
        ? "Open AI notes controls"
        : "Open AI notes controls (read-only)";

    $: buttonState = $notetakerLoadingStore
        ? "disabled"
        : isSessionRunning()
        ? "active"
        : $notetakerCanManageStore
        ? "normal"
        : "forbidden";
</script>

{#if $notetakerAvailableStore}
    <ActionBarButton
        on:click={onAiNotetakerClick}
        classList="group/btn-ai-notes"
        tooltipTitle={tooltip}
        tooltipDesc={$notetakerCanManageStore
            ? "Start or stop AI notes for this meeting room"
            : "You can view notes but cannot start/stop for this room."}
        state={buttonState}
        dataTestId="aiNotetakerButton"
        media="./static/images/screensharing.mp4"
        desc="Open quick AI notes controls for this meeting room"
    >
        <PenIcon />
    </ActionBarButton>
{/if}
