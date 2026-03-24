import { getRedisClient } from "../../Services/RedisClient";
import type { NotetakerSession, NotetakerSummaryVersion } from "./NotetakerTypes";

const DELIVERY_QUEUE_KEY = "ai_notetaker:delivery:queue";
const DELIVERY_DEAD_LETTER_QUEUE_KEY = "ai_notetaker:delivery:dead_letter";

export interface MeetingNotesDigestJob {
    id: string;
    sessionId: string;
    spaceName: string;
    createdAt: string;
    participantEmails: string[];
    summary?: NotetakerSummaryVersion;
    retryCount: number;
    lastError?: string;
}

export class NotetakerDeliveryQueueService {
    public async enqueueSessionDigest(session: NotetakerSession): Promise<void> {
        const client = await getRedisClient();
        if (!client) {
            return;
        }

        const participantEmails = session.participants
            .map((participant) => participant.email?.trim())
            .filter((email): email is string => Boolean(email));

        if (participantEmails.length === 0) {
            return;
        }

        const summary = session.summaries.find((candidate) => candidate.final) ?? session.summaries.at(-1);

        const job: MeetingNotesDigestJob = {
            id: `${session.id}:${Date.now()}`,
            sessionId: session.id,
            spaceName: session.spaceName,
            createdAt: new Date().toISOString(),
            participantEmails,
            summary,
            retryCount: 0,
        };

        await client.rPush(DELIVERY_QUEUE_KEY, JSON.stringify(job));
    }

    public async dequeueDigestJob(): Promise<MeetingNotesDigestJob | undefined> {
        const client = await getRedisClient();
        if (!client) {
            return undefined;
        }

        const rawJob = await client.lPop(DELIVERY_QUEUE_KEY);
        if (!rawJob) {
            return undefined;
        }

        try {
            return JSON.parse(rawJob) as MeetingNotesDigestJob;
        } catch {
            return undefined;
        }
    }

    public async requeueDigestJob(job: MeetingNotesDigestJob, lastError: string): Promise<void> {
        const client = await getRedisClient();
        if (!client) {
            return;
        }

        const retriedJob: MeetingNotesDigestJob = {
            ...job,
            retryCount: job.retryCount + 1,
            lastError,
        };

        await client.rPush(DELIVERY_QUEUE_KEY, JSON.stringify(retriedJob));
    }

    public async sendDigestJobToDeadLetter(job: MeetingNotesDigestJob, lastError: string): Promise<void> {
        const client = await getRedisClient();
        if (!client) {
            return;
        }

        const failedJob: MeetingNotesDigestJob = {
            ...job,
            lastError,
        };

        await client.rPush(DELIVERY_DEAD_LETTER_QUEUE_KEY, JSON.stringify(failedJob));
    }
}

export const notetakerDeliveryQueueService = new NotetakerDeliveryQueueService();
