<script lang="ts">
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import { get } from "svelte/store";
    import {
        audioManagerFileStore,
        audioManagerVisibilityStore,
        bubbleSoundStore,
    } from "../../Stores/AudioManagerStore";
    import { HtmlUtils } from "../../WebRtc/HtmlUtils";
    import { LL, locale } from "../../../i18n/i18n-svelte";
    import type { Locales } from "../../../i18n/i18n-types";
    import { displayableLocales, setCurrentLocale } from "../../Utils/locales";
    import { gameManager } from "../../Phaser/Game/GameManager";

    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import {
        PEER_SCREEN_SHARE_LOW_BANDWIDTH,
        PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH,
        PEER_VIDEO_LOW_BANDWIDTH,
        PEER_VIDEO_RECOMMENDED_BANDWIDTH,
    } from "../../Enum/EnvironmentVariable";
    import {
        requestedMicrophoneDeviceIdStore,
        requestedMicrophoneState,
        requestedNoiseSuppressionStore,
        requestedEchoCancellationStore,
        requestedAutoGainControlStore,
        requestedRnnoiseStore,
        videoBandwidthStore,
    } from "../../Stores/MediaStore";
    import { screenShareBandwidthStore } from "../../Stores/ScreenSharingStore";
    import { volumeProximityDiscussionStore } from "../../Stores/PeerStore";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { SoundMeter } from "../../Phaser/Components/SoundMeter";
    import { RNNoiseStreamProcessor } from "../../WebRtc/AudioStream/RNNoiseStreamProcessor";
    import SoundMeterWidget from "../SoundMeterWidget.svelte";
    import InputSwitch from "../Input/InputSwitch.svelte";
    import RangeSlider from "../Input/RangeSlider.svelte";
    import Select from "../Input/Select.svelte";
    import {
        IconAntennaBarsLow,
        IconAntennaBarsMid,
        IconAntennaBarsHigh,
        IconAdjustements,
        IconLanguage,
        IconDoorExit,
        IconScreenShare,
        IconCameraUp,
        IconMicrophone,
    } from "@wa-icons";
    import { isAndroid, isIOS } from "../../WebRtc/DeviceUtils";

    let fullscreen: boolean = localUserStore.getFullscreen();
    let notification: boolean = localUserStore.getNotification();
    let allowPictureInPicture: boolean = localUserStore.getAllowPictureInPicture();
    let blockAudio: boolean = localUserStore.getBlockAudio();
    let valueNoiseSuppression = localUserStore.getNoiseSuppression();
    let valueEchoCancellation = localUserStore.getEchoCancellation();
    let valueAutoGainControl = localUserStore.getAutoGainControl();
    let valueRnnoise = localUserStore.getRnnoiseEnabled();
    let forceCowebsiteTrigger: boolean = localUserStore.getForceCowebsiteTrigger();
    let ignoreFollowRequests: boolean = localUserStore.getIgnoreFollowRequests();
    let decreaseAudioPlayerVolumeWhileTalking: boolean = localUserStore.getDecreaseAudioPlayerVolumeWhileTalking();
    let disableAnimations: boolean = localUserStore.getDisableAnimations();
    let valueLocale: string = $locale;
    let valueCameraPrivacySettings = localUserStore.getCameraPrivacySettings();
    let valueMicrophonePrivacySettings = localUserStore.getMicrophonePrivacySettings();
    const initialVideoBandwidth = localUserStore.getVideoBandwidth();

    let valueVideoBandwidth =
        initialVideoBandwidth === "unlimited" ? 3 : initialVideoBandwidth === PEER_VIDEO_LOW_BANDWIDTH ? 1 : 2;
    const initialScreenShareBandwidth = localUserStore.getScreenShareBandwidth();
    let valueScreenShareBandwidth =
        initialScreenShareBandwidth === "unlimited"
            ? 3
            : initialScreenShareBandwidth === PEER_SCREEN_SHARE_LOW_BANDWIDTH
            ? 1
            : 2;

    let volumeProximityDiscussion = localUserStore.getVolumeProximityDiscussion();

    let previewCameraPrivacySettings = valueCameraPrivacySettings;
    let previewMicrophonePrivacySettings = valueMicrophonePrivacySettings;

    let valueBubbleSound = localUserStore.getBubbleSound();
    const sound = new Audio();
    const rnnoiseSupported = typeof AudioWorkletNode !== "undefined" && !isIOS() && !isAndroid();
    let micTestActive = false;
    let micTestVolume: number[] = [0, 0, 0, 0, 0, 0, 0];
    let micTestStream: MediaStream | null = null;
    let micTestMeter: SoundMeter | null = null;
    let micTestInterval: number | undefined;
    let micTestPreviousMicState: boolean | null = null;
    let micTestPreviousVolume: number | null = null;
    let micTestLoopbackContext: AudioContext | null = null;
    let micTestLoopbackSource: MediaStreamAudioSourceNode | null = null;
    let micTestLoopbackGain: GainNode | null = null;
    let micTestRnnoiseProcessor: RNNoiseStreamProcessor | null = null;

    type SettingsTab = "audio" | "video" | "privacy" | "general";
    let activeTab: SettingsTab = "audio";

    $: if (!rnnoiseSupported && valueRnnoise) {
        valueRnnoise = false;
        requestedRnnoiseStore.set(false);
    }
    $: if (valueRnnoise && valueNoiseSuppression) {
        valueNoiseSuppression = false;
        requestedNoiseSuppressionStore.set(false);
    }

    async function updateLocale() {
        await setCurrentLocale(valueLocale as Locales);
    }

    function updateVideoBandwidth() {
        let value: number | "unlimited";

        switch (valueVideoBandwidth) {
            case 1:
                value = PEER_VIDEO_LOW_BANDWIDTH;
                break;
            case 3:
                value = "unlimited";
                break;
            default:
                value = PEER_VIDEO_RECOMMENDED_BANDWIDTH;
                break;
        }

        videoBandwidthStore.setBandwidth(value);
    }

    function updateScreenShareBandwidth() {
        let value: number | "unlimited";

        switch (valueScreenShareBandwidth) {
            case 1:
                value = PEER_SCREEN_SHARE_LOW_BANDWIDTH;
                break;
            case 3:
                value = "unlimited";
                break;
            default:
                value = PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH;
                break;
        }

        screenShareBandwidthStore.setBandwidth(value);
    }

    function changeFullscreen() {
        // Analytics Client
        analyticsClient.settingFullscreen(fullscreen ? "true" : "false");

        const body = HtmlUtils.querySelectorOrFail("body");
        if (body) {
            if (document.fullscreenElement !== null && !fullscreen) {
                document.exitFullscreen().catch((e) => console.error(e));
            } else {
                document.documentElement.requestFullscreen().catch((e) => console.error(e));
            }
            localUserStore.setFullscreen(fullscreen);
        }
    }

    function changeNotification() {
        // Analytics Client
        analyticsClient.settingNotification(notification ? "true" : "false");

        if (Notification.permission === "granted") {
            localUserStore.setNotification(notification);
        } else {
            Notification.requestPermission()
                .then((response) => {
                    if (response === "granted") {
                        localUserStore.setNotification(notification);
                    } else {
                        localUserStore.setNotification(false);
                        notification = false;
                    }
                })
                .catch((e) => console.error(e));
        }
    }

    function changePictureInPicture() {
        // Analytics Client
        analyticsClient.settingPictureInPicture(allowPictureInPicture ? "true" : "false");

        localUserStore.setAllowPictureInPicture(allowPictureInPicture);
    }

    function changeBlockAudio() {
        if (blockAudio) {
            audioManagerFileStore.unloadAudio();
            audioManagerVisibilityStore.set("disabledBySettings");
        }
        localUserStore.setBlockAudio(blockAudio);
    }

    function changeNoiseSuppression() {
        if (valueNoiseSuppression) {
            valueRnnoise = false;
            requestedRnnoiseStore.set(false);
        }
        requestedNoiseSuppressionStore.set(valueNoiseSuppression);
        restartMicTestIfActive();
    }

    function changeEchoCancellation() {
        requestedEchoCancellationStore.set(valueEchoCancellation);
        restartMicTestIfActive();
    }

    function changeAutoGainControl() {
        requestedAutoGainControlStore.set(valueAutoGainControl);
        restartMicTestIfActive();
    }

    function changeRnnoise() {
        if (valueRnnoise) {
            valueNoiseSuppression = false;
            requestedNoiseSuppressionStore.set(false);
        }
        requestedRnnoiseStore.set(valueRnnoise);
        restartMicTestIfActive();
    }

    async function startMicTest() {
        if (micTestActive) return;
        micTestPreviousMicState = localUserStore.getRequestedMicrophoneState();
        micTestPreviousVolume = get(volumeProximityDiscussionStore);

        requestedMicrophoneState.disableMicrophone();
        volumeProximityDiscussionStore.set(0);

        try {
            const deviceId = get(requestedMicrophoneDeviceIdStore);
            const constraints: MediaStreamConstraints = {
                audio: deviceId
                    ? {
                          deviceId: { exact: deviceId },
                          autoGainControl: valueAutoGainControl,
                          echoCancellation: valueEchoCancellation,
                          noiseSuppression: valueNoiseSuppression && !valueRnnoise,
                      }
                    : {
                          autoGainControl: valueAutoGainControl,
                          echoCancellation: valueEchoCancellation,
                          noiseSuppression: valueNoiseSuppression && !valueRnnoise,
                      },
            };
            let rawStream = await navigator.mediaDevices.getUserMedia(constraints);
            if (valueRnnoise && rnnoiseSupported) {
                micTestRnnoiseProcessor = new RNNoiseStreamProcessor();
                rawStream = await micTestRnnoiseProcessor.processStream(rawStream);
            }
            micTestStream = rawStream;
            micTestMeter = new SoundMeter(micTestStream);
            micTestLoopbackContext = new AudioContext();
            await micTestLoopbackContext.resume();
            micTestLoopbackSource = micTestLoopbackContext.createMediaStreamSource(micTestStream);
            micTestLoopbackGain = micTestLoopbackContext.createGain();
            micTestLoopbackGain.gain.value = 1;
            micTestLoopbackSource.connect(micTestLoopbackGain).connect(micTestLoopbackContext.destination);
            micTestActive = true;
            micTestInterval = window.setInterval(() => {
                if (micTestMeter) {
                    micTestVolume = micTestMeter.getVolume();
                }
            }, 150);
        } catch (e) {
            warningMessageStore.addWarningMessage("Unable to access your microphone for the test.", { closable: true });
            stopMicTest();
        }
    }

    function stopMicTest() {
        if (micTestInterval) {
            clearInterval(micTestInterval);
            micTestInterval = undefined;
        }
        if (micTestMeter) {
            micTestMeter.stop();
            micTestMeter = null;
        }
        if (micTestStream) {
            micTestStream.getTracks().forEach((track) => track.stop());
            micTestStream = null;
        }
        if (micTestLoopbackSource) {
            micTestLoopbackSource.disconnect();
            micTestLoopbackSource = null;
        }
        if (micTestLoopbackGain) {
            micTestLoopbackGain.disconnect();
            micTestLoopbackGain = null;
        }
        if (micTestLoopbackContext) {
            micTestLoopbackContext.close().catch(() => undefined);
            micTestLoopbackContext = null;
        }
        if (micTestRnnoiseProcessor) {
            micTestRnnoiseProcessor.stop();
            micTestRnnoiseProcessor = null;
        }
        micTestActive = false;
        micTestVolume = [0, 0, 0, 0, 0, 0, 0];

        if (micTestPreviousMicState !== null) {
            if (micTestPreviousMicState) {
                requestedMicrophoneState.enableMicrophone();
            } else {
                requestedMicrophoneState.disableMicrophone();
            }
            micTestPreviousMicState = null;
        }
        if (micTestPreviousVolume !== null) {
            volumeProximityDiscussionStore.set(micTestPreviousVolume);
            micTestPreviousVolume = null;
        }
    }

    function restartMicTestIfActive() {
        if (!micTestActive) return;
        stopMicTest();
        void startMicTest();
    }

    onDestroy(() => {
        if (micTestActive) {
            stopMicTest();
        }
    });

    function changeForceCowebsiteTrigger() {
        // Analytics Client
        analyticsClient.settingAskWebsite(forceCowebsiteTrigger ? "true" : "false");

        localUserStore.setForceCowebsiteTrigger(forceCowebsiteTrigger);
    }

    function changeIgnoreFollowRequests() {
        // Analytics Client
        analyticsClient.settingRequestFollow(ignoreFollowRequests ? "true" : "false");

        localUserStore.setIgnoreFollowRequests(ignoreFollowRequests);
    }

    function changeDecreaseAudioPlayerVolumeWhileTalking() {
        // Analytics Client
        analyticsClient.settingDecreaseAudioVolume(decreaseAudioPlayerVolumeWhileTalking ? "true" : "false");

        localUserStore.setDecreaseAudioPlayerVolumeWhileTalking(decreaseAudioPlayerVolumeWhileTalking);
    }

    function changeDisableAnimations() {
        localUserStore.setDisableAnimations(disableAnimations);
        if (disableAnimations) {
            gameManager.getCurrentGameScene().animatedTiles.pause();
        } else {
            gameManager.getCurrentGameScene().animatedTiles.resume();
        }
    }

    function changeCameraPrivacySettings() {
        // Analytics Client
        analyticsClient.settingMicrophone(valueCameraPrivacySettings ? "true" : "false");

        if (valueCameraPrivacySettings !== previewCameraPrivacySettings) {
            previewCameraPrivacySettings = valueCameraPrivacySettings;
            localUserStore.setCameraPrivacySettings(valueCameraPrivacySettings);
        }
    }

    function changeMicrophonePrivacySettings() {
        // Analytics Client
        analyticsClient.settingCamera(valueMicrophonePrivacySettings ? "true" : "false");

        if (valueMicrophonePrivacySettings !== previewMicrophonePrivacySettings) {
            previewMicrophonePrivacySettings = valueMicrophonePrivacySettings;
            localUserStore.setMicrophonePrivacySettings(valueMicrophonePrivacySettings);
        }
    }

    function updateVolumeProximityDiscussion() {
        analyticsClient.settingAudioVolume();
        localUserStore.setVolumeProximityDiscussion(volumeProximityDiscussion);
        volumeProximityDiscussionStore.set(volumeProximityDiscussion);
    }

    function changeBubbleSound() {
        localUserStore.setBubbleSound(valueBubbleSound);
        bubbleSoundStore.set(valueBubbleSound);
        playBubbleSound().catch((e) => console.error(e));
    }

    async function playBubbleSound() {
        sound.src = `/resources/objects/webrtc-in-${valueBubbleSound}.mp3`;
        sound.volume = 0.2;
        await sound.play();
    }
