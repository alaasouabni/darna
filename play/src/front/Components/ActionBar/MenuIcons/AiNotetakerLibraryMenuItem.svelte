<script lang="ts">
    import { onMount } from "svelte";
    import { openModal } from "svelte-modals";
    import ActionBarButton from "../ActionBarButton.svelte";
    import PenIcon from "../../Icons/PenIcon.svelte";
    import AiNotetakerPanelModal from "../../Notetaker/AiNotetakerPanelModal.svelte";
    import { AI_NOTETAKER_ENABLED } from "../../../Enum/EnvironmentVariable";
    import { openedMenuStore } from "../../../Stores/MenuStore";
    import { notetakerControls, notetakerStatusStore } from "../../../Stores/NotetakerStore";

    onMount(() => {
        notetakerControls.bootstrapNotetaker();
    });

    function openLibrary(): void {
        openModal(AiNotetakerPanelModal, {});
        openedMenuStore.closeAll();
    }

    $: canShowLibrary = AI_NOTETAKER_ENABLED && $notetakerStatusStore.enabled;
</script>

{#if canShowLibrary}
    <ActionBarButton
        on:click={openLibrary}
        label="AI Notes"
        tooltipTitle="AI Notes Library"
        tooltipDesc="Browse transcripts, summaries, and exports across your discussions"
        state="normal"
    >
        <PenIcon height="h-5" width="w-5" />
    </ActionBarButton>
{/if}
