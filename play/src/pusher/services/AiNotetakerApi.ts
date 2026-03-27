import axios from "axios";
import { AI_NOTETAKER_API_URL, AI_NOTETAKER_ENABLED, ADMIN_API_TOKEN } from "../enums/EnvironmentVariable";

export interface NotetakerActorPayload {
    userId: string;
    displayName?: string;
    email?: string;
    tags: string[];
}

export interface NotetakerConfigPayload {
    permissionPolicy: "all_users" | "selected_roles";
    allowedTags: string[];
    emailDigestEnabled: boolean;
    starterMustStay: boolean;
    allowAdminReadAll: boolean;
    transcriptRetentionDays: number;
    summaryRetentionDays: number;
}

export interface NotetakerSessionPayload {
    id: string;
    roomId?: string;
    spaceName: string;
    startedByUserId: string;
    ownerUserId: string;
    sharedWithUserIds: string[];
    sharingStatus: "private_pending" | "shared";
    sharedAt?: string;
    sharedByUserId?: string;
    stopActorUserId?: string;
    stopReason?: "manual_stop" | "idle_auto_stop" | "room_empty_auto_stop" | "starter_left_auto_stop";
    startedAt: string;
    stoppedAt?: string;
    status: "starting" | "active" | "idle-warning" | "stopping" | "stopped" | "failed";
    visibilityPolicy: "participants-only";
    language?: string;
    lastSpeechAt?: string;
    idleWarningAt?: string;
    idleWarningDeadlineAt?: string;
    segments: Array<{
        id: string;
        speakerSpaceUserId?: string;
        speakerLabel?: string;
        text: string;
        startedAtMs?: number;
        endedAtMs?: number;
        confidence?: number;
        createdAt: string;
    }>;
    summaries: Array<{
        version: number;
        final: boolean;
        summaryMarkdown: string;
        decisions: string[];
        actionItems: string[];
        createdAt: string;
    }>;
    participants: Array<{
        userId: string;
        displayName?: string;
        email?: string;
        tags: string[];
        joinedAt: string;
        lastSeenAt: string;
        leftAt?: string;
    }>;
    auditEvents: Array<{
        id: string;
        eventType: string;
        actorUserId?: string;
        payload?: Record<string, unknown>;
        createdAt: string;
    }>;
    lastSummaryRefreshAt?: string;
    lastSummaryRefreshSegmentCount: number;
    errorMessage?: string;
}

export interface NotetakerShareCandidatePayload {
    userId: string;
    displayName?: string;
    email?: string;
    tags: string[];
    joinedAt?: string;
    lastSeenAt?: string;
    isCurrentSessionParticipant?: boolean;
}

class AiNotetakerApi {
    private readonly baseUrl = typeof AI_NOTETAKER_API_URL === "string" ? AI_NOTETAKER_API_URL : undefined;

    public isAvailable(): boolean {
        return Boolean(AI_NOTETAKER_ENABLED && this.baseUrl && ADMIN_API_TOKEN);
    }

    private getAxios() {
        if (!this.baseUrl) {
            throw new Error("AI_NOTETAKER_API_URL is not configured");
        }

        if (typeof ADMIN_API_TOKEN !== "string" || !ADMIN_API_TOKEN) {
            throw new Error("ADMIN_API_TOKEN is required for AI notetaker relay");
        }

        return axios.create({
            baseURL: this.baseUrl,
            headers: {
                Authorization: `Bearer ${ADMIN_API_TOKEN}`,
            },
            timeout: 15_000,
        });
    }

    public async getStatus(): Promise<{
        enabled: boolean;
        config: NotetakerConfigPayload;
        mistral: { configured: boolean };
    }> {
        const response = await this.getAxios().get("/ai-notes/status");
        return response.data;
    }

    public async getConfig(): Promise<NotetakerConfigPayload> {
        const response = await this.getAxios().get("/ai-notes/config");
        return response.data.config;
    }

    public async updateConfig(partialConfig: Partial<NotetakerConfigPayload>): Promise<NotetakerConfigPayload> {
        const response = await this.getAxios().put("/ai-notes/config", partialConfig);
        return response.data.config;
    }

    public async startSession(payload: {
        spaceName: string;
        roomId?: string;
        language?: string;
        startedBy: NotetakerActorPayload;
    }): Promise<NotetakerSessionPayload> {
        const response = await this.getAxios().post("/ai-notes/start", payload);
        return response.data.session;
    }


    public async addPresence(payload: {
        sessionId: string;
        participant: NotetakerActorPayload;
        markSpeechDetected?: boolean;
    }): Promise<NotetakerSessionPayload> {
        const response = await this.getAxios().post(`/ai-notes/${payload.sessionId}/presence`, {
            participant: payload.participant,
            markSpeechDetected: payload.markSpeechDetected,
        });
        return response.data.session;
    }

    public async keepRunning(sessionId: string, actor: NotetakerActorPayload): Promise<NotetakerSessionPayload> {
        const response = await this.getAxios().post(`/ai-notes/${sessionId}/keep-running`, { actor });
        return response.data.session;
    }

    public async markParticipantLeft(
        sessionId: string,
        actor: NotetakerActorPayload
    ): Promise<NotetakerSessionPayload> {
        const response = await this.getAxios().post(`/ai-notes/${sessionId}/leave`, { actor });
        return response.data.session;
    }

