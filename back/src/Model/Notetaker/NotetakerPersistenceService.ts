import { getRedisClient } from "../../Services/RedisClient";
import type {
    NotetakerSession,
    NotetakerSessionConfig,
    NotetakerAuditEvent,
    NotetakerParticipantSnapshot,
    NotetakerSummaryVersion,
    NotetakerAudioArtifact,
    TranscriptSegment,
} from "./NotetakerTypes";

const ALL_SESSIONS_SET_KEY = "ai_notetaker:sessions";
const ACTIVE_SESSIONS_HASH_KEY = "ai_notetaker:active_by_space";
const SESSION_KEY_PREFIX = "ai_notetaker:session:";
const SPACE_SESSIONS_SET_PREFIX = "ai_notetaker:space:sessions:";
const USER_SESSIONS_SET_PREFIX = "ai_notetaker:user:sessions:";
const CONFIG_KEY = "ai_notetaker:config";

type RedisClient = NonNullable<Awaited<ReturnType<typeof getRedisClient>>>;

interface SerializedTranscriptSegment extends Omit<TranscriptSegment, "createdAt"> {
    createdAt: string;
}

interface SerializedNotetakerSummaryVersion extends Omit<NotetakerSummaryVersion, "createdAt"> {
    createdAt: string;
}

interface SerializedNotetakerParticipantSnapshot
    extends Omit<NotetakerParticipantSnapshot, "joinedAt" | "lastSeenAt" | "leftAt"> {
    joinedAt: string;
    lastSeenAt: string;
    leftAt?: string;
}

interface SerializedNotetakerAuditEvent extends Omit<NotetakerAuditEvent, "createdAt"> {
    createdAt: string;
}

interface SerializedNotetakerAudioArtifact
    extends Omit<NotetakerAudioArtifact, "createdAt" | "transcribedAt" | "deletedAt"> {
    createdAt: string;
    transcribedAt?: string;
    deletedAt?: string;
}

interface SerializedNotetakerSession
    extends Omit<
        NotetakerSession,
        | "startedAt"
        | "sharedAt"
        | "stoppedAt"
        | "lastSpeechAt"
        | "idleWarningAt"
        | "idleWarningDeadlineAt"
        | "lastSummaryRefreshAt"
        | "segments"
        | "summaries"
        | "participants"
        | "auditEvents"
        | "audioArtifacts"
    > {
    startedAt: string;
    sharedAt?: string;
    stoppedAt?: string;
    lastSpeechAt?: string;
    idleWarningAt?: string;
    idleWarningDeadlineAt?: string;
    lastSummaryRefreshAt?: string;
    segments: SerializedTranscriptSegment[];
    summaries: SerializedNotetakerSummaryVersion[];
    participants: SerializedNotetakerParticipantSnapshot[];
    auditEvents: SerializedNotetakerAuditEvent[];
    audioArtifacts: SerializedNotetakerAudioArtifact[];
}

export class NotetakerPersistenceService {
    public async saveSession(session: NotetakerSession): Promise<void> {
        const client = await this.getClient();
        if (!client) {
            return;
        }

        const key = this.buildSessionKey(session.id);
        const payload = JSON.stringify(this.serializeSession(session));

        await client.set(key, payload);
        await client.sAdd(ALL_SESSIONS_SET_KEY, session.id);
        await client.sAdd(this.buildSpaceSessionsKey(session.spaceName), session.id);

        for (const participant of session.participants) {
            await client.sAdd(this.buildUserSessionsKey(participant.userId), session.id);
        }
    }

    public async deleteSession(sessionId: string, spaceName: string, participantIds: string[]): Promise<void> {
        const client = await this.getClient();
        if (!client) {
            return;
        }

        await client.del(this.buildSessionKey(sessionId));
        await client.sRem(ALL_SESSIONS_SET_KEY, sessionId);
        await client.sRem(this.buildSpaceSessionsKey(spaceName), sessionId);

        for (const participantId of participantIds) {
            await client.sRem(this.buildUserSessionsKey(participantId), sessionId);
        }
    }

