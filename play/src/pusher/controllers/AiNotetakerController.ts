import type { Request, Response } from "express";
import type { AxiosError } from "axios";
import { z } from "zod";
import { aiNotetakerApi, type NotetakerActorPayload, type NotetakerConfigPayload } from "../services/AiNotetakerApi";
import { socketManager } from "../services/SocketManager";
import { adminToken } from "../middlewares/AdminToken";
import { authenticated, type ResponseWithUserIdentifier } from "../middlewares/Authenticated";
import { BaseHttpController } from "./BaseHttpController";

const startBodySchema = z.object({
    spaceName: z.string().optional(),
    language: z.string().optional(),
});

const stopBodySchema = z.object({
    sessionId: z.string().optional(),
    reason: z.enum(["manual_stop", "auto_stop", "room_empty_auto_stop", "starter_left_auto_stop"]).optional(),
});

const keepRunningBodySchema = z.object({
    sessionId: z.string().min(1),
});

const presenceBodySchema = z.object({
    sessionId: z.string().min(1),
    markSpeechDetected: z.boolean().optional(),
});

const leaveBodySchema = z.object({
    sessionId: z.string().min(1),
});

const shareBodySchema = z.object({
    sessionId: z.string().min(1),
    userIds: z.array(z.string()).optional().default([]),
});

const configBodySchema = z.object({
    permissionPolicy: z.enum(["all_users", "selected_roles"]).optional(),
    allowedTags: z.array(z.string()).optional(),
    emailDigestEnabled: z.boolean().optional(),
    starterMustStay: z.boolean().optional(),
    allowAdminReadAll: z.boolean().optional(),
    transcriptRetentionDays: z.number().int().positive().optional(),
    summaryRetentionDays: z.number().int().positive().optional(),
});

export class AiNotetakerController extends BaseHttpController {
    protected routes(): void {
        this.status();
        this.currentSession();
        this.startSession();
        this.stopSession();
        this.keepRunning();
        this.updatePresence();
        this.markParticipantLeft();
        this.exportSession();
        this.exportRecording();
        this.listSessions();
        this.getSessionShareCandidates();
        this.getSessionShares();
        this.shareSession();
        this.removeSelfSessionShare();
        this.deleteSession();
        this.getConfig();
        this.updateConfig();
    }

