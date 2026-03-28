import type { Express, NextFunction, Request, Response } from "express";
import { AI_NOTETAKER_ENABLED, ADMIN_API_TOKEN } from "../Enum/EnvironmentVariable";
import { notetakerSessionService } from "../Model/Notetaker/NotetakerSessionService";
import type {
    NotetakerActor,
    NotetakerSession,
    NotetakerSessionConfig,
} from "../Model/Notetaker/NotetakerTypes";

const validateAdminTokenMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    if (!ADMIN_API_TOKEN) {
        res.status(401).json({ message: "No admin token configured" });
        return;
    }

    const authorization = req.header("authorization");
    const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
    const token = bearerToken ?? queryToken;

    if (token !== ADMIN_API_TOKEN) {
        res.status(401).json({ message: "Invalid admin token" });
        return;
    }

    next();
};

const requireFeatureEnabledMiddleware = (_req: Request, res: Response, next: NextFunction): void => {
    if (!AI_NOTETAKER_ENABLED) {
        res.status(403).json({ message: "AI notetaker is disabled" });
        return;
    }

    next();
};

interface NotetakerActorBody {
    userId?: string;
    displayName?: string;
    email?: string;
    color?: string;
    avatarUrl?: string;
    wokaId?: string;
    characterTextureIds?: string[];
    tags?: unknown;
}

interface StartSessionBody {
    spaceName?: string;
    roomId?: string;
    language?: string;
    startedBy?: NotetakerActorBody;
}

interface UpdateConfigBody {
    permissionPolicy?: NotetakerSessionConfig["permissionPolicy"];
    allowedTags?: string[];
    emailDigestEnabled?: boolean;
    starterMustStay?: boolean;
    allowAdminReadAll?: boolean;
    transcriptRetentionDays?: number;
    summaryRetentionDays?: number;
}

interface StopSessionBody {
    languageHint?: string;
    reason?: "manual_stop" | "auto_stop" | "room_empty_auto_stop" | "starter_left_auto_stop";
    actor?: NotetakerActorBody;
}

interface ShareSessionBody {
    actor?: NotetakerActorBody;
    userIds?: string[];
}

interface PresenceUpdateBody {
    participant?: NotetakerActorBody;
    markSpeechDetected?: boolean;
}

interface AttendanceEventBody {
    spaceName?: string;
    eventType?: "join" | "leave" | "heartbeat";
    actor?: NotetakerActorBody;
    at?: string;
}

interface ActorQuery {
    actorUserId?: string;
    actorDisplayName?: string;
    actorEmail?: string;
    actorColor?: string;
    actorAvatarUrl?: string;
    actorWokaId?: string;
    actorCharacterTextureIds?: string | string[];
    actorTags?: string | string[];
}

export class AiNotetakerController {
    constructor(private readonly app: Express) {
        this.getStatus();
        this.getConfig();
        this.updateConfig();
        this.startSession();
        this.reportAttendanceEvent();
        this.updatePresence();
        this.markParticipantLeft();
        this.keepRunning();
        this.stopSession();
        this.getSession();
        this.exportSession();
        this.exportRecording();
        this.getActiveSessionForSpace();
        this.listSessions();
        this.getSessionShareCandidates();
        this.getSessionShares();
        this.shareSession();
        this.removeSelfSessionShare();
        this.deleteSession();
    }

    private getStatus(): void {
        this.app.get("/ai-notes/status", validateAdminTokenMiddleware, async (_req: Request, res: Response) => {
            const [config, operationalMetrics] = await Promise.all([
                notetakerSessionService.getConfig(),
                notetakerSessionService.getOperationalMetrics(),
            ]);

            res.status(200).json({
                enabled: AI_NOTETAKER_ENABLED,
                config,
                configSource: notetakerSessionService.getConfigSource(),
                mistral: notetakerSessionService.getMistralConfigurationStatus(),
                operationalMetrics,
            });
        });
    }

    private getConfig(): void {
        this.app.get(
            "/ai-notes/config",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (_req: Request, res: Response) => {
                const config = await notetakerSessionService.getConfig();
                res.status(200).json({ config });
            }
        );
    }

