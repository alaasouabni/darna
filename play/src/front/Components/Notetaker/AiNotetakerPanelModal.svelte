<script lang="ts">
    import { onDestroy } from "svelte";
    import { closeModal, openModal } from "svelte-modals";
    import Popup from "../Modal/Popup.svelte";
    import AiNotetakerShareSessionModal from "./AiNotetakerShareSessionModal.svelte";
    import AiNotetakerTranscriptTimeline from "./AiNotetakerTranscriptTimeline.svelte";
    import { localUserStore } from "../../Connection/LocalUserStore";
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
    export let focusSessionId: string | undefined = undefined;

    let selectedSessionId: string | undefined;
    let selectedSessionIds = new Set<string>();
    let summaryRefreshPoller: ReturnType<typeof setInterval> | undefined;
    let selectionMode = false;
    let wasOpen = false;
    type SessionFilter = "all" | "owned" | "shared";
    let sessionFilter: SessionFilter = "all";
    const currentUserId = localUserStore.getLocalUser()?.uuid ?? undefined;

    $: currentMeetingSpace = $livekitMeetingRoomSpaceNameStore ?? undefined;

    $: if (isOpen && !wasOpen) {
        wasOpen = true;
        void notetakerControls.refreshCurrentSession(currentMeetingSpace);
        void notetakerControls.refreshSessions(getSessionsSpaceName());
    }

    $: if (!isOpen && wasOpen) {
        wasOpen = false;
    }

    $: allSessions = [...$notetakerSessionsStore].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    $: ownedSessions = allSessions.filter((session) => isOwnedByCurrentUser(session));
    $: sharedWithMeSessions = allSessions.filter((session) => !isOwnedByCurrentUser(session));
    $: hasOwnedSessions = ownedSessions.length > 0;
    $: orderedSessions =
        sessionFilter === "owned" ? ownedSessions : sessionFilter === "shared" ? sharedWithMeSessions : allSessions;
    $: visibleOwnedSessions = orderedSessions.filter((session) => isOwnedByCurrentUser(session));

    $: selectedSession = selectedSessionId !== undefined ? orderedSessions.find((session) => session.id === selectedSessionId) : undefined;

    $: displayedSession = selectedSession ?? $notetakerSessionStore ?? orderedSessions[0];

    $: if (selectedSessionId && !orderedSessions.some((session) => session.id === selectedSessionId)) {
        selectedSessionId = undefined;
    }

    $: if (!selectedSessionId && orderedSessions.length > 0) {
        selectedSessionId = orderedSessions[0].id;
    }

    $: if (focusSessionId && orderedSessions.some((session) => session.id === focusSessionId)) {
        selectedSessionId = focusSessionId;
        focusSessionId = undefined;
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
        return undefined;
    }

    function selectSession(session: NotetakerSession): void {
        selectedSessionId = session.id;
    }

    function isRunning(state: string): boolean {
        return state === "starting" || state === "active" || state === "idle-warning" || state === "stopping";
    }

    function getSessionOwnerUserId(session: NotetakerSession): string {
        return session.ownerUserId ?? session.startedByUserId;
    }

    function isOwnedByCurrentUser(session: NotetakerSession): boolean {
        if (!currentUserId) {
            return false;
        }

        return getSessionOwnerUserId(session) === currentUserId;
    }

    function getSessionOwnerLabel(session: NotetakerSession): string {
        return isOwnedByCurrentUser(session) ? "You" : getSessionOwnerUserId(session);
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

    function getSessionTitle(session: NotetakerSession): string {
        const summary = getPreferredSummary(session)?.summaryMarkdown?.trim();
        if (summary && summary.toLowerCase() !== "no transcript content was captured for this session.") {
            const headline = summary.replace(/\s+/g, " ").slice(0, 54).trim();
            if (headline.length > 0) {
                const started = new Date(session.startedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                });

                return `${headline}${summary.length > headline.length ? "..." : ""} (${started})`;
            }
        }

        const started = new Date(session.startedAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

        return `Discussion (${started})`;
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

    function sharingStatusLabel(session: NotetakerSession): string {
        const sharedCount = session.sharedWithUserIds?.length ?? 0;
        if (sharedCount === 0) {
            if (isOwnedByCurrentUser(session) && !isRunning(session.status)) {
                return "Not shared yet";
            }
            return "Private";
        }

        return sharedCount === 1 ? "Shared with 1" : `Shared with ${sharedCount}`;
    }

    function sharingStatusClasses(session: NotetakerSession): string {
        if ((session.sharedWithUserIds?.length ?? 0) === 0 && isOwnedByCurrentUser(session) && !isRunning(session.status)) {
            return "bg-warning/20 text-warning border border-warning/40";
        }

        return (session.sharedWithUserIds?.length ?? 0) > 0
            ? "bg-secondary/20 text-secondary border border-secondary/40"
            : "bg-white/10 text-white border border-white/20";
    }

    function ownershipLabel(session: NotetakerSession): string {
        return isOwnedByCurrentUser(session) ? "Initiated by you" : "Shared with you";
    }

    function ownershipClasses(session: NotetakerSession): string {
        return isOwnedByCurrentUser(session)
            ? "bg-success/20 text-success border border-success/40"
            : "bg-secondary/20 text-secondary border border-secondary/40";
    }

    function getFinalizedAtLabel(session: NotetakerSession): string | undefined {
        const finalSummary = getFinalSummary(session);
        if (!finalSummary) {
            return undefined;
        }

        return new Date(finalSummary.createdAt).toLocaleString();
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
        selectedSessionIds = new Set(visibleOwnedSessions.map((session) => session.id));
    }

    function clearSelection(): void {
        selectedSessionIds = new Set();
    }

    async function deleteSelectedSessions(): Promise<void> {
        if (selectedSessionIds.size === 0 || !$notetakerCanManageStore || !hasOwnedSessions) {
            return;
        }

        const ownedSessionIds = new Set(ownedSessions.map((session) => session.id));
        const targetIds = Array.from(selectedSessionIds).filter((sessionId) => ownedSessionIds.has(sessionId));
        if (targetIds.length === 0) {
            return;
        }
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
        if (ownedSessions.length === 0 || !$notetakerCanManageStore) {
            return;
        }

        const targetIds = ownedSessions.map((session) => session.id);
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
        if (!displayedSession || !$notetakerCanManageStore || !isOwnedByCurrentUser(displayedSession)) {
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

    async function removeDisplayedSessionFromMyLibrary(): Promise<void> {
        if (!displayedSession || isOwnedByCurrentUser(displayedSession)) {
            return;
        }

        const shouldRemove = window.confirm("Remove this shared discussion from your library?");
        if (!shouldRemove) {
            return;
        }

        const removed = await notetakerControls.removeSessionFromMyLibrary(displayedSession.id);
        if (!removed) {
            return;
        }

        selectedSessionIds.delete(displayedSession.id);
        selectedSessionIds = new Set(selectedSessionIds);
        selectedSessionId = undefined;
    }

    function openShareDialog(session: NotetakerSession): void {
        openModal(AiNotetakerShareSessionModal, {
            session,
            showOwnerStopMessage: false,
        });
    }

    function refreshPanel(): void {
        void notetakerControls.refreshCurrentSession(currentMeetingSpace);
        void notetakerControls.refreshSessions(getSessionsSpaceName());
    }

</script>

<Popup {isOpen} maxWidthClass="sm:max-w-[1200px]">
    <h1 slot="title" class="text-2xl font-bold">AI Notes Library</h1>
    <div slot="content" class="w-full px-1">
        <div class="rounded-xl bg-dark-500/50 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-xs opacity-80 uppercase tracking-wide">Live status</div>
                    <div class="flex flex-wrap items-center gap-2 mt-1">
                        <div class="text-base font-semibold uppercase tracking-wide">{$notetakerRuntimeStateStore}</div>
                        {#if $notetakerSessionStore}
                            <div
                                class="inline-flex items-center rounded-full px-2 py-1 text-[11px] {outputStateClasses(computeSessionOutputState($notetakerSessionStore).tone)}"
                            >
                                {computeSessionOutputState($notetakerSessionStore).label}
                            </div>
                        {/if}
                    </div>
                    <div class="text-xs opacity-70 mt-2">Showing: All discussions</div>
                    {#if currentMeetingSpace}
                        <div class="text-xs opacity-70 mt-1">Current room: {currentMeetingSpace}</div>
                    {/if}
                    {#if $notetakerSessionStore}
                        <div class="text-xs opacity-75 mt-1">{formatSessionTime($notetakerSessionStore)}</div>
                    {/if}
                </div>
                <button class="btn text-sm" on:click={refreshPanel}>Refresh</button>
            </div>
            {#if !$notetakerCanManageStore}
                <div class="text-xs text-warning mt-3">You are in read-only mode for AI notes in this meeting.</div>
            {/if}
        </div>

        <div class="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] mt-4 lg:h-[52vh] lg:min-h-[360px]">
            <div class="rounded-xl bg-dark-500/50 p-4 min-h-0 flex flex-col">
                <div class="shrink-0">
                    <div class="font-semibold">
                        Discussions ({orderedSessions.length})
                        {#if sessionFilter !== "all"}
                            <span class="opacity-70">/ {$notetakerSessionsStore.length} total</span>
                        {/if}
                    </div>
                    <div class="text-xs opacity-75 mt-1">All sessions you initiated or that were shared with you.</div>
                    <div class="mt-3">
                        <label class="text-[11px] opacity-70 uppercase tracking-wide" for="ai-notes-filter"
                            >View</label
                        >
                        <select
                            id="ai-notes-filter"
                            class="w-full mt-1 p-2 rounded-lg border border-white/20 text-white ai-notes-filter-select"
                            bind:value={sessionFilter}
                        >
                            <option value="all" style="color: rgb(15 23 42);">All discussions</option>
                            <option value="owned" style="color: rgb(15 23 42);">Initiated by you</option>
                            <option value="shared" style="color: rgb(15 23 42);">Shared with you</option>
                        </select>
                    </div>
                </div>

                {#if $notetakerCanManageStore && hasOwnedSessions}
                    <div class="flex flex-wrap items-center gap-2 mt-3">
                        <button
                            class="btn text-xs"
                            on:click={toggleSelectionMode}
                            disabled={$notetakerLoadingStore || visibleOwnedSessions.length === 0}
                        >
                            {selectionMode ? 'Exit selection' : 'Selection mode'}
                        </button>
                        <button
                            class="btn text-xs ml-auto"
                            on:click={deleteAllSessions}
                            disabled={$notetakerLoadingStore || ownedSessions.length === 0}
                        >
                            Delete all
                        </button>
                    </div>

                    {#if selectionMode}
                        <div class="flex flex-wrap gap-2 mt-2 rounded-lg bg-dark-600/50 p-2">
                            <button class="btn text-xs" on:click={selectAllSessions} disabled={visibleOwnedSessions.length === 0}
                                >Select all</button
                            >
                            <button class="btn text-xs" on:click={clearSelection} disabled={selectedSessionIds.size === 0}>Clear</button>
                            <button
                                class="btn text-xs bg-danger/80 hover:bg-danger ml-auto"
                                on:click={deleteSelectedSessions}
                                disabled={$notetakerLoadingStore || selectedSessionIds.size === 0}
                            >
                                Delete selected ({selectedSessionIds.size})
                            </button>
                        </div>
                    {/if}
                {/if}

                {#if orderedSessions.length === 0}
                    <div class="text-sm opacity-75 mt-3">No discussions found for this filter yet.</div>
                {:else}
                    <div class="space-y-3 overflow-y-auto pr-1 mt-3 flex-1 min-h-0">
                        {#each orderedSessions as session (session.id)}
                            <button
                                class="w-full text-left rounded-lg p-3 border border-white/10 hover:bg-dark-600/60 transition-colors {displayedSession?.id ===
                                session.id
                                    ? 'bg-dark-600/70'
                                    : 'bg-dark-700/30'}"
                                on:click={() => selectSession(session)}
                            >
                                <div class="flex items-start gap-2">
                                    {#if $notetakerCanManageStore && selectionMode && isOwnedByCurrentUser(session)}
                                        <input
                                            type="checkbox"
                                            class="mt-1"
                                            checked={isSessionSelected(session.id)}
                                            on:click|stopPropagation
                                            on:change={(event) => onSessionSelectionChange(session.id, event)}
                                        />
                                    {/if}
                                    <div class="min-w-0 flex-1">
                                        <div class="font-semibold text-sm truncate">{getSessionTitle(session)}</div>
                                        <div class="text-[11px] opacity-70 mt-1 truncate">{session.spaceName}</div>
                                        <div class="flex flex-wrap items-center gap-2 mt-2">
                                            <div
                                                class="inline-flex items-center rounded-full px-2 py-1 text-[10px] {outputStateClasses(computeSessionOutputState(session).tone)}"
                                            >
                                                {computeSessionOutputState(session).label}
                                            </div>
                                            <div
                                                class="inline-flex items-center rounded-full px-2 py-1 text-[10px] {ownershipClasses(session)}"
                                            >
                                                {ownershipLabel(session)}
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

            <div class="rounded-xl bg-dark-500/50 p-4 min-h-0 min-w-0 flex flex-col">
                {#if displayedSession}
                    <div class="shrink-0">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div class="text-xs opacity-70 uppercase tracking-wide">Selected session</div>
                                <div class="font-semibold text-base">{getSessionTitle(displayedSession)}</div>
                                <div class="text-xs opacity-75 mt-1">{formatSessionTime(displayedSession)}</div>
                                <div class="text-xs opacity-75 mt-1">Room: {displayedSession.spaceName}</div>
                                <div class="text-xs opacity-75 mt-1">Started by: {getSessionOwnerLabel(displayedSession)}</div>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <div
                                    class="inline-flex items-center rounded-full px-2 py-1 text-[11px] {outputStateClasses(computeSessionOutputState(displayedSession).tone)}"
                                >
                                    {computeSessionOutputState(displayedSession).label}
                                </div>
                                <div
                                    class="inline-flex items-center rounded-full px-2 py-1 text-[11px] {ownershipClasses(displayedSession)}"
                                >
                                    {ownershipLabel(displayedSession)}
                                </div>
                                <div
                                    class="inline-flex items-center rounded-full px-2 py-1 text-[11px] {sharingStatusClasses(displayedSession)}"
                                >
                                    {sharingStatusLabel(displayedSession)}
                                </div>
                            </div>
                        </div>
                        <div class="text-xs opacity-80 mt-3">{computeSessionOutputState(displayedSession).description}</div>
                        {#if isFinalOutputReady(displayedSession)}
                            <div class="text-xs opacity-70 mt-1">Finalized at: {getFinalizedAtLabel(displayedSession)}</div>
                        {:else if !isRunning(displayedSession.status)}
                            <div class="text-xs opacity-70 mt-1">This panel refreshes automatically while processing.</div>
                        {/if}
                        {#if isOwnedByCurrentUser(displayedSession) && (displayedSession.sharedWithUserIds?.length ?? 0) === 0 && !isRunning(displayedSession.status)}
                            <div class="text-xs text-warning mt-1">
                                This session is still private. Share it when you are ready.
                            </div>
                        {/if}
                    </div>

                    <div class="space-y-3 mt-4 pr-1 flex-1 min-h-0 overflow-y-auto">
                    <details open class="rounded-lg bg-dark-600/35 border border-white/10 p-3">
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

                    <details class="rounded-lg bg-dark-600/35 border border-white/10 p-3">
                        <summary class="font-semibold cursor-pointer">Transcript ({displayedSession.segments.length})</summary>
                        <div class="mt-3">
                            {#if isRunning(displayedSession.status)}
                                <div class="text-sm opacity-80">Transcript appears after the meeting is stopped.</div>
                            {:else if displayedSession.segments.length === 0 && !isFinalOutputReady(displayedSession)}
                                <div class="text-sm opacity-80">Transcript is still being finalized. This panel refreshes automatically.</div>
                            {:else if displayedSession.segments.length === 0}
                                <div class="text-sm opacity-80">No transcript segments yet.</div>
                            {:else}
                                <AiNotetakerTranscriptTimeline
                                    session={displayedSession}
                                    isFinalOutputReady={isFinalOutputReady(displayedSession)}
                                    getTimestampLabel={(segment) => formatSegmentTimestamp(displayedSession, segment)}
                                    showHeader={false}
                                />
                            {/if}
                        </div>
                    </details>

                    <div class="rounded-lg bg-dark-600/35 border border-white/10 p-3">
                        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <div class="font-semibold">Exports and actions</div>
                            <div class="flex flex-wrap items-center gap-2">
                                {#if isOwnedByCurrentUser(displayedSession)}
                                    <button class="btn text-xs" on:click={() => openShareDialog(displayedSession)}>
                                        {(displayedSession.sharedWithUserIds?.length ?? 0) > 0 ? "Edit sharing" : "Share session"}
                                    </button>
                                    {#if $notetakerCanManageStore}
                                        <button
                                            class="btn text-xs bg-danger/80 hover:bg-danger disabled:opacity-50"
                                            disabled={!$notetakerCanManageStore}
                                            on:click={deleteDisplayedSession}
                                        >
                                            Delete session
                                        </button>
                                    {/if}
                                {:else}
                                    <button class="btn text-xs" on:click={removeDisplayedSessionFromMyLibrary}>
                                        Remove from my library
                                    </button>
                                {/if}
                            </div>
                        </div>
                        <div class="text-xs opacity-75 mb-2">
                            Visibility: {sharingStatusLabel(displayedSession)}. {#if isOwnedByCurrentUser(displayedSession)}You can manage recipients any time.{:else}Only the starter can update sharing. You can remove this discussion from your own library.{/if}
                        </div>
                        {#if !isFinalOutputReady(displayedSession)}
                            <div class="text-xs opacity-75 mb-2">Current export is partial until output status becomes Ready.</div>
                        {/if}
                        {#if isRunning(displayedSession.status)}
                            <div class="text-xs opacity-75 mb-2">Recording download is available once the meeting is stopped.</div>
                        {/if}
                        <div class="grid gap-2 md:grid-cols-2">
                            <button class="btn text-sm" on:click={() => exportDisplayedSession("markdown")}>Download Markdown</button>
                            <button class="btn text-sm" on:click={() => exportDisplayedSession("text")}>Download Text</button>
                            <button
                                class="btn text-sm md:col-span-2"
                                disabled={isRunning(displayedSession.status)}
                                on:click={downloadDisplayedRecording}
                                >Download Recording (WAV)</button
                            >
                        </div>
                    </div>
                    </div>
                {:else}
                    <div class="text-sm opacity-80">
                        Select a session from the left panel to view summary, transcript, and exports.
                    </div>
                {/if}
            </div>
        </div>
    </div>
    <svelte:fragment slot="action">
        <button class="btn flex-1 justify-center" on:click={() => closeModal()}>Close</button>
        <button class="btn flex-1 justify-center" on:click={refreshPanel}>Refresh</button>
    </svelte:fragment>
</Popup>

<style>
    .ai-notes-filter-select {
        background-color: rgba(15, 23, 42, 0.72);
        color: rgb(241 245 249);
        color-scheme: dark;
    }

    .ai-notes-filter-select option {
        background-color: rgb(248 250 252);
        color: rgb(15 23 42);
    }
</style>
