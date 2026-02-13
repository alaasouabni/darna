<script lang="ts">
    import type { Game } from "../../Phaser/Game/Game";
    import type { LoginScene } from "../../Phaser/Login/LoginScene";
    import { LoginSceneName } from "../../Phaser/Login/LoginScene";
    import { MAX_USERNAME_LENGTH } from "../../Enum/EnvironmentVariable";
    import logoImg from "../images/logo.svg";
    import poweredByWorkAdventureImg from "../images/Powered_By_WorkAdventure_Big.png";
    import bgMap from "../images/map-exemple.png";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { LL, locale } from "../../../i18n/i18n-svelte";
    import { NameNotValidError, NameTooLongError } from "../../Exception/NameError";
    import { inGameProfileEditStore } from "../../Stores/ProfileEditStore";
    import { loginSceneVisibleStore } from "../../Stores/LoginSceneStore";
    import XIcon from "../Icons/XIcon.svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { isUserNameTooLong, isUserNameValid } from "../../Connection/LocalUserUtils";
    import { PROFILE_NAME_VARIABLE } from "../../Connection/ProfileVariables";

    export let game: Game;

    let loginScene: LoginScene | undefined;
    try {
        loginScene = game.scene.getScene(LoginSceneName) as LoginScene;
    } catch {
        loginScene = undefined;
    }

    let name = gameManager.getPlayerName() || "";
    let startValidating = false;
    let errorName = "";

    let logo = gameManager.currentStartedRoom.loginSceneLogo ?? logoImg;
    let legals = gameManager.currentStartedRoom?.legals ?? {};

    const sceneBg = gameManager.currentStartedRoom.backgroundSceneImage ?? bgMap;

    let legalStrings: string[] = [];
    if (legals?.termsOfUseUrl) {
        legalStrings.push(
            '<a href="' +
                encodeURI(legals.termsOfUseUrl) +
                '" target="_blank" class="text-white no-underline hover:underline bold hover:text-white">' +
                $LL.login.termsOfUse() +
                "</a>"
        );
    }
    if (legals?.privacyPolicyUrl) {
        legalStrings.push(
            '<a href="' +
                encodeURI(legals.privacyPolicyUrl) +
                '" target="_blank" class="text-white no-underline hover:underline bold hover:text-white">' +
                $LL.login.privacyPolicy() +
                "</a>"
        );
    }
    if (legals?.cookiePolicyUrl) {
        legalStrings.push(
            '<a href="' +
                encodeURI(legals.cookiePolicyUrl) +
                '" target="_blank" class="text-white no-underline hover:underline bold hover:text-white">' +
                $LL.login.cookiePolicy() +
                "</a>"
        );
    }

    let legalString: string | undefined;
    if (legalStrings.length > 0) {
        if (Intl.ListFormat) {
            const formatter = new Intl.ListFormat($locale, { style: "long", type: "conjunction" });
            legalString = formatter.format(legalStrings);
        } else {
            // For old browsers
            legalString = legalStrings.join(", ");
        }
    }

    async function submit() {
        startValidating = true;

        let finalName = name.trim();
        if (finalName !== "") {
            try {
                if ($inGameProfileEditStore) {
                    await saveNameInGame(finalName);
                } else {
                    if (!loginScene) {
                        throw new Error("Login scene is not available");
                    }
                    await loginScene.login(finalName);
                }
            } catch (err) {
                if (err instanceof NameTooLongError) {
                    errorName = $LL.login.input.name.tooLongError();
                } else if (err instanceof NameNotValidError) {
                    errorName = $LL.login.input.name.notValidError();
                } else {
                    errorName = $LL.login.genericError();
                    throw err;
                }
            }
        }
    }

    async function saveNameInGame(finalName: string): Promise<void> {
        if (isUserNameTooLong(finalName)) {
            throw new NameTooLongError();
        }
        if (!isUserNameValid(finalName)) {
            throw new NameNotValidError();
        }

        analyticsClient.validationName();
        await connectionManager.saveName(finalName);
        gameManager.setPlayerName(finalName);
        try {
            const scene = gameManager.getCurrentGameScene();
            scene.CurrentPlayer?.updatePlayerName(finalName);
            scene.setProfileVariable(PROFILE_NAME_VARIABLE, finalName);
            scene.syncLocalUserSpaceProfile({ name: finalName });
        } catch (e) {
            console.warn("Could not update player name in scene", e);
        }
        closeInGameModal();
    }

    function closeInGameModal() {
        if (loginScene) {
            loginScene.scene.stop(LoginSceneName);
            loginScene.scene.remove(LoginSceneName);
        }
        loginSceneVisibleStore.set(false);
        inGameProfileEditStore.set(false);
        startValidating = false;
        errorName = "";
    }

    function getBackgroundColor() {
        if (!gameManager.currentStartedRoom) return undefined;
        return gameManager.currentStartedRoom.backgroundColor;
    }

    /* eslint-disable svelte/no-at-html-tags */
</script>

