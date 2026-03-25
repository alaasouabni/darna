<script lang="ts">
    import { closeModal, openModal } from "svelte-modals";
    import Popup from "../Modal/Popup.svelte";
    import AiNotetakerPanelModal from "./AiNotetakerPanelModal.svelte";
    import { livekitMeetingRoomSpaceNameStore } from "../../Stores/GameStore";
    import {
        notetakerCanManageStore,
        notetakerControls,
        notetakerLoadingStore,
        notetakerRuntimeStateStore,
        notetakerSessionStore,
    } from "../../Stores/NotetakerStore";

    export let isOpen: boolean;

    let wasOpen = false;

    $: currentMeetingSpace = $livekitMeetingRoomSpaceNameStore ?? undefined;

    $: if (isOpen && !wasOpen) {
        wasOpen = true;
        void notetakerControls.refreshCurrentSession(currentMeetingSpace);
    }

    $: if (!isOpen && wasOpen) {
        wasOpen = false;
    }

    function isRunning(state: string): boolean {
        return state === "starting" || state === "active" || state === "idle-warning" || state === "stopping";
    }

    function primaryLabel(state: string): string {
        if (state === "idle-warning") {
            return "Keep running";
        }

        return isRunning(state) ? "Stop AI Notes" : "Start AI Notes";
    }

    function stateDescription(state: string): string {
        if (state === "idle-warning") {
            return "No speech detected recently. Keep running or stop the current AI notes session.";
        }

        if (state === "starting") {
            return "AI notetaker is starting for this meeting room.";
        }

        if (state === "active") {
            return "AI notetaker is recording this meeting.";
        }

        if (state === "stopping") {
            return "Session is stopping and final output is being prepared.";
        }

        if (state === "failed") {
            return "Last session failed. You can open the library to inspect details.";
        }

        return "Start AI notes for this meeting room.";
    }

    function quickStateClasses(state: string): string {
        if (state === "active" || state === "starting" || state === "stopping" || state === "idle-warning") {
            return "bg-secondary/20 text-secondary border border-secondary/40";
        }

        if (state === "failed") {
            return "bg-danger/20 text-danger border border-danger/40";
        }

        return "bg-white/10 text-white border border-white/20";
    }

    function formatCurrentSessionTime(): string | undefined {
        if (!$notetakerSessionStore) {
            return undefined;
        }

        const started = new Date($notetakerSessionStore.startedAt).toLocaleString();
        if (!$notetakerSessionStore.stoppedAt) {
            return `Started: ${started}`;
        }

        const stopped = new Date($notetakerSessionStore.stoppedAt).toLocaleString();
        return `Started: ${started} | Stopped: ${stopped}`;
    }

    function onPrimaryActionClick(): void {
        if ($notetakerLoadingStore || !$notetakerCanManageStore || !currentMeetingSpace) {
            return;
        }

        if ($notetakerRuntimeStateStore === "idle-warning") {
            void notetakerControls.keepRunning();
            return;
        }

        if (isRunning($notetakerRuntimeStateStore)) {
            void notetakerControls.stopSession();
            return;
        }

        void notetakerControls.startSession(currentMeetingSpace);
    }

    function openLibrary(): void {
        closeModal();
        openModal(AiNotetakerPanelModal, {});
    }

    function refreshQuickState(): void {
        void notetakerControls.refreshCurrentSession(currentMeetingSpace);
    }
</script>

<Popup {isOpen}>
    <h1 slot="title" class="text-2xl font-bold">AI Notes</h1>
    <div slot="content" class="w-full px-1">
        <div class="rounded-xl bg-dark-500/50 p-4">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <div class="text-xs opacity-80 uppercase tracking-wide">Meeting controls</div>
                    <div
                        class="inline-flex items-center rounded-full px-2 py-1 text-[11px] mt-2 uppercase tracking-wide {quickStateClasses($notetakerRuntimeStateStore)}"
                    >
                        {$notetakerRuntimeStateStore}
                    </div>
                </div>
                <button class="btn text-xs" on:click={refreshQuickState}>Refresh</button>
            </div>

            {#if currentMeetingSpace}
                <div class="text-xs opacity-70 mt-3">Room: {currentMeetingSpace}</div>
            {/if}

            <div class="text-sm opacity-85 mt-3">{stateDescription($notetakerRuntimeStateStore)}</div>
            {#if formatCurrentSessionTime()}
                <div class="text-xs opacity-70 mt-2">{formatCurrentSessionTime()}</div>
            {/if}
            {#if !currentMeetingSpace}
                <div class="text-xs text-warning mt-3">Join a meeting room to start or stop AI notes.</div>
            {/if}
            {#if !$notetakerCanManageStore}
                <div class="text-xs text-warning mt-3">You can view notes but cannot start or stop sessions.</div>
            {/if}
        </div>

        <div class="rounded-xl bg-dark-500/50 p-4 mt-3">
            <div class="font-semibold">Need full notes?</div>
            <div class="text-sm opacity-80 mt-1">
                Use the AI Notes Library to browse all transcripts, summaries, and downloads from any room.
            </div>
            <button class="btn text-sm mt-3" on:click={openLibrary}>Open AI Notes Library</button>
        </div>
    </div>
    <svelte:fragment slot="action">
        <button class="btn flex-1 justify-center" on:click={() => closeModal()}>Close</button>
        <button
            class="btn btn-secondary disabled:text-gray-400 disabled:bg-gray-500 bg-secondary flex-1 justify-center"
            disabled={$notetakerLoadingStore || !$notetakerCanManageStore || !currentMeetingSpace}
            on:click={onPrimaryActionClick}
        >
            {primaryLabel($notetakerRuntimeStateStore)}
        </button>
    </svelte:fragment>
</Popup>
