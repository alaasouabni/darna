<script lang="ts">
    export let id: string;
    export let label: string | undefined = undefined;
    export let labelPill: string | undefined = undefined;
    export let value = false;
    export let onChange = () => {};
    export let disabled = false;
    export let labelPosition: "top" | "right" = "right";
    export let variant: "white" | "black" = "black";

    let uniqueId = id || `input-${Math.random().toString(36).substring(2, 9)} `;
</script>

<div class="value-switch">
    {#if labelPosition === "top" && label}
        <label for={uniqueId} class="input-label">{label}</label>
    {/if}
    <label class="inline-flex cursor-pointer items-center relative mt-3">
        <input
            id={uniqueId}
            type="checkbox"
            class="sr-only peer"
            bind:checked={value}
            on:change={onChange}
            {disabled}
        />
        <div class="input-switch" class:input-switch-white={variant === "white"} data-testid={uniqueId} />
        {#if labelPosition === "right" && label}
            <span class="input-label input-label-inline ml-3 text-white/50 font-regular peer-checked:text-white">
                {#if labelPill}
                    <span class="input-label-pill mr-2">{labelPill}</span>
                {/if}
                {label}
            </span>
        {/if}
    </label>
</div>

<style lang="scss">
    .input-label-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 18px;
        padding: 0 7px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.32);
        background: rgba(255, 255, 255, 0.15);
        color: rgba(255, 255, 255, 0.92);
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        vertical-align: middle;
        transform: translateY(-1px);
    }
</style>