    private status(): void {
        this.app.get("/notetaker/status", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            const actor = this.extractActor(res);
            if (!actor) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }

            if (!aiNotetakerApi.isAvailable()) {
                res.status(200).json({
                    enabled: false,
                    relayConfigured: false,
                    inMeetingRoom: false,
                    meetingSpaces: [],
                    canManage: false,
                });
                return;
            }

            try {
                const status = await aiNotetakerApi.getStatus();
                const context = socketManager.getUserRuntimeContext(actor.userId);
                const inMeetingRoom = Boolean(context && context.meetingSpaces.length > 0);

                let canManage = false;
                if (status.config.permissionPolicy === "all_users") {
                    canManage = true;
                } else if (actor.tags.includes("admin")) {
                    canManage = true;
                } else if (status.config.allowedTags.length > 0) {
                    canManage = actor.tags.some((tag) => status.config.allowedTags.includes(tag));
                }

                res.status(200).json({
                    ...status,
                    relayConfigured: true,
                    inMeetingRoom,
                    meetingSpaces: context?.meetingSpaces ?? [],
                    canManage,
                    viewerUserId: actor.userId,
                    viewerEmail: actor.email,
                });
            } catch (error) {
                res.status(502).json({
                    message: "Failed to fetch AI notetaker status",
                    details: this.extractErrorMessage(error),
                });
            }
        });
    }

    private currentSession(): void {
        this.app.get(
            "/notetaker/current",
            [authenticated],
            async (
                req: Request<unknown, unknown, unknown, { spaceName?: string }>,
                res: ResponseWithUserIdentifier
            ) => {
                const actor = this.extractActor(res);
                if (!actor) {
                    res.status(401).json({ message: "Unauthorized" });
                    return;
                }

                if (!aiNotetakerApi.isAvailable()) {
                    res.status(503).json({ message: "AI notetaker relay is not configured" });
                    return;
                }

                const context = socketManager.getUserRuntimeContext(actor.userId);
                const selectedSpace = this.pickMeetingSpace(context?.meetingSpaces ?? [], req.query.spaceName);
                if (!selectedSpace) {
                    res.status(404).json({ session: null });
                    return;
                }

                try {
                    const session = await aiNotetakerApi.getActiveSession(selectedSpace, actor);
                    res.status(200).json({ session: this.enrichSessionForViewer(session, actor) });
                } catch (error) {
                    if (this.isNotFoundError(error)) {
                        res.status(404).json({ session: null });
                        return;
                    }

                    res.status(502).json({
                        message: "Failed to fetch current AI notetaker session",
                        details: this.extractErrorMessage(error),
                    });
                }
            }
        );
    }

    private startSession(): void {
        this.app.post("/notetaker/start", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            const actor = this.extractActor(res);
            if (!actor) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }

            if (!aiNotetakerApi.isAvailable()) {
                res.status(503).json({ message: "AI notetaker relay is not configured" });
                return;
            }

            const parsedBody = startBodySchema.safeParse(req.body ?? {});
            if (!parsedBody.success) {
                res.status(400).json({ message: parsedBody.error.errors[0]?.message ?? "Invalid request payload" });
                return;
            }

            const context = socketManager.getUserRuntimeContext(actor.userId);
            const selectedSpace = this.pickMeetingSpace(context?.meetingSpaces ?? [], parsedBody.data.spaceName);

            if (!selectedSpace) {
                res.status(400).json({ message: "User is not currently inside a meeting room" });
                return;
            }

            try {
                const session = await aiNotetakerApi.startSession({
                    spaceName: selectedSpace,
                    roomId: context?.roomId,
                    language: parsedBody.data.language,
                    startedBy: actor,
                });
                await aiNotetakerApi.addPresence({
                    sessionId: session.id,
                    participant: actor,
                });
                void socketManager.triggerNotetakerAttendanceReconciliation();
                res.status(200).json({ session: this.enrichSessionForViewer(session, actor) });
            } catch (error) {
                const statusCode = this.isForbiddenError(error) ? 403 : 502;
                res.status(statusCode).json({
                    message: "Failed to start AI notetaker session",
                    details: this.extractErrorMessage(error),
                });
            }
        });
    }

    private stopSession(): void {
        this.app.post("/notetaker/stop", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            const actor = this.extractActor(res);
            if (!actor) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }

            if (!aiNotetakerApi.isAvailable()) {
                res.status(503).json({ message: "AI notetaker relay is not configured" });
                return;
            }

            const parsedBody = stopBodySchema.safeParse(req.body ?? {});
            if (!parsedBody.success) {
                res.status(400).json({ message: parsedBody.error.errors[0]?.message ?? "Invalid request payload" });
                return;
            }

            try {
                let sessionId = parsedBody.data.sessionId;
                if (!sessionId) {
                    const context = socketManager.getUserRuntimeContext(actor.userId);
                    const selectedSpace = this.pickMeetingSpace(context?.meetingSpaces ?? []);
                    if (!selectedSpace) {
                        res.status(400).json({ message: "No meeting room context found" });
                        return;
                    }

                    const activeSession = await aiNotetakerApi.getActiveSession(selectedSpace, actor);
                    sessionId = activeSession.id;
                }

                const session = await aiNotetakerApi.stopSession({
                    sessionId,
                    actor,
                    reason: parsedBody.data.reason,
                });
                res.status(200).json({ session: this.enrichSessionForViewer(session, actor) });
            } catch (error) {
                const statusCode = this.isForbiddenError(error) ? 403 : this.isNotFoundError(error) ? 404 : 502;
                res.status(statusCode).json({
                    message: "Failed to stop AI notetaker session",
                    details: this.extractErrorMessage(error),
                });
            }
        });
    }

    private keepRunning(): void {
        this.app.post(
            "/notetaker/keep-running",
            [authenticated],
            async (req: Request, res: ResponseWithUserIdentifier) => {
                const actor = this.extractActor(res);
                if (!actor) {
                    res.status(401).json({ message: "Unauthorized" });
                    return;
                }

                if (!aiNotetakerApi.isAvailable()) {
                    res.status(503).json({ message: "AI notetaker relay is not configured" });
                    return;
                }

                const parsedBody = keepRunningBodySchema.safeParse(req.body ?? {});
                if (!parsedBody.success) {
                    res.status(400).json({ message: parsedBody.error.errors[0]?.message ?? "Invalid request payload" });
                    return;
                }

                try {
                    const session = await aiNotetakerApi.keepRunning(parsedBody.data.sessionId, actor);
                    res.status(200).json({ session: this.enrichSessionForViewer(session, actor) });
                } catch (error) {
                    const statusCode = this.isForbiddenError(error) ? 403 : this.isNotFoundError(error) ? 404 : 502;
                    res.status(statusCode).json({
                        message: "Failed to keep AI notetaker session running",
                        details: this.extractErrorMessage(error),
                    });
                }
            }
        );
    }

    private updatePresence(): void {
        this.app.post("/notetaker/presence", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            const actor = this.extractActor(res);
            if (!actor) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }

            if (!aiNotetakerApi.isAvailable()) {
                res.status(503).json({ message: "AI notetaker relay is not configured" });
                return;
            }

            const parsedBody = presenceBodySchema.safeParse(req.body ?? {});
            if (!parsedBody.success) {
                res.status(400).json({ message: parsedBody.error.errors[0]?.message ?? "Invalid request payload" });
                return;
            }

            try {
                const session = await aiNotetakerApi.addPresence({
                    sessionId: parsedBody.data.sessionId,
                    participant: actor,
                    markSpeechDetected: parsedBody.data.markSpeechDetected,
                });
                res.status(200).json({ session: this.enrichSessionForViewer(session, actor) });
            } catch (error) {
                const statusCode = this.isNotFoundError(error) ? 404 : 502;
                res.status(statusCode).json({
                    message: "Failed to update AI notetaker presence",
                    details: this.extractErrorMessage(error),
                });
            }
        });
    }

    private markParticipantLeft(): void {
        this.app.post("/notetaker/leave", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            const actor = this.extractActor(res);
            if (!actor) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }

            if (!aiNotetakerApi.isAvailable()) {
                res.status(503).json({ message: "AI notetaker relay is not configured" });
                return;
            }

            const parsedBody = leaveBodySchema.safeParse(req.body ?? {});
            if (!parsedBody.success) {
                res.status(400).json({ message: parsedBody.error.errors[0]?.message ?? "Invalid request payload" });
                return;
            }

                try {
                    const session = await aiNotetakerApi.markParticipantLeft(parsedBody.data.sessionId, actor);
                    res.status(200).json({ session: this.enrichSessionForViewer(session, actor) });
                } catch (error) {
                const statusCode = this.isNotFoundError(error) ? 404 : 502;
                res.status(statusCode).json({
                    message: "Failed to mark participant as left from AI notes session",
                    details: this.extractErrorMessage(error),
                });
            }
        });
    }

    private listSessions(): void {
        this.app.get(
            "/notetaker/sessions",
            [authenticated],
            async (
                req: Request<unknown, unknown, unknown, { spaceName?: string; includeActiveOnly?: "true" | "false" }>,
                res: ResponseWithUserIdentifier
            ) => {
                const actor = this.extractActor(res);
                if (!actor) {
                    res.status(401).json({ message: "Unauthorized" });
                    return;
                }

                if (!aiNotetakerApi.isAvailable()) {
                    res.status(503).json({ message: "AI notetaker relay is not configured" });
                    return;
                }

                try {
                    const context = socketManager.getUserRuntimeContext(actor.userId);
                    const normalizedSpace = req.query.spaceName
                        ? this.pickMeetingSpace(context?.meetingSpaces ?? [], req.query.spaceName)
                        : undefined;

                    const sessions = await aiNotetakerApi.listSessions({
                        actor,
                        spaceName: normalizedSpace,
                        includeActiveOnly: req.query.includeActiveOnly === "true",
                    });
                    res.status(200).json({ sessions: sessions.map((session) => this.enrichSessionForViewer(session, actor)) });
                } catch (error) {
                    res.status(502).json({
                        message: "Failed to list AI notetaker sessions",
                        details: this.extractErrorMessage(error),
                    });
                }
            }
        );
    }

    private exportSession(): void {
        this.app.get(
            "/notetaker/export/:sessionId",
            [authenticated],
            async (
                req: Request<{ sessionId: string }, unknown, unknown, { format?: "markdown" | "text" }>,
                res: ResponseWithUserIdentifier
            ) => {
                const actor = this.extractActor(res);
                if (!actor) {
                    res.status(401).json({ message: "Unauthorized" });
                    return;
                }

                if (!aiNotetakerApi.isAvailable()) {
                    res.status(503).json({ message: "AI notetaker relay is not configured" });
                    return;
                }

                const format = req.query.format === "text" ? "text" : "markdown";
                try {
                    const exportPayload = await aiNotetakerApi.exportSession(req.params.sessionId, actor, format);
                    const fallbackFileName = `ai-notes-${req.params.sessionId}.${format === "markdown" ? "md" : "txt"}`;
                    res.setHeader(
                        "Content-Type",
                        exportPayload.contentType ??
                            (format === "markdown" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8")
                    );
                    res.setHeader(
                        "Content-Disposition",
                        `attachment; filename=\"${exportPayload.filename ?? fallbackFileName}\"`
                    );
                    res.status(200).send(exportPayload.content);
                } catch (error) {
                    const statusCode = this.isNotFoundError(error) ? 404 : 502;
                    res.status(statusCode).json({
                        message: "Failed to export AI notes session",
                        details: this.extractErrorMessage(error),
                    });
                }
            }
        );
    }

    private exportRecording(): void {
        this.app.get(
            "/notetaker/recording/:sessionId",
            [authenticated],
            async (req: Request<{ sessionId: string }>, res: ResponseWithUserIdentifier) => {
                const actor = this.extractActor(res);
                if (!actor) {
                    res.status(401).json({ message: "Unauthorized" });
                    return;
                }

                if (!aiNotetakerApi.isAvailable()) {
                    res.status(503).json({ message: "AI notetaker relay is not configured" });
                    return;
                }

                try {
                    const recordingPayload = await aiNotetakerApi.exportSessionRecording(req.params.sessionId, actor);
                    const fallbackFileName = `ai-notes-recording-${req.params.sessionId}.wav`;
                    res.setHeader("Content-Type", recordingPayload.contentType ?? "audio/wav");
                    res.setHeader(
                        "Content-Disposition",
                        `attachment; filename="${recordingPayload.filename ?? fallbackFileName}"`
                    );
                    res.status(200).send(recordingPayload.content);
                } catch (error) {
                    const statusCode = this.isNotFoundError(error) ? 404 : 502;
                    res.status(statusCode).json({
                        message: "Failed to export AI notes recording",
                        details: this.extractErrorMessage(error),
                    });
                }
            }
        );
    }

    private getSessionShareCandidates(): void {
        this.app.get(
            "/notetaker/session/:sessionId/share-candidates",
            [authenticated],
            async (req: Request<{ sessionId: string }>, res: ResponseWithUserIdentifier) => {
                const actor = this.extractActor(res);
                if (!actor) {
                    res.status(401).json({ message: "Unauthorized" });
                    return;
                }

                if (!aiNotetakerApi.isAvailable()) {
                    res.status(503).json({ message: "AI notetaker relay is not configured" });
                    return;
                }

                try {
                    await socketManager.triggerNotetakerAttendanceReconciliation();
                    const candidates = await aiNotetakerApi.getSessionShareCandidates(req.params.sessionId, actor);
                    res.status(200).json({ candidates });
                } catch (error) {
                    const statusCode = this.isForbiddenError(error) ? 403 : this.isNotFoundError(error) ? 404 : 502;
                    res.status(statusCode).json({
                        message: "Failed to fetch AI notes share candidates",
                        details: this.extractErrorMessage(error),
                    });
                }
            }
        );
    }

    private getSessionShares(): void {
        this.app.get(
            "/notetaker/session/:sessionId/shares",
            [authenticated],
            async (req: Request<{ sessionId: string }>, res: ResponseWithUserIdentifier) => {
                const actor = this.extractActor(res);
                if (!actor) {
                    res.status(401).json({ message: "Unauthorized" });
                    return;
                }

                if (!aiNotetakerApi.isAvailable()) {
                    res.status(503).json({ message: "AI notetaker relay is not configured" });
                    return;
                }

                try {
                    await socketManager.triggerNotetakerAttendanceReconciliation();
                    const sharedWith = await aiNotetakerApi.getSessionShares(req.params.sessionId, actor);
                    res.status(200).json({ sharedWith });
                } catch (error) {
                    const statusCode = this.isForbiddenError(error) ? 403 : this.isNotFoundError(error) ? 404 : 502;
                    res.status(statusCode).json({
                        message: "Failed to fetch AI notes share list",
                        details: this.extractErrorMessage(error),
                    });
                }
            }
        );
    }

    private shareSession(): void {
        this.app.post("/notetaker/share", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            const actor = this.extractActor(res);
            if (!actor) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }

            if (!aiNotetakerApi.isAvailable()) {
                res.status(503).json({ message: "AI notetaker relay is not configured" });
                return;
            }

            const parsedBody = shareBodySchema.safeParse(req.body ?? {});
            if (!parsedBody.success) {
                res.status(400).json({ message: parsedBody.error.errors[0]?.message ?? "Invalid request payload" });
                return;
            }

            try {
                const session = await aiNotetakerApi.shareSession(
                    parsedBody.data.sessionId,
                    actor,
                    parsedBody.data.userIds
                );
                res.status(200).json({ session: this.enrichSessionForViewer(session, actor) });
            } catch (error) {
                const statusCode = this.isForbiddenError(error) ? 403 : this.isNotFoundError(error) ? 404 : 502;
                res.status(statusCode).json({
                    message: "Failed to update AI notes sharing",
                    details: this.extractErrorMessage(error),
                });
            }
        });
    }

    private removeSelfSessionShare(): void {
        this.app.post(
            "/notetaker/session/:sessionId/remove-self",
            [authenticated],
            async (req: Request<{ sessionId: string }>, res: ResponseWithUserIdentifier) => {
                const actor = this.extractActor(res);
                if (!actor) {
                    res.status(401).json({ message: "Unauthorized" });
                    return;
                }

                if (!aiNotetakerApi.isAvailable()) {
                    res.status(503).json({ message: "AI notetaker relay is not configured" });
                    return;
                }

                try {
                    await aiNotetakerApi.removeSelfFromSessionSharing(req.params.sessionId, actor);
                    res.status(204).send();
                } catch (error) {
                    const statusCode = this.isForbiddenError(error) ? 403 : this.isNotFoundError(error) ? 404 : 502;
                    res.status(statusCode).json({
                        message: "Failed to remove shared AI notes session from your library",
                        details: this.extractErrorMessage(error),
                    });
                }
            }
        );
    }

    private deleteSession(): void {
        this.app.delete(
            "/notetaker/session/:sessionId",
            [authenticated],
            async (req: Request<{ sessionId: string }>, res: ResponseWithUserIdentifier) => {
                const actor = this.extractActor(res);
                if (!actor) {
                    res.status(401).json({ message: "Unauthorized" });
                    return;
                }

                if (!aiNotetakerApi.isAvailable()) {
                    res.status(503).json({ message: "AI notetaker relay is not configured" });
                    return;
                }

                try {
                    await aiNotetakerApi.deleteSession(req.params.sessionId, actor);
                    res.status(204).send();
                } catch (error) {
                    const statusCode = this.isForbiddenError(error) ? 403 : this.isNotFoundError(error) ? 404 : 502;
                    res.status(statusCode).json({
                        message: "Failed to delete AI notes session",
                        details: this.extractErrorMessage(error),
                    });
                }
            }
        );
    }

    private getConfig(): void {
        this.app.get("/admin/notetaker/config", [adminToken], async (_req: Request, res: Response) => {
            if (!aiNotetakerApi.isAvailable()) {
                res.status(503).json({ message: "AI notetaker relay is not configured" });
                return;
            }

            try {
                const config = await aiNotetakerApi.getConfig();
                res.status(200).json({ config });
            } catch (error) {
                res.status(502).json({
                    message: "Failed to fetch AI notetaker config",
                    details: this.extractErrorMessage(error),
                });
            }
        });
    }

    private updateConfig(): void {
        this.app.put("/admin/notetaker/config", [adminToken], async (req: Request, res: Response) => {
            if (!aiNotetakerApi.isAvailable()) {
                res.status(503).json({ message: "AI notetaker relay is not configured" });
                return;
            }

            const parsedBody = configBodySchema.safeParse(req.body ?? {});
            if (!parsedBody.success) {
                res.status(400).json({ message: parsedBody.error.errors[0]?.message ?? "Invalid request payload" });
                return;
            }

            try {
                const config = await aiNotetakerApi.updateConfig(parsedBody.data as Partial<NotetakerConfigPayload>);
                res.status(200).json({ config });
            } catch (error) {
                res.status(502).json({
                    message: "Failed to update AI notetaker config",
                    details: this.extractErrorMessage(error),
                });
            }
        });
    }

    private extractActor(res: ResponseWithUserIdentifier): NotetakerActorPayload | undefined {
        if (!res.userIdentifier) {
            return undefined;
        }

        const normalizedEmail = res.userIdentifier.includes("@") ? res.userIdentifier : undefined;

        return {
            userId: res.userIdentifier,
            displayName: res.username,
            email: normalizedEmail,
            tags: res.tags ?? [],
        };
    }

    private pickMeetingSpace(meetingSpaces: string[], requestedSpaceName?: string): string | undefined {
        if (requestedSpaceName && meetingSpaces.includes(requestedSpaceName)) {
            return requestedSpaceName;
        }

        return meetingSpaces[0];
    }

    private normalizeUserId(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }

        return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
    }

    private areUserIdsEqual(left: string | undefined, right: string | undefined): boolean {
        const normalizedLeft = this.normalizeUserId(left);
        const normalizedRight = this.normalizeUserId(right);
        return Boolean(normalizedLeft) && Boolean(normalizedRight) && normalizedLeft === normalizedRight;
    }

    private isOwnerPresentInSession(session: {
        startedByUserId: string;
        ownerUserId?: string;
        participants?: Array<{ userId: string; leftAt?: string; lastSeenAt: string }>;
    }): boolean {
        const ownerId = session.ownerUserId ?? session.startedByUserId;
        const now = Date.now();

        return (session.participants ?? []).some((participant) => {
            if (!this.areUserIdsEqual(participant.userId, ownerId)) {
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

    private enrichSessionForViewer<T extends {
        status: string;
        startedByUserId: string;
        ownerUserId?: string;
        participants?: Array<{ userId: string; leftAt?: string; lastSeenAt: string }>;
    }>(session: T, actor: NotetakerActorPayload): T & { viewerIsOwner: boolean; viewerCanStop: boolean } {
        const ownerId = session.ownerUserId ?? session.startedByUserId;
        const isOwner =
            this.areUserIdsEqual(actor.userId, ownerId) ||
            this.areUserIdsEqual(actor.email, ownerId);
        const isRunning = ["starting", "active", "idle-warning", "stopping"].includes(session.status);
        const ownerPresent = this.isOwnerPresentInSession(session);
        const viewerCanStop = isRunning && (isOwner || !ownerPresent);

        return {
            ...session,
            viewerIsOwner: isOwner,
            viewerCanStop,
        };
    }

    private extractErrorMessage(error: unknown): string {
        if (!error) {
            return "Unknown error";
        }

        const axiosError = error as AxiosError<{ message?: string }>;
        const backendMessage = axiosError.response?.data?.message;
        if (backendMessage) {
            return backendMessage;
        }

        if (error instanceof Error) {
            return error.message;
        }

        return "Unknown error";
    }

    private isNotFoundError(error: unknown): boolean {
        const axiosError = error as AxiosError;
        return axiosError?.response?.status === 404;
    }

    private isForbiddenError(error: unknown): boolean {
        const axiosError = error as AxiosError;
        return axiosError?.response?.status === 403;
    }
}
