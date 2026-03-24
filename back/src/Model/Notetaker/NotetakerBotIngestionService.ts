import { createWriteStream, type Dirent, type WriteStream } from "fs";
import { mkdir, readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";
import type { ParticipantInfo, TrackInfo } from "livekit-server-sdk";
import { TrackSource, TrackType } from "livekit-server-sdk";
import { WebSocketServer, type WebSocket } from "ws";
import {
    AI_NOTETAKER_BOT_INGESTION_ENABLED,
    AI_NOTETAKER_BOT_INGESTION_WS_HOST,
    AI_NOTETAKER_BOT_INGESTION_WS_PORT,
    AI_NOTETAKER_BOT_INGESTION_WS_PUBLIC_URL,
    AI_NOTETAKER_BOT_INGESTION_TOKEN,
    AI_NOTETAKER_BOT_SYNC_INTERVAL_MS,
    AI_NOTETAKER_BOT_TRACK_MIME_TYPE,
    AI_NOTETAKER_AUDIO_STORAGE_DIR,
    AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES,
    AI_NOTETAKER_AUDIO_STORAGE_SOFT_LIMIT_BYTES,
    AI_NOTETAKER_ENABLED,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    LIVEKIT_HOST,
} from "../../Enum/EnvironmentVariable";
import { LiveKitService } from "../Services/LivekitService";
import type { NotetakerSession } from "./NotetakerTypes";


export type NotetakerBotRuntimeEventType =
    | "session_started"
    | "session_stopped"
    | "sync_tick"
    | "track_ingestion_started"
    | "track_ingestion_stopped"
    | "artifact_finalized"
    | "artifact_deleted"
    | "storage_warning"
    | "storage_limit"
    | "error";

export interface NotetakerBotRuntimeEvent {
    sessionId: string;
    type: NotetakerBotRuntimeEventType;
    payload?: Record<string, unknown>;
}

interface NotetakerBotIngestionCallbacks {
    onRuntimeEvent?: (event: NotetakerBotRuntimeEvent) => Promise<void>;
}

interface SessionRuntime {
    sessionId: string;
    spaceName: string;
    language?: string;
    tracksById: Map<string, TrackRuntime>;
    syncTimer: NodeJS.Timeout;
    syncInProgress: boolean;
    syncRequested: boolean;
    tracksStarting: Set<string>;
    trackRetries: Map<string, TrackRetryState>;
    metrics: SessionMetrics;
}

interface SessionMetrics {
    segmentsIngested: number;
    bytesIngested: number;
    lastSyncAtMs?: number;
    lastSegmentAtMs?: number;
    lastErrorAtMs?: number;
    lastErrorMessage?: string;
}

interface TrackRuntime {
    trackId: string;
    egressId: string;
    speakerSpaceUserId: string;
    speakerLabel?: string;
    startedAtMs: number;
}

interface TrackRetryState {
    attempts: number;
    nextRetryAtMs: number;
    lastError?: string;
}

interface SpeakerTrackDescriptor {
    trackId: string;
    speakerSpaceUserId: string;
    speakerLabel?: string;
}

interface ConnectionRuntime {
    sessionId: string;
    trackId: string;
    speakerSpaceUserId: string;
    speakerLabel?: string;
    mimeType: string;
    pcmSampleRate: number;
    pcmChannelCount?: 1 | 2;
    flushTimer?: NodeJS.Timeout;
    artifactId: string;
    artifactFilePath: string;
    artifactByteCount: number;
    artifactWriteStream?: WriteStream;
    artifactStartedAtMs?: number;
    artifactLastChunkAtMs?: number;
    artifactFinalizedAt?: Date;
    closing: boolean;
}

interface SessionStorageState {
    knownBytes: number;
    warningEmitted: boolean;
}

interface FinalizedArtifactPayload {
    artifactId: string;
    trackId: string;
    speakerSpaceUserId: string;
    speakerLabel?: string;
    mimeType: string;
    sampleRate?: number;
    channelCount?: 1 | 2;
    filePath: string;
    bytes: number;
    createdAt: string;
    endedAtMs?: number;
    startedAtMs?: number;
    status: "recorded" | "failed";
    error?: string;
}

interface ConnectionCloseMeta {
    code?: number;
    reason?: string;
}

export class NotetakerBotIngestionService {
    private readonly sessions = new Map<string, SessionRuntime>();
    private readonly connections = new Map<WebSocket, ConnectionRuntime>();
    private readonly livekitService = this.createLivekitService();
    private websocketServer: WebSocketServer | undefined;
    private readonly audioStorageDir = AI_NOTETAKER_AUDIO_STORAGE_DIR ?? "/tmp/ai-notetaker-audio";
    private readonly audioStorageSoftLimitBytes = Math.max(
        1,
        Math.min(AI_NOTETAKER_AUDIO_STORAGE_SOFT_LIMIT_BYTES, AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES)
    );
    private readonly audioStorageHardLimitBytes = Math.max(1, AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES);
    private storageState: SessionStorageState = {
        knownBytes: 0,
        warningEmitted: false,
    };
    private storageInitialized = false;

    constructor(private readonly callbacks: NotetakerBotIngestionCallbacks = {}) {}

    public async startSession(session: NotetakerSession): Promise<void> {
        if (!this.isEnabled()) {
            return;
        }

        try {
            await this.ensureStorageReady();
        } catch (error) {
            this.emitRuntimeEvent({
                sessionId: session.id,
                type: "error",
                payload: {
                    operation: "ensure_storage_ready",
                    message: this.toErrorMessage(error),
                },
            });
            console.error("[AI Notetaker Bot] Failed to initialize audio storage", { error });
            return;
        }

        if (!this.livekitService) {
            this.emitRuntimeEvent({
                sessionId: session.id,
                type: "error",
                payload: {
                    operation: "start_session",
                    message: "LiveKit credentials are missing; bot ingestion is disabled.",
                },
            });
            console.warn("[AI Notetaker Bot] LiveKit credentials are missing; bot ingestion is disabled.");
            return;
        }

        this.ensureWebsocketServer();

        const existing = this.sessions.get(session.id);
        if (existing) {
            existing.language = session.language;
            existing.spaceName = session.spaceName;
            existing.syncRequested = true;
            void this.scheduleSessionSync(session.id);
            return;
        }

        const syncTimer = setInterval(() => {
            void this.scheduleSessionSync(session.id);
        }, Math.max(2000, AI_NOTETAKER_BOT_SYNC_INTERVAL_MS));

        this.sessions.set(session.id, {
            sessionId: session.id,
            spaceName: session.spaceName,
            language: session.language,
            tracksById: new Map<string, TrackRuntime>(),
            syncTimer,
            syncInProgress: false,
            syncRequested: false,
            tracksStarting: new Set<string>(),
            trackRetries: new Map<string, TrackRetryState>(),
            metrics: {
                segmentsIngested: 0,
                bytesIngested: 0,
            },
        });

        this.emitRuntimeEvent({
            sessionId: session.id,
            type: "session_started",
            payload: {
                spaceName: session.spaceName,
            },
        });

        await this.scheduleSessionSync(session.id);
    }

    public async stopSession(sessionId: string): Promise<void> {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) {
            return;
        }

        clearInterval(runtime.syncTimer);
        this.sessions.delete(sessionId);

        const activeTracksAtStop = runtime.tracksById.size;
        for (const trackRuntime of runtime.tracksById.values()) {
            await this.stopTrackEgress(trackRuntime);
        }

        runtime.tracksById.clear();
        runtime.trackRetries.clear();
        runtime.tracksStarting.clear();
        this.closeSessionConnections(sessionId);

        this.emitRuntimeEvent({
            sessionId,
            type: "session_stopped",
            payload: {
                ingestedSegments: runtime.metrics.segmentsIngested,
                ingestedBytes: runtime.metrics.bytesIngested,
                activeTracksAtStop,
            },
        });
    }

    public async getStorageSnapshot(): Promise<{
        bytes: number;
        softLimitBytes: number;
        hardLimitBytes: number;
        warningEmitted: boolean;
    }> {
        if (this.isEnabled()) {
            await this.ensureStorageReady();
        }

        return {
            bytes: this.storageState.knownBytes,
            softLimitBytes: this.audioStorageSoftLimitBytes,
            hardLimitBytes: this.audioStorageHardLimitBytes,
            warningEmitted: this.storageState.warningEmitted,
        };
    }

    private isEnabled(): boolean {
        return AI_NOTETAKER_ENABLED && AI_NOTETAKER_BOT_INGESTION_ENABLED;
    }

    private createLivekitService(): LiveKitService | undefined {
        if (!LIVEKIT_HOST || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
            return undefined;
        }

        try {
            return new LiveKitService(LIVEKIT_HOST, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_HOST);
        } catch (error) {
            console.error("[AI Notetaker Bot] Failed to initialize LiveKit service for bot ingestion", { error });
            return undefined;
        }
    }

    private ensureWebsocketServer(): void {
        if (this.websocketServer) {
            return;
        }

        this.websocketServer = new WebSocketServer({
            host: AI_NOTETAKER_BOT_INGESTION_WS_HOST,
            port: AI_NOTETAKER_BOT_INGESTION_WS_PORT,
        });

        this.websocketServer.on("connection", (socket, request) => {
            this.handleConnection(socket, request);
        });

        this.websocketServer.on("error", (error) => {
            console.error("[AI Notetaker Bot] WebSocket server error", { error });
        });

        console.info("[AI Notetaker Bot] Ingestion WebSocket server started", {
            host: AI_NOTETAKER_BOT_INGESTION_WS_HOST,
            port: AI_NOTETAKER_BOT_INGESTION_WS_PORT,
        });
    }

    private async scheduleSessionSync(sessionId: string): Promise<void> {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) {
            return;
        }

        if (runtime.syncInProgress) {
            runtime.syncRequested = true;
            return;
        }

        runtime.syncInProgress = true;

        try {
            do {
                runtime.syncRequested = false;
                await this.syncSessionTracks(runtime);
            } while (runtime.syncRequested && this.sessions.has(sessionId));
        } finally {
            runtime.syncInProgress = false;
        }
    }

    private async syncSessionTracks(runtime: SessionRuntime): Promise<void> {
        if (!this.livekitService) {
            return;
        }

        let participants: ParticipantInfo[];
        try {
            participants = await this.livekitService.listParticipants(runtime.spaceName);
        } catch (error) {
            this.recordRuntimeError(runtime, "sync_list_participants", error);
            return;
        }

        const now = Date.now();
        const activeTracks = this.collectActiveAudioTracks(participants);
        let startedCount = 0;
        let stoppedCount = 0;

        for (const descriptor of activeTracks.values()) {
            if (runtime.tracksById.has(descriptor.trackId) || runtime.tracksStarting.has(descriptor.trackId)) {
                continue;
            }

            const retry = runtime.trackRetries.get(descriptor.trackId);
            if (retry && retry.nextRetryAtMs > now) {
                continue;
            }

            if (!this.canStartNewTrackRecording(runtime)) {
                continue;
            }

            const wsUrl = this.buildTrackIngestionUrl(runtime, descriptor);
            if (!wsUrl) {
                continue;
            }

            runtime.tracksStarting.add(descriptor.trackId);

            try {
                const egress = await this.livekitService.startTrackEgressToWebsocket(
                    runtime.spaceName,
                    descriptor.trackId,
                    wsUrl
                );

                runtime.tracksById.set(descriptor.trackId, {
                    trackId: descriptor.trackId,
                    egressId: egress.egressId,
                    speakerSpaceUserId: descriptor.speakerSpaceUserId,
                    speakerLabel: descriptor.speakerLabel,
                    startedAtMs: now,
                });
                runtime.trackRetries.delete(descriptor.trackId);
                startedCount += 1;

                this.emitRuntimeEvent({
                    sessionId: runtime.sessionId,
                    type: "track_ingestion_started",
                    payload: {
                        spaceName: runtime.spaceName,
                        trackId: descriptor.trackId,
                        speakerSpaceUserId: descriptor.speakerSpaceUserId,
                        egressId: egress.egressId,
                    },
                });
            } catch (error) {
                const retryState = this.computeRetryState(runtime.trackRetries.get(descriptor.trackId), error);
                runtime.trackRetries.set(descriptor.trackId, retryState);
                this.recordRuntimeError(runtime, "start_track_egress", error, {
                    trackId: descriptor.trackId,
                    speakerSpaceUserId: descriptor.speakerSpaceUserId,
                    retryInMs: Math.max(0, retryState.nextRetryAtMs - Date.now()),
                    retryAttempts: retryState.attempts,
                });
            } finally {
                runtime.tracksStarting.delete(descriptor.trackId);
            }
        }

        const activeTrackIds = new Set(activeTracks.keys());
        for (const [trackId, trackRuntime] of runtime.tracksById.entries()) {
            if (activeTrackIds.has(trackId)) {
                continue;
            }

            await this.stopTrackEgress(trackRuntime);
            runtime.tracksById.delete(trackId);
            runtime.trackRetries.delete(trackId);
            stoppedCount += 1;

            this.emitRuntimeEvent({
                sessionId: runtime.sessionId,
                type: "track_ingestion_stopped",
                payload: {
                    trackId,
                    speakerSpaceUserId: trackRuntime.speakerSpaceUserId,
                    reason: "track_not_active",
                },
            });
        }

        runtime.metrics.lastSyncAtMs = now;
        this.emitRuntimeEvent({
            sessionId: runtime.sessionId,
            type: "sync_tick",
            payload: {
                startedCount,
                stoppedCount,
                activeTrackCount: runtime.tracksById.size,
                retryingTrackCount: runtime.trackRetries.size,
                participantCount: participants.length,
            },
        });
    }

    private collectActiveAudioTracks(participants: ParticipantInfo[]): Map<string, SpeakerTrackDescriptor> {
        const tracks = new Map<string, SpeakerTrackDescriptor>();

        for (const participant of participants) {
            const speakerSpaceUserId = participant.identity?.trim();
            if (!speakerSpaceUserId) {
                continue;
            }

            const speakerLabel = participant.name?.trim() || participant.identity;
            for (const track of participant.tracks) {
                const descriptor = this.toSpeakerTrackDescriptor(track, speakerSpaceUserId, speakerLabel);
                if (!descriptor) {
                    continue;
                }

                tracks.set(descriptor.trackId, descriptor);
            }
        }

        return tracks;
    }

    private toSpeakerTrackDescriptor(
        track: TrackInfo | undefined,
        speakerSpaceUserId: string,
        speakerLabel?: string
    ): SpeakerTrackDescriptor | undefined {
        if (!track || !track.sid) {
            return undefined;
        }

        if (track.type !== TrackType.AUDIO || track.muted) {
            return undefined;
        }

        // Record/transcribe only meeting microphone audio. Screen-share audio is explicitly excluded.
        if (track.source !== TrackSource.MICROPHONE) {
            return undefined;
        }

        return {
            trackId: track.sid,
            speakerSpaceUserId,
            speakerLabel,
        };
    }

    private buildTrackIngestionUrl(runtime: SessionRuntime, descriptor: SpeakerTrackDescriptor): string | undefined {
        const baseUrl = AI_NOTETAKER_BOT_INGESTION_WS_PUBLIC_URL;
        if (!baseUrl) {
            this.recordRuntimeError(runtime, "build_ingestion_url", "Missing AI_NOTETAKER_BOT_INGESTION_WS_PUBLIC_URL");
            return undefined;
        }

        try {
            const url = new URL(baseUrl);
            url.searchParams.set("sessionId", runtime.sessionId);
            url.searchParams.set("trackId", descriptor.trackId);
            url.searchParams.set("speakerSpaceUserId", descriptor.speakerSpaceUserId);
            if (descriptor.speakerLabel) {
                url.searchParams.set("speakerLabel", descriptor.speakerLabel);
            }
            if (AI_NOTETAKER_BOT_INGESTION_TOKEN) {
                url.searchParams.set("token", AI_NOTETAKER_BOT_INGESTION_TOKEN);
            }

            return url.toString();
        } catch (error) {
            this.recordRuntimeError(runtime, "build_ingestion_url", error, { baseUrl });
            return undefined;
        }
    }

    private async stopTrackEgress(trackRuntime: TrackRuntime): Promise<void> {
        if (!this.livekitService) {
            return;
        }

        await this.livekitService.stopEgress(trackRuntime.egressId);
    }

    private handleConnection(socket: WebSocket, request: IncomingMessage): void {
        const parsed = this.parseConnectionParams(request.url);
        if (!parsed) {
            socket.close(1008, "Invalid AI notetaker ingestion query");
            return;
        }

        const sessionRuntime = this.sessions.get(parsed.sessionId);
        if (!sessionRuntime) {
            socket.close(1008, "Unknown notetaker session");
            return;
        }

        const activeTrackRuntime = sessionRuntime.tracksById.get(parsed.trackId);

        const defaultMimeType = AI_NOTETAKER_BOT_TRACK_MIME_TYPE ?? "audio/x-raw";
        const rawPcmFormat = this.parseRawPcmFormat(defaultMimeType);
        const artifactId = randomUUID();
        const artifactFilePath = join(
            this.audioStorageDir,
            `${parsed.sessionId}-${parsed.trackId}-${Date.now()}-${artifactId}.raw`
        );
        const artifactWriteStream = createWriteStream(artifactFilePath, { flags: "a" });

        const connectionRuntime: ConnectionRuntime = {
            sessionId: parsed.sessionId,
            trackId: parsed.trackId,
            speakerSpaceUserId: parsed.speakerSpaceUserId,
            speakerLabel: parsed.speakerLabel ?? activeTrackRuntime?.speakerLabel,
            mimeType: rawPcmFormat.mimeType,
            pcmSampleRate: rawPcmFormat.sampleRate,
            pcmChannelCount: rawPcmFormat.channelCount,
            flushTimer: undefined,
            artifactId,
            artifactFilePath,
            artifactByteCount: 0,
            artifactWriteStream,
            artifactStartedAtMs: undefined,
            artifactLastChunkAtMs: undefined,
            artifactFinalizedAt: undefined,
            closing: false,
        };

        this.connections.set(socket, connectionRuntime);

        artifactWriteStream.on("error", (error) => {
            this.recordRuntimeError(sessionRuntime, "artifact_write_error", error, {
                trackId: parsed.trackId,
                artifactId,
                filePath: artifactFilePath,
            });
        });

        socket.on("message", (payload, isBinary) => {
            this.handleConnectionMessage(socket, payload, isBinary);
        });

        socket.on("close", (code, reason) => {
            this.cleanupConnection(socket, true, {
                code,
                reason: Buffer.isBuffer(reason) ? reason.toString("utf-8") : String(reason ?? ""),
            });
        });

        socket.on("error", (error) => {
            const runtime = this.sessions.get(parsed.sessionId);
            if (runtime) {
                this.recordRuntimeError(runtime, "connection_error", error, {
                    trackId: parsed.trackId,
                });
            }
        });
    }

    private parseConnectionParams(rawUrl: string | undefined):
        | {
              sessionId: string;
              trackId: string;
              speakerSpaceUserId: string;
              speakerLabel?: string;
          }
        | undefined {
        if (!rawUrl) {
            return undefined;
        }

        try {
            const url = new URL(rawUrl, "ws://localhost");
            const sessionId = url.searchParams.get("sessionId")?.trim();
            const trackId = url.searchParams.get("trackId")?.trim();
            const speakerSpaceUserId = url.searchParams.get("speakerSpaceUserId")?.trim();
            const speakerLabel = url.searchParams.get("speakerLabel")?.trim() || undefined;
            const token = url.searchParams.get("token")?.trim();

            if (!sessionId || !trackId || !speakerSpaceUserId) {
                return undefined;
            }

            if (AI_NOTETAKER_BOT_INGESTION_TOKEN && token !== AI_NOTETAKER_BOT_INGESTION_TOKEN) {
                return undefined;
            }

            return {
                sessionId,
                trackId,
                speakerSpaceUserId,
                speakerLabel,
            };
        } catch {
            return undefined;
        }
    }


    private handleConnectionControlMessage(
        socket: WebSocket,
        payload: Buffer | ArrayBuffer | Buffer[] | string
    ): void {
        const runtime = this.connections.get(socket);
        if (!runtime) {
            return;
        }

        let messagePayload: string | undefined;
        if (typeof payload === "string") {
            messagePayload = payload;
        } else if (Buffer.isBuffer(payload)) {
            messagePayload = payload.toString("utf-8");
        } else if (Array.isArray(payload) && payload.length > 0) {
            messagePayload = Buffer.concat(payload.map((entry) => (Buffer.isBuffer(entry) ? entry : Buffer.from(entry)))).toString(
                "utf-8"
            );
        } else if (payload instanceof ArrayBuffer) {
            messagePayload = Buffer.from(payload).toString("utf-8");
        }

        if (!messagePayload) {
            return;
        }

        let decoded: { muted?: boolean; mime_type?: string } | undefined;
        try {
            decoded = JSON.parse(messagePayload) as { muted?: boolean; mime_type?: string };
        } catch {
            return;
        }

        if (typeof decoded.mime_type === "string" && decoded.mime_type.trim().length > 0) {
            const pcmFormat = this.parseRawPcmFormat(decoded.mime_type);
            runtime.mimeType = pcmFormat.mimeType;
            runtime.pcmSampleRate = pcmFormat.sampleRate;
            runtime.pcmChannelCount = pcmFormat.channelCount ?? runtime.pcmChannelCount;
        }

        if (decoded.muted === true) {
            // No-op: live chunk transcription is disabled in bot mode.
        }
    }

    private handleConnectionMessage(
        socket: WebSocket,
        payload: Buffer | ArrayBuffer | Buffer[] | string,
        isBinary: boolean
    ): void {
        const runtime = this.connections.get(socket);
        if (!runtime) {
            return;
        }

        if (!isBinary) {
            this.handleConnectionControlMessage(socket, payload);
            return;
        }

        const chunk = this.normalizeMessagePayload(payload);
        if (!chunk || chunk.length === 0) {
            return;
        }

        if (!this.writeChunkToArtifact(runtime, chunk)) {
            const sessionRuntime = this.sessions.get(runtime.sessionId);
            if (sessionRuntime) {
                this.recordRuntimeError(sessionRuntime, "artifact_storage_limit", "Audio storage hard limit reached", {
                    trackId: runtime.trackId,
                    artifactId: runtime.artifactId,
                    hardLimitBytes: this.audioStorageHardLimitBytes,
                });
            }

            runtime.closing = true;
            this.cleanupConnection(socket, false, {
                code: 1013,
                reason: "Audio storage hard limit reached",
            });
            socket.close(1013, "Audio storage hard limit reached");
            return;
        }

        const now = Date.now();
        runtime.artifactStartedAtMs = runtime.artifactStartedAtMs ?? now;
        runtime.artifactLastChunkAtMs = now;

        const sessionRuntime = this.sessions.get(runtime.sessionId);
        if (sessionRuntime) {
            sessionRuntime.metrics.bytesIngested += chunk.length;
        }
    }

    private normalizeMessagePayload(payload: Buffer | ArrayBuffer | Buffer[] | string): Buffer | undefined {
        if (Buffer.isBuffer(payload)) {
            return payload;
        }

        if (Array.isArray(payload)) {
            if (payload.length === 0) {
                return undefined;
            }
            return Buffer.concat(payload.map((entry) => (Buffer.isBuffer(entry) ? entry : Buffer.from(entry))));
        }

        if (payload instanceof ArrayBuffer) {
            return Buffer.from(payload);
        }

        return undefined;
    }

    private parseRawPcmFormat(mimeType: string): { mimeType: string; sampleRate: number; channelCount?: 1 | 2 } {
        const normalizedMimeType = mimeType.trim();
        const defaultSampleRate = 48000;
        const rateMatch = normalizedMimeType.match(/(?:^|;|\s)(?:rate|sample_rate)\s*=\s*(\d+)/i);
        const channelsMatch = normalizedMimeType.match(/(?:^|;|\s)channels\s*=\s*([12])/i);

        const sampleRate = rateMatch ? Number.parseInt(rateMatch[1], 10) : defaultSampleRate;
        const channelCount = channelsMatch ? (Number.parseInt(channelsMatch[1], 10) as 1 | 2) : undefined;

        return {
            mimeType: normalizedMimeType.length > 0 ? normalizedMimeType : "audio/x-raw",
            sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : defaultSampleRate,
            channelCount,
        };
    }

    private cleanupConnection(socket: WebSocket, _flushRemaining: boolean, closeMeta?: ConnectionCloseMeta): void {
        const runtime = this.connections.get(socket);
        if (!runtime) {
            return;
        }

        if (runtime.flushTimer) {
            clearInterval(runtime.flushTimer);
            runtime.flushTimer = undefined;
        }

        this.connections.delete(socket);
        void this.finalizeConnectionArtifact(runtime, closeMeta).finally(() => {
            if (!runtime.closing) {
                void this.handleUnexpectedTrackDisconnect(runtime, closeMeta);
            }
        });
    }

    private async handleUnexpectedTrackDisconnect(
        connectionRuntime: ConnectionRuntime,
        closeMeta?: ConnectionCloseMeta
    ): Promise<void> {
        const sessionRuntime = this.sessions.get(connectionRuntime.sessionId);
        if (!sessionRuntime) {
            return;
        }

        const trackRuntime = sessionRuntime.tracksById.get(connectionRuntime.trackId);
        if (!trackRuntime) {
            return;
        }

        await this.stopTrackEgress(trackRuntime);
        sessionRuntime.tracksById.delete(connectionRuntime.trackId);

        const retryState = this.computeRetryState(sessionRuntime.trackRetries.get(connectionRuntime.trackId), {
            message: `Track stream disconnected (code=${closeMeta?.code ?? "unknown"})`,
        });
        sessionRuntime.trackRetries.set(connectionRuntime.trackId, retryState);

        this.emitRuntimeEvent({
            sessionId: sessionRuntime.sessionId,
            type: "track_ingestion_stopped",
            payload: {
                trackId: connectionRuntime.trackId,
                speakerSpaceUserId: trackRuntime.speakerSpaceUserId,
                reason: "stream_disconnected",
                closeCode: closeMeta?.code,
                closeReason: closeMeta?.reason,
                retryInMs: Math.max(0, retryState.nextRetryAtMs - Date.now()),
            },
        });

        sessionRuntime.syncRequested = true;
        await this.scheduleSessionSync(sessionRuntime.sessionId);
    }

    private closeSessionConnections(sessionId: string): void {
        for (const [socket, runtime] of this.connections.entries()) {
            if (runtime.sessionId !== sessionId) {
                continue;
            }

            runtime.closing = true;
            this.cleanupConnection(socket, true, {
                code: 1000,
                reason: "Session stopped",
            });
            socket.close(1000, "Session stopped");
        }
    }

    private async ensureStorageReady(): Promise<void> {
        if (this.storageInitialized) {
            return;
        }

        await mkdir(this.audioStorageDir, { recursive: true });
        this.storageState.knownBytes = await this.computeDirectorySize(this.audioStorageDir);
        this.storageInitialized = true;
    }

    private async computeDirectorySize(directoryPath: string): Promise<number> {
        let total = 0;

        let entries: Dirent[];
        try {
            entries = await readdir(directoryPath, { withFileTypes: true });
        } catch {
            return 0;
        }

        for (const entry of entries) {
            const fullPath = join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                total += await this.computeDirectorySize(fullPath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            try {
                const fileStat = await stat(fullPath);
                total += fileStat.size;
            } catch {
                // Ignore transient stat failures.
            }
        }

        return total;
    }

    private canStartNewTrackRecording(runtime: SessionRuntime): boolean {
        if (this.storageState.knownBytes >= this.audioStorageHardLimitBytes) {
            this.emitRuntimeEvent({
                sessionId: runtime.sessionId,
                type: "storage_limit",
                payload: {
                    knownBytes: this.storageState.knownBytes,
                    hardLimitBytes: this.audioStorageHardLimitBytes,
                },
            });
            return false;
        }

        if (!this.storageState.warningEmitted && this.storageState.knownBytes >= this.audioStorageSoftLimitBytes) {
            this.storageState.warningEmitted = true;
            this.emitRuntimeEvent({
                sessionId: runtime.sessionId,
                type: "storage_warning",
                payload: {
                    knownBytes: this.storageState.knownBytes,
                    softLimitBytes: this.audioStorageSoftLimitBytes,
                    hardLimitBytes: this.audioStorageHardLimitBytes,
                },
            });
        } else if (this.storageState.warningEmitted && this.storageState.knownBytes < this.audioStorageSoftLimitBytes * 0.9) {
            this.storageState.warningEmitted = false;
        }

        return true;
    }

    private writeChunkToArtifact(runtime: ConnectionRuntime, chunk: Buffer): boolean {
        if (!runtime.artifactWriteStream) {
            return false;
        }

        if (this.storageState.knownBytes + chunk.length > this.audioStorageHardLimitBytes) {
            const sessionRuntime = this.sessions.get(runtime.sessionId);
            if (sessionRuntime) {
                this.emitRuntimeEvent({
                    sessionId: sessionRuntime.sessionId,
                    type: "storage_limit",
                    payload: {
                        knownBytes: this.storageState.knownBytes,
                        hardLimitBytes: this.audioStorageHardLimitBytes,
                        pendingChunkBytes: chunk.length,
                    },
                });
            }
            return false;
        }

        runtime.artifactWriteStream.write(chunk);
        runtime.artifactByteCount += chunk.length;
        this.storageState.knownBytes += chunk.length;

        const sessionRuntime = this.sessions.get(runtime.sessionId);
        if (
            sessionRuntime &&
            !this.storageState.warningEmitted &&
            this.storageState.knownBytes >= this.audioStorageSoftLimitBytes
        ) {
            this.storageState.warningEmitted = true;
            this.emitRuntimeEvent({
                sessionId: sessionRuntime.sessionId,
                type: "storage_warning",
                payload: {
                    knownBytes: this.storageState.knownBytes,
                    softLimitBytes: this.audioStorageSoftLimitBytes,
                    hardLimitBytes: this.audioStorageHardLimitBytes,
                },
            });
        }

        return true;
    }

    private async finalizeConnectionArtifact(runtime: ConnectionRuntime, closeMeta?: ConnectionCloseMeta): Promise<void> {
        if (runtime.artifactFinalizedAt) {
            return;
        }

        runtime.artifactFinalizedAt = new Date();

        const writeStream = runtime.artifactWriteStream;
        runtime.artifactWriteStream = undefined;
        if (writeStream) {
            await new Promise<void>((resolve) => {
                writeStream.once("error", () => resolve());
                writeStream.end(() => resolve());
            });
        }

        let finalBytes = runtime.artifactByteCount;
        try {
            const fileStat = await stat(runtime.artifactFilePath);
            finalBytes = fileStat.size;
        } catch {
            finalBytes = 0;
        }

        const adjustment = finalBytes - runtime.artifactByteCount;
        if (adjustment !== 0) {
            this.storageState.knownBytes = Math.max(0, this.storageState.knownBytes + adjustment);
            runtime.artifactByteCount = finalBytes;
        }

        let status: "recorded" | "failed" = "recorded";
        let error: string | undefined;

        if (finalBytes <= 0) {
            status = "failed";
            error = "Artifact has no data";
            try {
                await unlink(runtime.artifactFilePath);
            } catch {
                // ignore
            }
        }

        const payload: FinalizedArtifactPayload = {
            artifactId: runtime.artifactId,
            trackId: runtime.trackId,
            speakerSpaceUserId: runtime.speakerSpaceUserId,
            speakerLabel: runtime.speakerLabel,
            mimeType: runtime.mimeType,
            sampleRate: runtime.pcmSampleRate,
            channelCount: runtime.pcmChannelCount,
            filePath: runtime.artifactFilePath,
            bytes: Math.max(0, finalBytes),
            createdAt: runtime.artifactFinalizedAt.toISOString(),
            startedAtMs: runtime.artifactStartedAtMs,
            endedAtMs: runtime.artifactLastChunkAtMs,
            status,
            error,
        };

        this.emitRuntimeEvent({
            sessionId: runtime.sessionId,
            type: "artifact_finalized",
            payload: {
                ...payload,
                closeCode: closeMeta?.code,
                closeReason: closeMeta?.reason,
            },
        });
    }

    private computeRetryState(previous: TrackRetryState | undefined, error: unknown): TrackRetryState {
        const attempts = (previous?.attempts ?? 0) + 1;
        const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(6, attempts - 1));

        return {
            attempts,
            nextRetryAtMs: Date.now() + delayMs,
            lastError: this.toErrorMessage(error),
        };
    }

    private recordRuntimeError(
        runtime: SessionRuntime,
        operation: string,
        error: unknown,
        payload: Record<string, unknown> = {}
    ): void {
        runtime.metrics.lastErrorAtMs = Date.now();
        runtime.metrics.lastErrorMessage = this.toErrorMessage(error);

        this.emitRuntimeEvent({
            sessionId: runtime.sessionId,
            type: "error",
            payload: {
                operation,
                ...payload,
                message: runtime.metrics.lastErrorMessage,
            },
        });

        console.error("[AI Notetaker Bot] Runtime error", {
            sessionId: runtime.sessionId,
            spaceName: runtime.spaceName,
            operation,
            ...payload,
            error,
        });
    }

    private toErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        if (typeof error === "string") {
            return error;
        }

        return "Unknown error";
    }

    private emitRuntimeEvent(event: NotetakerBotRuntimeEvent): void {
        if (!this.callbacks.onRuntimeEvent) {
            return;
        }

        void this.callbacks.onRuntimeEvent(event).catch((error) => {
            console.error("[AI Notetaker Bot] Failed to forward runtime event", {
                sessionId: event.sessionId,
                type: event.type,
                error,
            });
        });
    }
}
