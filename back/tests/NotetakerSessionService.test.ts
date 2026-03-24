import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotetakerActor } from "../src/Model/Notetaker/NotetakerTypes";

const persistenceMock = {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
    saveSession: vi.fn(),
    setActiveSession: vi.fn(),
    clearActiveSession: vi.fn(),
    getActiveSessionId: vi.fn(),
    listActiveSessionIds: vi.fn(),
    listSessions: vi.fn(),
    listSessionsByUser: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
};

const deliveryQueueMock = {
    enqueueSessionDigest: vi.fn(),
};

const mistralMock = {
    isConfigured: vi.fn(() => true),
    generateSummary: vi.fn(async () => ({
        summaryMarkdown: "summary",
        decisions: [],
        actionItems: [],
    })),
    transcribeAudioChunk: vi.fn(),
};

let runtimeEventHandler: ((event: { sessionId: string; type: string; payload?: Record<string, unknown> }) => Promise<void>) | undefined;
const botStartMock = vi.fn(async () => undefined);
const botStopMock = vi.fn(async () => undefined);

vi.mock("../src/Enum/EnvironmentVariable", () => ({
    AI_NOTETAKER_ALLOW_ADMIN_READ_ALL: false,
    AI_NOTETAKER_EMAIL_DIGEST_ENABLED: false,
    AI_NOTETAKER_ENABLED: false,
    AI_NOTETAKER_IDLE_AUTO_STOP_MS: 120000,
    AI_NOTETAKER_IDLE_WARNING_MS: 300000,
    AI_NOTETAKER_MAINTENANCE_INTERVAL_MS: 15000,
    AI_NOTETAKER_PARTICIPANT_TIMEOUT_MS: 120000,
    AI_NOTETAKER_PERMISSION_POLICY: "all_users",
    AI_NOTETAKER_STARTER_MUST_STAY: false,
    AI_NOTETAKER_SUMMARY_REFRESH_SEGMENTS: 10,
    AI_NOTETAKER_SUMMARY_RETENTION_DAYS: 180,
    AI_NOTETAKER_TRANSCRIPT_RETENTION_DAYS: 90,
    AI_NOTETAKER_ALLOWED_TAGS: [],
}));

vi.mock("../src/Model/Notetaker/NotetakerPersistenceService", () => ({
    notetakerPersistenceService: persistenceMock,
}));

vi.mock("../src/Model/Notetaker/NotetakerDeliveryQueueService", () => ({
    notetakerDeliveryQueueService: deliveryQueueMock,
}));

vi.mock("../src/Model/Notetaker/MistralMeetingNotesService", () => ({
    mistralMeetingNotesService: mistralMock,
}));

vi.mock("../src/Model/Notetaker/NotetakerBotIngestionService", () => {
    class MockNotetakerBotIngestionService {
        constructor(callbacks: { onRuntimeEvent?: (event: { sessionId: string; type: string }) => Promise<void> }) {
            runtimeEventHandler = callbacks.onRuntimeEvent;
        }

        public startSession = botStartMock;
        public stopSession = botStopMock;
    }

    return {
        NotetakerBotIngestionService: MockNotetakerBotIngestionService,
    };
});

import { NotetakerSessionService } from "../src/Model/Notetaker/NotetakerSessionService";

const starter: NotetakerActor = {
    userId: "starter",
    displayName: "Starter",
    tags: [],
};

function resetPersistenceDefaults(): void {
    persistenceMock.getConfig.mockResolvedValue(undefined);
    persistenceMock.saveConfig.mockResolvedValue(undefined);
    persistenceMock.saveSession.mockResolvedValue(undefined);
    persistenceMock.setActiveSession.mockResolvedValue(undefined);
    persistenceMock.clearActiveSession.mockResolvedValue(undefined);
    persistenceMock.getActiveSessionId.mockResolvedValue(undefined);
    persistenceMock.listActiveSessionIds.mockResolvedValue([]);
    persistenceMock.listSessions.mockResolvedValue([]);
    persistenceMock.listSessionsByUser.mockResolvedValue([]);
    persistenceMock.getSession.mockResolvedValue(undefined);
    persistenceMock.deleteSession.mockResolvedValue(undefined);
}

describe("NotetakerSessionService", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-23T10:00:00.000Z"));
        vi.clearAllMocks();
        runtimeEventHandler = undefined;
        resetPersistenceDefaults();
    });

    it("fills speaker label from participant snapshot when segment has no label", async () => {
        const service = new NotetakerSessionService();
        const session = await service.startSession({
            spaceName: "space-a",
            startedBy: starter,
        });

        await service.updateParticipantPresence({
            sessionId: session.id,
            participant: {
                userId: "speaker-1",
                displayName: "Alice",
                tags: [],
            },
        });

        await service.addTranscriptSegment(session.id, {
            speakerSpaceUserId: "speaker-1",
            text: "hello world",
            endedAtMs: 1000,
        });

        const storedSession = await service.getSession(session.id, { allowSystemBypass: true });
        expect(storedSession?.segments[0]?.speakerLabel).toBe("Alice");
    });

    it("deduplicates repeated segment payloads arriving within 1.5s window", async () => {
        const service = new NotetakerSessionService();
        const session = await service.startSession({
            spaceName: "space-b",
            startedBy: starter,
        });

        await service.addTranscriptSegment(session.id, {
            speakerSpaceUserId: "speaker-2",
            speakerLabel: "Bob",
            text: "same sentence",
            endedAtMs: 1000,
        });

        await service.addTranscriptSegment(session.id, {
            speakerSpaceUserId: "speaker-2",
            speakerLabel: "Bob",
            text: "same sentence",
            endedAtMs: 1200,
        });

        const storedSession = await service.getSession(session.id, { allowSystemBypass: true });
        expect(storedSession?.segments).toHaveLength(1);
    });

    it("throttles bot sync runtime audit events to one per minute", async () => {
        const service = new NotetakerSessionService();
        const session = await service.startSession({
            spaceName: "space-c",
            startedBy: starter,
        });

        expect(runtimeEventHandler).toBeDefined();

        await runtimeEventHandler?.({
            sessionId: session.id,
            type: "sync_tick",
            payload: { activeTrackCount: 1 },
        });

        await runtimeEventHandler?.({
            sessionId: session.id,
            type: "sync_tick",
            payload: { activeTrackCount: 2 },
        });

        let storedSession = await service.getSession(session.id, { allowSystemBypass: true });
        let syncEvents =
            storedSession?.auditEvents.filter(
                (event) => event.eventType === "bot_runtime" && event.payload?.type === "sync_tick"
            ) ?? [];
        expect(syncEvents).toHaveLength(1);

        vi.setSystemTime(new Date("2026-03-23T10:01:01.000Z"));

        await runtimeEventHandler?.({
            sessionId: session.id,
            type: "sync_tick",
            payload: { activeTrackCount: 3 },
        });

        storedSession = await service.getSession(session.id, { allowSystemBypass: true });
        syncEvents =
            storedSession?.auditEvents.filter(
                (event) => event.eventType === "bot_runtime" && event.payload?.type === "sync_tick"
            ) ?? [];
        expect(syncEvents).toHaveLength(2);
    });
});
