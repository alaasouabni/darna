import { derived, get, readable, writable } from "svelte/store";
import type { CharacterTextureMessage, PrivateSpaceEvent, SpaceEvent } from "@workadventure/messages";
import { localUserStore } from "../Connection/LocalUserStore";
import { gameManager } from "../Phaser/Game/GameManager";
import { availabilityStatusStore } from "../Stores/MediaStore";
import { currentPlayerCharacterTexturesStore, currentPlayerNameStore } from "../Stores/CurrentPlayerProfileStore";
import LL from "../../i18n/i18n-svelte";
import type { SpaceUserExtended } from "./SpaceInterface";

export const localSpaceUser = (name?: string): SpaceUserExtended => {
    const nameStore = currentPlayerNameStore;
    const characterTexturesStore = derived(currentPlayerCharacterTexturesStore, (ids): CharacterTextureMessage[] =>
        ids.map((id) => ({ id, url: id.startsWith("http") || id.startsWith("/") ? id : "" }))
    );
    const fallbackName = name ?? get(LL).camera.my.nameTag();
    const initialName = get(nameStore) ?? fallbackName;
    const initialTextures = get(characterTexturesStore);

    const spaceUser: SpaceUserExtended = {
        isLogged: localUserStore.isLogged(),
        availabilityStatus: get(availabilityStatusStore),
        roomName: undefined,
        visitCardUrl: undefined,
        tags: [],
        cameraState: false,
        microphoneState: false,
        screenSharingState: true,
        megaphoneState: false,
        uuid: localUserStore.getLocalUser()?.uuid ?? "",
        chatID: localUserStore.getChatId() ?? undefined,
        showVoiceIndicator: true,
        spaceUserId: "local",
        name: initialName,
        playUri: "local",
        color: "local",
        jitsiParticipantId: undefined,
        characterTextures: initialTextures,
        pictureStore: readable<string | undefined>(undefined, (set) => {
            const unsubscribe = gameManager
                .getCurrentGameScene()
                .CurrentPlayer.pictureStore.subscribe((pictureStore) => {
                    set(pictureStore);
                });
            return () => {
                unsubscribe();
            };
        }),
        emitPrivateEvent: (message: NonNullable<PrivateSpaceEvent["event"]>) => {
            throw new Error("should not be called");
        },
        space: {
            emitPublicMessage: (message: NonNullable<SpaceEvent["event"]>) => {
                throw new Error("should not be called");
            },
        },
        reactiveUser: {
            spaceUserId: "",
            playUri: "",
            roomName: "",
            name: nameStore,
            color: writable("local"),
            characterTextures: characterTexturesStore,
            showVoiceIndicator: writable(true),
            availabilityStatus: writable(get(availabilityStatusStore)),
            isLogged: writable(localUserStore.isLogged()),
            visitCardUrl: writable(undefined),
            tags: writable([]),
            cameraState: writable(false),
            microphoneState: writable(false),
            screenSharingState: writable(true),
            megaphoneState: writable(false),
            jitsiParticipantId: writable(undefined),
            uuid: writable(localUserStore.getLocalUser()?.uuid ?? ""),
            chatID: writable(localUserStore.getChatId() ?? undefined),
        },
    };

    let nameOverride: string | undefined;
    let characterTexturesOverride: CharacterTextureMessage[] | undefined;

    Object.defineProperty(spaceUser, "name", {
        get: () => nameOverride ?? get(nameStore) ?? fallbackName,
        set: (value: string) => {
            nameOverride = value;
        },
        enumerable: true,
        configurable: true,
    });

    Object.defineProperty(spaceUser, "characterTextures", {
        get: () => characterTexturesOverride ?? get(characterTexturesStore),
        set: (value: CharacterTextureMessage[]) => {
            characterTexturesOverride = value;
        },
        enumerable: true,
        configurable: true,
    });

    return spaceUser;
};
