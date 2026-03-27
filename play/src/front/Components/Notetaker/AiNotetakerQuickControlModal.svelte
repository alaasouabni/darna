<script lang="ts">
    import { onDestroy } from "svelte";
    import { closeModal, openModal } from "svelte-modals";
    import Popup from "../Modal/Popup.svelte";
    import AiNotetakerPanelModal from "./AiNotetakerPanelModal.svelte";
    import AiNotetakerShareSessionModal from "./AiNotetakerShareSessionModal.svelte";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { livekitMeetingRoomSpaceNameStore } from "../../Stores/GameStore";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import {
        notetakerCanManageStore,
        notetakerControls,
        notetakerLoadingStore,
        notetakerRuntimeStateStore,
        notetakerSessionStore,
        notetakerStatusStore,
        type NotetakerSession,
    } from "../../Stores/NotetakerStore";

    export let isOpen: boolean;

    let wasOpen = false;
    let controlsRefreshPoller: ReturnType<typeof setInterval> | undefined;
    let lastRequestedSpaceWhileOpen: string | undefined;
    let primaryActionDisabled = true;

    $: currentMeetingSpace = $livekitMeetingRoomSpaceNameStore ?? undefined;
    $: effectiveMeetingSpace = currentMeetingSpace ?? $notetakerStatusStore.meetingSpaces[0] ?? undefined;
    $: hasMeetingContext =
        Boolean(currentMeetingSpace) || Boolean(effectiveMeetingSpace) || $notetakerStatusStore.inMeetingRoom;
    $: currentUser = localUserStore.getLocalUser();
    $: localUserIdentifiers = collectCurrentUserIdentifiers(currentUser);
    $: statusUserIdentifiers = collectStatusUserIdentifiers(
        $notetakerStatusStore.viewerUserId,
        $notetakerStatusStore.viewerEmail
    );
    $: currentUserIdentifiers = Array.from(new Set([...statusUserIdentifiers, ...localUserIdentifiers]));
    $: hasCurrentUserIdentity = currentUserIdentifiers.length > 0;
    $: ownerUserId = $notetakerSessionStore?.ownerUserId ?? $notetakerSessionStore?.startedByUserId;
    $: fallbackIsCurrentUserOwner =
        Boolean(ownerUserId) && currentUserIdentifiers.some((identifier) => idsMatch(identifier, ownerUserId));
    $: isCurrentUserOwner =
        typeof $notetakerSessionStore?.viewerIsOwner === "boolean"
            ? $notetakerSessionStore.viewerIsOwner
            : fallbackIsCurrentUserOwner;
    $: ownerPresent = isOwnerPresent($notetakerSessionStore);
    $: fallbackCanStopCurrentSession =
        isRunning($notetakerRuntimeStateStore) &&
        hasCurrentUserIdentity &&
        Boolean(ownerUserId) &&
        (isCurrentUserOwner || !ownerPresent);
    $: canStopCurrentSession =
        typeof $notetakerSessionStore?.viewerCanStop === "boolean"
            ? $notetakerSessionStore.viewerCanStop
            : fallbackCanStopCurrentSession;
    $: stopUnavailableReason =
        isRunning($notetakerRuntimeStateStore) && !canStopCurrentSession
            ? $notetakerRuntimeStateStore === "idle-warning"
                ? "Only the starter can decide to keep running or stop during inactivity warning."
                : "You can stop this session only if the starter leaves the meeting."
            : undefined;
    $: {
        const runtimeState = $notetakerRuntimeStateStore;
        const isSessionRunning = isRunning(runtimeState);

        if (!isSessionRunning) {
            primaryActionDisabled = $notetakerLoadingStore;
        } else if (runtimeState === "idle-warning") {
            primaryActionDisabled = !isCurrentUserOwner;
        } else {
            // Prefer server-authoritative permission when available.
            const serverCanStop = $notetakerSessionStore?.viewerCanStop;
            primaryActionDisabled = typeof serverCanStop === "boolean" ? !serverCanStop : !canStopCurrentSession;
        }
    }

    $: if (isOpen && !wasOpen) {
        wasOpen = true;
        void notetakerControls.refreshStatus();
        void notetakerControls.refreshCurrentSession(effectiveMeetingSpace);
        lastRequestedSpaceWhileOpen = effectiveMeetingSpace;
    }

    $: if (!isOpen && wasOpen) {
        wasOpen = false;
        lastRequestedSpaceWhileOpen = undefined;
    }

    $: if (isOpen && effectiveMeetingSpace && lastRequestedSpaceWhileOpen !== effectiveMeetingSpace) {
        lastRequestedSpaceWhileOpen = effectiveMeetingSpace;
        void notetakerControls.refreshCurrentSession(effectiveMeetingSpace);
    }

    $: {
        const shouldPollControls = isOpen && isRunning($notetakerRuntimeStateStore);
        if (shouldPollControls) {
            startControlsRefreshPoller();
        } else {
            stopControlsRefreshPoller();
        }
    }

    onDestroy(() => {
        stopControlsRefreshPoller();
    });

    function isRunning(state: string): boolean {
        return state === "starting" || state === "active" || state === "idle-warning" || state === "stopping";
    }

    function normalizeUserId(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }

        return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
    }

    function idsMatch(left: string | undefined, right: string | undefined): boolean {
        const normalizedLeft = normalizeUserId(left);
        const normalizedRight = normalizeUserId(right);
        return Boolean(normalizedLeft) && Boolean(normalizedRight) && normalizedLeft === normalizedRight;
    }

    function collectCurrentUserIdentifiers(
        user: ReturnType<typeof localUserStore.getLocalUser> | undefined | null
    ): string[] {
        if (!user) {
            return [];
        }

        const normalized = [normalizeUserId(user.uuid), normalizeUserId(user.email ?? undefined)].filter(
            (value): value is string => Boolean(value)
        );
        return Array.from(new Set(normalized));
    }

    function collectStatusUserIdentifiers(userId?: string, email?: string): string[] {
        const normalized = [normalizeUserId(userId), normalizeUserId(email)].filter(
            (value): value is string => Boolean(value)
        );
        return Array.from(new Set(normalized));
    }

    function isOwnerPresent(session: NotetakerSession | null): boolean {
        if (!session) {
            return false;
        }

        const ownerId = session.ownerUserId ?? session.startedByUserId;
        const now = Date.now();
        return session.participants.some((participant) => {
            if (!idsMatch(participant.userId, ownerId)) {
                return false;
            }

            if (participant.leftAt) {
                return false;
            }

            const lastSeenEpoch = new Date(participant.lastSeenAt).getTime();
            if (!Number.isFinite(lastSeenEpoch)) {
                return false;
            }

            return now - lastSeenEpoch <= 90_000;
        });
    }

    function shouldPromptShareAfterStop(stoppedSession: NotetakerSession | null): boolean {
        if (!stoppedSession || !hasCurrentUserIdentity) {
            return false;
        }

        const sessionOwnerUserId = stoppedSession.ownerUserId ?? stoppedSession.startedByUserId;
        return (
            stoppedSession.stopReason === "manual_stop" &&
            currentUserIdentifiers.some((identifier) => idsMatch(identifier, stoppedSession.stopActorUserId)) &&
            currentUserIdentifiers.some((identifier) => idsMatch(identifier, sessionOwnerUserId))
        );
    }

    function primaryLabel(state: string): string {
        if (state === "idle-warning") {
            if (!isCurrentUserOwner) {
                return "Starter action only";
            }

            return $notetakerCanManageStore ? "Keep running" : "Stop AI Notes";
        }

        return isRunning(state) ? "Stop AI Notes" : "Start AI Notes";
    }

    function primaryActionClasses(state: string): string {
        if (primaryActionDisabled) {
            return "bg-white/10 text-white/50 cursor-not-allowed";
        }

        const isStopAction = state === "idle-warning" ? !(isCurrentUserOwner && $notetakerCanManageStore) : isRunning(state);
        return isStopAction ? "btn-danger bg-danger" : "btn-secondary bg-secondary";
    }

    function stateDescription(state: string): string {
        if (state === "idle-warning") {
            if (!isCurrentUserOwner) {
                return "No speech detected recently. Waiting for the starter to keep running or stop.";
            }

            return "No speech detected recently. Keep running or stop the current AI notes session.";
        }

        if (state === "starting") {
            return "AI notetaker is starting for this meeting room.";
        }

        if (state === "active") {
            if (!canStopCurrentSession) {
                return "AI notetaker is recording. Only the starter can stop while they are still present.";
            }
            return "AI notetaker is recording this meeting.";
        }

        if (state === "stopping") {
            return "Session is stopping and final output is being prepared.";
        }

        if (state === "failed") {
            return "Last session failed. You can open the library to inspect details.";
        }

        if (!$notetakerStatusStore.enabled || !$notetakerStatusStore.relayConfigured) {
            return "AI notes are not available right now.";
        }

        if (!hasMeetingContext) {
            return "Join a meeting room to start AI notes.";
        }

        if (!$notetakerCanManageStore) {
            return "You can browse AI notes, but only allowed roles can start a new session.";
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

    function startControlsRefreshPoller(): void {
        if (controlsRefreshPoller) {
            return;
        }

        controlsRefreshPoller = setInterval(() => {
            void notetakerControls.refreshStatus();
            void notetakerControls.refreshCurrentSession(effectiveMeetingSpace);
        }, 4000);
    }

    function stopControlsRefreshPoller(): void {
        if (!controlsRefreshPoller) {
            return;
        }

        clearInterval(controlsRefreshPoller);
        controlsRefreshPoller = undefined;
    }

    async function onPrimaryActionClick(): Promise<void> {
        if (primaryActionDisabled) {
            return;
        }

        if ($notetakerRuntimeStateStore === "idle-warning") {
            if (!isCurrentUserOwner) {
                return;
            }

            if ($notetakerCanManageStore) {
                void notetakerControls.keepRunning();
                return;
            }

            const stoppedSession = await notetakerControls.stopSession();
            if (shouldPromptShareAfterStop(stoppedSession ?? null)) {
                closeModal();
                openModal(AiNotetakerShareSessionModal, {
                    session: stoppedSession,
                    showOwnerStopMessage: true,
                });
            }
            return;
        }

        if (isRunning($notetakerRuntimeStateStore)) {
            const stoppedSession = await notetakerControls.stopSession();
            if (shouldPromptShareAfterStop(stoppedSession ?? null)) {
                closeModal();
                openModal(AiNotetakerShareSessionModal, {
                    session: stoppedSession,
                    showOwnerStopMessage: true,
                });
            }
            return;
        }

        let startSpace = effectiveMeetingSpace;
        if (!startSpace) {
            await notetakerControls.refreshStatus();
            startSpace = $notetakerStatusStore.meetingSpaces[0] ?? undefined;
        }

        if (!startSpace) {
            warningMessageStore.addWarningMessage("Could not detect your current meeting room yet. Please retry in a few seconds.", {
                closable: true,
            });
            return;
        }

        void notetakerControls.startSession(startSpace);
    }

    function openLibrary(): void {
        closeModal();
        openModal(AiNotetakerPanelModal, {});
    }

    function refreshQuickState(): void {
        void notetakerControls.refreshStatus();
        void notetakerControls.refreshCurrentSession(effectiveMeetingSpace);
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

            {#if effectiveMeetingSpace}
                <div class="text-xs opacity-70 mt-3">Room: {effectiveMeetingSpace}</div>
            {/if}

            <div class="text-sm opacity-85 mt-3">{stateDescription($notetakerRuntimeStateStore)}</div>
            {#if formatCurrentSessionTime()}
                <div class="text-xs opacity-70 mt-2">{formatCurrentSessionTime()}</div>
            {/if}
            {#if !hasMeetingContext}
                <div class="text-xs text-warning mt-3">Join a meeting room to start or stop AI notes.</div>
            {/if}
            {#if !$notetakerCanManageStore && !isRunning($notetakerRuntimeStateStore)}
                <div class="text-xs text-warning mt-3">
                    You can view notes. Starting or extending sessions may be restricted by role.
                </div>
            {/if}
            {#if $notetakerLoadingStore && !isRunning($notetakerRuntimeStateStore)}
                <div class="text-xs opacity-70 mt-3">An AI notes action is in progress. Please wait a moment.</div>
            {/if}
            {#if stopUnavailableReason}
                <div class="text-xs text-warning mt-3">{stopUnavailableReason}</div>
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
        {#if !($notetakerRuntimeStateStore === "idle-warning" && !isCurrentUserOwner)}
            <button
                class="btn flex-1 justify-center {primaryActionClasses($notetakerRuntimeStateStore)}"
                disabled={primaryActionDisabled}
                on:click={onPrimaryActionClick}
            >
                {primaryLabel($notetakerRuntimeStateStore)}
            </button>
        {/if}
    </svelte:fragment>
</Popup>
