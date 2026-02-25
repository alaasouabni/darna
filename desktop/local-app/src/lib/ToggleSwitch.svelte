<script lang="ts">
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher<{ change: boolean }>();

    export let id: string;
    export let value: boolean;
    export let title: string = null;

    function handleChange(event: Event) {
        dispatch("change", (event.currentTarget as HTMLInputElement).checked);
    }
</script>

<label for={id} class="toggle-wrap">
    <input
        {id}
        type="checkbox"
        checked={value}
        on:change={handleChange}
    />
    <span class="toggle-track" aria-hidden="true">
        <span class="toggle-thumb" />
    </span>
    {#if title}
        <span class="toggle-label">{title}</span>
    {/if}
</label>

<style>
    .toggle-wrap {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        user-select: none;
    }

    input {
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
        pointer-events: none;
    }

    .toggle-track {
        position: relative;
        width: 46px;
        height: 26px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.12);
        transition: background 140ms ease, border-color 140ms ease;
        flex: 0 0 auto;
    }

    .toggle-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        background: #e8edf4;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        transition: transform 140ms ease, background 140ms ease;
    }

    input:checked + .toggle-track {
        background: rgba(14, 165, 233, 0.28);
        border-color: rgba(14, 165, 233, 0.45);
    }

    input:checked + .toggle-track .toggle-thumb {
        transform: translateX(20px);
        background: #dbeafe;
    }

    input:focus + .toggle-track {
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);
    }

    .toggle-label {
        color: rgba(232, 237, 244, 0.9);
        font-size: 13px;
    }
</style>