    public async setActiveSession(spaceName: string, sessionId: string): Promise<void> {
        const client = await this.getClient();
        if (!client) {
            return;
        }

        await client.hSet(ACTIVE_SESSIONS_HASH_KEY, spaceName, sessionId);
    }

    public async clearActiveSession(spaceName: string, expectedSessionId?: string): Promise<void> {
        const client = await this.getClient();
        if (!client) {
            return;
        }

        if (!expectedSessionId) {
            await client.hDel(ACTIVE_SESSIONS_HASH_KEY, spaceName);
            return;
        }

        const currentSessionId = await client.hGet(ACTIVE_SESSIONS_HASH_KEY, spaceName);
        if (currentSessionId === expectedSessionId) {
            await client.hDel(ACTIVE_SESSIONS_HASH_KEY, spaceName);
        }
    }

    public async getActiveSessionId(spaceName: string): Promise<string | undefined> {
        const client = await this.getClient();
        if (!client) {
            return undefined;
        }

        return (await client.hGet(ACTIVE_SESSIONS_HASH_KEY, spaceName)) ?? undefined;
    }

    public async listActiveSessionIds(): Promise<string[]> {
        const client = await this.getClient();
        if (!client) {
            return [];
        }

        const activeMap = await client.hGetAll(ACTIVE_SESSIONS_HASH_KEY);
        return Array.from(new Set(Object.values(activeMap)));
    }

    public async getSession(sessionId: string): Promise<NotetakerSession | undefined> {
        const client = await this.getClient();
        if (!client) {
            return undefined;
        }

        const raw = await client.get(this.buildSessionKey(sessionId));
        if (!raw) {
            return undefined;
        }

        return this.deserializeSession(raw);
    }

    public async listSessions(spaceName?: string): Promise<NotetakerSession[]> {
        const client = await this.getClient();
        if (!client) {
            return [];
        }

        const sessionIds = spaceName
            ? await client.sMembers(this.buildSpaceSessionsKey(spaceName))
            : await client.sMembers(ALL_SESSIONS_SET_KEY);

        return this.loadSessionsByIds(client, sessionIds);
    }

    public async listSessionsByUser(userId: string): Promise<NotetakerSession[]> {
        const client = await this.getClient();
        if (!client) {
            return [];
        }

        const sessionIds = await client.sMembers(this.buildUserSessionsKey(userId));
        return this.loadSessionsByIds(client, sessionIds);
    }

    public async getConfig(): Promise<NotetakerSessionConfig | undefined> {
        const client = await this.getClient();
        if (!client) {
            return undefined;
        }

        const raw = await client.get(CONFIG_KEY);
        if (!raw) {
            return undefined;
        }

        try {
            return JSON.parse(raw) as NotetakerSessionConfig;
        } catch {
            return undefined;
        }
    }

    public async saveConfig(config: NotetakerSessionConfig): Promise<void> {
        const client = await this.getClient();
        if (!client) {
            return;
        }

        await client.set(CONFIG_KEY, JSON.stringify(config));
    }

    private async loadSessionsByIds(client: RedisClient, sessionIds: string[]): Promise<NotetakerSession[]> {
        if (sessionIds.length === 0) {
            return [];
        }

        const sessions: NotetakerSession[] = [];
        for (const sessionId of sessionIds) {
            const raw = await client.get(this.buildSessionKey(sessionId));
            if (!raw) {
                continue;
            }

            const session = this.deserializeSession(raw);
            if (session) {
                sessions.push(session);
            }
        }

        return sessions.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    }

    private async getClient(): Promise<RedisClient | null> {
        return await getRedisClient();
    }

