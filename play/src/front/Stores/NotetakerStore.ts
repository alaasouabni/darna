import { derived, get, writable, type Readable } from "svelte/store";
import { axiosToPusher } from "../Connection/AxiosUtils";
import { localUserStore } from "../Connection/LocalUserStore";
import { AI_NOTETAKER_ENABLED } from "../Enum/EnvironmentVariable";
import { livekitMeetingRoomSpaceNameStore } from "./GameStore";
import { warningMessageStore } from "./ErrorStore";
import { inLivekitStore } from "./MediaStore";

type NotetakerRuntimeState = "inactive" | "starting" | "active" | "idle-warning" | "stopping" | "stopped" | "failed";

interface NotetakerSegment {
    id: string;
    speakerSpaceUserId?: string;
    speakerLabel?: string;
    text: string;
    startedAtMs?: number;
    endedAtMs?: number;
    confidence?: number;
    createdAt: string;
}

interface NotetakerSummaryVersion {
    version: number;
    final: boolean;
    summaryMarkdown: string;
    decisions: string[];
    actionItems: string[];
    createdAt: string;
}

interface NotetakerAuditEvent {
    id: string;
    eventType: string;
    actorUserId?: string;
    payload?: Record<string, unknown>;
    createdAt: string;
}

interface NotetakerParticipant {
    userId: string;
    displayName?: string;
    email?: string;
    color?: string;
    avatarUrl?: string;
    wokaId?: string;
    characterTextureIds?: string[];
    tags: string[];
    joinedAt: string;
    lastSeenAt: string;
    leftAt?: string;
}

export interface NotetakerShareCandidate {
    userId: string;
    displayName?: string;
    email?: string;
    color?: string;
    avatarUrl?: string;
    wokaId?: string;
    characterTextureIds?: string[];
    tags: string[];
    joinedAt?: string;
    lastSeenAt?: string;
    isCurrentSessionParticipant?: boolean;
}

export interface NotetakerSession {
    id: string;
    roomId?: string;
    spaceName: string;
    status: "starting" | "active" | "idle-warning" | "stopping" | "stopped" | "failed";
    startedByUserId: string;
    ownerUserId: string;
    sharedWithUserIds: string[];
    sharingStatus: "private_pending" | "shared";
    sharedAt?: string;
    sharedByUserId?: string;
    viewerIsOwner?: boolean;
    viewerCanStop?: boolean;
    stopActorUserId?: string;
    stopReason?: "manual_stop" | "idle_auto_stop" | "room_empty_auto_stop" | "starter_left_auto_stop";
    startedAt: string;
    stoppedAt?: string;
    idleWarningDeadlineAt?: string;
    segments: NotetakerSegment[];
    summaries: NotetakerSummaryVersion[];
    participants: NotetakerParticipant[];
    auditEvents: NotetakerAuditEvent[];
    errorMessage?: string;
}

interface NotetakerConfig {
    permissionPolicy: "all_users" | "selected_roles";
    allowedTags: string[];
    emailDigestEnabled: boolean;
    starterMustStay: boolean;
    allowAdminReadAll: boolean;
    transcriptRetentionDays: number;
    summaryRetentionDays: number;
}

interface NotetakerStatus {
    enabled: boolean;
    relayConfigured: boolean;
    inMeetingRoom: boolean;
    meetingSpaces: string[];
    canManage: boolean;
    viewerUserId?: string;
    viewerEmail?: string;
    config?: NotetakerConfig;
    mistral?: {
        configured: boolean;
    };
}

const currentSessionStore = writable<NotetakerSession | null>(null);
const sessionsStoreInternal = writable<NotetakerSession[]>([]);
const notetakerStatusStoreInternal = writable<NotetakerStatus>({
    enabled: false,
    relayConfigured: false,
    inMeetingRoom: false,
    meetingSpaces: [],
    canManage: false,
});
const notetakerLoadingStoreInternal = writable(false);
const notetakerLastErrorStoreInternal = writable<string | null>(null);

let statusPoller: ReturnType<typeof setInterval> | undefined;
let presenceHeartbeat: ReturnType<typeof setInterval> | undefined;
let summaryFollowUpPoller: ReturnType<typeof setInterval> | undefined;
let isBootstrapped = false;
let currentMeetingSpace: string | undefined;
let pendingLeaveSessionId: string | undefined;

