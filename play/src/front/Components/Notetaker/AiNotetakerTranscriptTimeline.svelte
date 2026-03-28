<script lang="ts">
    import type { NotetakerSession } from "../../Stores/NotetakerStore";
    import AiNotetakerTranscriptRow from "./AiNotetakerTranscriptRow.svelte";

    export let session: NotetakerSession;
    export let isFinalOutputReady = false;
    export let getTimestampLabel: (segment: NotetakerSession["segments"][number]) => string;
    export let showHeader = true;

    interface TranscriptRowViewModel {
        id: string;
        speakerKey: string;
        speakerName: string;
        color?: string;
        avatarUrl?: string;
        characterTextureIds?: string[];
        text: string;
        timestampLabel: string;
        groupedWithPrevious: boolean;
    }

    $: participantByUserId = new Map(
        session.participants.map((participant) => [normalizeSpeakerKey(participant.userId), participant] as const)
    );

    $: rows = session.segments.map((segment, index) => {
        const speakerName = resolveSpeakerName(segment);
        const speakerKey = resolveSpeakerKey(segment, speakerName);
        const previousKey = index > 0 ? resolveSpeakerKey(session.segments[index - 1], resolveSpeakerName(session.segments[index - 1])) : undefined;
        const participant = findParticipant(segment, speakerName);

        const row: TranscriptRowViewModel = {
            id: segment.id,
            speakerKey,
            speakerName,
            color: participant?.color,
            avatarUrl: participant?.avatarUrl,
            characterTextureIds: participant?.characterTextureIds,
            text: segment.text,
            timestampLabel: getTimestampLabel(segment),
            groupedWithPrevious: previousKey === speakerKey,
        };

        return row;
    });

    function normalizeSpeakerKey(value: string | undefined): string {
        if (!value) {
            return "";
        }

        return value.trim().toLowerCase();
    }

    function resolveSpeakerName(segment: NotetakerSession["segments"][number]): string {
        const fromLabel = segment.speakerLabel?.trim();
        if (fromLabel) {
            return fromLabel;
        }

        const fromParticipant = findParticipant(segment, undefined);
        if (fromParticipant?.displayName?.trim()) {
            return fromParticipant.displayName.trim();
        }

        return "Unknown speaker";
    }

    function resolveSpeakerKey(segment: NotetakerSession["segments"][number], speakerName: string): string {
        const bySpaceUserId = normalizeSpeakerKey(segment.speakerSpaceUserId);
        if (bySpaceUserId) {
            return bySpaceUserId;
        }

        const byLabel = normalizeSpeakerKey(speakerName);
        if (byLabel) {
            return byLabel;
        }

        return `unknown-${segment.id}`;
    }

    function findParticipant(
        segment: NotetakerSession["segments"][number],
        speakerName: string | undefined
    ): NotetakerSession["participants"][number] | undefined {
        const fromSpaceUserId = participantByUserId.get(normalizeSpeakerKey(segment.speakerSpaceUserId));
        if (fromSpaceUserId) {
            return fromSpaceUserId;
        }

        const normalizedSpeakerName = speakerName?.trim().toLowerCase();
        if (!normalizedSpeakerName) {
            return undefined;
        }

        return session.participants.find(
            (participant) => participant.displayName?.trim().toLowerCase() === normalizedSpeakerName
        );
    }
</script>

<div class="rounded-lg border border-white/10 bg-dark-600/30 p-2.5">
    {#if showHeader}
        <div class="font-semibold text-sm">Transcript ({session.segments.length})</div>
    {/if}

    {#if !isFinalOutputReady}
        <div class="text-xs opacity-75 mt-1">Partial transcript while processing. Final version appears when status is Ready.</div>
    {/if}

    <div class="max-h-72 overflow-y-auto pr-1 mt-2">
        {#each rows as row (row.id)}
            <AiNotetakerTranscriptRow
                speakerName={row.speakerName}
                speakerKey={row.speakerKey}
                color={row.color}
                avatarUrl={row.avatarUrl}
                characterTextureIds={row.characterTextureIds}
                text={row.text}
                timestampLabel={row.timestampLabel}
                groupedWithPrevious={row.groupedWithPrevious}
            />
        {/each}
    </div>
</div>
