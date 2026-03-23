import { get, derived, readable, writable } from "svelte/store";
import type { DesktopCapturerSource } from "../Interfaces/DesktopAppInterfaces";
import { localUserStore } from "../Connection/LocalUserStore";
import LL from "../../i18n/i18n-svelte";
import { inLivekitStore, isSpeakerStore, type LocalStreamStoreValue } from "./MediaStore";
import { inExternalServiceStore, myCameraStore, myMicrophoneStore } from "./MyMediaStore";
import { livekitMeetingRoomSpaceNameStore, personalAreaSpaceNameStore } from "./GameStore";
import type {} from "../Api/Desktop";
import type { Streamable, WebRtcStreamable } from "./StreamableCollectionStore";
import { screenShareStreamElementsStore } from "./PeerStore";
import { muteMediaStreamStore } from "./MuteMediaStreamStore";
import { isLiveStreamingStore } from "./IsStreamingStore";

declare const navigator: any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A store that contains the camera state requested by the user (on or off).
 */
function createRequestedScreenSharingState() {
    const { subscribe, set } = writable(false);

    return {
        subscribe,
        enableScreenSharing: () => set(true),
        disableScreenSharing: () => set(false),
    };
}

export const requestedScreenSharingState = createRequestedScreenSharingState();

let currentStream: MediaStream | undefined = undefined;
let detachCurrentStreamListeners: (() => void) | undefined;
let screenShareCaptureGeneration = 0;

/**
 * Stops the screen sharing (both video and audio tracks)
 */
function stopScreenSharing(): void {
    detachCurrentStreamListeners?.();
    detachCurrentStreamListeners = undefined;

    if (currentStream) {
        // Stop all tracks (video and audio)
        for (const track of currentStream.getTracks()) {
            track.stop();
        }
    }
    currentStream = undefined;
}

let previousComputedVideoConstraint: boolean | MediaTrackConstraints = false;
let previousComputedAudioConstraint: boolean | MediaTrackConstraints = false;

const SCREEN_SHARE_ALLOW_P2P_FALLBACK = false;
const SCREEN_SHARE_CAPTURE_IDEAL_WIDTH = 1920;
const SCREEN_SHARE_CAPTURE_IDEAL_HEIGHT = 1080;
const SCREEN_SHARE_CAPTURE_MAX_FPS = 30;
const SCREEN_SHARE_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
    width: {
        ideal: SCREEN_SHARE_CAPTURE_IDEAL_WIDTH,
    },
    height: {
        ideal: SCREEN_SHARE_CAPTURE_IDEAL_HEIGHT,
    },
    frameRate: {
        ideal: SCREEN_SHARE_CAPTURE_MAX_FPS,
        max: SCREEN_SHARE_CAPTURE_MAX_FPS,
    },
};

function getScreenShareVideoConstraints(): MediaTrackConstraints {
    return SCREEN_SHARE_VIDEO_CONSTRAINTS;
}

function getScreenShareAudioConstraints(): true | MediaTrackConstraints {
    const supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.();
    const audioConstraints: MediaTrackConstraints = {};

    if (supportedConstraints?.echoCancellation) {
        audioConstraints.echoCancellation = false;
    }
    if (supportedConstraints?.noiseSuppression) {
        audioConstraints.noiseSuppression = false;
    }
    if (supportedConstraints?.autoGainControl) {
        audioConstraints.autoGainControl = false;
    }
    if (supportedConstraints?.channelCount) {
        audioConstraints.channelCount = { ideal: 2 };
    }

    return Object.keys(audioConstraints).length > 0 ? audioConstraints : true;
}

type DisplayMediaRequestConstraints = {
    video: boolean | MediaTrackConstraints;
    audio: boolean | MediaTrackConstraints;
};

function shouldRetryWithPlainAudio(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    // Constraint-related errors are safe to retry with simpler audio settings.
    return (
        error.name === "TypeError" ||
        error.name === "OverconstrainedError" ||
        error.name === "ConstraintError"
    );
}

