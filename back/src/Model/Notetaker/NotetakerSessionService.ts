import { randomUUID } from "crypto";
import { readFile, unlink } from "fs/promises";
import {
    AI_NOTETAKER_ALLOW_ADMIN_READ_ALL,
    AI_NOTETAKER_EMAIL_DIGEST_ENABLED,
    AI_NOTETAKER_ENABLED,
    AI_NOTETAKER_IDLE_AUTO_STOP_MS,
    AI_NOTETAKER_IDLE_WARNING_MS,
    AI_NOTETAKER_MAINTENANCE_INTERVAL_MS,
    AI_NOTETAKER_PARTICIPANT_TIMEOUT_MS,
    AI_NOTETAKER_PERMISSION_POLICY,
    AI_NOTETAKER_STARTER_MUST_STAY,
    AI_NOTETAKER_SUMMARY_REFRESH_SEGMENTS,
    AI_NOTETAKER_SUMMARY_RETENTION_DAYS,
    AI_NOTETAKER_TRANSCRIPT_RETENTION_DAYS,
    AI_NOTETAKER_ALLOWED_TAGS,
    AI_NOTETAKER_AUDIO_RETENTION_FAILED_HOURS,
    AI_NOTETAKER_AUDIO_RETENTION_SUCCESS_HOURS,
    AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES,
    AI_NOTETAKER_AUDIO_STORAGE_SOFT_LIMIT_BYTES,
    AI_NOTETAKER_POST_MEETING_TRANSCRIPTION_ENABLED,
} from "../../Enum/EnvironmentVariable";
import { notetakerDeliveryQueueService } from "./NotetakerDeliveryQueueService";
import { mistralMeetingNotesService } from "./MistralMeetingNotesService";
import { NotetakerBotIngestionService, type NotetakerBotRuntimeEvent } from "./NotetakerBotIngestionService";
import { notetakerPersistenceService } from "./NotetakerPersistenceService";
import type {
    NotetakerActor,
    NotetakerAuditEventType,
    NotetakerSessionStopReason,
    NotetakerParticipantSnapshot,
    NotetakerSession,
    NotetakerSessionConfig,
    NotetakerSessionStatus,
    NotetakerSummary,
    NotetakerSummaryVersion,
    NotetakerAudioArtifact,
    TranscriptSegment,
    TranscriptSegmentInput,
} from "./NotetakerTypes";

type RuntimeStopReason = "manual_stop" | "auto_stop" | "room_empty_auto_stop" | "starter_left_auto_stop";

interface StartSessionInput {
    spaceName: string;
    startedBy: NotetakerActor;
    roomId?: string;
    language?: string;
}

interface PresenceUpdateInput {
    sessionId: string;
    participant: NotetakerActor;
    markSpeechDetected?: boolean;
}

interface AttendanceEventInput {
    spaceName: string;
    actor: NotetakerActor;
    eventType: "join" | "leave" | "heartbeat";
    occurredAt?: Date;
}

interface StopSessionInput {
    sessionId: string;
    actor?: NotetakerActor;
    reason?: RuntimeStopReason;
    languageHint?: string;
}

interface ShareSessionInput {
    sessionId: string;
    actor: NotetakerActor;
    userIds: string[];
}

interface NotetakerShareCandidate {
    userId: string;
    displayName?: string;
    email?: string;
    tags: string[];
    joinedAt?: Date;
    lastSeenAt?: Date;
    isCurrentSessionParticipant?: boolean;
}

interface FinalizedArtifactRuntimePayload {
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
    startedAtMs?: number;
    endedAtMs?: number;
    status: "recorded" | "failed";
    error?: string;
}

interface SessionAccessContext {
    actor?: NotetakerActor;
    allowSystemBypass?: boolean;
}

const ACTIVE_SESSION_STATUSES: NotetakerSessionStatus[] = ["starting", "active", "idle-warning", "stopping"];

export class NotetakerSessionService {
    private readonly sessionsById = new Map<string, NotetakerSession>();
    private readonly botIngestionService: NotetakerBotIngestionService;
    private configCache: NotetakerSessionConfig | undefined;
    private operationQueue: Promise<void> = Promise.resolve();
    private maintenanceQueue: Promise<void> = Promise.resolve();
    private maintenanceTimer: NodeJS.Timeout | undefined;
    private maintenanceTickCount = 0;
    private readonly lastBotSyncAuditAtBySession = new Map<string, number>();
    private readonly postMeetingProcessingSessions = new Set<string>();
    private postMeetingProcessingQueue: Promise<void> = Promise.resolve();
    private configSource: "env_defaults" | "persisted" = "env_defaults";

    constructor() {
        this.botIngestionService = new NotetakerBotIngestionService({
            onRuntimeEvent: async (event) => {
                await this.handleBotRuntimeEvent(event);
            },
        });

        if (AI_NOTETAKER_ENABLED) {
            this.startMaintenanceLoop();
        }
    }

    public getConfigSource(): "env_defaults" | "persisted" {
        return this.configSource;
    }

    public getMistralConfigurationStatus(): { configured: boolean } {
        return {
            configured: mistralMeetingNotesService.isConfigured(),
        };
    }

    public async getOperationalMetrics(): Promise<{
        audioStorageBytes: number;
        audioStorageSoftLimitBytes: number;
        audioStorageHardLimitBytes: number;
        audioStoragePercent: number;
        artifactsPending: number;
        artifactsFailed: number;
        artifactsDeleted: number;
        postMeetingJobsQueued: number;
    }> {
        let storageSnapshot: {
            bytes: number;
            softLimitBytes: number;
            hardLimitBytes: number;
            warningEmitted: boolean;
        } = {
            bytes: 0,
            softLimitBytes: AI_NOTETAKER_AUDIO_STORAGE_SOFT_LIMIT_BYTES,
            hardLimitBytes: AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES,
            warningEmitted: false,
        };
        let sessions: NotetakerSession[] = [];

        try {
            [storageSnapshot, sessions] = await Promise.all([
                this.botIngestionService.getStorageSnapshot(),
                notetakerPersistenceService.listSessions(),
            ]);
        } catch (error) {
            console.error("Failed to compute AI notetaker operational metrics", { error });
        }

        let artifactsPending = 0;
        let artifactsFailed = 0;
        let artifactsDeleted = 0;

        for (const session of sessions) {
            for (const artifact of session.audioArtifacts ?? []) {
                if (artifact.status === "recorded") {
                    artifactsPending += 1;
                } else if (artifact.status === "failed") {
                    artifactsFailed += 1;
                } else if (artifact.status === "deleted") {
                    artifactsDeleted += 1;
                }
            }
        }

        const audioStoragePercent =
            storageSnapshot.hardLimitBytes > 0
                ? Math.min(100, (storageSnapshot.bytes / storageSnapshot.hardLimitBytes) * 100)
                : 0;

        return {
            audioStorageBytes: storageSnapshot.bytes,
            audioStorageSoftLimitBytes: storageSnapshot.softLimitBytes,
            audioStorageHardLimitBytes: storageSnapshot.hardLimitBytes,
            audioStoragePercent,
            artifactsPending,
            artifactsFailed,
            artifactsDeleted,
            postMeetingJobsQueued: this.postMeetingProcessingSessions.size,
        };
    }

    public async getConfig(): Promise<NotetakerSessionConfig> {
        const persisted = await notetakerPersistenceService.getConfig();
        if (persisted) {
            this.configSource = "persisted";
            this.configCache = this.normalizeConfig(persisted);
            return this.configCache;
        }

        if (!this.configCache) {
            this.configSource = "env_defaults";
            this.configCache = this.getDefaultConfig();
            await this.safeSaveConfig(this.configCache);
        }

        return this.configCache;
    }

    public async updateConfig(partialConfig: Partial<NotetakerSessionConfig>): Promise<NotetakerSessionConfig> {
        return this.runSerialized(async () => {
            const current = await this.getConfig();
            const merged = this.normalizeConfig({
                ...current,
                ...partialConfig,
            });

            this.configSource = "persisted";
            this.configCache = merged;
            await this.safeSaveConfig(merged);
            return merged;
        });
    }

    public async startSession(input: StartSessionInput): Promise<NotetakerSession> {
        return this.runSerialized(async () => {
            const config = await this.getConfig();
            this.assertCanManageSession(config, input.startedBy);

            const existingSession = await this.getActiveSessionForSpace(input.spaceName, {
                allowSystemBypass: true,
            });
            if (existingSession) {
                await this.touchParticipant(existingSession, input.startedBy, false);
                await this.botIngestionService.startSession(existingSession);
                return existingSession;
            }

            const now = new Date();
            const session: NotetakerSession = {
                id: randomUUID(),
                roomId: input.roomId,
                spaceName: input.spaceName,
                startedByUserId: input.startedBy.userId,
                ownerUserId: input.startedBy.userId,
                sharedWithUserIds: [],
                sharingStatus: "private_pending",
                startedAt: now,
                status: "starting",
                visibilityPolicy: "participants-only",
                language: input.language,
                segments: [],
                summaries: [],
                participants: [],
                auditEvents: [],
                audioArtifacts: [],
                lastSummaryRefreshSegmentCount: 0,
            };

            await this.touchParticipant(session, input.startedBy, false);
            this.pushAuditEvent(session, "start", input.startedBy.userId, {
                roomId: input.roomId,
                permissionPolicy: config.permissionPolicy,
            });
            this.setSessionStatus(session, "active");

            this.cacheSession(session);
            await this.persistSession(session);
            await this.safeSetActiveSession(input.spaceName, session.id);
            await this.botIngestionService.startSession(session);

            return session;
        });
    }

