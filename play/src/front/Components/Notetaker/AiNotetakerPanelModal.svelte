<script lang="ts">
    import { onDestroy } from "svelte";
    import { closeModal } from "svelte-modals";
    import Popup from "../Modal/Popup.svelte";
    import { livekitMeetingRoomSpaceNameStore } from "../../Stores/GameStore";
    import {
        notetakerCanManageStore,
        notetakerControls,
        notetakerLoadingStore,
        notetakerRuntimeStateStore,
        notetakerSessionStore,
        notetakerSessionsStore,
        type NotetakerSession,
    } from "../../Stores/NotetakerStore";

    export let isOpen: boolean;

    type PanelTab = "current" | "history";

    let selectedSessionId: string | undefined;
    let selectedSessionIds = new Set<string>();
    let summaryRefreshPoller: ReturnType<typeof setInterval> | undefined;
    let panelTab: PanelTab = "history";
    let selectionMode = false;
    let wasOpen = false;
    let lastCurrentRoomKey: string | undefined;

    $: currentMeetingSpace = $livekitMeetingRoomSpaceNameStore ?? undefined;

    $: if (!currentMeetingSpace && panelTab === "current") {
        panelTab = "history";
    }

    $: if (isOpen && !wasOpen) {
        wasOpen = true;
        void notetakerControls.refreshCurrentSession(currentMeetingSpace);
        void notetakerControls.refreshSessions(getSessionsSpaceName());
    }

    $: if (!isOpen && wasOpen) {
        wasOpen = false;
    }

    $: if (isOpen && panelTab === "current") {
        const currentRoomKey = currentMeetingSpace ?? "__none__";
        if (lastCurrentRoomKey !== currentRoomKey) {
            lastCurrentRoomKey = currentRoomKey;
            void notetakerControls.refreshCurrentSession(currentMeetingSpace);
            void notetakerControls.refreshSessions(getSessionsSpaceName());
        }
    }

    $: if (panelTab !== "current") {
        lastCurrentRoomKey = undefined;
    }

    $: selectedSession =
        selectedSessionId !== undefined
            ? $notetakerSessionsStore.find((session) => session.id === selectedSessionId)
            : undefined;

    $: displayedSession = selectedSession ?? $notetakerSessionStore ?? $notetakerSessionsStore[0];

    $: if (selectedSessionId && !$notetakerSessionsStore.some((session) => session.id === selectedSessionId)) {
        selectedSessionId = undefined;
    }

    $: if (!selectedSessionId && $notetakerSessionsStore.length > 0) {
        selectedSessionId = $notetakerSessionsStore[0].id;
    }

    $: {
        const availableIds = new Set($notetakerSessionsStore.map((session) => session.id));
        const normalized = new Set(Array.from(selectedSessionIds).filter((sessionId) => availableIds.has(sessionId)));
        if (normalized.size !== selectedSessionIds.size) {
            selectedSessionIds = normalized;
        }
    }

    $: displayedSummary = displayedSession ? getPreferredSummary(displayedSession) : undefined;

    $: {
        const shouldPollSummary =
            isOpen &&
            displayedSession !== undefined &&
            displayedSummary === undefined &&
            ["stopping", "stopped", "failed"].includes(displayedSession.status);

        if (shouldPollSummary) {
            startSummaryRefreshPoller();
        } else {
            stopSummaryRefreshPoller();
        }
    }

    onDestroy(() => {
        stopSummaryRefreshPoller();
    });

    function startSummaryRefreshPoller(): void {
        if (summaryRefreshPoller) {
            return;
        }

        summaryRefreshPoller = setInterval(() => {
            if (!displayedSession) {
                stopSummaryRefreshPoller();
                return;
            }

            void notetakerControls.refreshSessions(getSessionsSpaceName());
            void notetakerControls.refreshCurrentSession(currentMeetingSpace);
        }, 5000);
    }

    function stopSummaryRefreshPoller(): void {
        if (summaryRefreshPoller) {
            clearInterval(summaryRefreshPoller);
            summaryRefreshPoller = undefined;
        }
    }

    function getPreferredSummary(session: NotetakerSession): NotetakerSession["summaries"][number] | undefined {
        const finalSummaries = session.summaries.filter((summary) => summary.final && hasSummaryContent(summary));
        if (finalSummaries.length > 0) {
            return finalSummaries.at(-1);
        }

        const contentSummaries = session.summaries.filter((summary) => hasSummaryContent(summary));
        return contentSummaries.at(-1) ?? session.summaries.at(-1);
    }

    function getSessionsSpaceName(): string | undefined {
        return panelTab === "current" ? currentMeetingSpace : undefined;
    }

    function switchPanelTab(tab: PanelTab): void {
        if (panelTab === tab) {
            return;
        }

        panelTab = tab;
        selectionMode = false;
        selectedSessionId = undefined;
        selectedSessionIds = new Set();
        void notetakerControls.refreshSessions(getSessionsSpaceName());
    }

    function selectSession(session: NotetakerSession): void {
        selectedSessionId = session.id;
    }

    function isRunning(state: string): boolean {
        return state === "starting" || state === "active" || state === "idle-warning" || state === "stopping";
    }

    function onPrimaryActionClick(): void {
        if ($notetakerLoadingStore || !$notetakerCanManageStore) {
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

    function formatSessionTime(session: NotetakerSession): string {
        const started = new Date(session.startedAt).toLocaleString();
        if (!session.stoppedAt) {
            return `Started: ${started}`;
        }

        const stopped = new Date(session.stoppedAt).toLocaleString();
        return `Started: ${started} | Stopped: ${stopped}`;
    }

    function formatSessionTimeCompact(session: NotetakerSession): string {
        const started = new Date(session.startedAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

        if (!session.stoppedAt) {
            return `Started ${started}`;
        }

        const stopped = new Date(session.stoppedAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
        return `${started} -> ${stopped}`;
    }

    function formatDurationFromMs(totalMs: number): string {
        const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, "0")}`;
    }

    function formatSegmentTimestamp(session: NotetakerSession, segment: NotetakerSession["segments"][number]): string {
        const segmentEpoch =
            typeof segment.startedAtMs === "number" && Number.isFinite(segment.startedAtMs)
                ? segment.startedAtMs
                : Date.parse(segment.createdAt);

        const sessionStartEpoch = Date.parse(session.startedAt);
        const absoluteTime = new Date(segmentEpoch).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });

        if (
            Number.isFinite(segmentEpoch) &&
            Number.isFinite(sessionStartEpoch) &&
            segmentEpoch >= sessionStartEpoch &&
            segmentEpoch - sessionStartEpoch <= 48 * 60 * 60 * 1000
        ) {
            const relative = formatDurationFromMs(segmentEpoch - sessionStartEpoch);
            return `+${relative} | ${absoluteTime}`;
        }

        return absoluteTime;
    }

    interface SessionOutputState {
        label: string;
        description: string;
        tone: "ready" | "processing" | "running" | "failed";
    }

    function hasSummaryContent(summary: NotetakerSession["summaries"][number] | undefined): boolean {
        return typeof summary?.summaryMarkdown === "string" && summary.summaryMarkdown.trim().length > 0;
    }

    function getFinalSummary(session: NotetakerSession): NotetakerSession["summaries"][number] | undefined {
        const finalSummaries = session.summaries.filter((summary) => summary.final && hasSummaryContent(summary));
        return finalSummaries.at(-1);
    }

    function isFinalOutputReady(session: NotetakerSession): boolean {
        return getFinalSummary(session) !== undefined;
    }

    function computeSessionOutputState(session: NotetakerSession): SessionOutputState {
        if (isRunning(session.status)) {
            return {
                label: "Recording",
                description: "Meeting is in progress. Final notes are generated after stop.",
                tone: "running",
            };
        }

        if (isFinalOutputReady(session)) {
            const isDegraded = session.status === "failed";
            return {
                label: isDegraded ? "Ready (with warnings)" : "Ready",
                description: isDegraded
                    ? "Final notes are available, but the session reported runtime errors."
                    : "Final transcript and summary are ready.",
                tone: "ready",
            };
        }

        if (session.status === "failed") {
            return {
                label: "Failed",
                description: session.errorMessage ?? "Processing failed before a final version was generated.",
                tone: "failed",
            };
        }

        return {
            label: "Processing",
            description: "Audio was recorded. Transcript and summary are still being finalized.",
            tone: "processing",
        };
    }

    function outputStateClasses(tone: SessionOutputState["tone"]): string {
        if (tone === "ready") {
            return "bg-success/20 text-success border border-success/40";
        }

        if (tone === "failed") {
            return "bg-danger/20 text-danger border border-danger/40";
        }

        if (tone === "running") {
            return "bg-secondary/20 text-secondary border border-secondary/40";
        }

        return "bg-warning/20 text-warning border border-warning/40";
    }

    function getFinalizedAtLabel(session: NotetakerSession): string | undefined {
        const finalSummary = getFinalSummary(session);
        if (!finalSummary) {
            return undefined;
        }

        return new Date(finalSummary.createdAt).toLocaleString();
    }

    function primaryLabel(state: string): string {
        if (state === "idle-warning") {
            return "Keep running";
        }

        return isRunning(state) ? "Stop AI Notes" : "Start AI Notes";
    }

    function exportDisplayedSession(format: "markdown" | "text"): void {
        if (!displayedSession) {
            return;
        }

        void notetakerControls.exportSession(displayedSession.id, format);
    }

    function downloadDisplayedRecording(): void {
        if (!displayedSession || isRunning(displayedSession.status)) {
            return;
        }

        void notetakerControls.downloadRecording(displayedSession.id);
    }

    function toggleSelectionMode(): void {
        if (!selectionMode) {
            selectionMode = true;
            return;
        }

        selectionMode = false;
        selectedSessionIds = new Set();
    }

    function isSessionSelected(sessionId: string): boolean {
        return selectedSessionIds.has(sessionId);
    }

    function toggleSessionSelection(sessionId: string, checked: boolean): void {
        const next = new Set(selectedSessionIds);
        if (checked) {
            next.add(sessionId);
        } else {
            next.delete(sessionId);
        }
        selectedSessionIds = next;
    }

    function onSessionSelectionChange(sessionId: string, event: Event): void {
        const target = event.currentTarget;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        toggleSessionSelection(sessionId, target.checked);
    }

    function selectAllSessions(): void {
        selectedSessionIds = new Set($notetakerSessionsStore.map((session) => session.id));
    }

    function clearSelection(): void {
        selectedSessionIds = new Set();
    }

    async function deleteSelectedSessions(): Promise<void> {
        if (selectedSessionIds.size === 0 || !$notetakerCanManageStore) {
            return;
        }

        const targetIds = Array.from(selectedSessionIds);
        const shouldDelete = window.confirm(`Delete ${targetIds.length} AI notes session(s) permanently?`);
        if (!shouldDelete) {
            return;
        }

        await notetakerControls.deleteSessions(targetIds);
        selectedSessionIds = new Set();
        selectionMode = false;

        if (displayedSession && targetIds.includes(displayedSession.id)) {
            selectedSessionId = undefined;
        }
    }

    async function deleteAllSessions(): Promise<void> {
        if ($notetakerSessionsStore.length === 0 || !$notetakerCanManageStore) {
            return;
        }

        const targetIds = $notetakerSessionsStore.map((session) => session.id);
        const shouldDelete = window.confirm(`Delete all ${targetIds.length} AI notes session(s) in this room?`);
        if (!shouldDelete) {
            return;
        }

        await notetakerControls.deleteSessions(targetIds);
        selectedSessionId = undefined;
        selectedSessionIds = new Set();
        selectionMode = false;
    }

    function deleteDisplayedSession(): void {
        if (!displayedSession || !$notetakerCanManageStore) {
            return;
        }

        const shouldDelete = window.confirm("Delete this AI notes session permanently?");
        if (!shouldDelete) {
            return;
        }

        void notetakerControls.deleteSession(displayedSession.id);
        selectedSessionIds.delete(displayedSession.id);
        selectedSessionIds = new Set(selectedSessionIds);
        selectedSessionId = undefined;
    }

    function refreshPanel(): void {
        void notetakerControls.refreshCurrentSession(currentMeetingSpace);
        void notetakerControls.refreshSessions(getSessionsSpaceName());
    }
</script>

<Popup {isOpen}>
    <h1 slot="title" class="text-2xl font-bold">AI Notes</h1>
    <div slot="content" class="w-full max-h-[72vh] overflow-y-auto px-1">
        <div class="rounded-xl bg-dark-500/50 p-4 mb-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div class="text-sm opacity-80">Current state</div>
                    <div class="text-lg font-semibold uppercase tracking-wide">{$notetakerRuntimeStateStore}</div>
                    {#if $notetakerSessionStore}
                        <div class="text-xs opacity-75 mt-2">{formatSessionTime($notetakerSessionStore)}</div>
                        <div
                            class="inline-flex items-center rounded-full px-2 py-1 text-[11px] mt-2 {outputStateClasses(computeSessionOutputState($notetakerSessionStore).tone)}"
                        >
                            {computeSessionOutputState($notetakerSessionStore).label}
                        </div>
                    {/if}
                </div>
                <button class="btn text-sm" on:click={refreshPanel}>Refresh</button>
            </div>
            {#if !$notetakerCanManageStore}
                <div class="text-xs text-warning mt-2">You are in read-only mode for AI notes in this meeting.</div>
            {/if}
        </div>

        <div class="space-y-4">
            <div class="rounded-xl bg-dark-500/50 p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div class="font-semibold">My notes ({$notetakerSessionsStore.length})</div>
                        <div class="text-xs opacity-75 mt-1">Browse room notes or your full history.</div>
                    </div>
                    <div class="flex gap-2">
                        <button
                            class="btn text-xs {panelTab === 'current' ? 'bg-secondary' : ''}"
                            disabled={!currentMeetingSpace}
                            on:click={() => switchPanelTab('current')}
                        >
                            Current room
                        </button>
                        <button class="btn text-xs {panelTab === 'history' ? 'bg-secondary' : ''}" on:click={() => switchPanelTab('history')}>
                            All discussions
                        </button>
                    </div>
                </div>

                {#if panelTab === 'current' && !currentMeetingSpace}
                    <div class="text-xs text-warning mt-2">Join a meeting room to view room-specific sessions.</div>
                {/if}

                {#if $notetakerCanManageStore}
                    <div class="flex flex-wrap items-center gap-2 mt-3">
                        <button
                            class="btn text-xs"
                            on:click={toggleSelectionMode}
                            disabled={$notetakerLoadingStore || $notetakerSessionsStore.length === 0}
                        >
                            {selectionMode ? 'Exit selection' : 'Selection mode'}
                        </button>
                        <button
                            class="btn text-xs ml-auto"
                            on:click={deleteAllSessions}
                            disabled={$notetakerLoadingStore || $notetakerSessionsStore.length === 0}
                        >
                            Delete all
                        </button>
                    </div>

                    {#if selectionMode}
                        <div class="flex flex-wrap gap-2 mt-3">
                            <button class="btn text-xs" on:click={selectAllSessions} disabled={$notetakerSessionsStore.length === 0}
                                >Select all</button
                            >
                            <button class="btn text-xs" on:click={clearSelection} disabled={selectedSessionIds.size === 0}>Clear</button>
                            <button
                                class="btn text-xs bg-danger/80 hover:bg-danger"
                                on:click={deleteSelectedSessions}
                                disabled={$notetakerLoadingStore || selectedSessionIds.size === 0}
                            >
                                Delete selected ({selectedSessionIds.size})
                            </button>
                        </div>
                    {/if}
                {/if}

                {#if $notetakerSessionsStore.length === 0}
                    <div class="text-sm opacity-75 mt-3">
                        {panelTab === "current" ? "No sessions found for this room yet." : "No discussions found yet."}
                    </div>
                {:else}
                    <div class="space-y-2 max-h-[34vh] overflow-y-auto pr-1 mt-3">
                        {#each $notetakerSessionsStore as session (session.id)}
                            <button
                                class="w-full text-left rounded-lg p-3 border border-white/10 hover:bg-dark-600/60 transition-colors {displayedSession?.id ===
                                session.id
                                    ? 'bg-dark-600/70'
                                    : 'bg-dark-700/30'}"
                                on:click={() => selectSession(session)}
                            >
                                <div class="flex items-start gap-2">
                                    {#if $notetakerCanManageStore && selectionMode}
                                        <input
                                            type="checkbox"
                                            class="mt-1"
                                            checked={isSessionSelected(session.id)}
                                            on:click|stopPropagation
                                            on:change={(event) => onSessionSelectionChange(session.id, event)}
                                        />
                                    {/if}
                                    <div class="min-w-0 flex-1">
                                        <div class="flex flex-wrap items-center justify-between gap-2">
                                            <div class="font-semibold text-sm truncate">{session.spaceName}</div>
                                            <div
                                                class="inline-flex items-center rounded-full px-2 py-1 text-[10px] {outputStateClasses(computeSessionOutputState(session).tone)}"
                                            >
                                                {computeSessionOutputState(session).label}
                                            </div>
                                        </div>
                                        <div class="text-xs opacity-75 mt-1">{formatSessionTimeCompact(session)}</div>
                                    </div>
                                </div>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>

            {#if displayedSession}
                <div class="rounded-xl bg-dark-500/50 p-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div class="text-xs opacity-70 uppercase tracking-wide">Selected session</div>
                            <div class="font-semibold text-base">{displayedSession.spaceName}</div>
                            <div class="text-xs opacity-75 mt-1">{formatSessionTime(displayedSession)}</div>
                        </div>
                        <div
                            class="inline-flex items-center rounded-full px-2 py-1 text-[11px] {outputStateClasses(computeSessionOutputState(displayedSession).tone)}"
                        >
                            {computeSessionOutputState(displayedSession).label}
                        </div>
                    </div>
                    <div class="text-xs opacity-80 mt-3">{computeSessionOutputState(displayedSession).description}</div>
                    {#if isFinalOutputReady(displayedSession)}
                        <div class="text-xs opacity-70 mt-1">Finalized at: {getFinalizedAtLabel(displayedSession)}</div>
                    {:else if !isRunning(displayedSession.status)}
                        <div class="text-xs opacity-70 mt-1">This panel refreshes automatically while processing.</div>
                    {/if}
                </div>

                <details open class="rounded-xl bg-dark-500/50 p-4">
                    <summary class="font-semibold cursor-pointer">Summary</summary>
                    <div class="mt-3">
                        {#if displayedSummary}
                            {#if !isFinalOutputReady(displayedSession)}
                                <div class="text-xs opacity-75 mb-2">Draft summary. Final version is still processing.</div>
                            {/if}
                            <div class="text-sm whitespace-pre-wrap">{displayedSummary.summaryMarkdown}</div>
                            {#if displayedSummary.decisions.length}
                                <div class="font-semibold mt-4 mb-1">Decisions</div>
                                <ul class="list-disc list-inside text-sm space-y-1">
                                    {#each displayedSummary.decisions as decision}
                                        <li>{decision}</li>
                                    {/each}
                                </ul>
                            {/if}
                            {#if displayedSummary.actionItems.length}
                                <div class="font-semibold mt-4 mb-1">Action items</div>
                                <ul class="list-disc list-inside text-sm space-y-1">
                                    {#each displayedSummary.actionItems as actionItem}
                                        <li>{actionItem}</li>
                                    {/each}
                                </ul>
                            {/if}
                        {:else if isRunning(displayedSession.status)}
                            <div class="text-sm opacity-80">Summary is generated after the meeting ends.</div>
                        {:else}
                            <div class="text-sm opacity-80">Summary is being generated. This panel refreshes automatically.</div>
                        {/if}
                    </div>
                </details>

                <details class="rounded-xl bg-dark-500/50 p-4">
                    <summary class="font-semibold cursor-pointer">Transcript ({displayedSession.segments.length})</summary>
                    <div class="mt-3">
                        {#if isRunning(displayedSession.status)}
                            <div class="text-sm opacity-80">Transcript appears after the meeting is stopped.</div>
                        {:else if displayedSession.segments.length === 0 && !isFinalOutputReady(displayedSession)}
                            <div class="text-sm opacity-80">Transcript is still being finalized. This panel refreshes automatically.</div>
                        {:else if displayedSession.segments.length === 0}
                            <div class="text-sm opacity-80">No transcript segments yet.</div>
                        {:else}
                            {#if !isFinalOutputReady(displayedSession)}
                                <div class="text-xs opacity-75 mb-2">Partial transcript while processing. Final version will appear when status is Ready.</div>
                            {/if}
                            <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
                                {#each displayedSession.segments as segment (segment.id)}
                                    <div class="rounded-lg bg-dark-600/60 p-2 text-sm">
                                        <div class="flex flex-wrap items-center justify-between gap-2">
                                            <div class="font-semibold">{segment.speakerLabel ?? "Unknown speaker"}</div>
                                            <div class="text-xs opacity-70">{formatSegmentTimestamp(displayedSession, segment)}</div>
                                        </div>
                                        <div class="opacity-90 mt-1">{segment.text}</div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </details>

                <div class="rounded-xl bg-dark-500/50 p-4">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div class="font-semibold">Export</div>
                        {#if $notetakerCanManageStore}
                            <button
                                class="btn text-xs bg-danger/80 hover:bg-danger disabled:opacity-50"
                                disabled={!$notetakerCanManageStore}
                                on:click={deleteDisplayedSession}
                            >
                                Delete session
                            </button>
                        {/if}
                    </div>
                    {#if !isFinalOutputReady(displayedSession)}
                        <div class="text-xs opacity-75 mb-2">Current export is partial until output status becomes Ready.</div>
                    {/if}
                    {#if isRunning(displayedSession.status)}
                        <div class="text-xs opacity-75 mb-2">Recording download is available once the meeting is stopped.</div>
                    {/if}
                    <div class="flex flex-wrap gap-2">
                        <button class="btn text-sm" on:click={() => exportDisplayedSession("markdown")}>Download Markdown</button>
                        <button class="btn text-sm" on:click={() => exportDisplayedSession("text")}>Download Text</button>
                        <button class="btn text-sm" disabled={isRunning(displayedSession.status)} on:click={downloadDisplayedRecording}
                            >Download Recording (WAV)</button
                        >
                    </div>
                </div>
            {:else}
                <div class="rounded-xl bg-dark-500/50 p-4 text-sm opacity-80">No session selected.</div>
            {/if}
        </div>
    </div>
    <svelte:fragment slot="action">
        <button class="btn flex-1 justify-center" on:click={() => closeModal()}>Close</button>
        <button
            class="btn btn-secondary disabled:text-gray-400 disabled:bg-gray-500 bg-secondary flex-1 justify-center"
            disabled={$notetakerLoadingStore || !$notetakerCanManageStore}
            on:click={onPrimaryActionClick}
        >
            {primaryLabel($notetakerRuntimeStateStore)}
        </button>
    </svelte:fragment>
</Popup>