function buildDisplayMediaConstraints(
    constraints: MediaStreamConstraints,
    useBestEffortAudioConstraints: boolean
): DisplayMediaRequestConstraints {
    const requestedVideoConstraints = constraints.video === undefined ? true : constraints.video;
    const requestedAudioConstraints = constraints.audio === undefined ? true : constraints.audio;
    const wantsAudio = requestedAudioConstraints !== false;

    return {
        video: requestedVideoConstraints,
        audio: wantsAudio
            ? useBestEffortAudioConstraints
                ? getScreenShareAudioConstraints()
                : requestedAudioConstraints
            : false,
    };
}

async function getDisplayMediaWithAudioFallback(constraints: MediaStreamConstraints): Promise<MediaStream> {
    const bestEffortConstraints = buildDisplayMediaConstraints(constraints, true);

    try {
        return await navigator.mediaDevices.getDisplayMedia(bestEffortConstraints);
    } catch (error) {
        const wantsAudio = constraints.audio !== false;
        if (!wantsAudio || !shouldRetryWithPlainAudio(error)) {
            throw error;
        }

        console.info(
            "Screen-share audio constraints were rejected, retrying with plain audio capture.",
            error
        );
        return navigator.mediaDevices.getDisplayMedia(buildDisplayMediaConstraints(constraints, false));
    }
}

function createScreenShareBandwidthStore() {
    const { subscribe, set } = writable<number | "unlimited">(localUserStore.getScreenShareBandwidth());

    return {
        subscribe,
        setBandwidth: (bandwidth: number | "unlimited") => {
            set(bandwidth);
            localUserStore.setScreenShareBandwidth(bandwidth);
        },
    };
}

export const screenShareBandwidthStore = createScreenShareBandwidthStore();

/**
 * A store containing whether the screen sharing button should be displayed or hidden.
 */
export const screenSharingAvailableStore = isLiveStreamingStore;

export function isLivekitActiveForScreenSharing(): boolean {
    return get(inLivekitStore);
}

function isLivekitRequiredForCurrentContext(): boolean {
    return get(personalAreaSpaceNameStore) !== null || get(livekitMeetingRoomSpaceNameStore) !== null;
}

export function isScreenSharingAllowedForCurrentTransport(): boolean {
    if (SCREEN_SHARE_ALLOW_P2P_FALLBACK) return true;
    if (!isLivekitRequiredForCurrentContext()) return true;
    return isLivekitActiveForScreenSharing();
}

/**
 * A store containing the media constraints we want to apply.
 */
export const screenSharingConstraintsStore = derived(
    [
        requestedScreenSharingState,
        myCameraStore,
        myMicrophoneStore,
        inExternalServiceStore,
        inLivekitStore,
        personalAreaSpaceNameStore,
        livekitMeetingRoomSpaceNameStore,
        screenSharingAvailableStore,
        screenShareStreamElementsStore,
        isSpeakerStore,
    ],
    (
        [
            $requestedScreenSharingState,
            $myCameraStore,
            $myMicrophoneStore,
            $inExternalServiceStore,
            $inLivekitStore,
            $personalAreaSpaceNameStore,
            $livekitMeetingRoomSpaceNameStore,
            $screenSharingAvailableStore,
            $screenShareStreamElementsStore,
            $isSpeakerStore,
        ],
        set
    ) => {
        let currentVideoConstraint: boolean | MediaTrackConstraints = getScreenShareVideoConstraints();
        // TODO: set to true if we want audio enabled by default during screen sharing.
        let currentAudioConstraint: boolean | MediaTrackConstraints = true;

        // Disable screen sharing if the user requested so
        if (!$requestedScreenSharingState) {
            currentVideoConstraint = false;
            currentAudioConstraint = false;
        }

        // In LiveKit-mandatory contexts (personal areas and meeting rooms), defer capture
        // until the transport has switched to LiveKit.
        const livekitRequiredForContext =
            $personalAreaSpaceNameStore !== null || $livekitMeetingRoomSpaceNameStore !== null;
        if (livekitRequiredForContext && !SCREEN_SHARE_ALLOW_P2P_FALLBACK && !$inLivekitStore) {
            currentVideoConstraint = false;
            currentAudioConstraint = false;
        }

        // Disable screen sharing if is in a external video/audio service.
        if ($inExternalServiceStore) {
            currentVideoConstraint = false;
            currentAudioConstraint = false;
        }

        // Disable screen sharing if not in a live streaming context and no active screen shares or speaker status
        if (!$screenSharingAvailableStore && $screenShareStreamElementsStore.length === 0 && !$isSpeakerStore) {
            currentVideoConstraint = false;
            currentAudioConstraint = false;
        }

        // Let's make the changes only if the new value is different from the old one.
        if (
            previousComputedVideoConstraint !== currentVideoConstraint ||
            previousComputedAudioConstraint !== currentAudioConstraint
        ) {
            previousComputedVideoConstraint = currentVideoConstraint;
            previousComputedAudioConstraint = currentAudioConstraint;
            // Let's copy the objects.
            /*if (typeof previousComputedVideoConstraint !== 'boolean') {
                previousComputedVideoConstraint = {...previousComputedVideoConstraint};
            }
            if (typeof previousComputedAudioConstraint !== 'boolean') {
                previousComputedAudioConstraint = {...previousComputedAudioConstraint};
            }*/

            set({
                video: currentVideoConstraint,
                audio: currentAudioConstraint,
            });
        }
    },
    {
        video: false,
        audio: false,
    } as MediaStreamConstraints
);