    public async addTranscriptSegment(
        sessionId: string,
        segmentInput: TranscriptSegmentInput,
        actor?: NotetakerActor
    ): Promise<NotetakerSession> {
        return this.runSerialized(async () => {
            const session = await this.getSessionOrThrow(sessionId);

            if (!ACTIVE_SESSION_STATUSES.includes(session.status)) {
                throw new Error(`Session ${sessionId} is not active`);
            }

            const normalizedSegmentInput = this.normalizeTranscriptSegmentInput(session, segmentInput, actor);

            if (this.isDuplicateSegment(session, normalizedSegmentInput)) {
                return session;
            }

            const segment: TranscriptSegment = {
                id: randomUUID(),
                createdAt: new Date(),
                ...normalizedSegmentInput,
            };

            session.segments.push(segment);
            session.lastSpeechAt = new Date();

            if (actor) {
                await this.touchParticipant(session, actor, false);
            }

            if (session.status === "idle-warning") {
                this.clearIdleWarningState(session);
                this.pushAuditEvent(session, "warning_cleared", actor?.userId, {
                    reason: "speech_resumed",
                });
            }

            this.pushAuditEvent(session, "speech_detected", actor?.userId, {
                speakerSpaceUserId: segment.speakerSpaceUserId,
                speakerLabel: segment.speakerLabel,
            });

            await this.maybeRefreshSummary(session, false);

            this.cacheSession(session);
            await this.persistSession(session);

            return session;
        });
    }

    private normalizeTranscriptSegmentInput(
        session: NotetakerSession,
        segmentInput: TranscriptSegmentInput,
        actor?: NotetakerActor
    ): TranscriptSegmentInput {
        const speakerSpaceUserId = segmentInput.speakerSpaceUserId ?? actor?.userId;
        const participantLabel = speakerSpaceUserId
            ? session.participants.find((participant) => participant.userId === speakerSpaceUserId)?.displayName
            : undefined;

        const normalizedSpeakerLabel =
            segmentInput.speakerLabel?.trim() || actor?.displayName?.trim() || participantLabel?.trim() || undefined;

        return {
            ...segmentInput,
            speakerSpaceUserId,
            speakerLabel: normalizedSpeakerLabel,
        };
    }

    private isDuplicateSegment(session: NotetakerSession, candidate: TranscriptSegmentInput): boolean {
        const previous = session.segments.at(-1);
        if (!previous) {
            return false;
        }

        if (previous.text.trim() !== candidate.text.trim()) {
            return false;
        }

        if (previous.speakerSpaceUserId !== candidate.speakerSpaceUserId) {
            return false;
        }

        if (previous.endedAtMs === undefined || candidate.endedAtMs === undefined) {
            return false;
        }

        return Math.abs(previous.endedAtMs - candidate.endedAtMs) <= 1500;
    }

    public async updateParticipantPresence(input: PresenceUpdateInput): Promise<NotetakerSession> {
        return this.runSerialized(async () => {
            const session = await this.getSessionOrThrow(input.sessionId);
            if (!ACTIVE_SESSION_STATUSES.includes(session.status)) {
                return session;
            }

            const isNew = await this.touchParticipant(session, input.participant, false);
            if (isNew) {
                this.pushAuditEvent(session, "participant_joined", input.participant.userId);
            }

            if (input.markSpeechDetected) {
                session.lastSpeechAt = new Date();
                if (session.status === "idle-warning") {
                    this.clearIdleWarningState(session);
                    this.pushAuditEvent(session, "warning_cleared", input.participant.userId, {
                        reason: "speech_resumed",
                    });
                }
            }

            this.cacheSession(session);
            await this.persistSession(session);
            return session;
        });
    }

    public async recordAttendanceEvent(input: AttendanceEventInput): Promise<{ handled: boolean; sessionId?: string }> {
        return this.runSerialized(async () => {
            const session = await this.getActiveSessionForSpace(input.spaceName, { allowSystemBypass: true });
            if (!session || !ACTIVE_SESSION_STATUSES.includes(session.status)) {
                return { handled: false };
            }

            const eventTimestamp = input.occurredAt ?? new Date();
            if (input.eventType === "leave") {
                const participant = session.participants.find(
                    (candidate) =>
                        this.normalizeShareRecipientId(candidate.userId) === this.normalizeShareRecipientId(input.actor.userId)
                );
                if (!participant) {
                    return { handled: true, sessionId: session.id };
                }

                participant.lastSeenAt = eventTimestamp;
                participant.leftAt = eventTimestamp;
                this.pushAuditEvent(session, "participant_left", input.actor.userId, {
                    source: "server_attendance_event",
                });
            } else {
                const isNew = await this.touchParticipant(session, input.actor, false, eventTimestamp);
                if (isNew || input.eventType === "join") {
                    this.pushAuditEvent(session, "participant_joined", input.actor.userId, {
                        source: "server_attendance_event",
                        eventType: input.eventType,
                    });
                }
            }

            this.cacheSession(session);
            await this.persistSession(session);
            return {
                handled: true,
                sessionId: session.id,
            };
        });
    }

    public async markParticipantLeft(sessionId: string, actor: NotetakerActor): Promise<NotetakerSession> {
        return this.runSerialized(async () => {
            const session = await this.getSessionOrThrow(sessionId);
            const participant = session.participants.find(
                (candidate) => this.normalizeShareRecipientId(candidate.userId) === this.normalizeShareRecipientId(actor.userId)
            );
            if (!participant) {
                return session;
            }

            participant.lastSeenAt = new Date();
            participant.leftAt = new Date();
            this.pushAuditEvent(session, "participant_left", actor.userId);

            this.cacheSession(session);
            await this.persistSession(session);
            return session;
        });
    }

    public async keepRunning(sessionId: string, actor: NotetakerActor): Promise<NotetakerSession> {
        return this.runSerialized(async () => {
            const session = await this.getSessionOrThrow(sessionId);
            const config = await this.getConfig();
            this.assertCanManageSession(config, actor);

            await this.touchParticipant(session, actor, false);
            session.lastSpeechAt = new Date();
            this.clearIdleWarningState(session);
            this.pushAuditEvent(session, "keep_running", actor.userId);

            this.cacheSession(session);
            await this.persistSession(session);
            return session;
        });
    }

    public async stopSession(input: StopSessionInput): Promise<NotetakerSession> {
        return this.runSerialized(async () => {
            const session = await this.getSessionOrThrow(input.sessionId);
            const config = await this.getConfig();

            if (input.actor) {
                await this.touchParticipant(session, input.actor, false);
                this.assertCanStopSession(config, session, input.actor);
            }

            const reason = input.reason ?? "manual_stop";
            return this.stopSessionInternal(session, reason, input.actor?.userId, input.languageHint);
        });
    }

    public async shareSession(input: ShareSessionInput): Promise<NotetakerSession> {
        return this.runSerialized(async () => {
            const session = await this.getSessionOrThrow(input.sessionId);
            const config = await this.getConfig();
            this.assertCanManageSharing(config, session, input.actor);
            const ownerUserId = this.normalizeShareRecipientId(this.getOwnerUserId(session));
            const normalizedShareIds = Array.from(
                new Set(
                    input.userIds
                        .map((userId) => this.normalizeShareRecipientId(userId))
                        .filter((userId) => userId.length > 0 && userId !== ownerUserId)
                )
            ).sort((left, right) => left.localeCompare(right));

            const sharingChanged =
                normalizedShareIds.length !== session.sharedWithUserIds.length ||
                normalizedShareIds.some((userId, index) => session.sharedWithUserIds[index] !== userId);

            if (!sharingChanged) {
                return session;
            }

            session.sharedWithUserIds = normalizedShareIds;
            if (normalizedShareIds.length === 0) {
                session.sharingStatus = "private_pending";
                session.sharedAt = undefined;
                session.sharedByUserId = undefined;
                this.pushAuditEvent(session, "sharing_cleared", input.actor.userId);
            } else {
                session.sharingStatus = "shared";
                session.sharedAt = new Date();
                session.sharedByUserId = input.actor.userId;
                this.pushAuditEvent(session, "sharing_updated", input.actor.userId, {
                    recipientCount: normalizedShareIds.length,
                });
            }

            this.cacheSession(session);
            await this.persistSession(session);
            return session;
        });
    }

    public async removeSelfFromSharedSession(sessionId: string, actor: NotetakerActor): Promise<void> {
        await this.runSerialized(async () => {
            const session = await this.getSessionOrThrow(sessionId);
            const config = await this.getConfig();

            const actorUserId = this.normalizeShareRecipientId(actor.userId);
            const ownerUserId = this.getOwnerUserId(session);

            if (actorUserId === ownerUserId) {
                throw new Error("Session owner cannot remove themselves from their own library.");
            }

            if (!this.canReadSession(config, session, actor)) {
                throw new Error("You are not authorized to update this AI notes sharing.");
            }

            if (!session.sharedWithUserIds.includes(actorUserId)) {
                return;
            }

            session.sharedWithUserIds = session.sharedWithUserIds.filter((userId) => userId !== actorUserId);

            if (session.sharedWithUserIds.length === 0) {
                session.sharingStatus = "private_pending";
                session.sharedAt = undefined;
                session.sharedByUserId = undefined;
                this.pushAuditEvent(session, "sharing_cleared", actor.userId, {
                    reason: "recipient_self_removed",
                });
            } else {
                this.pushAuditEvent(session, "sharing_updated", actor.userId, {
                    recipientCount: session.sharedWithUserIds.length,
                    removedSelf: true,
                });
            }

            this.cacheSession(session);
            await this.persistSession(session);
        });
    }