    public async reportAttendanceEvent(
        spaceName: string,
        actor: NotetakerActorPayload,
        eventType: "join" | "leave" | "heartbeat"
    ): Promise<{ handled: boolean; sessionId?: string }> {
        const response = await this.getAxios().post("/ai-notes/attendance/event", {
            spaceName,
            actor,
            eventType,
        });
        return response.data;
    }

    public async stopSession(payload: {
        sessionId: string;
        actor: NotetakerActorPayload;
        reason?: "manual_stop" | "auto_stop" | "room_empty_auto_stop" | "starter_left_auto_stop";
    }): Promise<NotetakerSessionPayload> {
        const response = await this.getAxios().post(`/ai-notes/${payload.sessionId}/stop`, {
            actor: payload.actor,
            reason: payload.reason,
        });
        return response.data.session;
    }

    public async getSessionShareCandidates(
        sessionId: string,
        actor: NotetakerActorPayload
    ): Promise<NotetakerShareCandidatePayload[]> {
        const response = await this.getAxios().get(`/ai-notes/${sessionId}/share-candidates`, {
            params: {
                actorUserId: actor.userId,
                actorDisplayName: actor.displayName,
                actorEmail: actor.email,
                actorTags: actor.tags.join(","),
            },
        });
        return response.data.candidates;
    }

    public async getSessionShares(
        sessionId: string,
        actor: NotetakerActorPayload
    ): Promise<NotetakerShareCandidatePayload[]> {
        const response = await this.getAxios().get(`/ai-notes/${sessionId}/shares`, {
            params: {
                actorUserId: actor.userId,
                actorDisplayName: actor.displayName,
                actorEmail: actor.email,
                actorTags: actor.tags.join(","),
            },
        });
        return response.data.sharedWith;
    }

    public async shareSession(
        sessionId: string,
        actor: NotetakerActorPayload,
        userIds: string[]
    ): Promise<NotetakerSessionPayload> {
        const response = await this.getAxios().post(`/ai-notes/${sessionId}/share`, {
            actor,
            userIds,
        });
        return response.data.session;
    }

    public async removeSelfFromSessionSharing(sessionId: string, actor: NotetakerActorPayload): Promise<void> {
        await this.getAxios().post(`/ai-notes/${sessionId}/remove-self`, {
            actor,
        });
    }

    public async getSession(sessionId: string, actor: NotetakerActorPayload): Promise<NotetakerSessionPayload> {
        const response = await this.getAxios().get(`/ai-notes/${sessionId}`, {
            params: {
                actorUserId: actor.userId,
                actorDisplayName: actor.displayName,
                actorEmail: actor.email,
                actorTags: actor.tags.join(","),
            },
        });
        return response.data.session;
    }

    public async exportSession(
        sessionId: string,
        actor: NotetakerActorPayload,
        format: "markdown" | "text"
    ): Promise<{ content: string; contentType?: string; filename?: string }> {
        const response = await this.getAxios().get(`/ai-notes/${sessionId}/export`, {
            params: {
                format,
                actorUserId: actor.userId,
                actorDisplayName: actor.displayName,
                actorEmail: actor.email,
                actorTags: actor.tags.join(","),
            },
            responseType: "text",
        });

        const contentDisposition = response.headers["content-disposition"] as string | undefined;
        const filenameMatch = contentDisposition?.match(/filename=\"?([^\";]+)\"?/i);

        return {
            content: response.data as string,
            contentType: response.headers["content-type"] as string | undefined,
            filename: filenameMatch?.[1],
        };
    }

    public async exportSessionRecording(
        sessionId: string,
        actor: NotetakerActorPayload
    ): Promise<{ content: Buffer; contentType?: string; filename?: string }> {
        const response = await this.getAxios().get(`/ai-notes/${sessionId}/recording`, {
            params: {
                actorUserId: actor.userId,
                actorDisplayName: actor.displayName,
                actorEmail: actor.email,
                actorTags: actor.tags.join(","),
            },
            responseType: "arraybuffer",
        });

        const contentDisposition = response.headers["content-disposition"] as string | undefined;
        const filenameMatch = contentDisposition?.match(/filename="?([^";]+)"?/i);

        return {
            content: Buffer.from(response.data as ArrayBuffer),
            contentType: response.headers["content-type"] as string | undefined,
            filename: filenameMatch?.[1],
        };
    }

    public async getActiveSession(spaceName: string, actor: NotetakerActorPayload): Promise<NotetakerSessionPayload> {
        const response = await this.getAxios().get("/ai-notes-active", {
            params: {
                spaceName,
                actorUserId: actor.userId,
                actorDisplayName: actor.displayName,
                actorEmail: actor.email,
                actorTags: actor.tags.join(","),
            },
        });
        return response.data.session;
    }

    public async deleteSession(sessionId: string, actor: NotetakerActorPayload): Promise<void> {
        await this.getAxios().delete(`/ai-notes/${sessionId}`, {
            data: { actor },
        });
    }

    public async listSessions(params: {
        actor: NotetakerActorPayload;
        spaceName?: string;
        includeActiveOnly?: boolean;
    }): Promise<NotetakerSessionPayload[]> {
        const response = await this.getAxios().get("/ai-notes", {
            params: {
                actorUserId: params.actor.userId,
                actorDisplayName: params.actor.displayName,
                actorEmail: params.actor.email,
                actorTags: params.actor.tags.join(","),
                spaceName: params.spaceName,
                includeActiveOnly: params.includeActiveOnly,
            },
        });

        return response.data.sessions;
    }
}

export const aiNotetakerApi = new AiNotetakerApi();