const IDLE_WARNING_MESSAGE_ID = "ai-notetaker-idle-warning";
const AI_NOTETAKER_DISCLOSURE_KEY_PREFIX = "wa-ai-notes-disclosure:";

function getAuthHeaders(): Record<string, string> {
    const authToken = localUserStore.getAuthToken();
    if (!authToken) {
        throw new Error("Missing auth token");
    }

    return {
        Authorization: authToken,
    };
}

function upsertSessionInStores(session: NotetakerSession): void {
    sessionsStoreInternal.update((sessions) => {
        const existingIndex = sessions.findIndex((candidate) => candidate.id === session.id);
        if (existingIndex >= 0) {
            const next = [...sessions];
            next[existingIndex] = session;
            return next;
        }
        return [session, ...sessions];
    });

    const currentSession = get(currentSessionStore);
    if (currentSession?.id === session.id) {
        currentSessionStore.set(session);
    }
}

function clearIdleWarningMessage(): void {
    warningMessageStore.clearWarningMessageById(IDLE_WARNING_MESSAGE_ID);
}

function stopTranscriptionRecorder(): void {
    // Bot-only ingestion mode: browser-side recorder is intentionally disabled.
}

function stopSummaryFollowUpPoller(): void {
    if (summaryFollowUpPoller) {
        clearInterval(summaryFollowUpPoller);
        summaryFollowUpPoller = undefined;
    }
}

function sessionHasSummary(session: NotetakerSession | null | undefined): boolean {
    if (!session || session.summaries.length === 0) {
        return false;
    }

    const latestSummary = session.summaries.at(-1);
    return typeof latestSummary?.summaryMarkdown === "string" && latestSummary.summaryMarkdown.trim().length > 0;
}

function maybeStartSummaryFollowUp(session: NotetakerSession | null | undefined): void {
    stopSummaryFollowUpPoller();

    if (!session) {
        return;
    }

    if (session.status !== "stopped" && session.status !== "failed") {
        return;
    }

    if (sessionHasSummary(session)) {
        return;
    }

    let attempts = 0;
    summaryFollowUpPoller = setInterval(() => {
        attempts += 1;
        void refreshCurrentSession(session.spaceName);
        void refreshSessions();

        const currentSession = get(currentSessionStore);
        const listedSession = get(sessionsStoreInternal).find((candidate) => candidate.id === session.id);

        if (sessionHasSummary(currentSession?.id === session.id ? currentSession : listedSession) || attempts >= 24) {
            stopSummaryFollowUpPoller();
        }
    }, 5000);
}

function syncTranscriptionRecorder(): void {
    stopTranscriptionRecorder();
}

async function refreshStatus(): Promise<void> {
    if (!AI_NOTETAKER_ENABLED) {
        notetakerStatusStoreInternal.set({
            enabled: false,
            relayConfigured: false,
            inMeetingRoom: false,
            meetingSpaces: [],
            canManage: false,
        });
        return;
    }

    try {
        const response = await axiosToPusher.get<NotetakerStatus>("notetaker/status", {
            headers: getAuthHeaders(),
        });
        notetakerStatusStoreInternal.set(response.data);
        notetakerLastErrorStoreInternal.set(null);
    } catch (error) {
        console.error("Failed to refresh notetaker status", error);
    }
}

function handleIdleWarning(session: NotetakerSession | null): void {
    if (!session || session.status !== "idle-warning") {
        clearIdleWarningMessage();
        return;
    }

    warningMessageStore.addWarningMessage(
        "No speech detected. AI notes will auto-stop soon. Use the AI Notes button to keep running.",
        {
            id: IDLE_WARNING_MESSAGE_ID,
            closable: true,
        }
    );
}

function ensureHeartbeat(): void {
    if (presenceHeartbeat) {
        clearInterval(presenceHeartbeat);
        presenceHeartbeat = undefined;
    }

    const session = get(currentSessionStore);
    if (!session || ["stopped", "failed"].includes(session.status)) {
        return;
    }

    presenceHeartbeat = setInterval(() => {
        const currentSession = get(currentSessionStore);
        if (!currentSession || ["stopped", "failed"].includes(currentSession.status)) {
            if (presenceHeartbeat) {
                clearInterval(presenceHeartbeat);
                presenceHeartbeat = undefined;
            }
            return;
        }

        void axiosToPusher
            .post(
                "notetaker/presence",
                {
                    sessionId: currentSession.id,
                },
                {
                    headers: getAuthHeaders(),
                }
            )
            .catch((error) => {
                console.error("Failed to send notetaker presence heartbeat", error);
            });
    }, 30_000);
}

