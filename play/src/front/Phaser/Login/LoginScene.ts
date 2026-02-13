import { get } from "svelte/store";
import { loginSceneVisibleIframeStore, loginSceneVisibleStore } from "../../Stores/LoginSceneStore";
import { localUserStore } from "../../Connection/LocalUserStore";
import { setCurrentPlayerName } from "../../Stores/CurrentPlayerProfileStore";
import { connectionManager } from "../../Connection/ConnectionManager";
import { gameManager } from "../Game/GameManager";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { isUserNameTooLong, isUserNameValid } from "../../Connection/LocalUserUtils";
import { NameNotValidError, NameTooLongError } from "../../Exception/NameError";
import { hasCapability } from "../../Connection/Capabilities";
import { inGameProfileEditStore } from "../../Stores/ProfileEditStore";
import { ResizableScene } from "./ResizableScene";
import { SelectCharacterSceneName } from "./SelectCharacterScene";

export const LoginSceneName = "LoginScene";

export class LoginScene extends ResizableScene {
    private name = "";

    constructor() {
        super({
            key: LoginSceneName,
        });
        this.name = gameManager.getPlayerName() || "";
    }

    preload() {}

    create() {
        const isInGameEdit = get(inGameProfileEditStore);
        loginSceneVisibleIframeStore.set(false);
        if (!isInGameEdit) {
            //If authentication is mandatory, push authentication iframe
            if (
                localUserStore.getAuthToken() == undefined &&
                gameManager.currentStartedRoom &&
                gameManager.currentStartedRoom.authenticationMandatory
            ) {
                const redirect = connectionManager.loadOpenIDScreen(false);
                if (redirect !== null) {
                    window.location.assign(redirect.toString());
                }
                loginSceneVisibleIframeStore.set(true);
            }
        }
        loginSceneVisibleStore.set(true);

        if (gameManager.currentStartedRoom.backgroundColor != undefined) {
            this.cameras.main.setBackgroundColor(gameManager.currentStartedRoom.backgroundColor);
        }
    }

    public async login(name: string): Promise<void> {
        if (isUserNameTooLong(name)) {
            throw new NameTooLongError();
        }
        if (!isUserNameValid(name)) {
            throw new NameNotValidError();
        }

        analyticsClient.validationName();
        name = name.trim();
        const didSaveName = await connectionManager.saveName(name);
        gameManager.setPlayerName(name);
        if (!didSaveName) {
            // Only save the name if the user is not logged in
            // If the user is logged in, the name will be fetched from the server. No need to save it locally.
            if (!localUserStore.isLogged() || !hasCapability("api/save-name")) {
                setCurrentPlayerName(name);
            }
        }

        const isInGameEdit = get(inGameProfileEditStore);
        this.scene.stop(LoginSceneName);
        this.scene.remove(LoginSceneName);
        loginSceneVisibleStore.set(false);
        if (isInGameEdit) {
            inGameProfileEditStore.set(false);
            return;
        }
        gameManager.tryResumingGame(SelectCharacterSceneName);
    }

    update(_time: number, _delta: number): void {}

    public onResize(): void {}
}
