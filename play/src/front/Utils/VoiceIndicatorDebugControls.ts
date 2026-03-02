import {
    VOICE_INDICATOR_DEBUG_LOGS,
    VOICE_INDICATOR_DISABLE_TWEEN,
    VOICE_INDICATOR_MIN_OFF_MS,
    VOICE_INDICATOR_MIN_ON_MS,
    VOICE_INDICATOR_OFF_THRESHOLD,
    VOICE_INDICATOR_ON_THRESHOLD,
    VOICE_INDICATOR_PERF_ENABLED,
    VOICE_INDICATOR_USE_HYSTERESIS,
} from "../Enum/EnvironmentVariable";

const LEGACY_TALK_ICON_VOLUME_THRESHOLD = 10;

export type WaVoiceIndicatorDebugControls = {
    enabled: boolean;
    disableTween: boolean;
    useHysteresis: boolean;
    onThreshold: number;
    offThreshold: number;
    minOnMs: number;
    minOffMs: number;
    debugLogs: boolean;
};

const DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS: WaVoiceIndicatorDebugControls = {
    enabled: VOICE_INDICATOR_PERF_ENABLED,
    disableTween: VOICE_INDICATOR_DISABLE_TWEEN,
    useHysteresis: VOICE_INDICATOR_USE_HYSTERESIS,
    onThreshold: VOICE_INDICATOR_ON_THRESHOLD,
    offThreshold: VOICE_INDICATOR_OFF_THRESHOLD,
    minOnMs: VOICE_INDICATOR_MIN_ON_MS,
    minOffMs: VOICE_INDICATOR_MIN_OFF_MS,
    debugLogs: VOICE_INDICATOR_DEBUG_LOGS,
};

type VoiceIndicatorDebugWindow = Window & {
    __waVoiceIndicator?: Partial<WaVoiceIndicatorDebugControls>;
};

function sanitizeNumber(value: unknown, fallback: number, minValue: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(minValue, value);
}

function toNumberOr(value: unknown, fallback: number, minValue: number): number {
    return sanitizeNumber(value, fallback, minValue);
}

function toBooleanOr(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    return fallback;
}

function getDebugWindowControls(): Partial<WaVoiceIndicatorDebugControls> | undefined {
    if (typeof window === "undefined") {
        return undefined;
    }

    const debugWindow = window as VoiceIndicatorDebugWindow;
    if (!debugWindow.__waVoiceIndicator) {
        debugWindow.__waVoiceIndicator = { ...DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS };
    }
    return debugWindow.__waVoiceIndicator;
}

export function getVoiceIndicatorDebugControls(): WaVoiceIndicatorDebugControls {
    const controls = getDebugWindowControls();
    if (!controls) {
        return { ...DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS };
    }

    return {
        enabled: toBooleanOr(controls.enabled, DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS.enabled),
        disableTween: toBooleanOr(controls.disableTween, DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS.disableTween),
        useHysteresis: toBooleanOr(controls.useHysteresis, DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS.useHysteresis),
        onThreshold: toNumberOr(controls.onThreshold, DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS.onThreshold, 0),
        offThreshold: toNumberOr(controls.offThreshold, DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS.offThreshold, 0),
        minOnMs: toNumberOr(controls.minOnMs, DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS.minOnMs, 0),
        minOffMs: toNumberOr(controls.minOffMs, DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS.minOffMs, 0),
        debugLogs: toBooleanOr(controls.debugLogs, DEFAULT_VOICE_INDICATOR_DEBUG_CONTROLS.debugLogs),
    };
}

export function getLegacyTalkIconVolumeThreshold(): number {
    return LEGACY_TALK_ICON_VOLUME_THRESHOLD;
}