async function refreshCurrentSession(spaceName?: string): Promise<void> {
    if (!AI_NOTETAKER_ENABLED) {
        currentSessionStore.set(null);
        sessionsStoreInternal.set([]);
        clearIdleWarningMessage();
        stopTranscriptionRecorder();
        return;
    }

    try {
        const response = await axiosToPusher.get<{ session: NotetakerSession | null }>("notetaker/current", {
            headers: getAuthHeaders(),
            params: {
                spaceName,
            },
        });
        currentSessionStore.set(response.data.session);
        handleIdleWarning(response.data.session);
        ensureHeartbeat();
        syncTranscriptionRecorder();
        maybeStartSummaryFollowUp(response.data.session);
        notetakerLastErrorStoreInternal.set(null);
    } catch {
        currentSessionStore.set(null);
        clearIdleWarningMessage();
        ensureHeartbeat();
        stopSummaryFollowUpPoller();
        stopTranscriptionRecorder();
    }
}

async function refreshSessions(_spaceName?: string): Promise<void> {
    if (!AI_NOTETAKER_ENABLED) {
        sessionsStoreInternal.set([]);
        return;
    }

    try {
        const response = await axiosToPusher.get<{ sessions: NotetakerSession[] }>("notetaker/sessions", {
            headers: getAuthHeaders(),
        });
        sessionsStoreInternal.set(response.data.sessions);
        notetakerLastErrorStoreInternal.set(null);
    } catch (error) {
        console.error("Failed to refresh notetaker sessions", error);
    }
}

function hasDisclosureAcknowledgement(spaceName?: string): boolean {
    if (!spaceName || typeof window === "undefined") {
        return true;
    }

    return window.localStorage.getItem(`${AI_NOTETAKER_DISCLOSURE_KEY_PREFIX}${spaceName}`) === "1";
}

