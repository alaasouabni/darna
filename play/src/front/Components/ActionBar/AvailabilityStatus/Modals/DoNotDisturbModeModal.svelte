<script lang="ts">
    import { AvailabilityStatus } from "@workadventure/messages";
    import PopUpContainer from "../../../PopUp/PopUpContainer.svelte";
    import { resetAllStatusStoreExcept } from "../../../../Rules/StatusRules/statusChangerFunctions";
    import { IconMicrophoneOff, IconVideoOff, IconVolumeOff } from "../../../Icons";

    export let status: AvailabilityStatus;

    $: isDnd = status === AvailabilityStatus.DO_NOT_DISTURB;
    $: title = isDnd ? "Do Not Disturb mode" : "Back in a Moment mode";
    $: description = isDnd
        ? "You are in Do Not Disturb mode. Your mic and camera are off, and you will not hear anything in the office."
        : "You are in Back in a Moment mode. Your mic and camera are off, and you will not hear anything in the office.";

    const makeAvailable = () => {
        resetAllStatusStoreExcept();
    };
</script>

<div class="status-modal-overlay">
    <div class="status-modal-card">
        <PopUpContainer extraClasses="max-w-md w-full" fullContent>
            <div class="flex flex-col items-center gap-3">
                <div class="text-xl font-semibold">{title}</div>
                <div class="flex items-center justify-center gap-3">
                    <span class="status-icon">
                        <IconMicrophoneOff font-size="20" />
                    </span>
                    <span class="status-icon">
                        <IconVideoOff font-size="20" />
                    </span>
                    <span class="status-icon">
                        <IconVolumeOff font-size="20" />
                    </span>
                </div>
                <div class="text-sm opacity-90 text-center">{description}</div>
                <button class="btn btn-secondary btn-sm w-full" on:click={makeAvailable}>Make me available</button>
            </div>
        </PopUpContainer>
    </div>
</div>

<style lang="scss">
    .status-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 9999px;
        background: rgba(239, 68, 68, 0.18);
        color: #f87171;
    }

    .status-modal-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        pointer-events: none;
    }

    .status-modal-card {
        pointer-events: auto;
        padding: 0 1rem;
    }
</style>
