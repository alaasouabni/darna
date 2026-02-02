import { derived, writable } from "svelte/store";
import { localUserStore } from "../Connection/LocalUserStore";

type CurrentPlayerProfile = {
    name: string;
    characterTextureIds: string[];
    companionTextureId: string | null;
};

const initialProfile: CurrentPlayerProfile = {
    name: localUserStore.getName() ?? "",
    characterTextureIds: localUserStore.getCharacterTextures() ?? [],
    companionTextureId: localUserStore.getCompanionTextureId(),
};

export const currentPlayerProfileStore = writable<CurrentPlayerProfile>(initialProfile);

export const currentPlayerNameStore = derived(currentPlayerProfileStore, (profile) => profile.name);
export const currentPlayerCharacterTexturesStore = derived(
    currentPlayerProfileStore,
    (profile) => profile.characterTextureIds
);
export const currentPlayerCompanionTextureIdStore = derived(
    currentPlayerProfileStore,
    (profile) => profile.companionTextureId
);

export function setCurrentPlayerName(name: string): void {
    currentPlayerProfileStore.update((profile) => ({ ...profile, name }));
    localUserStore.setName(name);
}

export function setCurrentPlayerCharacterTextures(textureIds: string[]): void {
    currentPlayerProfileStore.update((profile) => ({ ...profile, characterTextureIds: textureIds }));
    localUserStore.setCharacterTextures(textureIds);
}

export function setCurrentPlayerCompanionTextureId(textureId: string | null): void {
    currentPlayerProfileStore.update((profile) => ({ ...profile, companionTextureId: textureId }));
    localUserStore.setCompanionTextureId(textureId);
}