    private updateConfig(): void {
        this.app.put(
            "/ai-notes/config",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<unknown, unknown, UpdateConfigBody>, res: Response) => {
                const config = await notetakerSessionService.updateConfig(req.body);
                res.status(200).json({ config });
            }
        );
    }

    private startSession(): void {
        this.app.post(
            "/ai-notes/start",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<unknown, unknown, StartSessionBody>, res: Response) => {
                const { spaceName, roomId, language } = req.body;
                const startedBy = this.parseActor(req.body.startedBy);

                if (!spaceName || !startedBy) {
                    res.status(400).json({ message: "spaceName and startedBy.userId are required" });
                    return;
                }

                try {
                    const session = await notetakerSessionService.startSession({
                        spaceName,
                        roomId,
                        language,
                        startedBy,
                    });
                    res.status(200).json({ session });
                } catch (error) {
                    res.status(403).json({
                        message: error instanceof Error ? error.message : "Failed to start AI notetaker session",
                    });
                }
            }
        );
    }

    private updatePresence(): void {
        this.app.post(
            "/ai-notes/:sessionId/presence",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, PresenceUpdateBody>, res: Response) => {
                const participant = this.parseActor(req.body.participant);
                if (!participant) {
                    res.status(400).json({ message: "participant.userId is required" });
                    return;
                }

                try {
                    const session = await notetakerSessionService.updateParticipantPresence({
                        sessionId: req.params.sessionId,
                        participant,
                        markSpeechDetected: req.body.markSpeechDetected,
                    });
                    res.status(200).json({ session });
                } catch (error) {
                    res.status(404).json({ message: error instanceof Error ? error.message : "Session not found" });
                }
            }
        );
    }

    private markParticipantLeft(): void {
        this.app.post(
            "/ai-notes/:sessionId/leave",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, { actor?: NotetakerActorBody }>, res: Response) => {
                const actor = this.parseActor(req.body.actor);
                if (!actor) {
                    res.status(400).json({ message: "actor.userId is required" });
                    return;
                }

                try {
                    const session = await notetakerSessionService.markParticipantLeft(req.params.sessionId, actor);
                    res.status(200).json({ session });
                } catch (error) {
                    res.status(404).json({ message: error instanceof Error ? error.message : "Session not found" });
                }
            }
        );
    }

    private keepRunning(): void {
        this.app.post(
            "/ai-notes/:sessionId/keep-running",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, { actor?: NotetakerActorBody }>, res: Response) => {
                const actor = this.parseActor(req.body.actor);
                if (!actor) {
                    res.status(400).json({ message: "actor.userId is required" });
                    return;
                }

                try {
                    const session = await notetakerSessionService.keepRunning(req.params.sessionId, actor);
                    res.status(200).json({ session });
                } catch (error) {
                    res.status(403).json({
                        message: error instanceof Error ? error.message : "Unable to keep session running",
                    });
                }
            }
        );
    }

    private stopSession(): void {
        this.app.post(
            "/ai-notes/:sessionId/stop",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, StopSessionBody>, res: Response) => {
                const actor = this.parseActor(req.body.actor);

                try {
                    const session = await notetakerSessionService.stopSession({
                        sessionId: req.params.sessionId,
                        actor,
                        reason: req.body.reason,
                        languageHint: req.body.languageHint,
                    });
                    res.status(200).json({ session });
                } catch (error) {
                    res.status(403).json({
                        message: error instanceof Error ? error.message : "Unable to stop session",
                    });
                }
            }
        );
    }

    private getSession(): void {
        this.app.get(
            "/ai-notes/:sessionId",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, unknown, ActorQuery>, res: Response) => {
                const actor = this.parseActorFromQuery(req.query);

                if (!actor) {
                    res.status(400).json({ message: "actorUserId query parameter is required" });
                    return;
                }

                const session = await notetakerSessionService.getSession(req.params.sessionId, {
                    actor,
                    allowSystemBypass: false,
                });

                if (!session) {
                    res.status(404).json({ message: "Session not found" });
                    return;
                }

                res.status(200).json({ session });
            }
        );
    }

    private getActiveSessionForSpace(): void {
        this.app.get(
            "/ai-notes-active",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<unknown, unknown, unknown, ActorQuery & { spaceName?: string }>, res: Response) => {
                const spaceName = typeof req.query.spaceName === "string" ? req.query.spaceName : undefined;
                if (!spaceName) {
                    res.status(400).json({ message: "spaceName query parameter is required" });
                    return;
                }

                const actor = this.parseActorFromQuery(req.query);
                if (!actor) {
                    res.status(400).json({ message: "actorUserId query parameter is required" });
                    return;
                }

                const session = await notetakerSessionService.getActiveSessionForSpace(spaceName, {
                    actor,
                    // This endpoint is called through the trusted pusher relay. The relay already
                    // constrains `spaceName` to the caller's current meeting spaces.
                    allowSystemBypass: true,
                });

                if (!session) {
                    res.status(404).json({ message: "No active session" });
                    return;
                }

                res.status(200).json({ session });
            }
        );
    }

    private exportRecording(): void {
        this.app.get(
            "/ai-notes/:sessionId/recording",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, unknown, ActorQuery>, res: Response) => {
                const actor = this.parseActorFromQuery(req.query);
                if (!actor) {
                    res.status(400).json({ message: "actorUserId query parameter is required" });
                    return;
                }

                try {
                    const recording = await notetakerSessionService.exportSessionRecording(req.params.sessionId, {
                        actor,
                        allowSystemBypass: false,
                    });

                    res.setHeader("Content-Type", "audio/wav");
                    res.setHeader("Content-Disposition", `attachment; filename="${recording.filename}"`);
                    res.status(200).send(recording.buffer);
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unable to export recording";
                    if (message.includes("not found") || message.includes("No audio artifacts")) {
                        res.status(404).json({ message });
                        return;
                    }

                    res.status(500).json({ message });
                }
            }
        );
    }

    private exportSession(): void {
        this.app.get(
            "/ai-notes/:sessionId/export",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (
                req: Request<{ sessionId: string }, unknown, unknown, ActorQuery & { format?: "markdown" | "text" }>,
                res: Response
            ) => {
                const actor = this.parseActorFromQuery(req.query);
                if (!actor) {
                    res.status(400).json({ message: "actorUserId query parameter is required" });
                    return;
                }

                const session = await notetakerSessionService.getSession(req.params.sessionId, {
                    actor,
                    allowSystemBypass: false,
                });

                if (!session) {
                    res.status(404).json({ message: "Session not found" });
                    return;
                }

                const format = req.query.format === "text" ? "text" : "markdown";
                const exportText = this.buildSessionExport(session, format);
                const extension = format === "markdown" ? "md" : "txt";
                const safeSpaceName = session.spaceName.replace(/[^a-zA-Z0-9-_]/g, "_");

                res.setHeader(
                    "Content-Type",
                    format === "markdown" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8"
                );
                res.setHeader(
                    "Content-Disposition",
                    `attachment; filename=\"ai-notes-${safeSpaceName}-${session.id}.${extension}\"`
                );
                res.status(200).send(exportText);
            }
        );
    }

    private listSessions(): void {
        this.app.get(
            "/ai-notes",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (
                req: Request<
                    unknown,
                    unknown,
                    unknown,
                    ActorQuery & { spaceName?: string; includeActiveOnly?: "true" | "false" }
                >,
                res: Response
            ) => {
                const actor = this.parseActorFromQuery(req.query);
                if (!actor) {
                    res.status(400).json({ message: "actorUserId query parameter is required" });
                    return;
                }

                const includeActiveOnly = req.query.includeActiveOnly === "true";
                const sessions = await notetakerSessionService.listSessions({
                    actor,
                    spaceName: req.query.spaceName,
                    includeActiveOnly,
                    allowSystemBypass: false,
                });
                res.status(200).json({ sessions });
            }
        );
    }

    private reportAttendanceEvent(): void {
        this.app.post(
            "/ai-notes/attendance/event",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<unknown, unknown, AttendanceEventBody>, res: Response) => {
                const actor = this.parseActor(req.body.actor);
                if (!actor) {
                    res.status(400).json({ message: "actor.userId is required" });
                    return;
                }

                if (!req.body.spaceName || req.body.spaceName.trim().length === 0) {
                    res.status(400).json({ message: "spaceName is required" });
                    return;
                }

                const eventType = req.body.eventType;
                if (eventType !== "join" && eventType !== "leave" && eventType !== "heartbeat") {
                    res.status(400).json({ message: "eventType must be one of join, leave, heartbeat" });
                    return;
                }

                let occurredAt: Date | undefined;
                if (typeof req.body.at === "string" && req.body.at.trim().length > 0) {
                    const parsedAt = new Date(req.body.at);
                    if (!Number.isNaN(parsedAt.getTime())) {
                        occurredAt = parsedAt;
                    }
                }

                try {
                    const result = await notetakerSessionService.recordAttendanceEvent({
                        spaceName: req.body.spaceName.trim(),
                        actor,
                        eventType,
                        occurredAt,
                    });
                    res.status(200).json(result);
                } catch (error) {
                    res.status(500).json({
                        message: error instanceof Error ? error.message : "Failed to process attendance event",
                    });
                }
            }
        );
    }

    private getSessionShareCandidates(): void {
        this.app.get(
            "/ai-notes/:sessionId/share-candidates",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, unknown, ActorQuery>, res: Response) => {
                const actor = this.parseActorFromQuery(req.query);
                if (!actor) {
                    res.status(400).json({ message: "actorUserId query parameter is required" });
                    return;
                }

                try {
                    const candidates = await notetakerSessionService.getSessionShareCandidates(req.params.sessionId, actor);
                    res.status(200).json({ candidates });
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unable to fetch sharing candidates";
                    if (message.includes("not found")) {
                        res.status(404).json({ message });
                        return;
                    }
                    if (message.includes("Only the session owner")) {
                        res.status(403).json({ message });
                        return;
                    }

                    res.status(500).json({ message });
                }
            }
        );
    }

    private getSessionShares(): void {
        this.app.get(
            "/ai-notes/:sessionId/shares",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, unknown, ActorQuery>, res: Response) => {
                const actor = this.parseActorFromQuery(req.query);
                if (!actor) {
                    res.status(400).json({ message: "actorUserId query parameter is required" });
                    return;
                }

                try {
                    const sharedWith = await notetakerSessionService.getSessionShares(req.params.sessionId, actor);
                    res.status(200).json({ sharedWith });
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unable to fetch sharing details";
                    if (message.includes("not found")) {
                        res.status(404).json({ message });
                        return;
                    }
                    if (message.includes("Only the session owner")) {
                        res.status(403).json({ message });
                        return;
                    }

                    res.status(500).json({ message });
                }
            }
        );
    }

    private shareSession(): void {
        this.app.post(
            "/ai-notes/:sessionId/share",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, ShareSessionBody>, res: Response) => {
                const actor = this.parseActor(req.body.actor);
                if (!actor) {
                    res.status(400).json({ message: "actor.userId is required" });
                    return;
                }

                if (!Array.isArray(req.body.userIds)) {
                    res.status(400).json({ message: "userIds must be an array" });
                    return;
                }

                try {
                    const session = await notetakerSessionService.shareSession({
                        sessionId: req.params.sessionId,
                        actor,
                        userIds: req.body.userIds,
                    });
                    res.status(200).json({ session });
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unable to update session sharing";
                    if (message.includes("not found")) {
                        res.status(404).json({ message });
                        return;
                    }
                    if (message.includes("Only the session owner")) {
                        res.status(403).json({ message });
                        return;
                    }

                    res.status(500).json({ message });
                }
            }
        );
    }

    private removeSelfSessionShare(): void {
        this.app.post(
            "/ai-notes/:sessionId/remove-self",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, { actor?: NotetakerActorBody }>, res: Response) => {
                const actor = this.parseActor(req.body.actor);
                if (!actor) {
                    res.status(400).json({ message: "actor.userId is required" });
                    return;
                }

                try {
                    await notetakerSessionService.removeSelfFromSharedSession(req.params.sessionId, actor);
                    res.status(204).send();
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : "Unable to remove shared session from library";
                    if (message.includes("not found")) {
                        res.status(404).json({ message });
                        return;
                    }
                    if (
                        message.includes("not authorized") ||
                        message.includes("cannot remove themselves from their own library")
                    ) {
                        res.status(403).json({ message });
                        return;
                    }

                    res.status(500).json({ message });
                }
            }
        );
    }

    private deleteSession(): void {
        this.app.delete(
            "/ai-notes/:sessionId",
            validateAdminTokenMiddleware,
            requireFeatureEnabledMiddleware,
            async (req: Request<{ sessionId: string }, unknown, { actor?: NotetakerActorBody }>, res: Response) => {
                const actor = this.parseActor(req.body.actor);
                if (!actor) {
                    res.status(400).json({ message: "actor.userId is required" });
                    return;
                }

                try {
                    await notetakerSessionService.deleteSession(req.params.sessionId, actor);
                    res.status(204).send();
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unable to delete session";
                    if (message.includes("not authorized")) {
                        res.status(403).json({ message });
                        return;
                    }
                    if (message.includes("not found")) {
                        res.status(404).json({ message });
                        return;
                    }

                    res.status(500).json({ message });
                }
            }
        );
    }

    private parseActor(actorBody: NotetakerActorBody | undefined): NotetakerActor | undefined {
        if (!actorBody?.userId || typeof actorBody.userId !== "string") {
            return undefined;
        }

        return {
            userId: actorBody.userId,
            displayName: actorBody.displayName,
            email: actorBody.email,
            color: actorBody.color,
            avatarUrl: actorBody.avatarUrl,
            wokaId: actorBody.wokaId,
            characterTextureIds: this.parseCharacterTextureIds(actorBody.characterTextureIds),
            tags: this.parseTags(actorBody.tags),
        };
    }

    private parseActorFromQuery(query: ActorQuery): NotetakerActor | undefined {
        if (!query.actorUserId) {
            return undefined;
        }

        return {
            userId: query.actorUserId,
            displayName: query.actorDisplayName,
            email: query.actorEmail,
            color: query.actorColor,
            avatarUrl: query.actorAvatarUrl,
            wokaId: query.actorWokaId,
            characterTextureIds: this.parseCharacterTextureIds(query.actorCharacterTextureIds),
            tags: this.parseTags(query.actorTags),
        };
    }

    private parseTags(rawTags: unknown): string[] {
        if (Array.isArray(rawTags)) {
            return rawTags.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0);
        }

        if (typeof rawTags === "string") {
            return rawTags
                .split(",")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
        }

        return [];
    }

    private parseCharacterTextureIds(rawTextureIds: unknown): string[] {
        if (Array.isArray(rawTextureIds)) {
            return Array.from(
                new Set(rawTextureIds.map((textureId) => String(textureId).trim()).filter((textureId) => textureId.length > 0))
            );
        }

        if (typeof rawTextureIds === "string") {
            return Array.from(
                new Set(
                    rawTextureIds
                        .split(",")
                        .map((textureId) => textureId.trim())
                        .filter((textureId) => textureId.length > 0)
                )
            );
        }

        return [];
    }

    private buildSessionExport(session: NotetakerSession, format: "markdown" | "text"): string {
        const latestSummary = session.summaries.find((summary) => summary.final) ?? session.summaries.at(-1);
        const startedAt = session.startedAt.toISOString();
        const stoppedAt = session.stoppedAt?.toISOString();

        if (format === "text") {
            const textBlocks: string[] = [
                `AI Notes Export`,
                `Space: ${session.spaceName}`,
                `Started: ${startedAt}`,
                `Stopped: ${stoppedAt ?? "N/A"}`,
                ``,
                `SUMMARY`,
                latestSummary?.summaryMarkdown ?? "No summary available.",
                ``,
            ];

            if (latestSummary?.decisions.length) {
                textBlocks.push("DECISIONS");
                for (const decision of latestSummary.decisions) {
                    textBlocks.push(`- ${decision}`);
                }
                textBlocks.push("");
            }

            if (latestSummary?.actionItems.length) {
                textBlocks.push("ACTION ITEMS");
                for (const actionItem of latestSummary.actionItems) {
                    textBlocks.push(`- ${actionItem}`);
                }
                textBlocks.push("");
            }

            textBlocks.push("TRANSCRIPT");
            if (session.segments.length === 0) {
                textBlocks.push("No transcript segments.");
            } else {
                for (const segment of session.segments) {
                    textBlocks.push(`${segment.speakerLabel ?? "Unknown speaker"}: ${segment.text}`);
                }
            }

            return textBlocks.join("\n");
        }

        const markdownBlocks: string[] = [
            `# AI Notes Export`,
            ``,
            `- **Space:** ${session.spaceName}`,
            `- **Started:** ${startedAt}`,
            `- **Stopped:** ${stoppedAt ?? "N/A"}`,
            ``,
            `## Summary`,
            latestSummary?.summaryMarkdown ?? "No summary available.",
            ``,
        ];

        if (latestSummary?.decisions.length) {
            markdownBlocks.push("## Decisions");
            for (const decision of latestSummary.decisions) {
                markdownBlocks.push(`- ${decision}`);
            }
            markdownBlocks.push("");
        }

        if (latestSummary?.actionItems.length) {
            markdownBlocks.push("## Action Items");
            for (const actionItem of latestSummary.actionItems) {
                markdownBlocks.push(`- ${actionItem}`);
            }
            markdownBlocks.push("");
        }

        markdownBlocks.push("## Transcript");
        if (session.segments.length === 0) {
            markdownBlocks.push("- No transcript segments.");
        } else {
            for (const segment of session.segments) {
                markdownBlocks.push(`- **${segment.speakerLabel ?? "Unknown speaker"}:** ${segment.text}`);
            }
        }

        return markdownBlocks.join("\n");
    }
}

