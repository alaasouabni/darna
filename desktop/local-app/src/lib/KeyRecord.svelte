<script lang="ts">
    import { createEventDispatcher } from "svelte";

    export let id: string;
    export let value: string = "";

    const dispatch = createEventDispatcher<{
        change: string;
    }>();

    function keyCodeToElectron(key: string): string {
        if (key.match(/^Key[A-Z]/)) {
            return key.replace(/^Key/, "").toLocaleUpperCase();
        }

        if (key.match(/^Digit[0-9]/)) {
            return key.replace(/^Digit/, "").toLowerCase();
        }

        if (key.match(/^Numpad[0-9]/)) {
            return key.replace(/^Numpad/, "num").toLowerCase();
        }

        switch (key) {
            case "ControlLeft":
            case "ControlRight":
                return "CmdOrCtrl";
            case "AltLeft":
                return "Alt";
            case "AltRight":
                return "AltGr";
            case "ScrollLock":
                return "Scrolllock";
            case "ShiftLeft":
            case "ShiftRight":
                return "Shift";
            case "Period":
                return ".";
            case "Comma":
                return ",";
            case "Slash":
                return "/";
            case "Backslash":
                return "\\";
            case "Minus":
                return "-";
            case "Equal":
                return "=";
            case "BracketLeft":
                return "[";
            case "BracketRight":
                return "]";
            case "Quote":
                return "'";
            case "Semicolon":
                return ";";
            case "IntlBackslash":
                return "\\";
            case "Backquote":
                return "`";
            case "NumpadDecimal":
                return "numdec";
            case "NumpadAdd":
                return "numadd";
            case "NumpadSubtract":
                return "numsub";
            case "NumpadMultiply":
                return "nummult";
            case "NumpadDivide":
                return "numdiv";
            default:
                return key;
        }
    }

    let shortCut: string[] = [];
    let recording = false;
    let recordingTimeout: NodeJS.Timeout;
    let keyInputTimeout: NodeJS.Timeout;

    function resetRecording() {
        recording = false;
        shortCut = [];
        value = "";
        dispatch("change", value);
    }

    function stopRecording() {
        clearTimeout(recordingTimeout);
        recording = false;
        value = shortCut.map(keyCodeToElectron).join(" + ");
        dispatch("change", value);
    }

    function startRecording() {
        if (recording) {
            return;
        }

        recording = true;
        value = "";
        shortCut = [];

        recordingTimeout = setTimeout(() => {
            stopRecording();
        }, 1000 * 5);
    }

    function keyUp(event: KeyboardEvent) {
        if (!recording) {
            return;
        }

        shortCut = [...shortCut, event.code];

        if (!keyInputTimeout) {
            keyInputTimeout = setTimeout(() => {
                stopRecording();
                keyInputTimeout = undefined;
            }, 300);
        }
    }
</script>

<div class="key-record" class:is-recording={recording} on:keyup={keyUp} on:click={startRecording} tabindex="0" role="button">
    <input {id} type="text" disabled {value} aria-label="Shortcut" />

    {#if value.length > 0}
        <button class="clear" type="button" title="Clear shortcut" on:click|stopPropagation={resetRecording}>×</button>
    {/if}

    <button class="record" type="button" on:click|stopPropagation={recording ? stopRecording : startRecording}>
        {#if recording}
            Recording...
        {:else}
            Record
        {/if}
    </button>
</div>

<style>
    .key-record {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: 8px;
        width: 100%;
        min-height: 42px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
        padding: 6px;
        color: #edf2f8;
        outline: none;
    }

    .key-record:focus {
        border-color: rgba(14, 165, 233, 0.5);
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);
    }

    .key-record.is-recording {
        border-color: rgba(239, 68, 68, 0.45);
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12);
    }

    input {
        width: 100%;
        min-width: 0;
        background: transparent;
        border: none;
        color: inherit;
        font-size: 12px;
        padding: 0 8px;
        outline: none;
    }

    input:disabled {
        opacity: 1;
        -webkit-text-fill-color: currentColor;
    }

    button {
        border: 0;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        color: #edf2f8;
    }

    .clear {
        width: 28px;
        height: 28px;
        background: rgba(255, 255, 255, 0.08);
    }

    .clear:hover {
        background: rgba(255, 255, 255, 0.14);
    }

    .record {
        min-width: 94px;
        height: 28px;
        padding: 0 12px;
        background: rgba(255, 255, 255, 0.06);
    }

    .record:hover {
        background: rgba(255, 255, 255, 0.12);
    }

    .key-record.is-recording .record {
        background: rgba(239, 68, 68, 0.18);
        color: #fecaca;
    }
</style>
