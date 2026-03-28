<script lang="ts">
    import { onDestroy } from "svelte";
    import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { CharacterLayerManager } from "../../Phaser/Entity/CharacterLayerManager";
    import { defaultColor, defaultWoka } from "../../Chat/Connection/Matrix/MatrixChatConnection";
    import { getColorByString } from "../../Utils/ColorGenerator";
    import type { WokaData } from "../Woka/WokaTypes";

    export let speakerName: string;
    export let speakerKey: string;
    export let color: string | undefined = undefined;
    export let avatarUrl: string | undefined = undefined;
    export let characterTextureIds: string[] | undefined = undefined;
    export let size: "sm" | "md" = "md";

    let renderedWokaSrc: string | undefined = undefined;
    let resolutionSequence = 0;
    let currentAvatarSrc = defaultWoka;

    $: normalizedName = speakerName.trim();
    $: avatarBackground = normalizeBackgroundColor(color) ?? defaultColor ?? getColorByString(speakerKey || normalizedName);
    $: avatarSizeClass = size === "sm" ? "h-6 w-6" : "h-7 w-7";
    $: innerAvatarSizeClass = size === "sm" ? "h-6 w-6" : "h-7 w-7";
    $: avatarImageSizeClass = size === "sm" ? "h-7 w-7" : "h-8 w-8";
    $: normalizedTextureIds = normalizeCharacterTextureIds(characterTextureIds);
    $: hasCharacterTextureSnapshot = normalizedTextureIds.length > 0;
    // Raw texture URLs look wrong in transcript rows; only trust rendered snapshots or base64 avatars.
    $: preferredAvatarSrc =
        renderedWokaSrc ??
        (!hasCharacterTextureSnapshot && avatarUrl?.startsWith("data:image") ? avatarUrl : undefined);
    $: currentAvatarSrc = preferredAvatarSrc ?? defaultWoka;

    $: {
        const currentSequence = ++resolutionSequence;
        renderedWokaSrc = undefined;
        if (hasCharacterTextureSnapshot) {
            void resolveRenderedWoka(normalizedTextureIds, currentSequence);
        }
    }

    onDestroy(() => {
        resolutionSequence += 1;
    });

    function normalizeCharacterTextureIds(textureIds: string[] | undefined): string[] {
        if (!Array.isArray(textureIds)) {
            return [];
        }

        return Array.from(
            new Set(textureIds.map((textureId) => textureId.trim()).filter((textureId) => textureId.length > 0))
        );
    }

    async function resolveRenderedWoka(textureIds: string[], sequence: number): Promise<void> {
        const cacheKey = textureIds.join(",");
        if (!cacheKey) {
            return;
        }

        const cached = renderedWokaByTextureKey.get(cacheKey);
        if (cached) {
            if (sequence === resolutionSequence) {
                renderedWokaSrc = cached;
            }
            return;
        }

        let pendingResolution = pendingWokaByTextureKey.get(cacheKey);
        if (!pendingResolution) {
            pendingResolution = renderWokaFromTextureIds(textureIds);
            pendingWokaByTextureKey.set(cacheKey, pendingResolution);
        }

        try {
            const renderedWoka = await pendingResolution;
            if (!renderedWoka) {
                return;
            }

            renderedWokaByTextureKey.set(cacheKey, renderedWoka);
            if (sequence === resolutionSequence) {
                renderedWokaSrc = renderedWoka;
            }
        } finally {
            pendingWokaByTextureKey.delete(cacheKey);
        }
    }

    async function renderWokaFromTextureIds(textureIds: string[]): Promise<string | undefined> {
        const wokaTexturesById = await fetchWokaTexturesById();
        if (wokaTexturesById.size === 0) {
            return undefined;
        }

        const textures = textureIds
            .map((textureId) => {
                const textureUrl = wokaTexturesById.get(textureId);
                if (!textureUrl) {
                    return undefined;
                }

                return {
                    id: textureId,
                    url: textureUrl,
                };
            })
            .filter((texture): texture is { id: string; url: string } => texture !== undefined);

        if (textures.length === 0) {
            return undefined;
        }

        try {
            return await CharacterLayerManager.wokaBase64(textures);
        } catch (error) {
            console.warn("Failed to render AI notes woka from textures", error);
            return undefined;
        }
    }

    async function fetchWokaTexturesById(): Promise<Map<string, string>> {
        if (!wokaTexturesByIdPromise) {
            wokaTexturesByIdPromise = (async () => {
                const roomUrl = gameManager.currentStartedRoom?.href;
                if (!roomUrl) {
                    return new Map<string, string>();
                }

                const response = await fetch(
                    `${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}`,
                    {
                        headers: {
                            Authorization: localUserStore.getAuthToken() ?? "",
                        },
                        credentials: "include",
                    }
                );

                if (!response.ok) {
                    throw new Error("Failed to load Woka list for AI notes transcript avatar rendering");
                }

                const wokaData = (await response.json()) as WokaData;
                const texturesById = new Map<string, string>();
                for (const bodyPart of Object.values(wokaData)) {
                    for (const collection of bodyPart.collections) {
                        for (const texture of collection.textures) {
                            if (texture.id && texture.url) {
                                texturesById.set(texture.id, texture.url);
                            }
                        }
                    }
                }

                return texturesById;
            })();
        }

        try {
            return await wokaTexturesByIdPromise;
        } catch (error) {
            console.warn("Failed to fetch Woka list for AI notes transcript avatars", error);
            wokaTexturesByIdPromise = undefined;
            return new Map<string, string>();
        }
    }

    const renderedWokaByTextureKey = new Map<string, string>();
    const pendingWokaByTextureKey = new Map<string, Promise<string | undefined>>();
    let wokaTexturesByIdPromise: Promise<Map<string, string>> | undefined;

    function onAvatarImageError(): void {
        if (currentAvatarSrc !== defaultWoka) {
            currentAvatarSrc = defaultWoka;
        }
    }

    function normalizeBackgroundColor(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = value.trim();
        return normalized.length > 0 ? normalized : undefined;
    }
</script>

<div
    class="relative shrink-0 rounded-md overflow-hidden {avatarSizeClass}"
    style:background-color={avatarBackground}
    aria-label={"Speaker avatar for " + normalizedName}
>
    <div class="rounded-md overflow-hidden {innerAvatarSizeClass}">
        <div class="-translate-x-[3px] translate-y-[3px]">
        <img
            class={avatarImageSizeClass}
            src={currentAvatarSrc}
            alt={"Avatar of " + normalizedName}
            loading="lazy"
            draggable="false"
            on:error={onAvatarImageError}
        />
        </div>
    </div>
</div>
