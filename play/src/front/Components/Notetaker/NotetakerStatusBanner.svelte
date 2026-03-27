<script lang="ts">
    import { onDestroy } from "svelte";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import {
        notetakerCanManageStore,
        notetakerControls,
        notetakerLoadingStore,
        notetakerRuntimeStateStore,
        notetakerSessionStore,
        notetakerStatusStore,
    } from "../../Stores/NotetakerStore";

    let now = Date.now();
    let ticker: ReturnType<typeof setInterval> | undefined;

    $: shouldDisplay =
        $notetakerRuntimeStateStore === "starting" ||
        $notetakerRuntimeStateStore === "active" ||
        $notetakerRuntimeStateStore === "idle-warning" ||
        $notetakerRuntimeStateStore === "stopping";

    $: deadline = $notetakerSessionStore?.idleWarningDeadlineAt
        ? new Date($notetakerSessionStore.idleWarningDeadlineAt).getTime()
        : undefined;

    $: if ($notetakerRuntimeStateStore === "idle-warning" && deadline && !ticker) {
        ticker = setInterval(() => {
            now = Date.now();
        }, 1000);
    }

    $: if ($notetakerRuntimeStateStore !== "idle-warning" && ticker) {
        clearInterval(ticker);
        ticker = undefined;
    }

    onDestroy(() => {
        if (ticker) {
            clearInterval(ticker);
        }
    });

    $: secondsLeft = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
    $: minutes = Math.floor(secondsLeft / 60);
    $: seconds = secondsLeft % 60;
    $: countdown = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    $: currentUser = localUserStore.getLocalUser();
    $: currentUserIdentifiers = collectCurrentUserIdentifiers(currentUser);
    $: statusUserIdentifiers = collectStatusUserIdentifiers(
        $notetakerStatusStore.viewerUserId,
        $notetakerStatusStore.viewerEmail
    );
    $: viewerIdentifiers = Array.from(new Set([...statusUserIdentifiers, ...currentUserIdentifiers]));
    $: ownerUserId = $notetakerSessionStore?.ownerUserId ?? $notetakerSessionStore?.startedByUserId;
    $: isCurrentUserOwner =
        typeof $notetakerSessionStore?.viewerIsOwner === "boolean"
            ? $notetakerSessionStore.viewerIsOwner
            : Boolean(ownerUserId) && viewerIdentifiers.some((identifier) => idsMatch(identifier, ownerUserId));

    function normalizeUserId(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }

        return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
    }

    function idsMatch(left: string | undefined, right: string | undefined): boolean {
        const normalizedLeft = normalizeUserId(left);
        const normalizedRight = normalizeUserId(right);
        return Boolean(normalizedLeft) && Boolean(normalizedRight) && normalizedLeft === normalizedRight;
    }

    function collectCurrentUserIdentifiers(
        user: ReturnType<typeof localUserStore.getLocalUser> | undefined | null
    ): string[] {
        if (!user) {
            return [];
        }

        const normalized = [normalizeUserId(user.uuid), normalizeUserId(user.email ?? undefined)].filter(
            (value): value is string => Boolean(value)
        );
        return Array.from(new Set(normalized));
    }

    function collectStatusUserIdentifiers(userId?: string, email?: string): string[] {
        const normalized = [normalizeUserId(userId), normalizeUserId(email)].filter(
            (value): value is string => Boolean(value)
        );
        return Array.from(new Set(normalized));
    }
</script>

{#if shouldDisplay}
    <div class="fixed bottom-4 start-4 z-[250] pointer-events-auto w-[min(92vw,22rem)]">
        <div class="rounded-xl border border-white/15 bg-contrast/90 backdrop-blur-md px-4 py-3 shadow-lg">
            {#if $notetakerRuntimeStateStore === "idle-warning"}
                <div class="font-semibold text-sm">AI notes: no speech detected.</div>
                <div class="text-xs opacity-80 mt-1">Auto-stop in {countdown}.</div>
                {#if isCurrentUserOwner}
                    <div class="mt-2 flex gap-2 justify-end">
                        <button
                            class="btn btn-secondary text-sm"
                            disabled={$notetakerLoadingStore || !$notetakerCanManageStore}
                            on:click={() => void notetakerControls.keepRunning()}
                        >
                            Keep running
                        </button>
                        <button
                            class="btn text-sm"
                            disabled={$notetakerLoadingStore}
                            on:click={() => void notetakerControls.stopSession()}
                        >
                            Stop now
                        </button>
                    </div>
                {:else}
                    <div class="text-xs opacity-75 mt-2">Waiting for the starter to decide.</div>
                {/if}
            {:else if $notetakerRuntimeStateStore === "starting"}
                <div class="font-semibold text-sm">AI notes are starting...</div>
            {:else if $notetakerRuntimeStateStore === "stopping"}
                <div class="font-semibold text-sm">AI notes are stopping...</div>
            {:else}
                <div class="font-semibold text-sm">AI notes are active in this meeting.</div>
            {/if}
        </div>
    </div>
{/if}