    public async getSessionShareCandidates(sessionId: string, actor: NotetakerActor): Promise<NotetakerShareCandidate[]> {
        const session = await this.getSessionOrThrow(sessionId);
        const config = await this.getConfig();
        this.assertCanManageSharing(config, session, actor);
        const ownerUserId = this.normalizeShareRecipientId(this.getOwnerUserId(session));
        const candidateByUserId = new Map<string, NotetakerShareCandidate>();
        const addCandidate = (
            userId: string,
            displayName?: string,
            email?: string,
            tags: string[] = [],
            joinedAt?: Date,
            lastSeenAt?: Date,
            options: { currentSession?: boolean } = {}
        ): void => {
            const normalizedUserId = this.normalizeShareRecipientId(userId);
            if (!normalizedUserId || normalizedUserId === ownerUserId) {
                return;
            }

            const existing = candidateByUserId.get(normalizedUserId);
            if (!existing) {
                candidateByUserId.set(normalizedUserId, {
                    userId: normalizedUserId,
                    displayName,
                    email,
                    tags: this.normalizeTags(tags),
                    joinedAt,
                    lastSeenAt,
                    isCurrentSessionParticipant: options.currentSession === true,
                });
                return;
            }

            existing.displayName = existing.displayName || displayName;
            existing.email = existing.email || email;
            existing.tags = this.normalizeTags([...existing.tags, ...tags]);
            if (options.currentSession && joinedAt) {
                existing.joinedAt = joinedAt;
            } else if (!existing.joinedAt || (joinedAt && joinedAt.getTime() > existing.joinedAt.getTime())) {
                existing.joinedAt = joinedAt;
            }
            if (!existing.lastSeenAt || (lastSeenAt && lastSeenAt.getTime() > existing.lastSeenAt.getTime())) {
                existing.lastSeenAt = lastSeenAt;
            }
            existing.isCurrentSessionParticipant = existing.isCurrentSessionParticipant || options.currentSession === true;
        };

        for (const participant of session.participants) {
            addCandidate(
                participant.userId,
                participant.displayName,
                participant.email,
                participant.tags,
                participant.joinedAt,
                participant.lastSeenAt,
                { currentSession: true }
            );
        }

        const relatedSessions = await notetakerPersistenceService.listSessions(session.spaceName);
        for (const relatedSession of relatedSessions) {
            if (relatedSession.id === session.id) {
                continue;
            }
            this.normalizeSession(relatedSession);
            for (const participant of relatedSession.participants) {
                addCandidate(
                    participant.userId,
                    participant.displayName,
                    participant.email,
                    participant.tags,
                    participant.joinedAt,
                    participant.lastSeenAt
                );
            }
        }

        for (const sharedUserId of session.sharedWithUserIds) {
            addCandidate(sharedUserId);
        }

        return Array.from(candidateByUserId.values()).sort((left, right) => {
            if (left.isCurrentSessionParticipant !== right.isCurrentSessionParticipant) {
                return left.isCurrentSessionParticipant ? -1 : 1;
            }

            const leftSeenAt = left.lastSeenAt?.getTime() ?? 0;
            const rightSeenAt = right.lastSeenAt?.getTime() ?? 0;
            if (leftSeenAt !== rightSeenAt) {
                return rightSeenAt - leftSeenAt;
            }

            return left.userId.localeCompare(right.userId);
        });
    }

    public async getSessionShares(sessionId: string, actor: NotetakerActor): Promise<NotetakerShareCandidate[]> {
        const session = await this.getSessionOrThrow(sessionId);
        const config = await this.getConfig();
        this.assertCanManageSharing(config, session, actor);

        const participantsById = new Map(session.participants.map((participant) => [participant.userId, participant]));

        return session.sharedWithUserIds.map((userId) => {
            const participant = participantsById.get(userId);
            return {
                userId,
                displayName: participant?.displayName,
                email: participant?.email,
                tags: participant?.tags ?? [],
                joinedAt: participant?.joinedAt,
                lastSeenAt: participant?.lastSeenAt,
            };
        });
    }

    public async deleteSession(sessionId: string, actor: NotetakerActor): Promise<void> {
        await this.runSerialized(async () => {
            const session = await this.getSessionOrThrow(sessionId);
            const config = await this.getConfig();

            const isOwner = this.getOwnerUserId(session) === this.normalizeShareRecipientId(actor.userId);
            const isAdminOverride = this.isAdminReadOverride(config, actor);

            if (!isOwner && !isAdminOverride) {
                throw new Error("You are not authorized to delete this AI notetaker session.");
            }

            if (ACTIVE_SESSION_STATUSES.includes(session.status)) {
                await this.stopSessionInternal(session, "manual_stop", actor.userId);
            }

            const participantIds = Array.from(new Set(session.participants.map((participant) => participant.userId)));

            await this.safeDeleteSession(session.id, session.spaceName, participantIds);
            await this.safeClearActiveSession(session.spaceName, session.id);
            this.sessionsById.delete(session.id);

            this.lastBotSyncAuditAtBySession.delete(session.id);
            this.postMeetingProcessingSessions.delete(session.id);
        });
    }

    public async getSession(
        sessionId: string,
        context: SessionAccessContext = { allowSystemBypass: true }
    ): Promise<NotetakerSession | undefined> {
        const session = await this.getSessionFromCacheOrPersistence(sessionId);
        if (!session) {
            return undefined;
        }

        if (context.allowSystemBypass) {
            return session;
        }

        const config = await this.getConfig();
        if (this.canReadSession(config, session, context.actor)) {
            return session;
        }

        return undefined;
    }

    public async exportSessionRecording(
        sessionId: string,
        context: SessionAccessContext = { allowSystemBypass: true }
    ): Promise<{ buffer: Buffer; filename: string; includedArtifacts: number; skippedArtifacts: number }> {
        const session = await this.getSession(sessionId, context);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const sourceArtifacts = session.audioArtifacts
            .filter((artifact) => artifact.status !== "deleted" && artifact.bytes > 0)
            .sort((left, right) =>
                this.resolveArtifactStartEpochMs(session, left) - this.resolveArtifactStartEpochMs(session, right)
            );

        if (sourceArtifacts.length === 0) {
            throw new Error("No audio artifacts available for this session.");
        }

        const outputSampleRate = 16_000;
        const preparedArtifacts: Array<{ startSample: number; samples: Int16Array }> = [];
        let skippedArtifacts = 0;
        let maxOutputSampleCount = 0;

        for (const artifact of sourceArtifacts) {
            let payload: Buffer;
            try {
                payload = await readFile(artifact.filePath);
            } catch {
                skippedArtifacts += 1;
                continue;
            }

            const prepared = this.prepareArtifactForTranscription(artifact, payload);
            const pcmPayload = this.extractPcmS16leFromWav(prepared.buffer);
            if (!pcmPayload || pcmPayload.length < 2) {
                skippedArtifacts += 1;
                continue;
            }

            const sampleCount = Math.floor(pcmPayload.length / 2);
            if (sampleCount <= 0) {
                skippedArtifacts += 1;
                continue;
            }

            const samples = new Int16Array(sampleCount);
            for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
                samples[sampleIndex] = pcmPayload.readInt16LE(sampleIndex * 2);
            }

            const artifactStartEpochMs = this.resolveArtifactStartEpochMs(session, artifact);
            const relativeStartMs = Math.max(0, artifactStartEpochMs - session.startedAt.getTime());
            const startSample = Math.floor((relativeStartMs * outputSampleRate) / 1000);

            preparedArtifacts.push({
                startSample,
                samples,
            });

            maxOutputSampleCount = Math.max(maxOutputSampleCount, startSample + samples.length);
        }

        if (preparedArtifacts.length === 0 || maxOutputSampleCount <= 0) {
            throw new Error("No supported audio artifacts were available for export.");
        }

        const mixedSamples = new Int32Array(maxOutputSampleCount);
        for (const artifact of preparedArtifacts) {
            for (let sampleIndex = 0; sampleIndex < artifact.samples.length; sampleIndex += 1) {
                mixedSamples[artifact.startSample + sampleIndex] += artifact.samples[sampleIndex];
            }
        }

        let peak = 1;
        for (const sample of mixedSamples) {
            const magnitude = Math.abs(sample);
            if (magnitude > peak) {
                peak = magnitude;
            }
        }

        const gain = peak > 32767 ? 32767 / peak : 1;
        const outputPcm = Buffer.alloc(maxOutputSampleCount * 2);
        for (let sampleIndex = 0; sampleIndex < mixedSamples.length; sampleIndex += 1) {
            const amplified = Math.round(mixedSamples[sampleIndex] * gain);
            const clamped = Math.max(-32768, Math.min(32767, amplified));
            outputPcm.writeInt16LE(clamped, sampleIndex * 2);
        }