export function isScreenSharingSupported(): boolean {
    if (window.WAD?.getDesktopCapturerSources) {
        return true;
    }

    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

async function getDesktopCapturerSources() {
    showDesktopCapturerSourcePicker.set(true);
    const source = await new Promise<DesktopCapturerSource | null>((resolve) => {
        desktopCapturerSourcePromiseResolve = resolve;
    });
    if (source === null) {
        return;
    }
    // Note: getUserMedia with chromeMediaSource does not support audio capture.
    // Audio is only available with getDisplayMedia when sharing a browser tab.
    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: source.id,
            },
        },
    });
}

/**
 * A store containing the MediaStream object for ScreenSharing (or undefined if nothing requested, or Error if an error occurred)
 */
export const screenSharingLocalStreamStore = derived(
    [screenSharingConstraintsStore, screenSharingAvailableStore],
    ([$screenSharingConstraintsStore, $screenSharingAvailableStore], set) => {
        const constraints = $screenSharingConstraintsStore;
        const waitingForLivekitHandover =
            get(requestedScreenSharingState) &&
            isLivekitRequiredForCurrentContext() &&
            !SCREEN_SHARE_ALLOW_P2P_FALLBACK &&
            !isLivekitActiveForScreenSharing() &&
            $screenSharingAvailableStore &&
            // Keep the "pending request" behavior only before first capture.
            // If we already have a stream and leave the room, we should clear the request
            // to avoid immediate re-prompts outside the meeting.
            currentStream === undefined;

        if ($screenSharingConstraintsStore.video === false && $screenSharingConstraintsStore.audio === false) {
            screenShareCaptureGeneration += 1;
            stopScreenSharing();
            if (!waitingForLivekitHandover) {
                requestedScreenSharingState.disableScreenSharing();
            }
            set({
                type: "success",
                stream: undefined,
            });
            return;
        }

        const captureGeneration = ++screenShareCaptureGeneration;
        let currentStreamPromise: Promise<MediaStream>;
        // Prefer getDisplayMedia over getDesktopCapturerSources to support audio capture
        // According to MDN: audio is optional, default is false
        // Audio is only available for certain display surfaces (mainly browser tabs)
        // See: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
            currentStreamPromise = getDisplayMediaWithAudioFallback(constraints);
        } else if (window.WAD?.getDesktopCapturerSources) {
            currentStreamPromise = getDesktopCapturerSources();
        } else {
            stopScreenSharing();
            set({
                type: "error",
                error: new Error("Your browser does not support sharing screen"),
            });
            return;
        }

        (async () => {
            try {
                stopScreenSharing();
                const newStream = await currentStreamPromise;
                if (captureGeneration !== screenShareCaptureGeneration) {
                    for (const track of newStream.getTracks()) {
                        track.stop();
                    }
                    return;
                }

                currentStream = newStream;
                const videoTrack = currentStream.getVideoTracks()[0];
                if (videoTrack) {
                    try {
                        videoTrack.contentHint = "detail";
                    } catch (error) {
                        console.info("Could not set screen-share video contentHint.", error);
                    }
                }

                const audioTrack = currentStream.getAudioTracks()[0];
                if (audioTrack) {
                    try {
                        audioTrack.contentHint = "music";
                    } catch (error) {
                        console.info("Could not set screen-share audio contentHint.", error);
                    }
                }

                const stream = currentStream;
                const emitCurrentStream = () => {
                    // Ignore late events from a previous stream instance.
                    if (captureGeneration !== screenShareCaptureGeneration || stream !== currentStream) {
                        return;
                    }
                    set({
                        type: "success",
                        stream: currentStream,
                    });
                };

                const handleTrackChanged = () => {
                    emitCurrentStream();
                };

                stream.addEventListener("addtrack", handleTrackChanged);
                stream.addEventListener("removetrack", handleTrackChanged);
                detachCurrentStreamListeners = () => {
                    stream.removeEventListener("addtrack", handleTrackChanged);
                    stream.removeEventListener("removetrack", handleTrackChanged);
                };

                // If stream ends (for instance if user clicks the stop screen sharing button in the browser), let's close the view
                for (const track of currentStream.getTracks()) {
                    track.onended = () => {
                        if (captureGeneration !== screenShareCaptureGeneration) {
                            return;
                        }
                        screenShareCaptureGeneration += 1;
                        stopScreenSharing();
                        requestedScreenSharingState.disableScreenSharing();
                        previousComputedVideoConstraint = false;
                        previousComputedAudioConstraint = false;
                        set({
                            type: "success",
                            stream: undefined,
                        });
                    };
                }

                emitCurrentStream();
                return;
            } catch (e) {
                if (captureGeneration !== screenShareCaptureGeneration) {
                    return;
                }
                currentStream = undefined;
                detachCurrentStreamListeners?.();
                detachCurrentStreamListeners = undefined;
                requestedScreenSharingState.disableScreenSharing();
                console.info("Error. Unable to share screen.", e);
                set({
                    type: "error",
                    error: e instanceof Error ? e : new Error("An unknown error happened"),
                });
            }
        })().catch((e) => console.error(e));
    }
);