</script>

<div class="settings-shell" transition:fly={{ x: -700, duration: 250 }}>
    <nav class="settings-tabs">
        <button
            class="settings-tab {activeTab === 'audio' ? 'active' : ''}"
            on:click={() => (activeTab = "audio")}
        >
            Audio
        </button>
        <button
            class="settings-tab {activeTab === 'video' ? 'active' : ''}"
            on:click={() => (activeTab = "video")}
        >
            Video
        </button>
        <button
            class="settings-tab {activeTab === 'privacy' ? 'active' : ''}"
            on:click={() => (activeTab = "privacy")}
        >
            {$LL.menu.settings.privacySettings.title()}
        </button>
        <button
            class="settings-tab {activeTab === 'general' ? 'active' : ''}"
            on:click={() => (activeTab = "general")}
        >
            {$LL.menu.settings.otherSettings()}
        </button>
    </nav>
    <div class="settings-content divide-y divide-white/20">
    {#if activeTab === "video"}
    <section class=" p-0 first:pt-0 pt-0 m-0">
        <div class="bg-contrast font-bold text-lg p-4 flex items-center">
            <div class="me-4 opacity-50"><IconCameraUp /></div>
            {$LL.menu.settings.videoBandwidth.title()}
        </div>
        <div class="flex w-full mb-6 mt-2 ps-6 justify-center">
            <div class="flex flex-col w-10/12 lg:w-6/12">
                <ul class="flex justify-between w-full px-[10px] mb-8">
                    <li
                        class="flex justify-center relative {valueVideoBandwidth === 1
                            ? 'opacity-100 font-bold'
                            : 'opacity-50 hover:opacity-80'}"
                    >
                        <IconAntennaBarsLow />
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            class="absolute -bottom-4 cursor-pointer"
                            on:click|preventDefault={() => (valueVideoBandwidth = 1)}
                            >{$LL.menu.settings.videoBandwidth.low()}</span
                        >
                    </li>
                    <li
                        class="flex justify-center relative {valueVideoBandwidth === 2
                            ? 'opacity-100 font-bold'
                            : 'opacity-50 hover:opacity-80'}"
                    >
                        <IconAntennaBarsMid />
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            class="absolute -bottom-4 cursor-pointer"
                            on:click|preventDefault={() => (valueVideoBandwidth = 2)}
                            >{$LL.menu.settings.videoBandwidth.recommended()}</span
                        >
                    </li>
                    <li
                        class="flex justify-center relative {valueVideoBandwidth === 3
                            ? 'opacity-100 font-bold'
                            : 'opacity-50 hover:opacity-80'}"
                    >
                        <IconAntennaBarsHigh />
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            class="absolute -bottom-4 cursor-pointer"
                            on:click|preventDefault={() => (valueVideoBandwidth = 3)}
                            >{$LL.menu.settings.videoBandwidth.unlimited()}</span
                        >
                    </li>
                </ul>
                <RangeSlider
                    buttonShape="square"
                    min={1}
                    max={3}
                    step={1}
                    bind:value={valueVideoBandwidth}
                    onChange={updateVideoBandwidth}
                />
            </div>
        </div>
    </section>
    <section class="flex flex-col p-0 first:pt-0 pt-8 m-0">
        <div class="bg-contrast font-bold text-lg p-4 flex items-center">
            <div class="me-4 opacity-50"><IconScreenShare /></div>

            {$LL.menu.settings.shareScreenBandwidth.title()}
        </div>
        <div class="flex w-full mb-6 mt-2 ps-6 justify-center">
            <div class="flex flex-col w-10/12 lg:w-6/12">
                <ul class="flex justify-between w-full px-[10px] mb-8">
                    <li
                        class="flex relative {valueScreenShareBandwidth === 1
                            ? 'opacity-100 font-bold'
                            : 'opacity-50 hover:opacity-80'}"
                    >
                        <IconAntennaBarsLow />
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            class="absolute -bottom-4 cursor-pointer"
                            on:click|preventDefault={() => (valueScreenShareBandwidth = 1)}
                            >{$LL.menu.settings.shareScreenBandwidth.low()}</span
                        >
                    </li>
                    <li
                        class="flex justify-center relative {valueScreenShareBandwidth === 2
                            ? 'opacity-100 font-bold'
                            : 'opacity-50 hover:opacity-80'}"
                    >
                        <IconAntennaBarsMid />
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            class="absolute -bottom-4 cursor-pointer"
                            on:click|preventDefault={() => (valueScreenShareBandwidth = 2)}
                            >{$LL.menu.settings.shareScreenBandwidth.recommended()}</span
                        >
                    </li>
                    <li
                        class="flex justify-center relative {valueScreenShareBandwidth === 3
                            ? 'opacity-100 font-bold'
                            : 'opacity-50 hover:opacity-80'}"
                    >
                        <IconAntennaBarsHigh />
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            class="absolute -bottom-4 cursor-pointer"
                            on:click|preventDefault={() => (valueScreenShareBandwidth = 3)}
                            >{$LL.menu.settings.shareScreenBandwidth.unlimited()}</span
                        >
                    </li>
                </ul>
                <RangeSlider
                    min={1}
                    max={3}
                    step={1}
                    bind:value={valueScreenShareBandwidth}
                    onChange={updateScreenShareBandwidth}
                    buttonShape="square"
                />
            </div>
        </div>
    </section>
    {/if}
    {#if activeTab === "audio"}
    <section class="flex flex-col p-0 first:pt-0 pt-0 m-0">
        <div class="bg-contrast font-bold text-lg p-4 flex items-center">
            <div class="me-4 opacity-50"><IconAdjustements /></div>

            {$LL.menu.settings.proximityDiscussionVolume()}
        </div>

        <div class="flex w-full justify-center">
            <div class="flex flex-col w-10/12 lg:w-6/12">
                <ul class="flex justify-between w-full px-[10px] mb-5">
                    <li class="flex justify-center relative">
                        <span class="absolute">0</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">1</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">2</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">3</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">4</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">5</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">6</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">7</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">8</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">9</span>
                    </li>
                    <li class="flex justify-center relative">
                        <span class="absolute">10</span>
                    </li>
                </ul>
                <RangeSlider
                    min={0}
                    max={1}
                    step={0.1}
                    bind:value={volumeProximityDiscussion}
                    onChange={updateVolumeProximityDiscussion}
                />
            </div>
        </div>
    </section>
    <section class="flex flex-col p-0 first:pt-0 pt-8 m-0">
        <div class="bg-contrast font-bold text-lg p-4 flex items-center">
            <div class="me-4 opacity-50"><IconAdjustements /></div>
            Audio settings
        </div>

        <div class="mt-2 p-2">
            <div class="flex items-end gap-2">
                <Select
                    id="bubble-sound"
                    bind:value={valueBubbleSound}
                    onChange={changeBubbleSound}
                    label={$LL.menu.settings.bubbleSound()}
                    outerClass="flex-1"
                    options={[
                        { value: "ding", label: $LL.menu.settings.bubbleSoundOptions.ding() },
                        { value: "wobble", label: $LL.menu.settings.bubbleSoundOptions.wobble() },
                    ]}
                />
                <button class="btn btn-light btn-ghost mb-2" on:click={playBubbleSound}>Play</button>
            </div>
        </div>

        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="decreaseAudioPlayerVolumeWhileTalking-toggle"
                bind:value={decreaseAudioPlayerVolumeWhileTalking}
                onChange={changeDecreaseAudioPlayerVolumeWhileTalking}
                label={$LL.audio.manager.reduce()}
            />
        </div>

        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="changeBlockAudio"
                bind:value={blockAudio}
                onChange={changeBlockAudio}
                label={$LL.menu.settings.blockAudio()}
            />
        </div>
        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="echo-cancellation-toggle"
                bind:value={valueEchoCancellation}
                onChange={changeEchoCancellation}
                label={$LL.menu.settings.echoCancellation()}
            />
        </div>
        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="auto-gain-control-toggle"
                bind:value={valueAutoGainControl}
                onChange={changeAutoGainControl}
                label={$LL.menu.settings.autoGainControl()}
            />
        </div>
        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="noise-suppression-toggle"
                bind:value={valueNoiseSuppression}
                onChange={changeNoiseSuppression}
                label={$LL.menu.settings.noiseSuppressionBrowser()}
                disabled={valueRnnoise}
            />
        </div>
        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="rnnoise-toggle"
                bind:value={valueRnnoise}
                onChange={changeRnnoise}
                label="RNNoise (desktop only)"
                disabled={!rnnoiseSupported || valueNoiseSuppression}
            />
        </div>
        {#if !rnnoiseSupported}
            <div class="mx-4 mb-4 text-sm text-white/50">
                RNNoise is available on desktop browsers that support AudioWorklet.
            </div>
        {:else if valueRnnoise || valueNoiseSuppression}
            <div class="mx-4 mb-4 text-sm text-white/50">
                Choose one noise suppression method: browser or RNNoise.
            </div>
        {:else}
            <div class="mx-4 mb-4 text-sm text-white/50">
                RNNoise replaces the browser noise suppression toggle.
            </div>
        {/if}
        <div class="bg-contrast font-bold text-lg p-4 flex items-center mt-6">
            <div class="me-4 opacity-50"><IconMicrophone /></div>
            Microphone test
        </div>
        <div class="mt-2 p-4 flex flex-col gap-3">
            <div class="text-sm text-white/60">
                While testing, your mic is muted in the room and incoming voice audio is paused. You will hear yourself.
            </div>
            <button class="btn btn-light w-fit" on:click={() => (micTestActive ? stopMicTest() : startMicTest())}>
                {micTestActive ? "Stop test" : "Start test"}
            </button>
            {#if micTestActive}
                <div class="flex items-center gap-3">
                    <SoundMeterWidget volume={micTestVolume} barColor="blue" />
                    <span class="text-sm text-white/60">Speak to see the level.</span>
                </div>
            {/if}
        </div>
    </section>
    {/if}
    {#if activeTab === "general"}
    <section class="flex flex-col p-0 first:pt-0 pt-0 m-0">
        <div class="bg-contrast font-bold text-lg p-4 flex items-center">
            <div class="me-4 opacity-50"><IconLanguage /></div>
            {$LL.menu.settings.language.title()}
        </div>
        <div class="mt-2 p-2">
            <select
                class="w-full languages-switcher bg-contrast rounded border border-solid border-white/20 mb-0"
                bind:value={valueLocale}
                on:change={updateLocale}
            >
                {#each displayableLocales as locale (locale.id)}
                    <option value={locale.id}>
                        {`${
                            locale.language ? locale.language.charAt(0).toUpperCase() + locale.language.slice(1) : ""
                        } (${locale.region})`}
                    </option>
                {/each}
            </select>
        </div>
    </section>
    <section class="flex flex-col p-0 first:pt-0 pt-8 m-0">
        <div class="bg-contrast font-bold text-lg p-4 flex items-center">
            <div class="me-4 opacity-50"><IconAdjustements /></div>
            {$LL.menu.settings.otherSettings()}
        </div>

        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="fullscreen-toggle"
                bind:value={fullscreen}
                onChange={changeFullscreen}
                label={$LL.menu.settings.fullscreen()}
            />
        </div>
        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="notification-toggle"
                bind:value={notification}
                onChange={changeNotification}
                label={$LL.menu.settings.notifications()}
            />
        </div>
        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="picture-in-picture-toggle"
                bind:value={allowPictureInPicture}
                onChange={changePictureInPicture}
                label={$LL.menu.settings.enablePictureInPicture()}
            />
        </div>
        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="cowebsiteTrigger-toggle"
                bind:value={forceCowebsiteTrigger}
                onChange={changeForceCowebsiteTrigger}
                label={$LL.menu.settings.cowebsiteTrigger()}
            />
        </div>

        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="cowebsiteTrigger-toggle"
                bind:value={ignoreFollowRequests}
                onChange={changeIgnoreFollowRequests}
                label={$LL.menu.settings.ignoreFollowRequest()}
            />
        </div>
        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="changeDisableAnimations"
                bind:value={disableAnimations}
                onChange={changeDisableAnimations}
                label={$LL.menu.settings.disableAnimations()}
            />
        </div>
    </section>
    {/if}
    {#if activeTab === "privacy"}
    <section class="flex flex-col p-0 first:pt-0 pt-0 m-0">
        <div class="tooltip">
            <div class="group bg-contrast font-bold text-lg p-4 flex items-center relative">
                <div class="me-4 opacity-50"><IconDoorExit /></div>
                <div class="grow">
                    <div>{$LL.menu.settings.privacySettings.title()}</div>
                    <div class="text-sm italic text-white/50">{$LL.menu.settings.privacySettings.explanation()}</div>
                </div>
            </div>
        </div>

        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="cam-toggle"
                bind:value={valueCameraPrivacySettings}
                onChange={changeCameraPrivacySettings}
                label={$LL.menu.settings.privacySettings.cameraToggle()}
            />
        </div>

        <div class="flex cursor-pointer items-center relative m-4">
            <InputSwitch
                id="mic-toggle"
                bind:value={valueMicrophonePrivacySettings}
                onChange={changeMicrophonePrivacySettings}
                label={$LL.menu.settings.privacySettings.microphoneToggle()}
            />
        </div>
    </section>
    {/if}
    </div>
</div>

<style lang="scss">
.settings-shell {
    display: flex;
    gap: 16px;
    padding: 12px 16px 16px 16px;
    align-items: flex-start;
}

.settings-tabs {
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
}

.settings-tab {
    text-align: left;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
}

.settings-tab:hover {
    color: rgba(255, 255, 255, 1);
    border-color: rgba(255, 255, 255, 0.2);
}

.settings-tab.active {
    background: rgba(32, 200, 160, 0.12);
    border-color: rgba(32, 200, 160, 0.35);
    color: #ffffff;
}

.settings-content {
    flex: 1;
    padding-top: 4px;
}
</style>
