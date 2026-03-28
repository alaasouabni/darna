<script lang="ts">
    import AiNotetakerSpeakerAvatar from "./AiNotetakerSpeakerAvatar.svelte";

    export let speakerName: string;
    export let speakerKey: string;
    export let color: string | undefined = undefined;
    export let avatarUrl: string | undefined = undefined;
    export let characterTextureIds: string[] | undefined = undefined;
    export let text: string;
    export let timestampLabel: string;
    export let groupedWithPrevious = false;

    $: rowGapClass = groupedWithPrevious ? "pt-1" : "pt-3";
</script>

<div class="flex items-start gap-2 {rowGapClass}">
    <div class="w-7 shrink-0 flex justify-center">
        {#if !groupedWithPrevious}
            <AiNotetakerSpeakerAvatar
                speakerName={speakerName}
                speakerKey={speakerKey}
                {color}
                {avatarUrl}
                {characterTextureIds}
                size="md"
            />
        {/if}
    </div>

    <div class="min-w-0 flex-1">
        {#if !groupedWithPrevious}
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                <div class="font-bold text-xs">{speakerName}</div>
                <div class="text-xxs opacity-65">{timestampLabel}</div>
            </div>
        {/if}

        <div class="rounded-md bg-contrast px-2 py-1.5">
            <div class="whitespace-pre-wrap break-words text-[13px] leading-5">{text}</div>
        </div>

        {#if groupedWithPrevious}
            <div class="text-xxs opacity-60 mt-1 pl-1">{timestampLabel}</div>
        {/if}
    </div>
</div>