        const safeSpaceName = session.spaceName.replace(/[^a-zA-Z0-9-_]/g, "_");
        return {
            buffer: this.wrapPcmS16leInWav(outputPcm, outputSampleRate, 1),
            filename: `ai-notes-recording-${safeSpaceName}-${session.id}.wav`,
            includedArtifacts: preparedArtifacts.length,
            skippedArtifacts,
        };
    }

    public async listSessions(
        options: {
            spaceName?: string;
            actor?: NotetakerActor;
            includeActiveOnly?: boolean;
            allowSystemBypass?: boolean;
        } = { allowSystemBypass: true }
    ): Promise<NotetakerSession[]> {
        const config = await this.getConfig();

        const sessions = await notetakerPersistenceService.listSessions(options.spaceName);

        for (const session of sessions) {
            this.normalizeSession(session);
            this.cacheSession(session);
        }

        const filteredBySpace = options.spaceName
            ? sessions.filter((session) => session.spaceName === options.spaceName)
            : sessions;

        const filteredByAcl = options.allowSystemBypass
            ? filteredBySpace
            : filteredBySpace.filter((session) => this.canReadSession(config, session, options.actor));

        const filteredByStatus = options.includeActiveOnly
            ? filteredByAcl.filter((session) => ACTIVE_SESSION_STATUSES.includes(session.status))
            : filteredByAcl;

        return filteredByStatus.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    }

    public async getActiveSessionForSpace(
        spaceName: string,
        context: SessionAccessContext = { allowSystemBypass: true }
    ): Promise<NotetakerSession | undefined> {
        const activeSessionId = await notetakerPersistenceService.getActiveSessionId(spaceName);
        if (activeSessionId) {
            const persistedSession = await this.getSession(activeSessionId, {
                ...context,
                allowSystemBypass: true,
            });
            if (persistedSession && ACTIVE_SESSION_STATUSES.includes(persistedSession.status)) {
                if (context.allowSystemBypass) {
                    return persistedSession;
                }

                const config = await this.getConfig();
                if (this.canReadSession(config, persistedSession, context.actor)) {
                    return persistedSession;
                }
            }
        }

        return undefined;
    }

    private async stopSessionInternal(
        session: NotetakerSession,
        reason: RuntimeStopReason,
        actorUserId?: string,
        languageHint?: string
    ): Promise<NotetakerSession> {
        if (session.status === "stopped" || session.status === "failed") {
            await this.botIngestionService.stopSession(session.id);
            return session;
        }

        this.setSessionStatus(session, "stopping");
        await this.botIngestionService.stopSession(session.id);

        try {
            await this.refreshSummary(session, true, languageHint);
            this.setSessionStatus(session, "stopped");
            session.stoppedAt = new Date();
            session.stopActorUserId = actorUserId;
            session.stopReason = this.toSessionStopReason(reason);
            await this.safeClearActiveSession(session.spaceName, session.id);
            this.pushAuditEvent(session, reason, actorUserId);

            if (reason === "manual_stop" && actorUserId && actorUserId === this.getOwnerUserId(session)) {
                this.pushAuditEvent(session, "sharing_prompted_on_owner_stop", actorUserId);
            }

            const config = await this.getConfig();
            if (config.emailDigestEnabled) {
                await this.safeEnqueueDigest(session);
            }
        } catch (error) {
            this.setSessionStatus(session, "failed");
            session.errorMessage = error instanceof Error ? error.message : "Unexpected error while stopping session";
            session.stoppedAt = new Date();
            session.stopActorUserId = actorUserId;
            session.stopReason = this.toSessionStopReason(reason);
            await this.safeClearActiveSession(session.spaceName, session.id);
            this.pushAuditEvent(session, "error", actorUserId, {
                operation: "stop_session",
                message: session.errorMessage,
            });
        }

        this.cacheSession(session);
        await this.persistSession(session);

        if (!ACTIVE_SESSION_STATUSES.includes(session.status)) {
            this.lastBotSyncAuditAtBySession.delete(session.id);
            this.postMeetingProcessingSessions.delete(session.id);
        }

        this.enqueuePostMeetingProcessing(session.id, languageHint);

        return session;
    }

    private async handleBotRuntimeEvent(event: NotetakerBotRuntimeEvent): Promise<void> {
        await this.runSerialized(async () => {
            const session = await this.getSessionFromCacheOrPersistence(event.sessionId);
            if (!session) {
                return;
            }

            const shouldThrottleSyncEvent = event.type === "sync_tick";
            if (shouldThrottleSyncEvent) {
                const now = Date.now();
                const previous = this.lastBotSyncAuditAtBySession.get(session.id) ?? 0;
                if (now - previous < 60_000) {
                    return;
                }

                this.lastBotSyncAuditAtBySession.set(session.id, now);
            }

            if (event.type === "artifact_finalized") {
                const artifactPayload = this.parseFinalizedArtifactPayload(event.payload);
                if (artifactPayload) {
                    this.upsertAudioArtifact(session, artifactPayload);
                    this.pushAuditEvent(session, "artifact_recorded", undefined, {
                        artifactId: artifactPayload.artifactId,
                        trackId: artifactPayload.trackId,
                        speakerSpaceUserId: artifactPayload.speakerSpaceUserId,
                        bytes: artifactPayload.bytes,
                        status: artifactPayload.status,
                        error: artifactPayload.error,
                    });
                }
            } else if (event.type === "artifact_deleted") {
                const artifactId =
                    typeof event.payload?.artifactId === "string" && event.payload.artifactId.length > 0
                        ? event.payload.artifactId
                        : undefined;
                if (artifactId) {
                    const artifact = session.audioArtifacts.find((candidate) => candidate.id === artifactId);
                    if (artifact) {
                        artifact.status = "deleted";
                        artifact.deletedAt = new Date();
                    }
                }
                this.pushAuditEvent(session, "artifact_deleted", undefined, {
                    ...(event.payload ?? {}),
                });
            }

            this.pushAuditEvent(session, "bot_runtime", undefined, {
                type: event.type,
                ...(event.payload ?? {}),
            });

            this.cacheSession(session);
            await this.persistSession(session);
        });
    }

    private parseFinalizedArtifactPayload(
        payload: Record<string, unknown> | undefined
    ): FinalizedArtifactRuntimePayload | undefined {
        if (!payload) {
            return undefined;
        }

        const artifactId = typeof payload.artifactId === "string" ? payload.artifactId : undefined;
        const trackId = typeof payload.trackId === "string" ? payload.trackId : undefined;
        const speakerSpaceUserId =
            typeof payload.speakerSpaceUserId === "string" ? payload.speakerSpaceUserId : undefined;
        const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : undefined;
        const filePath = typeof payload.filePath === "string" ? payload.filePath : undefined;
        const createdAt = typeof payload.createdAt === "string" ? payload.createdAt : undefined;
        const bytes = typeof payload.bytes === "number" ? payload.bytes : undefined;
        const status = payload.status === "recorded" || payload.status === "failed" ? payload.status : undefined;

        if (
            !artifactId ||
            !trackId ||
            !speakerSpaceUserId ||
            !mimeType ||
            !filePath ||
            !createdAt ||
            typeof bytes !== "number" ||
            !status
        ) {
            return undefined;
        }

        return {
            artifactId,
            trackId,
            speakerSpaceUserId,
            speakerLabel: typeof payload.speakerLabel === "string" ? payload.speakerLabel : undefined,
            mimeType,
            sampleRate: typeof payload.sampleRate === "number" ? payload.sampleRate : undefined,
            channelCount: payload.channelCount === 1 || payload.channelCount === 2 ? payload.channelCount : undefined,
            filePath,
            bytes,
            createdAt,
            startedAtMs: typeof payload.startedAtMs === "number" ? payload.startedAtMs : undefined,
            endedAtMs: typeof payload.endedAtMs === "number" ? payload.endedAtMs : undefined,
            status,
            error: typeof payload.error === "string" ? payload.error : undefined,
        };
    }

    private upsertAudioArtifact(session: NotetakerSession, payload: FinalizedArtifactRuntimePayload): void {
        const createdAtDate = new Date(payload.createdAt);
        const safeCreatedAt = Number.isNaN(createdAtDate.getTime()) ? new Date() : createdAtDate;

        const existing = session.audioArtifacts.find((artifact) => artifact.id === payload.artifactId);
        if (existing) {
            existing.trackId = payload.trackId;
            existing.speakerSpaceUserId = payload.speakerSpaceUserId;
            existing.speakerLabel = payload.speakerLabel;
            existing.mimeType = payload.mimeType;
            existing.sampleRate = payload.sampleRate;
            existing.channelCount = payload.channelCount;
            existing.filePath = payload.filePath;
            existing.bytes = payload.bytes;
            existing.startedAtMs = payload.startedAtMs;
            existing.endedAtMs = payload.endedAtMs;
            existing.status = payload.status;
            existing.lastError = payload.error;
            return;
        }

        session.audioArtifacts.push({
            id: payload.artifactId,
            trackId: payload.trackId,
            speakerSpaceUserId: payload.speakerSpaceUserId,
            speakerLabel: payload.speakerLabel,
            mimeType: payload.mimeType,
            sampleRate: payload.sampleRate,
            channelCount: payload.channelCount,
            filePath: payload.filePath,
            bytes: payload.bytes,
            createdAt: safeCreatedAt,
            startedAtMs: payload.startedAtMs,
            endedAtMs: payload.endedAtMs,
            status: payload.status,
            lastError: payload.error,
        });
    }

    private enqueuePostMeetingProcessing(sessionId: string, languageHint?: string): void {
        if (!AI_NOTETAKER_POST_MEETING_TRANSCRIPTION_ENABLED || !mistralMeetingNotesService.isConfigured()) {
            return;
        }

        if (this.postMeetingProcessingSessions.has(sessionId)) {
            return;
        }

        this.postMeetingProcessingSessions.add(sessionId);

        const run = this.postMeetingProcessingQueue.then(
            async () => {
                await this.processPostMeetingArtifacts(sessionId, languageHint);
            },
            async () => {
                await this.processPostMeetingArtifacts(sessionId, languageHint);
            }
        );

        this.postMeetingProcessingQueue = run.then(
            () => undefined,
            () => undefined
        );

        void run.finally(() => {
            this.postMeetingProcessingSessions.delete(sessionId);
        });
    }

    private async processPostMeetingArtifacts(sessionId: string, languageHint?: string): Promise<void> {
        await this.runSerialized(async () => {
            try {
                const session = await this.getSessionFromCacheOrPersistence(sessionId);
                if (!session) {
                    return;
                }

                if (ACTIVE_SESSION_STATUSES.includes(session.status)) {
                    return;
                }

                const sessionChanged = await this.runPostMeetingTranscription(session, languageHint);
                if (!sessionChanged) {
                    return;
                }

                if (session.segments.length > 0) {
                    await this.refreshSummary(session, true, languageHint);
                }

                this.cacheSession(session);
                await this.persistSession(session);
            } catch (error) {
                console.error("Failed post-meeting transcription processing", {
                    sessionId,
                    error,
                });
            }
        });
    }

    private async runPostMeetingTranscription(session: NotetakerSession, languageHint?: string): Promise<boolean> {
        if (!AI_NOTETAKER_POST_MEETING_TRANSCRIPTION_ENABLED) {
            return false;
        }

        if (!mistralMeetingNotesService.isConfigured()) {
            return false;
        }

        const candidates = session.audioArtifacts.filter((artifact) => artifact.status === "recorded");
        if (candidates.length === 0) {
            return false;
        }

        const generatedSegments: TranscriptSegment[] = [];
        let sessionChanged = false;

        for (const artifact of candidates) {
            let payload: Buffer;
            try {
                payload = await readFile(artifact.filePath);
            } catch (error) {
                artifact.status = "failed";
                artifact.lastError = error instanceof Error ? error.message : "Failed to read artifact file";
                sessionChanged = true;
                continue;
            }

            const preparedPayload = this.prepareArtifactForTranscription(artifact, payload);

            try {
                const transcript = await mistralMeetingNotesService.transcribeAudioChunk(
                    preparedPayload.buffer,
                    preparedPayload.mimeType,
                    languageHint ?? session.language,
                    this.buildTranscriptionContextBias(session, artifact)
                );

                if (!transcript || transcript.trim().length === 0) {
                    artifact.status = "failed";
                    artifact.lastError = "Transcription returned empty text";
                    sessionChanged = true;
                    continue;
                }

                artifact.status = "transcribed";
                artifact.transcribedAt = new Date();
                artifact.lastError = undefined;
                sessionChanged = true;

                generatedSegments.push({
                    id: randomUUID(),
                    createdAt: new Date(),
                    speakerSpaceUserId: artifact.speakerSpaceUserId,
                    speakerLabel: artifact.speakerLabel,
                    text: transcript.trim(),
                    startedAtMs: artifact.startedAtMs,
                    endedAtMs: artifact.endedAtMs,
                });
            } catch (error) {
                artifact.status = "failed";
                artifact.lastError = error instanceof Error ? error.message : "Post-meeting transcription failed";
                sessionChanged = true;
            }
        }

        if (generatedSegments.length > 0) {
            generatedSegments.sort((left, right) => {
                const leftStart = typeof left.startedAtMs === "number" ? left.startedAtMs : Number.MAX_SAFE_INTEGER;
                const rightStart = typeof right.startedAtMs === "number" ? right.startedAtMs : Number.MAX_SAFE_INTEGER;
                return leftStart - rightStart;
            });

            session.segments = generatedSegments;
            session.lastSummaryRefreshSegmentCount = 0;
            session.lastSpeechAt = new Date();
            sessionChanged = true;
        }

        return sessionChanged;
    }

    private buildTranscriptionContextBias(session: NotetakerSession, artifact: NotetakerAudioArtifact): string[] {
        const entries = new Set<string>();
        const addEntry = (rawValue?: string): void => {
            for (const token of this.normalizeTranscriptionContextBiasTokens(rawValue)) {
                entries.add(token);
            }
        };

        for (const participant of session.participants) {
            addEntry(participant.displayName);
            addEntry(participant.userId);
        }

        addEntry(artifact.speakerLabel);
        addEntry(artifact.speakerSpaceUserId);

        return Array.from(entries).slice(0, 50);
    }

    private normalizeTranscriptionContextBiasTokens(rawValue?: string): string[] {
        if (!rawValue) {
            return [];
        }

        const trimmed = rawValue.trim();
        if (trimmed.length === 0) {
            return [];
        }

        // Mistral rejects context_bias entries that contain whitespace or commas.
        return trimmed
            .split(/[\s,]+/g)
            .map((token) => token.trim())
            .filter((token) => token.length > 0);
    }

    private prepareArtifactForTranscription(
        artifact: NotetakerAudioArtifact,
        payload: Buffer
    ): { buffer: Buffer; mimeType: string } {
        if (!this.shouldTreatArtifactAsRawPcm(artifact.mimeType, payload)) {
            return {
                buffer: payload,
                mimeType: artifact.mimeType,
            };
        }

        const channelCount = this.resolveRawPcmChannelCount(artifact, payload);
        const sampleRate =
            typeof artifact.sampleRate === "number" && Number.isFinite(artifact.sampleRate) && artifact.sampleRate > 0
                ? artifact.sampleRate
                : 48000;

        const monoPayload = this.convertToMonoPcmS16le(payload, channelCount);
        const normalizedPayload = this.normalizePcmS16leLevel(monoPayload);
        const resampled = this.resamplePcmS16le(normalizedPayload, sampleRate, 16000);
        return {
            buffer: this.wrapPcmS16leInWav(resampled, 16000, 1),
            mimeType: "audio/wav",
        };
    }

    private shouldTreatArtifactAsRawPcm(mimeType: string, payload: Buffer): boolean {
        const normalizedMimeType = mimeType.toLowerCase();

        if (this.looksLikeOgg(payload) || this.looksLikeWebm(payload) || this.looksLikeWav(payload)) {
            return false;
        }

        return normalizedMimeType.includes("x-raw") || normalizedMimeType.includes("pcm");
    }

    private resolveRawPcmChannelCount(artifact: NotetakerAudioArtifact, payload: Buffer): 1 | 2 {
        if (artifact.channelCount === 1 || artifact.channelCount === 2) {
            return artifact.channelCount;
        }

        if (payload.length < 8) {
            return 1;
        }

        const frameCount = Math.min(48_000, Math.floor(payload.length / 4));
        if (frameCount <= 0) {
            return 1;
        }

        let absoluteAmplitudeTotal = 0;
        let channelDifferenceTotal = 0;

        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
            const offset = frameIndex * 4;
            const left = payload.readInt16LE(offset);
            const right = payload.readInt16LE(offset + 2);

            absoluteAmplitudeTotal += Math.abs(left) + Math.abs(right);
            channelDifferenceTotal += Math.abs(left - right);
        }

        if (absoluteAmplitudeTotal <= 0) {
            return 1;
        }

        const channelDifferenceRatio = (channelDifferenceTotal * 2) / absoluteAmplitudeTotal;
        return channelDifferenceRatio < 0.25 ? 2 : 1;
    }

    private looksLikeOgg(payload: Buffer): boolean {
        return payload.length >= 4 && payload.subarray(0, 4).equals(Buffer.from("OggS"));
    }

    private looksLikeWebm(payload: Buffer): boolean {
        return (
            payload.length >= 4 &&
            payload[0] === 0x1a &&
            payload[1] === 0x45 &&
            payload[2] === 0xdf &&
            payload[3] === 0xa3
        );
    }

    private looksLikeWav(payload: Buffer): boolean {
        return payload.length >= 12 && payload.subarray(0, 4).equals(Buffer.from("RIFF"));
    }

    private convertToMonoPcmS16le(rawPcmPayload: Buffer, inputChannelCount: 1 | 2): Buffer {
        if (inputChannelCount === 1) {
            return Buffer.from(rawPcmPayload);
        }

        const frameSize = inputChannelCount * 2;
        const frameCount = Math.floor(rawPcmPayload.length / frameSize);
        if (frameCount <= 0) {
            return Buffer.alloc(0);
        }

        const monoBuffer = Buffer.alloc(frameCount * 2);
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
            const frameOffset = frameIndex * frameSize;
            const left = rawPcmPayload.readInt16LE(frameOffset);
            const right = rawPcmPayload.readInt16LE(frameOffset + 2);
            const mixed = Math.max(-32768, Math.min(32767, Math.round((left + right) / 2)));
            monoBuffer.writeInt16LE(mixed, frameIndex * 2);
        }

        return monoBuffer;
    }

    private normalizePcmS16leLevel(monoPcmPayload: Buffer): Buffer {
        const sampleCount = Math.floor(monoPcmPayload.length / 2);
        if (sampleCount <= 0) {
            return monoPcmPayload;
        }

        let squaredSum = 0;
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
            const sample = monoPcmPayload.readInt16LE(sampleIndex * 2);
            squaredSum += sample * sample;
        }

        const rms = Math.sqrt(squaredSum / sampleCount);
        if (!Number.isFinite(rms) || rms <= 0) {
            return monoPcmPayload;
        }

        const targetRms = 9_000;
        const maxGain = 8;
        const minUsefulRms = 600;
        if (rms >= targetRms || rms < minUsefulRms) {
            return monoPcmPayload;
        }

        const gain = Math.min(maxGain, targetRms / rms);
        if (gain <= 1.01) {
            return monoPcmPayload;
        }

        const normalized = Buffer.alloc(monoPcmPayload.length);
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
            const sample = monoPcmPayload.readInt16LE(sampleIndex * 2);
            const amplified = Math.round(sample * gain);
            const clamped = Math.max(-32768, Math.min(32767, amplified));
            normalized.writeInt16LE(clamped, sampleIndex * 2);
        }

        return normalized;
    }

    private resamplePcmS16le(monoPcmPayload: Buffer, inputSampleRate: number, outputSampleRate: number): Buffer {
        if (inputSampleRate === outputSampleRate) {
            return monoPcmPayload;
        }

        const inputSampleCount = Math.floor(monoPcmPayload.length / 2);
        if (inputSampleCount <= 0) {
            return Buffer.alloc(0);
        }

        const outputSampleCount = Math.max(1, Math.floor((inputSampleCount * outputSampleRate) / inputSampleRate));
        const outputBuffer = Buffer.alloc(outputSampleCount * 2);
        const step = inputSampleRate / outputSampleRate;

        for (let outputIndex = 0; outputIndex < outputSampleCount; outputIndex += 1) {
            const sourcePosition = outputIndex * step;
            const sourceIndex = Math.floor(sourcePosition);
            const nextSourceIndex = Math.min(inputSampleCount - 1, sourceIndex + 1);
            const interpolationRatio = sourcePosition - sourceIndex;

            const first = monoPcmPayload.readInt16LE(Math.min(sourceIndex, inputSampleCount - 1) * 2);
            const second = monoPcmPayload.readInt16LE(nextSourceIndex * 2);
            const interpolated = Math.round(first + (second - first) * interpolationRatio);
            const clamped = Math.max(-32768, Math.min(32767, interpolated));

            outputBuffer.writeInt16LE(clamped, outputIndex * 2);
        }

        return outputBuffer;
    }

    private wrapPcmS16leInWav(pcmBuffer: Buffer, sampleRate: number, channelCount: number): Buffer {
        const bitsPerSample = 16;
        const byteRate = sampleRate * channelCount * (bitsPerSample / 8);
        const blockAlign = channelCount * (bitsPerSample / 8);
        const header = Buffer.alloc(44);

        header.write("RIFF", 0);
        header.writeUInt32LE(36 + pcmBuffer.length, 4);
        header.write("WAVE", 8);
        header.write("fmt ", 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(channelCount, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(byteRate, 28);
        header.writeUInt16LE(blockAlign, 32);
        header.writeUInt16LE(bitsPerSample, 34);
        header.write("data", 36);
        header.writeUInt32LE(pcmBuffer.length, 40);

        return Buffer.concat([header, pcmBuffer], 44 + pcmBuffer.length);
    }

    private async maybeRefreshSummary(session: NotetakerSession, isFinal: boolean): Promise<void> {
        if (isFinal) {
            await this.refreshSummary(session, true);
            return;
        }

        if (AI_NOTETAKER_SUMMARY_REFRESH_SEGMENTS <= 0) {
            return;
        }

        const segmentDelta = session.segments.length - session.lastSummaryRefreshSegmentCount;
        if (segmentDelta < AI_NOTETAKER_SUMMARY_REFRESH_SEGMENTS) {
            return;
        }

        await this.refreshSummary(session, false);
    }

    private async refreshSummary(session: NotetakerSession, isFinal: boolean, languageHint?: string): Promise<void> {
        const transcript = this.formatTranscript(session.segments);

        let summary: NotetakerSummary;
        try {
            summary = await mistralMeetingNotesService.generateSummary(transcript, languageHint ?? session.language);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Summary generation failed";
            this.pushAuditEvent(session, "error", undefined, {
                operation: "summary_generation",
                message,
            });

            summary = this.createEmergencySummary(transcript);
        }

        const version = this.getNextSummaryVersion(session.summaries);
        const summaryVersion: NotetakerSummaryVersion = {
            ...summary,
            version,
            final: isFinal,
            createdAt: new Date(),
        };

        session.summaries.push(summaryVersion);
        session.lastSummaryRefreshAt = new Date();
        session.lastSummaryRefreshSegmentCount = session.segments.length;
        this.pushAuditEvent(session, "summary_updated", undefined, {
            version,
            final: isFinal,
        });
    }

    private createEmergencySummary(transcript: string): NotetakerSummary {
        const lines = transcript
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, 10);

        if (lines.length === 0) {
            return {
                summaryMarkdown: "No transcript content was captured for this session.",
                decisions: [],
                actionItems: [],
            };
        }

        return {
            summaryMarkdown: `## Session Notes\n\n${lines.map((line) => `- ${line}`).join("\n")}`,
            decisions: [],
            actionItems: [],
        };
    }

    private getNextSummaryVersion(summaries: NotetakerSummaryVersion[]): number {
        if (summaries.length === 0) {
            return 1;
        }

        return summaries[summaries.length - 1].version + 1;
    }

    private formatTranscript(segments: TranscriptSegment[]): string {
        return segments
            .map((segment) => {
                const speaker = segment.speakerLabel?.trim() ? segment.speakerLabel.trim() : "Unknown speaker";
                return `${speaker}: ${segment.text.trim()}`;
            })
            .join("\n");
    }

    private resolveArtifactStartEpochMs(session: NotetakerSession, artifact: NotetakerAudioArtifact): number {
        if (typeof artifact.startedAtMs === "number" && Number.isFinite(artifact.startedAtMs)) {
            return artifact.startedAtMs;
        }

        return artifact.createdAt.getTime() >= session.startedAt.getTime()
            ? artifact.createdAt.getTime()
            : session.startedAt.getTime();
    }

    private extractPcmS16leFromWav(wavPayload: Buffer): Buffer | undefined {
        if (wavPayload.length < 44) {
            return undefined;
        }

        if (
            !wavPayload.subarray(0, 4).equals(Buffer.from("RIFF")) ||
            !wavPayload.subarray(8, 12).equals(Buffer.from("WAVE"))
        ) {
            return undefined;
        }

        let offset = 12;
        let dataStart: number | undefined;
        let dataLength = 0;

        while (offset + 8 <= wavPayload.length) {
            const chunkId = wavPayload.subarray(offset, offset + 4).toString("ascii");
            const chunkSize = wavPayload.readUInt32LE(offset + 4);
            const chunkDataStart = offset + 8;
            const chunkDataEnd = chunkDataStart + chunkSize;

            if (chunkDataEnd > wavPayload.length) {
                return undefined;
            }

            if (chunkId === "fmt ") {
                if (chunkSize < 16) {
                    return undefined;
                }

                const audioFormat = wavPayload.readUInt16LE(chunkDataStart);
                const channelCount = wavPayload.readUInt16LE(chunkDataStart + 2);
                const bitsPerSample = wavPayload.readUInt16LE(chunkDataStart + 14);

                if (audioFormat !== 1 || bitsPerSample !== 16 || channelCount !== 1) {
                    return undefined;
                }
            } else if (chunkId === "data") {
                dataStart = chunkDataStart;
                dataLength = chunkSize;
                break;
            }

            offset = chunkDataEnd + (chunkSize % 2);
        }

        if (dataStart === undefined || dataLength <= 0) {
            return undefined;
        }

        return Buffer.from(wavPayload.subarray(dataStart, dataStart + dataLength));
    }

    private async getSessionOrThrow(sessionId: string): Promise<NotetakerSession> {
        const session = await this.getSessionFromCacheOrPersistence(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        return session;
    }

    private async getSessionFromCacheOrPersistence(sessionId: string): Promise<NotetakerSession | undefined> {
        const cached = this.sessionsById.get(sessionId);
        if (cached) {
            this.normalizeSession(cached);
            return cached;
        }

        const persisted = await notetakerPersistenceService.getSession(sessionId);
        if (persisted) {
            this.normalizeSession(persisted);
            this.cacheSession(persisted);
            return persisted;
        }

        return undefined;
    }

    private cacheSession(session: NotetakerSession): void {
        this.sessionsById.set(session.id, session);
    }

    private setSessionStatus(session: NotetakerSession, status: NotetakerSessionStatus): void {
        session.status = status;
    }

    private clearIdleWarningState(session: NotetakerSession): void {
        session.idleWarningAt = undefined;
        session.idleWarningDeadlineAt = undefined;
        if (session.status === "idle-warning") {
            this.setSessionStatus(session, "active");
        }
    }

    private async touchParticipant(
        session: NotetakerSession,
        actor: NotetakerActor,
        isLeaving: boolean,
        referenceTime: Date = new Date()
    ): Promise<boolean> {
        const now = referenceTime;
        const tags = this.normalizeTags(actor.tags);
        const normalizedActorUserId = this.normalizeShareRecipientId(actor.userId);
        const existing = session.participants.find(
            (participant) => this.normalizeShareRecipientId(participant.userId) === normalizedActorUserId
        );

        if (!existing) {
            const participant: NotetakerParticipantSnapshot = {
                userId: normalizedActorUserId || actor.userId,
                displayName: actor.displayName,
                email: actor.email,
                tags,
                joinedAt: now,
                lastSeenAt: now,
                leftAt: isLeaving ? now : undefined,
            };
            session.participants.push(participant);
            return true;
        }

        existing.displayName = actor.displayName ?? existing.displayName;
        existing.email = actor.email ?? existing.email;
        existing.tags = tags.length > 0 ? tags : existing.tags;
        existing.lastSeenAt = now;
        existing.leftAt = isLeaving ? now : undefined;

        return false;
    }

    private pushAuditEvent(
        session: NotetakerSession,
        eventType: NotetakerAuditEventType,
        actorUserId?: string,
        payload?: Record<string, unknown>
    ): void {
        session.auditEvents.push({
            id: randomUUID(),
            eventType,
            actorUserId,
            payload,
            createdAt: new Date(),
        });

        if (session.auditEvents.length > 200) {
            session.auditEvents = session.auditEvents.slice(-200);
        }
    }

    private assertCanManageSession(config: NotetakerSessionConfig, actor: NotetakerActor): void {
        if (config.permissionPolicy === "all_users") {
            return;
        }

        if (actor.tags.includes("admin")) {
            return;
        }

        if (config.allowedTags.length === 0) {
            throw new Error("AI notetaker start/stop is restricted and no authorized tags are configured.");
        }

        const hasAllowedTag = actor.tags.some((tag) => config.allowedTags.includes(tag));
        if (!hasAllowedTag) {
            throw new Error("You are not authorized to start or stop AI notetaker in this room.");
        }
    }

    private assertCanManageSharing(
        config: NotetakerSessionConfig,
        session: NotetakerSession,
        actor: NotetakerActor
    ): void {
        if (this.isAdminReadOverride(config, actor)) {
            return;
        }

        if (this.normalizeShareRecipientId(actor.userId) !== this.getOwnerUserId(session)) {
            throw new Error("Only the session owner can manage sharing.");
        }
    }

    private assertCanStopSession(config: NotetakerSessionConfig, session: NotetakerSession, actor: NotetakerActor): void {
        if (this.isAdminReadOverride(config, actor)) {
            return;
        }

        const ownerUserId = this.getOwnerUserId(session);
        if (this.normalizeShareRecipientId(actor.userId) === ownerUserId) {
            return;
        }

        if (!this.isParticipantActive(session, actor.userId)) {
            throw new Error("Only active meeting participants can stop this AI notes session.");
        }

        if (this.isParticipantActive(session, ownerUserId)) {
            throw new Error("Only the starter can stop this session while they are still present.");
        }
    }

    private canReadSession(config: NotetakerSessionConfig, session: NotetakerSession, actor?: NotetakerActor): boolean {
        if (!actor) {
            return false;
        }

        if (this.isAdminReadOverride(config, actor)) {
            return true;
        }

        const actorUserId = this.normalizeShareRecipientId(actor.userId);

        if (actorUserId === this.getOwnerUserId(session)) {
            return true;
        }

        return session.sharedWithUserIds.includes(actorUserId);
    }

    private isAdminReadOverride(config: NotetakerSessionConfig, actor: NotetakerActor): boolean {
        return config.allowAdminReadAll && actor.tags.includes("admin");
    }

    private getOwnerUserId(session: NotetakerSession): string {
        return this.normalizeShareRecipientId(session.ownerUserId || session.startedByUserId);
    }

    private isParticipantActive(session: NotetakerSession, userId: string, referenceTime: Date = new Date()): boolean {
        const normalizedUserId = this.normalizeShareRecipientId(userId);
        return this.getActiveParticipants(session, referenceTime).some(
            (participant) => this.normalizeShareRecipientId(participant.userId) === normalizedUserId
        );
    }

    private getActiveParticipants(
        session: NotetakerSession,
        referenceTime: Date = new Date()
    ): NotetakerParticipantSnapshot[] {
        const referenceEpoch = referenceTime.getTime();
        return session.participants.filter((participant) => {
            if (participant.leftAt) {
                return false;
            }

            return referenceEpoch - participant.lastSeenAt.getTime() <= AI_NOTETAKER_PARTICIPANT_TIMEOUT_MS;
        });
    }

    private normalizeSession(session: NotetakerSession): void {
        session.ownerUserId = session.ownerUserId || session.startedByUserId;
        const normalizedOwnerUserId = this.normalizeShareRecipientId(session.ownerUserId);
        session.ownerUserId = normalizedOwnerUserId || session.ownerUserId;
        session.audioArtifacts = session.audioArtifacts ?? [];
        session.sharedWithUserIds = Array.from(
            new Set(
                (session.sharedWithUserIds ?? [])
                    .map((userId) => this.normalizeShareRecipientId(userId))
                    .filter((userId) => userId.length > 0 && userId !== session.ownerUserId)
            )
        ).sort((left, right) => left.localeCompare(right));

        if (session.sharedWithUserIds.length > 0) {
            session.sharingStatus = "shared";
        } else {
            session.sharingStatus = "private_pending";
            session.sharedAt = undefined;
            session.sharedByUserId = undefined;
        }
    }

    private toSessionStopReason(reason: RuntimeStopReason): NotetakerSessionStopReason {
        if (reason === "auto_stop") {
            return "idle_auto_stop";
        }

        return reason;
    }

    private normalizeTags(tags: string[] | undefined): string[] {
        if (!tags) {
            return [];
        }

        return Array.from(new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)));
    }

    private normalizeShareRecipientId(userId: string): string {
        const normalized = userId.trim();
        if (!normalized) {
            return "";
        }

        return normalized.includes("@") ? normalized.toLowerCase() : normalized;
    }

    private normalizeConfig(config: NotetakerSessionConfig): NotetakerSessionConfig {
        const allowedTags = this.normalizeTags(config.allowedTags);

        return {
            permissionPolicy: config.permissionPolicy,
            allowedTags,
            emailDigestEnabled: config.emailDigestEnabled,
            starterMustStay: config.starterMustStay,
            allowAdminReadAll: config.allowAdminReadAll,
            transcriptRetentionDays: Math.max(1, Math.floor(config.transcriptRetentionDays)),
            summaryRetentionDays: Math.max(1, Math.floor(config.summaryRetentionDays)),
        };
    }

    private getDefaultConfig(): NotetakerSessionConfig {
        return {
            permissionPolicy: AI_NOTETAKER_PERMISSION_POLICY,
            allowedTags: this.normalizeTags(AI_NOTETAKER_ALLOWED_TAGS),
            emailDigestEnabled: AI_NOTETAKER_EMAIL_DIGEST_ENABLED,
            starterMustStay: AI_NOTETAKER_STARTER_MUST_STAY,
            allowAdminReadAll: AI_NOTETAKER_ALLOW_ADMIN_READ_ALL,
            transcriptRetentionDays: AI_NOTETAKER_TRANSCRIPT_RETENTION_DAYS,
            summaryRetentionDays: AI_NOTETAKER_SUMMARY_RETENTION_DAYS,
        };
    }

    private async persistSession(session: NotetakerSession): Promise<void> {
        try {
            await notetakerPersistenceService.saveSession(session);
        } catch (error) {
            console.error("Failed to persist AI notetaker session", {
                sessionId: session.id,
                error,
            });
        }
    }

    private async safeSetActiveSession(spaceName: string, sessionId: string): Promise<void> {
        try {
            await notetakerPersistenceService.setActiveSession(spaceName, sessionId);
        } catch (error) {
            console.error("Failed to persist AI notetaker active session mapping", {
                spaceName,
                sessionId,
                error,
            });
        }
    }

    private async safeClearActiveSession(spaceName: string, expectedSessionId?: string): Promise<void> {
        try {
            await notetakerPersistenceService.clearActiveSession(spaceName, expectedSessionId);
        } catch (error) {
            console.error("Failed to clear AI notetaker active session mapping", {
                spaceName,
                expectedSessionId,
                error,
            });
        }
    }

    private async safeDeleteSession(sessionId: string, spaceName: string, participantIds: string[]): Promise<void> {
        try {
            await notetakerPersistenceService.deleteSession(sessionId, spaceName, participantIds);
        } catch (error) {
            console.error("Failed to delete AI notetaker session", {
                sessionId,
                spaceName,
                participantIds,
                error,
            });
            throw error;
        }
    }

    private async safeSaveConfig(config: NotetakerSessionConfig): Promise<void> {
        try {
            await notetakerPersistenceService.saveConfig(config);
        } catch (error) {
            console.error("Failed to persist AI notetaker configuration", { error });
        }
    }

    private async safeEnqueueDigest(session: NotetakerSession): Promise<void> {
        try {
            await notetakerDeliveryQueueService.enqueueSessionDigest(session);
        } catch (error) {
            console.error("Failed to enqueue AI notetaker digest job", {
                sessionId: session.id,
                error,
            });
        }
    }

    private async runSerialized<T>(operation: () => Promise<T>): Promise<T> {
        let operationResult: T | undefined;
        const run = this.operationQueue.then(
            async () => {
                operationResult = await operation();
            },
            async () => {
                operationResult = await operation();
            }
        );

        this.operationQueue = run.then(
            () => undefined,
            () => undefined
        );

        await run;

        return operationResult as T;
    }

    private startMaintenanceLoop(): void {
        if (this.maintenanceTimer) {
            return;
        }

        this.maintenanceTimer = setInterval(() => {
            void this.runMaintenanceLoop();
        }, Math.max(5000, AI_NOTETAKER_MAINTENANCE_INTERVAL_MS));
    }

    private async runMaintenanceLoop(): Promise<void> {
        const run = this.maintenanceQueue.then(
            async () => {
                await this.performMaintenance();
            },
            async () => {
                await this.performMaintenance();
            }
        );

        this.maintenanceQueue = run.then(
            () => undefined,
            () => undefined
        );

        await run;
    }

    private async performMaintenance(): Promise<void> {
        if (!AI_NOTETAKER_ENABLED) {
            return;
        }

        const activeSessionIds = await notetakerPersistenceService.listActiveSessionIds();
        if (activeSessionIds.length === 0) {
            this.maintenanceTickCount += 1;
            if (this.maintenanceTickCount % 4 === 0) {
                await this.schedulePendingPostMeetingProcessing();
            }
            if (this.maintenanceTickCount % 20 === 0) {
                await this.cleanupExpiredData();
            }
            return;
        }

        const config = await this.getConfig();
        const now = new Date();

        for (const activeSessionId of activeSessionIds) {
            const session = await this.getSessionFromCacheOrPersistence(activeSessionId);
            if (!session) {
                continue;
            }

            if (ACTIVE_SESSION_STATUSES.includes(session.status)) {
                await this.botIngestionService.startSession(session);
            } else {
                await this.botIngestionService.stopSession(session.id);
            }

            let sessionChanged = false;
            const currentlyActiveParticipants = this.getActiveParticipants(session, now);

            if (ACTIVE_SESSION_STATUSES.includes(session.status) && currentlyActiveParticipants.length === 0) {
                await this.stopSessionInternal(session, "room_empty_auto_stop", undefined);
                continue;
            }

            if (config.starterMustStay && ACTIVE_SESSION_STATUSES.includes(session.status)) {
                const starterPresent = currentlyActiveParticipants.some(
                    (participant) => participant.userId === this.getOwnerUserId(session)
                );
                if (!starterPresent) {
                    await this.stopSessionInternal(session, "starter_left_auto_stop", undefined);
                    continue;
                }
            }

            if (session.status === "active" || session.status === "idle-warning") {
                const reference = session.lastSpeechAt ?? session.startedAt;
                const silenceDurationMs = now.getTime() - reference.getTime();

                if (session.status === "active" && silenceDurationMs >= AI_NOTETAKER_IDLE_WARNING_MS) {
                    this.setSessionStatus(session, "idle-warning");
                    session.idleWarningAt = now;
                    session.idleWarningDeadlineAt = new Date(now.getTime() + AI_NOTETAKER_IDLE_AUTO_STOP_MS);
                    this.pushAuditEvent(session, "warning_shown");
                    sessionChanged = true;
                } else if (
                    session.status === "idle-warning" &&
                    session.idleWarningDeadlineAt &&
                    now.getTime() >= session.idleWarningDeadlineAt.getTime()
                ) {
                    await this.stopSessionInternal(session, "auto_stop", undefined);
                    continue;
                }
            }

            if (sessionChanged) {
                this.cacheSession(session);
                await this.persistSession(session);
            }
        }

        this.maintenanceTickCount += 1;
        if (this.maintenanceTickCount % 4 === 0) {
            await this.schedulePendingPostMeetingProcessing();
        }
        if (this.maintenanceTickCount % 20 === 0) {
            await this.cleanupExpiredData();
        }
    }

    private async schedulePendingPostMeetingProcessing(): Promise<void> {
        let sessions: NotetakerSession[];
        try {
            sessions = await notetakerPersistenceService.listSessions();
        } catch (error) {
            console.error("Failed to list sessions while scheduling post-meeting processing", { error });
            return;
        }

        for (const session of sessions) {
            this.normalizeSession(session);
            if (ACTIVE_SESSION_STATUSES.includes(session.status)) {
                continue;
            }

            const hasPendingArtifacts = session.audioArtifacts.some((artifact) => artifact.status === "recorded");
            if (!hasPendingArtifacts) {
                continue;
            }

            this.cacheSession(session);
            this.enqueuePostMeetingProcessing(session.id, session.language);
        }
    }

    private async deleteSessionAudioArtifacts(session: NotetakerSession): Promise<void> {
        for (const artifact of session.audioArtifacts) {
            if (artifact.status === "deleted") {
                continue;
            }

            await this.deleteAudioArtifact(session, artifact, "session_delete");
        }
    }

    private async deleteAudioArtifact(
        session: NotetakerSession,
        artifact: NotetakerAudioArtifact,
        reason: string
    ): Promise<boolean> {
        if (artifact.status === "deleted") {
            return false;
        }

        try {
            await unlink(artifact.filePath);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown file deletion error";
            if (!message.toLowerCase().includes("enoent")) {
                artifact.lastError = message;
                return false;
            }
        }

        artifact.status = "deleted";
        artifact.deletedAt = new Date();
        artifact.lastError = undefined;

        this.pushAuditEvent(session, "artifact_deleted", undefined, {
            artifactId: artifact.id,
            bytes: artifact.bytes,
            reason,
        });

        return true;
    }

    private async cleanupExpiredData(): Promise<void> {
        const config = await this.getConfig();
        const sessions = await notetakerPersistenceService.listSessions();

        const now = Date.now();
        const transcriptRetentionMs = config.transcriptRetentionDays * 24 * 60 * 60 * 1000;
        const summaryRetentionMs = config.summaryRetentionDays * 24 * 60 * 60 * 1000;
        const successRetentionMs = AI_NOTETAKER_AUDIO_RETENTION_SUCCESS_HOURS * 60 * 60 * 1000;
        const failedRetentionMs = AI_NOTETAKER_AUDIO_RETENTION_FAILED_HOURS * 60 * 60 * 1000;

        const quotaCandidates: Array<{ sessionId: string; artifactId: string; createdAt: number; bytes: number }> = [];
        let retainedAudioBytes = 0;

        for (const session of sessions) {
            this.normalizeSession(session);
            let sessionChanged = false;

            if (session.stoppedAt) {
                const ageMs = now - session.stoppedAt.getTime();

                if (ageMs >= summaryRetentionMs) {
                    await this.deleteSessionAudioArtifacts(session);
                    await notetakerPersistenceService.deleteSession(
                        session.id,
                        session.spaceName,
                        session.participants.map((participant) => participant.userId)
                    );
                    this.sessionsById.delete(session.id);
                    this.lastBotSyncAuditAtBySession.delete(session.id);
                    this.postMeetingProcessingSessions.delete(session.id);
                    continue;
                }

                if (ageMs >= transcriptRetentionMs && session.segments.length > 0) {
                    session.segments = [];
                    this.pushAuditEvent(session, "summary_updated", undefined, {
                        reason: "transcript_retention_cleanup",
                    });
                    sessionChanged = true;
                }
            }

            for (const artifact of session.audioArtifacts) {
                if (artifact.status === "deleted") {
                    continue;
                }

                const ageMs = now - artifact.createdAt.getTime();
                const retentionMs =
                    artifact.status === "failed" || artifact.status === "recorded"
                        ? failedRetentionMs
                        : successRetentionMs;
                if (ageMs >= retentionMs) {
                    const deleted = await this.deleteAudioArtifact(session, artifact, "retention_cleanup");
                    sessionChanged = sessionChanged || deleted;
                    continue;
                }

                const artifactBytes = Math.max(0, artifact.bytes);
                retainedAudioBytes += artifactBytes;
                if (artifact.status === "transcribed") {
                    quotaCandidates.push({
                        sessionId: session.id,
                        artifactId: artifact.id,
                        createdAt: artifact.createdAt.getTime(),
                        bytes: artifactBytes,
                    });
                }
            }

            if (sessionChanged) {
                this.cacheSession(session);
                await this.persistSession(session);
            }
        }

        if (retainedAudioBytes > AI_NOTETAKER_AUDIO_STORAGE_SOFT_LIMIT_BYTES) {
            quotaCandidates.sort((left, right) => left.createdAt - right.createdAt);
            for (const candidate of quotaCandidates) {
                if (retainedAudioBytes <= AI_NOTETAKER_AUDIO_STORAGE_SOFT_LIMIT_BYTES) {
                    break;
                }

                const session = await this.getSessionFromCacheOrPersistence(candidate.sessionId);
                if (!session) {
                    continue;
                }

                const artifact = session.audioArtifacts.find((entry) => entry.id === candidate.artifactId);
                if (!artifact || artifact.status === "deleted") {
                    continue;
                }

                const deleted = await this.deleteAudioArtifact(session, artifact, "quota_cleanup");
                if (!deleted) {
                    continue;
                }

                retainedAudioBytes = Math.max(0, retainedAudioBytes - candidate.bytes);
                this.cacheSession(session);
                await this.persistSession(session);
            }
        }

        if (retainedAudioBytes > AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES) {
            console.warn("AI notetaker audio storage remains above hard cap after cleanup", {
                retainedAudioBytes,
                hardLimitBytes: AI_NOTETAKER_AUDIO_STORAGE_HARD_LIMIT_BYTES,
            });
        }
    }
}

export const notetakerSessionService = new NotetakerSessionService();














