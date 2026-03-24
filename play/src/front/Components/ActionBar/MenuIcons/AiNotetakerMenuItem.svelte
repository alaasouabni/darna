<script lang="ts">
    import { onMount } from "svelte";
    import { openModal } from "svelte-modals";
    import ActionBarButton from "../ActionBarButton.svelte";
    import PenIcon from "../../Icons/PenIcon.svelte";
    import AiNotetakerPanelModal from "../../Notetaker/AiNotetakerPanelModal.svelte";
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
        openModal(AiNotetakerPanelModal, {});
    }

    $: tooltip = isSessionRunning()
        ? "Open AI notes (active)"
        : $notetakerCanManageStore
        ? "Open AI notes"
        : "Open AI notes (read-only)";

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
            ? "Capture transcript and meeting summary"
            : "You can read notes but cannot start/stop for this room."}
        state={buttonState}
        dataTestId="aiNotetakerButton"
        media="./static/images/screensharing.mp4"
        desc="Toggle AI notetaker in this meeting room"
    >
        <PenIcon />
    </ActionBarButton>
{/if}