{#if $inGameProfileEditStore}
    <div class="fixed inset-0 z-40 flex items-center justify-center pointer-events-auto">
        <div class="absolute inset-0 bg-black/45" />
        <form
            class="relative z-10 w-[min(520px,90vw)] bg-contrast/95 border border-white/10 rounded-xl p-6 shadow-xl"
            on:submit|preventDefault={submit}
        >
            <button
                type="button"
                aria-label="Close"
                class="absolute right-3 top-3 h-9 w-9 rounded-full hover:bg-white/10 flex items-center justify-center"
                on:click|preventDefault={closeInGameModal}
            >
                <XIcon classList="h-4 w-4" />
            </button>
            <section class="text-center flex h-fit flex-col justify-center items-center mb-0">
                <span class="text-white text-lg bold">
                    {$LL.login.input.name.placeholder()}
                </span>
                <!-- svelte-ignore a11y-autofocus -->
                <input
                    type="text"
                    name="fname"
                    data-testid="loginSceneNameInput"
                    placeholder={$LL.login.input.name.placeholder()}
                    class="w-full h-12 text text-center bg-contrast rounded border border-solid border-white/20 mt-4 mb-0"
                    autofocus
                    maxlength={MAX_USERNAME_LENGTH}
                    bind:value={name}
                    on:input={() => {
                        if (errorName !== "") {
                            errorName = "";
                        }
                    }}
                    on:keypress={() => {
                        startValidating = true;
                    }}
                    class:border-danger={(name.trim() === "" && startValidating) || errorName !== ""}
                />
                {#if (name.trim() === "" && startValidating) || errorName !== ""}
                    <p class="err text-xs text-danger italic pt-2 mb-0">
                        {#if errorName}{errorName}{:else}{$LL.login.input.name.empty()}{/if}
                    </p>
                {/if}
            </section>
            <section
                class="action flex h-fit justify-center m-0"
                class:opacity-50={(name.trim() === "" && startValidating) || errorName !== ""}
            >
                <button
                    type="submit"
                    disabled={(name.trim() === "" && startValidating) || errorName !== ""}
                    class="mt-4 w-full bold text-center block btn btn-secondary btn-lg loginSceneFormSubmit"
                    >{$LL.login.continue()}</button
                >
            </section>
        </form>
    </div>
{:else}
    <section class="self-center absolute z-30 top-0 text-center w-full block">
        <img
            draggable="false"
            src={logo}
            alt="logo"
            class="main-logo mt-8 {gameManager.currentStartedRoom.loginSceneLogo ? 'max-h-[200px] object-cover' : ''}"
            style="width: 333px;"
        />
    </section>

    <form
        class="loginScene h-dvh flex flex-col items-center justify-center pointer-events-auto relative z-30"
        on:submit|preventDefault={submit}
    >
        <div class="w-full sm:w-96 md:w-10/12 lg:w-1/2 xl:w-1/3 rounded mx-auto text-center p-8">
            <section class="text-center flex h-fit flex-col justify-center items-center mb-0">
                <span class="text-white text-lg bold">
                    {$LL.login.input.name.placeholder()}
                </span>
                <!-- svelte-ignore a11y-autofocus -->
                <input
                    type="text"
                    name="fname"
                    data-testid="loginSceneNameInput"
                    placeholder={$LL.login.input.name.placeholder()}
                    class="w-52 md:w-96 h-12 text text-center bg-contrast rounded border border-solid border-white/20 mt-4 mb-0"
                    autofocus
                    maxlength={MAX_USERNAME_LENGTH}
                    bind:value={name}
                    on:input={() => {
                        if (errorName !== "") {
                            errorName = "";
                        }
                    }}
                    on:keypress={() => {
                        startValidating = true;
                    }}
                    class:border-danger={(name.trim() === "" && startValidating) || errorName !== ""}
                />
                {#if (name.trim() === "" && startValidating) || errorName !== ""}
                    <p class="err text-xs text-danger italic pt-2 mb-0">
                        {#if errorName}{errorName}{:else}{$LL.login.input.name.empty()}{/if}
                    </p>
                {/if}
            </section>
            <section
                class="action flex h-fit justify-center m-0"
                class:opacity-50={(name.trim() === "" && startValidating) || errorName !== ""}
            >
                <button
                    type="submit"
                    disabled={(name.trim() === "" && startValidating) || errorName !== ""}
                    class="mt-4 w-52 md:w-96 bold text-center block btn btn-secondary btn-lg loginSceneFormSubmit"
                    >{$LL.login.continue()}</button
                >
            </section>
            {#if legalString}
                <section class="terms-and-conditions h-fit text-center w-full">
                    <p class="text-white text-xs italic opacity-50">
                        {@html $LL.login.terms({
                            links: legalString,
                        })}
                    </p>
                </section>
            {/if}
        </div>
        {#if logo !== logoImg && gameManager.currentStartedRoom.showPoweredBy !== false}
            <section class="text-right flex powered-by justify-center items-end">
                <img draggable="false" src={poweredByWorkAdventureImg} alt="Powered by WorkAdventure" class="h-14" />
            </section>
        {/if}
    </form>
    <div
        class="absolute left-0 top-0 w-full h-full z-20 bg-contrast opacity-80"
        style={getBackgroundColor() != undefined ? `background-color: ${getBackgroundColor()};` : ""}
    />
    <div class="absolute left-0 top-0 w-full h-full bg-cover z-10" style="background-image: url('{sceneBg}');" />
{/if}
