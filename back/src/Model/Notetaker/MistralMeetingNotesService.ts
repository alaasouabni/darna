import axios from "axios";
import { randomUUID } from "crypto";
import {
    MISTRAL_API_KEY,
    MISTRAL_BASE_URL,
    MISTRAL_CHAT_MODEL,
    MISTRAL_SUMMARY_MAX_CHARS,
    MISTRAL_TRANSCRIPTION_MODEL,
} from "../../Enum/EnvironmentVariable";
import type { NotetakerSummary } from "./NotetakerTypes";

interface MistralChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

interface MistralChatCompletionResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
}

export class MistralMeetingNotesService {
    private readonly baseUrl = typeof MISTRAL_BASE_URL === "string" ? MISTRAL_BASE_URL : "https://api.mistral.ai";
    private readonly model = typeof MISTRAL_CHAT_MODEL === "string" ? MISTRAL_CHAT_MODEL : "mistral-small-latest";
    private readonly transcriptionModel = this.resolveTranscriptionModel();
    private readonly maxChars =
        typeof MISTRAL_SUMMARY_MAX_CHARS === "number" && Number.isFinite(MISTRAL_SUMMARY_MAX_CHARS)
            ? Math.max(1000, MISTRAL_SUMMARY_MAX_CHARS)
            : 20000;
    private readonly apiKey = typeof MISTRAL_API_KEY === "string" ? MISTRAL_API_KEY : undefined;

    private resolveTranscriptionModel(): string {
        const configuredModel = MISTRAL_TRANSCRIPTION_MODEL?.trim();
        if (!configuredModel) {
            return "voxtral-mini-latest";
        }

        // Realtime-only models are not supported by this file-upload transcription path.
        if (
            configuredModel === "voxtral-mini-transcribe-realtime-2602" ||
            configuredModel === "voxtral-mini-realtime-2602" ||
            configuredModel === "voxtral-mini-realtime-latest"
        ) {
            return "voxtral-mini-latest";
        }

        return configuredModel;
    }

    public isConfigured(): boolean {
        return Boolean(this.apiKey);
    }

    public async transcribeAudioChunk(
        audioChunk: Buffer,
        mimeType: string,
        languageHint?: string,
        contextBias?: string[]
    ): Promise<string | undefined> {
        if (!this.apiKey) {
            return undefined;
        }

        if (audioChunk.length === 0) {
            return undefined;
        }

        const requestId = randomUUID();
        const extension = this.getAudioExtensionFromMimeType(mimeType);
        const formData = this.buildTranscriptionFormData(audioChunk, mimeType, extension, requestId, languageHint, contextBias);

        const response = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "X-Request-ID": requestId,
            },
            body: formData,
        });

        if (!response.ok) {
            const details = await response.text().catch(() => "Unable to decode error payload");
            throw new Error(`Mistral transcription request failed with status ${response.status}: ${details}`);
        }

        const payload = (await response.json()) as {
            text?: string;
        };

        const transcribedText = payload.text?.trim();
        return transcribedText && transcribedText.length > 0 ? transcribedText : undefined;
    }

    private buildTranscriptionFormData(
        audioChunk: Buffer,
        mimeType: string,
        extension: string,
        requestId: string,
        languageHint?: string,
        contextBias?: string[]
    ): FormData {
        const formData = new FormData();
        const audioChunkBlobPart = Uint8Array.from(audioChunk);
        formData.append(
            "file",
            new Blob([audioChunkBlobPart], {
                type: mimeType,
            }),
            `meeting-chunk-${requestId}.${extension}`
        );
        formData.append("model", this.transcriptionModel);

        if (languageHint && languageHint.trim()) {
            formData.append("language", languageHint.trim());
        }

        if (contextBias && contextBias.length > 0) {
            const mergedContextBias = contextBias
                .map((bias) => bias.trim())
                .filter((bias) => bias.length > 0)
                .slice(0, 100)
                .join(",");
            if (mergedContextBias.length > 0) {
                formData.append("context_bias", mergedContextBias);
            }
        }

        return formData;
    }

    public async generateSummary(transcript: string, languageHint?: string): Promise<NotetakerSummary> {
        const normalizedTranscript = transcript.trim();
        if (!normalizedTranscript) {
            return {
                summaryMarkdown: "No transcript content was captured for this session.",
                decisions: [],
                actionItems: [],
            };
        }

        if (!this.apiKey) {
            return this.createFallbackSummary(normalizedTranscript);
        }

        const transcriptChunk = normalizedTranscript.slice(0, this.maxChars);
        const messages: MistralChatMessage[] = [
            {
                role: "system",
                content:
                    "You are an assistant that creates concise meeting notes. " +
                    "Return ONLY a JSON object with keys: summaryMarkdown (string), decisions (string[]), actionItems (string[]). " +
                    "Do not wrap JSON in markdown fences.",
            },
            {
                role: "user",
                content:
                    `Language hint: ${languageHint ?? "auto"}\n` +
                    "Create meeting notes from this transcript:\n" +
                    transcriptChunk,
            },
        ];

        const requestId = randomUUID();
        const response = await axios.post<MistralChatCompletionResponse>(
            `${this.baseUrl}/v1/chat/completions`,
            {
                model: this.model,
                temperature: 0.2,
                messages,
            },
            {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    "X-Request-ID": requestId,
                },
                timeout: 30000,
            }
        );

        const content = response.data.choices?.[0]?.message?.content?.trim();
        if (!content) {
            return this.createFallbackSummary(normalizedTranscript);
        }

        const parsed = this.tryParseSummary(content);
        if (parsed) {
            return parsed;
        }

        return {
            summaryMarkdown: content,
            decisions: [],
            actionItems: [],
        };
    }

    private tryParseSummary(content: string): NotetakerSummary | undefined {
        const direct = this.safeJsonParse(content);
        if (direct) {
            return direct;
        }

        const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i);
        if (fencedMatch?.[1]) {
            return this.safeJsonParse(fencedMatch[1]);
        }

        return undefined;
    }

    private safeJsonParse(input: string): NotetakerSummary | undefined {
        try {
            const parsed = JSON.parse(input) as Partial<NotetakerSummary>;
            const summaryMarkdown = typeof parsed.summaryMarkdown === "string" ? parsed.summaryMarkdown : undefined;
            const decisions = Array.isArray(parsed.decisions)
                ? parsed.decisions.filter((item): item is string => typeof item === "string")
                : [];
            const actionItems = Array.isArray(parsed.actionItems)
                ? parsed.actionItems.filter((item): item is string => typeof item === "string")
                : [];

            if (!summaryMarkdown) {
                return undefined;
            }

            return {
                summaryMarkdown,
                decisions,
                actionItems,
            };
        } catch {
            return undefined;
        }
    }

    private createFallbackSummary(transcript: string): NotetakerSummary {
        const lines = transcript
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, 8);

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

    private getAudioExtensionFromMimeType(mimeType: string): string {
        const normalizedMime = mimeType.toLowerCase();

        if (normalizedMime.includes("webm")) {
            return "webm";
        }
        if (normalizedMime.includes("ogg")) {
            return "ogg";
        }
        if (normalizedMime.includes("wav")) {
            return "wav";
        }
        if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3")) {
            return "mp3";
        }

        return "bin";
    }
}

export const mistralMeetingNotesService = new MistralMeetingNotesService();