function saveDisclosureAcknowledgement(spaceName?: string): void {
    if (!spaceName || typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(`${AI_NOTETAKER_DISCLOSURE_KEY_PREFIX}${spaceName}`, "1");
}

function shouldDisplayDisclosure(spaceName?: string): boolean {
    if (!spaceName) {
        return false;
    }

    return !hasDisclosureAcknowledgement(spaceName);
}

function confirmDisclosure(spaceName?: string): boolean {
    if (!shouldDisplayDisclosure(spaceName)) {
        return true;
    }

    if (typeof window === "undefined") {
        return true;
    }

    const accepted = window.confirm(
        "AI notes will transcribe and summarize the meeting for participants in this room. Continue?"
    );

    if (accepted) {
        saveDisclosureAcknowledgement(spaceName);
    }

    return accepted;
}

async function startSession(spaceName?: string): Promise<void> {
    if (!confirmDisclosure(spaceName)) {
        return;
    }

    notetakerLoadingStoreInternal.set(true);
    try {
        const response = await axiosToPusher.post<{ session: NotetakerSession }>(
            "notetaker/start",
            {
                spaceName,
            },
            {
                headers: getAuthHeaders(),
            }
        );
        currentSessionStore.set(response.data.session);
        handleIdleWarning(response.data.session);
        ensureHeartbeat();
        stopSummaryFollowUpPoller();
        syncTranscriptionRecorder();
        void refreshSessions();
        notetakerLastErrorStoreInternal.set(null);
    } catch (error) {
        const message = "Failed to start AI notes";
        warningMessageStore.addWarningMessage(message, { closable: true });
        notetakerLastErrorStoreInternal.set(message);
        console.error(message, error);
    } finally {
        notetakerLoadingStoreInternal.set(false);
    }
}

async function stopSession(): Promise<NotetakerSession | undefined> {
    const session = get(currentSessionStore);
    if (!session) {
        return undefined;
    }

    notetakerLoadingStoreInternal.set(true);
    try {
        const response = await axiosToPusher.post<{ session: NotetakerSession }>(
            "notetaker/stop",
            {
                sessionId: session.id,
                reason: "manual_stop",
            },
            {
                headers: getAuthHeaders(),
            }
        );
        currentSessionStore.set(response.data.session);
        handleIdleWarning(response.data.session);
        ensureHeartbeat();
        syncTranscriptionRecorder();
        maybeStartSummaryFollowUp(response.data.session);
        void refreshSessions();
        notetakerLastErrorStoreInternal.set(null);
        return response.data.session;
    } catch (error) {
        const message = "Failed to stop AI notes";
        warningMessageStore.addWarningMessage(message, { closable: true });
        notetakerLastErrorStoreInternal.set(message);
        console.error(message, error);
        return undefined;
    } finally {
        notetakerLoadingStoreInternal.set(false);
    }
}

async function keepRunning(): Promise<void> {
    const session = get(currentSessionStore);
    if (!session) {
        return;
    }

    notetakerLoadingStoreInternal.set(true);
    try {
        const response = await axiosToPusher.post<{ session: NotetakerSession }>(
            "notetaker/keep-running",
            {
                sessionId: session.id,
            },
            {
                headers: getAuthHeaders(),
            }
        );
        currentSessionStore.set(response.data.session);
        handleIdleWarning(response.data.session);
        ensureHeartbeat();
        syncTranscriptionRecorder();
        maybeStartSummaryFollowUp(response.data.session);
        void refreshSessions();
        notetakerLastErrorStoreInternal.set(null);
    } catch (error) {
        const message = "Failed to keep AI notes running";
        warningMessageStore.addWarningMessage(message, { closable: true });
        notetakerLastErrorStoreInternal.set(message);
        console.error(message, error);
    } finally {
        notetakerLoadingStoreInternal.set(false);
    }
}

async function deleteSessions(sessionIds: string[]): Promise<void> {
    const uniqueSessionIds = Array.from(new Set(sessionIds.filter((sessionId) => sessionId.trim().length > 0)));
    if (uniqueSessionIds.length === 0) {
        return;
    }

    notetakerLoadingStoreInternal.set(true);

    let failedCount = 0;

    try {
        for (const sessionId of uniqueSessionIds) {
            try {
                await axiosToPusher.delete(`notetaker/session/${sessionId}`, {
                    headers: getAuthHeaders(),
                });
            } catch (error) {
                failedCount += 1;
                console.error("Failed to delete AI notes session", { sessionId, error });
            }
        }

        const currentSession = get(currentSessionStore);
        if (currentSession && uniqueSessionIds.includes(currentSession.id)) {
            currentSessionStore.set(null);
            clearIdleWarningMessage();
            ensureHeartbeat();
            stopSummaryFollowUpPoller();
            stopTranscriptionRecorder();
        }

        await refreshSessions();
        if (currentMeetingSpace) {
            await refreshCurrentSession(currentMeetingSpace);
        }

        if (failedCount > 0) {
            const message =
                failedCount === uniqueSessionIds.length
                    ? "Failed to delete AI notes sessions"
                    : `${failedCount} AI notes session(s) could not be deleted`;
            warningMessageStore.addWarningMessage(message, { closable: true });
            notetakerLastErrorStoreInternal.set(message);
            return;
        }

        notetakerLastErrorStoreInternal.set(null);
    } finally {
        notetakerLoadingStoreInternal.set(false);
    }
}

async function deleteSession(sessionId: string): Promise<void> {
    await deleteSessions([sessionId]);
}

async function removeSessionFromMyLibrary(sessionId: string): Promise<boolean> {
    notetakerLoadingStoreInternal.set(true);
    try {
        await axiosToPusher.post(
            `notetaker/session/${sessionId}/remove-self`,
            {},
            {
                headers: getAuthHeaders(),
            }
        );

        sessionsStoreInternal.update((sessions) => sessions.filter((session) => session.id !== sessionId));
        if (get(currentSessionStore)?.id === sessionId) {
            currentSessionStore.set(null);
        }
        notetakerLastErrorStoreInternal.set(null);
        return true;
    } catch (error) {
        const message = "Failed to remove shared AI notes session from your library";
        warningMessageStore.addWarningMessage(message, { closable: true });
        notetakerLastErrorStoreInternal.set(message);
        console.error(message, error);
        return false;
    } finally {
        notetakerLoadingStoreInternal.set(false);
    }
}

async function getSessionShareCandidates(sessionId: string): Promise<NotetakerShareCandidate[]> {
    try {
        const response = await axiosToPusher.get<{ candidates: NotetakerShareCandidate[] }>(
            `notetaker/session/${sessionId}/share-candidates`,
            {
                headers: getAuthHeaders(),
            }
        );

        notetakerLastErrorStoreInternal.set(null);
        return response.data.candidates;
    } catch (error) {
        const message = "Failed to load AI notes sharing candidates";
        warningMessageStore.addWarningMessage(message, { closable: true });
        notetakerLastErrorStoreInternal.set(message);
        console.error(message, error);
        return [];
    }
}

async function getSessionShares(sessionId: string): Promise<NotetakerShareCandidate[]> {
    try {
        const response = await axiosToPusher.get<{ sharedWith: NotetakerShareCandidate[] }>(
            `notetaker/session/${sessionId}/shares`,
            {
                headers: getAuthHeaders(),
            }
        );

        notetakerLastErrorStoreInternal.set(null);
        return response.data.sharedWith;
    } catch (error) {
        const message = "Failed to load AI notes sharing list";
        warningMessageStore.addWarningMessage(message, { closable: true });
        notetakerLastErrorStoreInternal.set(message);
        console.error(message, error);
        return [];
    }
}

async function updateSessionSharing(sessionId: string, userIds: string[]): Promise<NotetakerSession | undefined> {
    notetakerLoadingStoreInternal.set(true);
    try {
        const response = await axiosToPusher.post<{ session: NotetakerSession }>(
            "notetaker/share",
            {
                sessionId,
                userIds,
            },
            {
                headers: getAuthHeaders(),
            }
        );

        const updatedSession = response.data.session;
        upsertSessionInStores(updatedSession);
        notetakerLastErrorStoreInternal.set(null);
        return updatedSession;
    } catch (error) {
        const message = "Failed to update AI notes sharing";
        warningMessageStore.addWarningMessage(message, { closable: true });
        notetakerLastErrorStoreInternal.set(message);
        console.error(message, error);
        return undefined;
    } finally {
        notetakerLoadingStoreInternal.set(false);
    }
}

async function exportSession(sessionId: string, format: "markdown" | "text"): Promise<void> {
    try {
        if (typeof window === "undefined" || typeof document === "undefined") {
            return;
        }

        const response = await axiosToPusher.get<Blob>(`notetaker/export/${sessionId}`, {
            headers: getAuthHeaders(),
            params: { format },
            responseType: "blob",
        });

        const contentDisposition = response.headers["content-disposition"];
        const fileNameMatch =
            typeof contentDisposition === "string" ? contentDisposition.match(/filename=\"?([^\";]+)\"?/i) : undefined;
        const defaultFileName = `ai-notes-${sessionId}.${format === "markdown" ? "md" : "txt"}`;
        const fileName = fileNameMatch?.[1] ?? defaultFileName;

        const blobUrl = window.URL.createObjectURL(response.data);
        const anchor = document.createElement("a");
        anchor.href = blobUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
        const message = "Failed to export AI notes";
        warningMessageStore.addWarningMessage(message, { closable: true });
        notetakerLastErrorStoreInternal.set(message);
        console.error(message, error);
    }
}

async function downloadRecording(sessionId: string): Promise<void> {
    try {
        if (typeof window === "undefined" || typeof document === "undefined") {
            return;
        }

        const response = await axiosToPusher.get<Blob>(`notetaker/recording/${sessionId}`, {
            headers: getAuthHeaders(),
            responseType: "blob",
        });

        const contentDisposition = response.headers["content-disposition"];
        const fileNameMatch =
            typeof contentDisposition === "string" ? contentDisposition.match(/filename="?([^";]+)"?/i) : undefined;
        const fileName = fileNameMatch?.[1] ?? `ai-notes-recording-${sessionId}.wav`;

        const blobUrl = window.URL.createObjectURL(response.data);
        const anchorElement = document.createElement("a");
        anchorElement.href = blobUrl;
        anchorElement.download = fileName;
        document.body.appendChild(anchorElement);
        anchorElement.click();
        document.body.removeChild(anchorElement);
        window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
        const message = "Failed to download AI recording";
        warningMessageStore.addWarningMessage(message, { closable: true });
        notetakerLastErrorStoreInternal.set(message);
        console.error(message, error);
    }
}

async function markParticipantLeft(sessionId: string): Promise<void> {
    if (!AI_NOTETAKER_ENABLED || pendingLeaveSessionId === sessionId) {
        return;
    }

    pendingLeaveSessionId = sessionId;
    try {
        await axiosToPusher.post(
            "notetaker/leave",
            {
                sessionId,
            },
            {
                headers: getAuthHeaders(),
            }
        );
    } catch (error) {
        console.error("Failed to mark notetaker participant as left", error);
    } finally {
        if (pendingLeaveSessionId === sessionId) {
            pendingLeaveSessionId = undefined;
        }
    }
}

function bootstrapNotetaker(): void {
    if (isBootstrapped) {
        return;
    }

    isBootstrapped = true;

    void refreshStatus();

    livekitMeetingRoomSpaceNameStore.subscribe((spaceName) => {
        const normalizedSpace = spaceName ?? undefined;
        const previousSpace = currentMeetingSpace;
        currentMeetingSpace = normalizedSpace;

        const currentSession = get(currentSessionStore);
        if (
            currentSession &&
            previousSpace &&
            previousSpace !== normalizedSpace &&
            currentSession.spaceName === previousSpace
        ) {
            void markParticipantLeft(currentSession.id);
        }

        if (!normalizedSpace) {
            currentSessionStore.set(null);
            clearIdleWarningMessage();
            ensureHeartbeat();
            stopSummaryFollowUpPoller();
            stopTranscriptionRecorder();
            return;
        }

        void refreshCurrentSession(normalizedSpace);
        void refreshSessions();
    });

    inLivekitStore.subscribe((inLivekit) => {
        if (inLivekit) {
            const selectedMeetingSpace = get(livekitMeetingRoomSpaceNameStore) ?? undefined;
            if (selectedMeetingSpace) {
                void refreshCurrentSession(selectedMeetingSpace);
                void refreshSessions();
            }
            syncTranscriptionRecorder();
            return;
        }

        const currentSession = get(currentSessionStore);
        if (currentSession) {
            void markParticipantLeft(currentSession.id);
        }

        currentSessionStore.set(null);
        clearIdleWarningMessage();
        ensureHeartbeat();
        stopSummaryFollowUpPoller();
        stopTranscriptionRecorder();
    });

    currentSessionStore.subscribe(() => {
        syncTranscriptionRecorder();
    });

    if (!statusPoller) {
        statusPoller = setInterval(() => {
            const selectedMeetingSpace = get(livekitMeetingRoomSpaceNameStore) ?? undefined;
            void refreshStatus();
            if (selectedMeetingSpace) {
                void refreshCurrentSession(selectedMeetingSpace);
                void refreshSessions();
            }
        }, 8_000);
    }
}

export const notetakerSessionStore: Readable<NotetakerSession | null> = derived(
    currentSessionStore,
    ($session) => $session
);
export const notetakerSessionsStore: Readable<NotetakerSession[]> = derived(
    sessionsStoreInternal,
    ($sessions) => $sessions
);
export const notetakerStatusStore: Readable<NotetakerStatus> = derived(
    notetakerStatusStoreInternal,
    ($status) => $status
);
export const notetakerLoadingStore: Readable<boolean> = derived(notetakerLoadingStoreInternal, ($loading) => $loading);
export const notetakerLastErrorStore: Readable<string | null> = derived(
    notetakerLastErrorStoreInternal,
    ($error) => $error
);

export const notetakerRuntimeStateStore: Readable<NotetakerRuntimeState> = derived(
    currentSessionStore,
    ($session): NotetakerRuntimeState => {
        if (!$session) {
            return "inactive";
        }

        return $session.status;
    }
);

export const notetakerCanManageStore: Readable<boolean> = derived(notetakerStatusStoreInternal, ($status) => {
    return $status.canManage;
});

export const notetakerAvailableStore: Readable<boolean> = derived(
    [notetakerStatusStoreInternal, inLivekitStore, livekitMeetingRoomSpaceNameStore],
    ([$status, $inLivekit, $meetingSpaceName]) => {
        return (
            AI_NOTETAKER_ENABLED &&
            $status.enabled &&
            $status.relayConfigured &&
            $inLivekit &&
            $meetingSpaceName !== null
        );
    }
);

export const notetakerControls = {
    bootstrapNotetaker,
    refreshStatus,
    refreshCurrentSession,
    refreshSessions,
    startSession,
    stopSession,
    keepRunning,
    deleteSession,
    deleteSessions,
    removeSessionFromMyLibrary,
    getSessionShareCandidates,
    getSessionShares,
    updateSessionSharing,
    exportSession,
    downloadRecording,
};
