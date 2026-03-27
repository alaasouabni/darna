<script lang="ts">
    import { onMount } from "svelte";
    import { closeModal } from "svelte-modals";
    import Popup from "../Modal/Popup.svelte";
    import {
        notetakerControls,
        notetakerLoadingStore,
        type NotetakerSession,
        type NotetakerShareCandidate,
    } from "../../Stores/NotetakerStore";

    export let isOpen: boolean;
    export let session: NotetakerSession;
    export let showOwnerStopMessage = false;

    let candidates: NotetakerShareCandidate[] = [];
    let selectedUserIds = new Set<string>((session.sharedWithUserIds ?? []).map((userId) => normalizeRecipientId(userId)));
    let recipientInput = "";
    let isLoadingCandidates = false;

    $: normalizedFilterTerm = recipientInput.trim().toLowerCase();
    $: candidatesByUserId = new Map(candidates.map((candidate) => [normalizeRecipientId(candidate.userId), candidate]));
    $: selectedRecipients = Array.from(selectedUserIds);
    $: filteredCandidates = candidates.filter((candidate) => {
        if (!normalizedFilterTerm) {
            return true;
        }

        const haystack = [candidate.displayName, candidate.email, candidate.userId]
            .filter((value): value is string => typeof value === "string")
            .join(" ")
            .toLowerCase();

        return haystack.includes(normalizedFilterTerm);
    });
    $: filteredCurrentSessionCandidates = filteredCandidates.filter((candidate) => candidate.isCurrentSessionParticipant);
    $: filteredHistoricalCandidates = filteredCandidates.filter((candidate) => !candidate.isCurrentSessionParticipant);

    function normalizeRecipientId(userId: string): string {
        const normalized = userId.trim();
        if (!normalized) {
            return "";
        }

        return normalized.includes("@") ? normalized.toLowerCase() : normalized;
    }

    function parseRecipientTokens(input: string): string[] {
        return Array.from(new Set(input.split(/[,\s;]+/).map((value) => normalizeRecipientId(value)).filter(Boolean)));
    }

    onMount(() => {
        void loadCandidates();
    });

    async function loadCandidates(): Promise<void> {
        isLoadingCandidates = true;
        try {
            const [candidateList, currentShares] = await Promise.all([
                notetakerControls.getSessionShareCandidates(session.id),
                notetakerControls.getSessionShares(session.id),
            ]);

            candidates = candidateList;
            const defaultSelectedIds =
                currentShares.length > 0
                    ? currentShares.map((candidate) => candidate.userId)
                    : (session.sharedWithUserIds ?? []);
            selectedUserIds = new Set(defaultSelectedIds.map((userId) => normalizeRecipientId(userId)).filter(Boolean));
        } finally {
            isLoadingCandidates = false;
        }
    }

    function isCandidateSelected(userId: string): boolean {
        return selectedUserIds.has(userId);
    }

    function toggleCandidate(userId: string, checked: boolean): void {
        const next = new Set(selectedUserIds);
        const normalizedUserId = normalizeRecipientId(userId);
        if (checked) {
            next.add(normalizedUserId);
        } else {
            next.delete(normalizedUserId);
        }
        selectedUserIds = next;
    }

    function onCandidateSelectionChange(userId: string, event: Event): void {
        const target = event.currentTarget;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        toggleCandidate(userId, target.checked);
    }

    function addManualRecipientsFromInput(): void {
        const tokens = parseRecipientTokens(recipientInput);
        if (tokens.length === 0) {
            return;
        }

        const next = new Set(selectedUserIds);
        for (const token of tokens) {
            next.add(token);
        }

        selectedUserIds = next;
        recipientInput = "";
    }

    function removeRecipient(userId: string): void {
        const normalizedUserId = normalizeRecipientId(userId);
        const next = new Set(selectedUserIds);
        next.delete(normalizedUserId);
        selectedUserIds = next;
    }

    function onManualRecipientKeyDown(event: KeyboardEvent): void {
        if (event.key !== "Enter") {
            return;
        }

        event.preventDefault();
        addManualRecipientsFromInput();
    }

    function getRecipientLabel(userId: string): string {
        const candidate = candidatesByUserId.get(normalizeRecipientId(userId));
        if (!candidate) {
            return userId;
        }

        return candidate.displayName || candidate.email || candidate.userId;
    }

    async function keepPrivate(): Promise<void> {
        const updated = await notetakerControls.updateSessionSharing(session.id, []);
        if (updated) {
            closeModal();
        }
    }

    async function shareSelected(): Promise<void> {
        const updated = await notetakerControls.updateSessionSharing(
            session.id,
            Array.from(selectedUserIds).sort((left, right) => left.localeCompare(right))
        );
        if (updated) {
            closeModal();
        }
    }

    function formatCandidateMeta(candidate: NotetakerShareCandidate): string {
        const parts: string[] = [];
        if (candidate.email) {
            parts.push(candidate.email);
        }
        if (candidate.isCurrentSessionParticipant) {
            parts.push("In this session");
        }
        if (candidate.joinedAt) {
            parts.push(`Joined ${new Date(candidate.joinedAt).toLocaleString()}`);
        }
        return parts.join(" - ");
    }
</script>