    private serializeSession(session: NotetakerSession): SerializedNotetakerSession {
        return {
            ...session,
            startedAt: session.startedAt.toISOString(),
            sharedAt: session.sharedAt?.toISOString(),
            stoppedAt: session.stoppedAt?.toISOString(),
            lastSpeechAt: session.lastSpeechAt?.toISOString(),
            idleWarningAt: session.idleWarningAt?.toISOString(),
            idleWarningDeadlineAt: session.idleWarningDeadlineAt?.toISOString(),
            lastSummaryRefreshAt: session.lastSummaryRefreshAt?.toISOString(),
            segments: session.segments.map((segment) => ({
                ...segment,
                createdAt: segment.createdAt.toISOString(),
            })),
            summaries: session.summaries.map((summary) => ({
                ...summary,
                createdAt: summary.createdAt.toISOString(),
            })),
            participants: session.participants.map((participant) => ({
                ...participant,
                joinedAt: participant.joinedAt.toISOString(),
                lastSeenAt: participant.lastSeenAt.toISOString(),
                leftAt: participant.leftAt?.toISOString(),
            })),
            auditEvents: session.auditEvents.map((event) => ({
                ...event,
                createdAt: event.createdAt.toISOString(),
            })),
            audioArtifacts: session.audioArtifacts.map((artifact) => ({
                ...artifact,
                createdAt: artifact.createdAt.toISOString(),
                transcribedAt: artifact.transcribedAt?.toISOString(),
                deletedAt: artifact.deletedAt?.toISOString(),
            })),
        };
    }

    private deserializeSession(raw: string): NotetakerSession | undefined {
        try {
            const parsed = JSON.parse(raw) as SerializedNotetakerSession;

            return {
                ...parsed,
                startedAt: new Date(parsed.startedAt),
                sharedAt: parsed.sharedAt ? new Date(parsed.sharedAt) : undefined,
                stoppedAt: parsed.stoppedAt ? new Date(parsed.stoppedAt) : undefined,
                lastSpeechAt: parsed.lastSpeechAt ? new Date(parsed.lastSpeechAt) : undefined,
                idleWarningAt: parsed.idleWarningAt ? new Date(parsed.idleWarningAt) : undefined,
                idleWarningDeadlineAt: parsed.idleWarningDeadlineAt
                    ? new Date(parsed.idleWarningDeadlineAt)
                    : undefined,
                lastSummaryRefreshAt: parsed.lastSummaryRefreshAt ? new Date(parsed.lastSummaryRefreshAt) : undefined,
                segments: parsed.segments.map((segment) => ({
                    ...segment,
                    createdAt: new Date(segment.createdAt),
                })),
                summaries: parsed.summaries.map((summary) => ({
                    ...summary,
                    createdAt: new Date(summary.createdAt),
                })),
                participants: parsed.participants.map((participant) => ({
                    ...participant,
                    joinedAt: new Date(participant.joinedAt),
                    lastSeenAt: new Date(participant.lastSeenAt),
                    leftAt: participant.leftAt ? new Date(participant.leftAt) : undefined,
                })),
                auditEvents: parsed.auditEvents.map((event) => ({
                    ...event,
                    createdAt: new Date(event.createdAt),
                })),
                audioArtifacts: (parsed.audioArtifacts ?? []).map((artifact) => ({
                    ...artifact,
                    createdAt: new Date(artifact.createdAt),
                    transcribedAt: artifact.transcribedAt ? new Date(artifact.transcribedAt) : undefined,
                    deletedAt: artifact.deletedAt ? new Date(artifact.deletedAt) : undefined,
                })),
            };
        } catch {
            return undefined;
        }
    }

    private buildSessionKey(sessionId: string): string {
        return `${SESSION_KEY_PREFIX}${sessionId}`;
    }

    private buildSpaceSessionsKey(spaceName: string): string {
        return `${SPACE_SESSIONS_SET_PREFIX}${spaceName}`;
    }

    private buildUserSessionsKey(userId: string): string {
        return `${USER_SESSIONS_SET_PREFIX}${userId}`;
    }
}

export const notetakerPersistenceService = new NotetakerPersistenceService();
