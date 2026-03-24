import axios from "axios";
import {
    AI_NOTETAKER_DELIVERY_INTERVAL_MS,
    AI_NOTETAKER_DELIVERY_MAX_RETRIES,
    AI_NOTETAKER_DIGEST_WEBHOOK_URL,
    AI_NOTETAKER_EMAIL_DIGEST_ENABLED,
    AI_NOTETAKER_ENABLED,
} from "../../Enum/EnvironmentVariable";
import { notetakerDeliveryQueueService, type MeetingNotesDigestJob } from "./NotetakerDeliveryQueueService";

interface DigestWebhookPayload {
    id: string;
    sessionId: string;
    spaceName: string;
    createdAt: string;
    participantEmails: string[];
    summary?: {
        summaryMarkdown: string;
        decisions: string[];
        actionItems: string[];
        version: number;
        final: boolean;
        createdAt: Date;
    };
}

export class NotetakerDeliveryWorkerService {
    private timer: NodeJS.Timeout | undefined;
    private queueTask: Promise<void> = Promise.resolve();

    public start(): void {
        if (!AI_NOTETAKER_ENABLED || !AI_NOTETAKER_EMAIL_DIGEST_ENABLED || this.timer) {
            return;
        }

        const intervalMs = Math.max(2000, AI_NOTETAKER_DELIVERY_INTERVAL_MS);
        this.timer = setInterval(() => {
            void this.processTick();
        }, intervalMs);
    }

    private async processTick(): Promise<void> {
        const run = this.queueTask.then(
            async () => {
                await this.processOneJob();
            },
            async () => {
                await this.processOneJob();
            }
        );

        this.queueTask = run.then(
            () => undefined,
            () => undefined
        );

        await run;
    }

    private async processOneJob(): Promise<void> {
        const job = await notetakerDeliveryQueueService.dequeueDigestJob();
        if (!job) {
            return;
        }

        try {
            await this.deliverDigest(job);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown delivery error";
            const nextRetryCount = job.retryCount + 1;

            if (nextRetryCount > AI_NOTETAKER_DELIVERY_MAX_RETRIES) {
                await notetakerDeliveryQueueService.sendDigestJobToDeadLetter(job, errorMessage);
                console.error("AI notetaker delivery moved to dead-letter queue", {
                    jobId: job.id,
                    sessionId: job.sessionId,
                    retryCount: job.retryCount,
                    errorMessage,
                });
                return;
            }

            await notetakerDeliveryQueueService.requeueDigestJob(job, errorMessage);
            console.warn("AI notetaker delivery retry scheduled", {
                jobId: job.id,
                sessionId: job.sessionId,
                retryCount: nextRetryCount,
                maxRetries: AI_NOTETAKER_DELIVERY_MAX_RETRIES,
                errorMessage,
            });
        }
    }

    private async deliverDigest(job: MeetingNotesDigestJob): Promise<void> {
        const payload: DigestWebhookPayload = {
            id: job.id,
            sessionId: job.sessionId,
            spaceName: job.spaceName,
            createdAt: job.createdAt,
            participantEmails: job.participantEmails,
            summary: job.summary,
        };

        if (!AI_NOTETAKER_DIGEST_WEBHOOK_URL) {
            console.info("AI notetaker digest job completed without webhook endpoint", {
                sessionId: job.sessionId,
                participantCount: job.participantEmails.length,
            });
            return;
        }

        await axios.post(AI_NOTETAKER_DIGEST_WEBHOOK_URL, payload, {
            timeout: 10000,
            headers: {
                "Content-Type": "application/json",
            },
        });

        console.info("AI notetaker digest job delivered", {
            sessionId: job.sessionId,
            participantCount: job.participantEmails.length,
        });
    }
}

export const notetakerDeliveryWorkerService = new NotetakerDeliveryWorkerService();