<Popup {isOpen} maxWidthClass="sm:max-w-[820px]">
    <h1 slot="title" class="text-2xl font-bold">Share AI Notes Session</h1>
    <div slot="content" class="w-full px-1">
        <div class="rounded-xl bg-dark-500/50 p-4">
            <div class="font-semibold">{session.spaceName}</div>
            <div class="text-xs opacity-75 mt-1">
                Started {new Date(session.startedAt).toLocaleString()}
                {#if session.stoppedAt}
                    | Stopped {new Date(session.stoppedAt).toLocaleString()}
                {/if}
            </div>
            {#if showOwnerStopMessage}
                <div class="text-sm mt-3">Session stopped. Choose who can access this transcript and summary.</div>
            {/if}
            <div class="text-xs opacity-75 mt-2">Default privacy is private. You can update sharing later from AI Notes Library.</div>
        </div>

        <div class="rounded-xl bg-dark-500/50 p-4 mt-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="font-semibold">Recipients from this meeting</div>
                <div class="text-xs opacity-70">Selected: {selectedUserIds.size}</div>
            </div>

            <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                    class="min-w-0 flex-1 rounded-lg border border-white/15 bg-dark-700/85 px-3 py-2 text-sm text-white placeholder-white/60 outline-none transition-colors focus:border-secondary"
                    type="text"
                    placeholder="Search participants or add email/user id (comma-separated)"
                    bind:value={recipientInput}
                    on:keydown={onManualRecipientKeyDown}
                />
                <button
                    class="btn btn-primary min-w-[88px] justify-center"
                    disabled={!recipientInput.trim() || $notetakerLoadingStore}
                    on:click={addManualRecipientsFromInput}>Add</button
                >
            </div>
            <div class="text-xs opacity-70 mt-2">
                Type to filter suggestions. Click <strong>Add</strong> to add exact email/user id manually.
            </div>

            {#if selectedRecipients.length > 0}
                <div class="mt-3 flex flex-wrap gap-2">
                    {#each selectedRecipients as selectedUserId (selectedUserId)}
                        <button
                            class="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-dark-600/70 px-3 py-1 text-xs text-white"
                            on:click={() => removeRecipient(selectedUserId)}
                        >
                            <span class="truncate">{getRecipientLabel(selectedUserId)}</span>
                            <span class="opacity-75" aria-hidden="true">x</span>
                        </button>
                    {/each}
                </div>
            {/if}

            {#if isLoadingCandidates}
                <div class="text-sm opacity-75 mt-3">Loading participants...</div>
            {:else if filteredCandidates.length === 0}
                <div class="text-sm opacity-75 mt-3">
                    No suggested users found for this session yet. Add recipients manually above.
                </div>
            {:else}
                <div class="space-y-2 max-h-72 overflow-y-auto mt-3 pr-1">
                    {#if filteredCurrentSessionCandidates.length > 0}
                        <div class="text-xs font-semibold uppercase tracking-wide opacity-70 px-1">
                            Participants in this session
                        </div>
                        {#each filteredCurrentSessionCandidates as candidate (candidate.userId)}
                            <label class="flex items-start gap-3 rounded-lg border border-white/10 bg-dark-600/45 px-3 py-2">
                                <input
                                    class="mt-1"
                                    type="checkbox"
                                    checked={isCandidateSelected(normalizeRecipientId(candidate.userId))}
                                    on:change={(event) => onCandidateSelectionChange(candidate.userId, event)}
                                />
                                <div class="min-w-0">
                                    <div class="text-sm font-semibold truncate">
                                        {candidate.displayName ?? candidate.userId}
                                    </div>
                                    <div class="text-xs opacity-70 break-all">{formatCandidateMeta(candidate)}</div>
                                </div>
                            </label>
                        {/each}
                    {/if}

                    {#if filteredHistoricalCandidates.length > 0}
                        <div class="text-xs font-semibold uppercase tracking-wide opacity-70 px-1 pt-1">
                            Other recent participants
                        </div>
                        {#each filteredHistoricalCandidates as candidate (candidate.userId)}
                            <label class="flex items-start gap-3 rounded-lg border border-white/10 bg-dark-600/45 px-3 py-2">
                                <input
                                    class="mt-1"
                                    type="checkbox"
                                    checked={isCandidateSelected(normalizeRecipientId(candidate.userId))}
                                    on:change={(event) => onCandidateSelectionChange(candidate.userId, event)}
                                />
                                <div class="min-w-0">
                                    <div class="text-sm font-semibold truncate">
                                        {candidate.displayName ?? candidate.userId}
                                    </div>
                                    <div class="text-xs opacity-70 break-all">{formatCandidateMeta(candidate)}</div>
                                </div>
                            </label>
                        {/each}
                    {/if}
                </div>
            {/if}
        </div>
    </div>
    <svelte:fragment slot="action">
        <button class="btn flex-1 justify-center" on:click={() => closeModal()}>Cancel</button>
        <button class="btn flex-1 justify-center" disabled={$notetakerLoadingStore} on:click={keepPrivate}>Keep private</button>
        <button
            class="btn btn-secondary flex-1 justify-center"
            disabled={$notetakerLoadingStore || selectedUserIds.size === 0}
            on:click={shareSelected}
            >Share selected</button
        >
    </svelte:fragment>
</Popup>
