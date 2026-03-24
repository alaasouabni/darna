export type NotetakerSessionStatus = "starting" | "active" | "idle-warning" | "stopping" | "stopped" | "failed";

export type NotetakerPermissionPolicy = "all_users" | "selected_roles";

export type NotetakerSessionVisibilityPolicy = "participants-only";

export type NotetakerAuditEventType =
    | "start"
    | "participant_joined"
    | "participant_left"
    | "speech_detected"
    | "bot_runtime"
    | "artifact_recorded"
    | "artifact_deleted"
    | "warning_shown"
    | "warning_cleared"
    | "keep_running"
    | "summary_updated"
    | "manual_stop"
    | "auto_stop"
    | "room_empty_auto_stop"
    | "starter_left_auto_stop"
    | "error";

export interface TranscriptSegmentInput {
    speakerSpaceUserId?: string;
    speakerLabel?: string;
    text: string;
    startedAtMs?: number;
    endedAtMs?: number;
    confidence?: number;
}

export interface TranscriptSegment extends TranscriptSegmentInput {
    id: string;
    createdAt: Date;
}

export interface NotetakerSummary {
    summaryMarkdown: string;
    decisions: string[];
    actionItems: string[];
}

export interface NotetakerSummaryVersion extends NotetakerSummary {
    version: number;
    final: boolean;
    createdAt: Date;
}

export type NotetakerAudioArtifactStatus =
    | "recording"
    | "recorded"
    | "transcribed"
    | "failed"
    | "deleted";

export interface NotetakerAudioArtifact {
    id: string;
    trackId: string;
    speakerSpaceUserId: string;
    speakerLabel?: string;
    mimeType: string;
    sampleRate?: number;
    channelCount?: 1 | 2;
    filePath: string;
    bytes: number;
    createdAt: Date;
    startedAtMs?: number;
    endedAtMs?: number;
    status: NotetakerAudioArtifactStatus;
    transcribedAt?: Date;
    deletedAt?: Date;
    lastError?: string;
}

export interface NotetakerParticipantSnapshot {
    userId: string;
    displayName?: string;
    email?: string;
    tags: string[];
    joinedAt: Date;
    lastSeenAt: Date;
    leftAt?: Date;
}

export interface NotetakerAuditEvent {
    id: string;
    eventType: NotetakerAuditEventType;
    actorUserId?: string;
    payload?: Record<string, unknown>;
    createdAt: Date;
}

export interface NotetakerSessionConfig {
    permissionPolicy: NotetakerPermissionPolicy;
    allowedTags: string[];
    emailDigestEnabled: boolean;
    starterMustStay: boolean;
    allowAdminReadAll: boolean;
    transcriptRetentionDays: number;
    summaryRetentionDays: number;
}

export interface NotetakerSession {
    id: string;
    roomId?: string;
    spaceName: string;
    startedByUserId: string;
    startedAt: Date;
    stoppedAt?: Date;
    status: NotetakerSessionStatus;
    visibilityPolicy: NotetakerSessionVisibilityPolicy;
    language?: string;
    lastSpeechAt?: Date;
    idleWarningAt?: Date;
    idleWarningDeadlineAt?: Date;
    segments: TranscriptSegment[];
    summaries: NotetakerSummaryVersion[];
    participants: NotetakerParticipantSnapshot[];
    auditEvents: NotetakerAuditEvent[];
    audioArtifacts: NotetakerAudioArtifact[];
    lastSummaryRefreshAt?: Date;
    lastSummaryRefreshSegmentCount: number;
    errorMessage?: string;
}

export interface NotetakerActor {
    userId: string;
    displayName?: string;
    email?: string;
    tags: string[];
}