export interface ScreenSharingLocalMedia {
    uniqueId: string;
    stream: MediaStream | undefined;
    userId?: undefined;
}

/**
 * The representation of the screen sharing stream.
 */
export const screenSharingLocalMedia = readable<Streamable | undefined>(undefined, function start(set) {
    const localMediaStreamStore = writable<MediaStream | undefined>(undefined);
    const mutedLocalMediaStreamStore = muteMediaStreamStore(localMediaStreamStore);

    const hasAudio = derived(
        localMediaStreamStore,
        ($localMediaStreamStore) => ($localMediaStreamStore?.getAudioTracks().length ?? 0) > 0
    );
    const isMediaMuted = derived(
        localMediaStreamStore,
        ($localMediaStreamStore) => ($localMediaStreamStore?.getAudioTracks().length ?? 0) === 0
    );

    const localMedia = {
        uniqueId: "localScreenSharingStream",
        media: {
            type: "webrtc" as const,
            streamStore: mutedLocalMediaStreamStore,
            isBlocked: writable(false),
        } satisfies WebRtcStreamable,
        spaceUserId: undefined,
        hasAudio: hasAudio,
        hasVideo: writable(true),
        isMuted: isMediaMuted,
        name: writable(""),
        showVoiceIndicator: writable(false),
        statusStore: writable("connected"),
        volumeStore: writable(undefined),
        flipX: false,
        muteAudio: true,
        displayMode: "fit" as const,
        displayInPictureInPictureMode: true,
        usePresentationMode: true,
        closeStreamable: () => {},
        volume: writable(1),
        videoType: "local_screenSharing",
    } satisfies Streamable;

    const unsubscribe = screenSharingLocalStreamStore.subscribe((screenSharingLocalStream) => {
        localMedia.name = writable(get(LL).camera.my.nameTag());
        if (screenSharingLocalStream.type === "success") {
            localMediaStreamStore.set(screenSharingLocalStream.stream);
            if (screenSharingLocalStream.stream === undefined) {
                set(undefined);
            } else {
                set(localMedia);
            }
        } else {
            localMediaStreamStore.set(undefined);
            set(undefined);
        }
    });

    return function stop() {
        unsubscribe();
    };
});

export const showDesktopCapturerSourcePicker = writable(false);

export let desktopCapturerSourcePromiseResolve: ((source: DesktopCapturerSource | null) => void) | undefined;
