import createRNNWasmModuleSync from "./rnnoise-sync.js";

const FRAME_SIZE = 480;

// Overall output gain (safe with limiter)
const OUTPUT_GAIN = 1.15;

// -------------------- Gate + speech detection --------------------
const VAD_ON = 0.08;
const VAD_OFF = 0.04;

// If VAD is very high, treat as speech even if RMS is low (fixes your dropouts)
const VAD_STRONG = 0.6;

// Hangover: keep speech open briefly after detection drops
const HANG_FRAMES = 60;

// Silence handling (kills hiss)
const NOISE_GAIN = 0.25;
const SILENCE_RMS = 0.006;
const SILENCE_GAIN = 0.04;

// Require energy + VAD to open speech (but VAD_STRONG can override)
const RMS_ON = 0.0065; // lowered (your logs show speech rms ~0.004–0.010)
const RMS_OFF = 0.0045;

const OPEN_FRAMES = 3;
const CLOSE_FRAMES = 8;

// Treat as “true silence” only if BOTH RMS is low AND VAD is low
const SILENCE_VAD_MAX = 0.12;

// Smooth gate changes
const ATTACK_FRAMES = 2;
const RELEASE_FRAMES = 25;
const ATTACK_COEFF = 1 - Math.exp(-1 / ATTACK_FRAMES);
const RELEASE_COEFF = 1 - Math.exp(-1 / RELEASE_FRAMES);

// -------------------- Startup grace (FIXES first-seconds cut) --------------------
// Anchor grace to the moment we receive real audio (first full frame),
// not to constructor time.
const STARTUP_GRACE_SEC = 1.0; // 0.7–1.0 is usually enough
const STARTUP_OPEN_FRAMES = 1; // open immediately if speech-ish
const STARTUP_NOISE_GAIN = 0.65; // avoid clamping early syllables

// -------------------- Impulse (keyboard/mouse click) rejection --------------------
const ENABLE_IMPULSE_REJECT = true;
const IMPULSE_CREST = 12.0;
const IMPULSE_MAX_RMS = 0.035;
const IMPULSE_VAD_MAX = 0.35;

// -------------------- Auto makeup gain --------------------
const ENABLE_AUTO_MAKEUP = true;
const MAKEUP_MIN = 0.9;
const MAKEUP_MAX = 6.0;
const MAKEUP_ATTACK = 0.25;
const MAKEUP_RELEASE = 0.05;

const MAKEUP_LEARN_VAD = 0.06;
const MAKEUP_DECAY = 0.02;

// Also require some energy to learn/apply makeup (prevents boosting noise during hangover)
const MAKEUP_MIN_RMS = 0.006;

// -------------------- VAD-based RAW↔DENOISED mix --------------------
const ENABLE_VAD_MIX = true;
const MIX_START = 0.03;
const MIX_END = 0.18;
const MIX_ATTACK = 0.25;
const MIX_RELEASE = 0.05;

// RNNoise expects PCM16-scale floats
const RNNOISE_SCALE = 32768;

// Limiter
const LIMIT = 0.98;

// Debug
const ENABLE_DEBUG = true;
const DEBUG_EVERY_FRAMES = 100;

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function rms(x) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return Math.sqrt(s / x.length + 1e-12);
}

function peakAbs(x) {
    let p = 0;
    for (let i = 0; i < x.length; i++) {
        const a = Math.abs(x[i]);
        if (a > p) p = a;
    }
    return p;
}

function smoothstep01(x) {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
}

class RNNoiseWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.frameBuffer = new Float32Array(FRAME_SIZE);
        this.frameOffset = 0;

        this.outputQueue = [];
        this.outputOffset = 0;

        this.ready = false;
        this.failed = false;
        this.module = null;
        this.statePtr = 0;
        this.inPtr = 0;
        this.outPtr = 0;
        this.processFrameFn = null;

        this.speaking = false;
        this.speechHold = 0;
        this.gateGain = 1.0;
        this.openCount = 0;
        this.closeCount = 0;

        this.makeup = 1.0;
        this.mix = 1.0;

        this._dbgFrames = 0;

        // Startup grace: set when we see the first full audio frame
        this.startedAt = -1;

        this.initModule().catch((e) => {
            this.failed = true;
            this.port.postMessage({ type: "error", message: e?.message ?? String(e) });
        });
    }

    inStartupGrace() {
        return this.startedAt >= 0 && currentTime - this.startedAt < STARTUP_GRACE_SEC;
    }

    async initModule() {
        const module = createRNNWasmModuleSync();
        await module.ready;

        if (!module._malloc || !module._rnnoise_create || !module._rnnoise_process_frame) {
            throw new Error("RNNoise module missing required exports.");
        }

        this.module = module;
        this.statePtr = module._rnnoise_create(0);

        this.inPtr = module._malloc(FRAME_SIZE * 4);
        this.outPtr = module._malloc(FRAME_SIZE * 4);
        this.processFrameFn = module._rnnoise_process_frame;

        this.ready = true;
        this.port.postMessage({ type: "ready" });
    }

    processFrame(frame) {
        if (!this.ready || !this.module || !this.processFrameFn || !this.inPtr || !this.outPtr) {
            // In your pipeline you await "ready" before using the stream,
            // but keep this safe anyway.
            return { frame: frame.slice(), vad: 0.0 };
        }

        const heapF32 = this.module.HEAPF32;
        const inOff = this.inPtr >>> 2;
        const outOff = this.outPtr >>> 2;

        for (let i = 0; i < FRAME_SIZE; i++) {
            heapF32[inOff + i] = frame[i] * RNNOISE_SCALE;
        }

        const vad = this.processFrameFn(this.statePtr, this.outPtr, this.inPtr);

        const out = new Float32Array(FRAME_SIZE);
        for (let i = 0; i < FRAME_SIZE; i++) {
            out[i] = heapF32[outOff + i] / RNNOISE_SCALE;
        }

        return { frame: out, vad };
    }

    // speechish: VAD+RMS, but strong VAD can override RMS (fixes your volume drops)
    // During startup grace, be slightly more permissive on RMS (prevents initial cut).
    isSpeechish(vad, rawRms, isImpulse) {
        if (isImpulse) return false;
        if (vad >= VAD_STRONG) return true;

        const inGrace = this.inStartupGrace();
        const rmsThresh = inGrace ? RMS_OFF : RMS_ON;

        return vad >= VAD_ON && rawRms >= rmsThresh;
    }

    // silenceish: low VAD + low RMS (prevents “vad=0.99 in silence” from breaking you)
    isSilenceish(vad, rawRms) {
        const trueSilent = rawRms < SILENCE_RMS && vad < SILENCE_VAD_MAX;
        const softSilent = vad < VAD_OFF && rawRms < RMS_OFF;
        return trueSilent || softSilent;
    }

    computeGateTarget(vad, rawRms, isImpulse) {
        const inGrace = this.inStartupGrace();

        const speechish = this.isSpeechish(vad, rawRms, isImpulse);
        const silenceish = this.isSilenceish(vad, rawRms);

        const openFrames = inGrace ? STARTUP_OPEN_FRAMES : OPEN_FRAMES;

        if (!this.speaking) {
            this.openCount = speechish ? this.openCount + 1 : 0;
            if (this.openCount >= openFrames) {
                this.speaking = true;
                this.speechHold = HANG_FRAMES;
                this.openCount = 0;
                this.closeCount = 0;
            }
        } else {
            if (speechish) {
                this.speechHold = HANG_FRAMES;
                this.closeCount = 0;
            } else if (this.speechHold > 0) {
                this.speechHold--;
            } else if (silenceish) {
                this.closeCount++;
                if (this.closeCount >= CLOSE_FRAMES) {
                    this.speaking = false;
                    this.closeCount = 0;
                }
            }
        }

        // True silence clamp (but NOT during startup grace, avoids early syllable loss)
        if (rawRms < SILENCE_RMS && vad < SILENCE_VAD_MAX) {
            return inGrace ? STARTUP_NOISE_GAIN : SILENCE_GAIN;
        }

        if (this.speaking) return 1.0;

        // During grace, don’t clamp hard yet
        if (inGrace) return STARTUP_NOISE_GAIN;

        if (rawRms < SILENCE_RMS) return SILENCE_GAIN;
        return NOISE_GAIN;
    }

    updateGateGain(target) {
        const coeff = target > this.gateGain ? ATTACK_COEFF : RELEASE_COEFF;
        this.gateGain += (target - this.gateGain) * coeff;
        return this.gateGain;
    }

    updateMakeup(rawFrame, processedFrame, vad, rawRms) {
        if (!ENABLE_AUTO_MAKEUP) return this.makeup;

        // Only learn on real speech frames (vad + enough energy)
        if (vad < MAKEUP_LEARN_VAD || rawRms < MAKEUP_MIN_RMS) {
            this.makeup += (1.0 - this.makeup) * MAKEUP_DECAY;
            return this.makeup;
        }

        const inR = rms(rawFrame);
        const outR = rms(processedFrame);
        if (outR < 1e-6) return this.makeup;

        const target = clamp(inR / outR, MAKEUP_MIN, MAKEUP_MAX);
        const k = target > this.makeup ? MAKEUP_ATTACK : MAKEUP_RELEASE;
        this.makeup += (target - this.makeup) * k;

        return this.makeup;
    }

    updateMix(vad, forceDenoised) {
        if (!ENABLE_VAD_MIX) {
            this.mix = 1.0;
            return this.mix;
        }

        const target = forceDenoised ? 1.0 : smoothstep01((vad - MIX_START) / (MIX_END - MIX_START));
        const k = target > this.mix ? MIX_ATTACK : MIX_RELEASE;
        this.mix += (target - this.mix) * k;

        return this.mix;
    }

    applyGainAndLimit(frame, gain) {
        for (let i = 0; i < frame.length; i++) {
            let y = frame[i] * gain;
            if (y > LIMIT) y = LIMIT;
            else if (y < -LIMIT) y = -LIMIT;
            frame[i] = y;
        }
    }

    process(inputs, outputs) {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const outputChannel = output[0];

        if (!inputs || inputs.length === 0 || inputs[0].length === 0 || !inputs[0][0]) {
            outputChannel.fill(0);
            return true;
        }

        const inputChannel = inputs[0][0];

        let inOff = 0;
        while (inOff < inputChannel.length) {
            const remaining = FRAME_SIZE - this.frameOffset;
            const toCopy = Math.min(remaining, inputChannel.length - inOff);

            this.frameBuffer.set(inputChannel.subarray(inOff, inOff + toCopy), this.frameOffset);
            this.frameOffset += toCopy;
            inOff += toCopy;

            if (this.frameOffset === FRAME_SIZE) {
                // Anchor grace to first actual audio frame
                if (this.startedAt < 0) this.startedAt = currentTime;

                if (this.failed) {
                    this.outputQueue.push(this.frameBuffer.slice());
                } else {
                    const raw = this.frameBuffer;
                    const rawRms = rms(raw);
                    const p = peakAbs(raw);
                    const crest = p / (rawRms + 1e-12);

                    const { frame: denoised, vad } = this.processFrame(raw);

                    const isImpulse =
                        ENABLE_IMPULSE_REJECT &&
                        crest > IMPULSE_CREST &&
                        rawRms < IMPULSE_MAX_RMS &&
                        vad < IMPULSE_VAD_MAX;

                    // Gate
                    const gateTarget = this.computeGateTarget(vad, rawRms, isImpulse);
                    const gate = this.updateGateGain(gateTarget);

                    // Mix: force denoised if not speaking OR truly silent
                    const trueSilent = rawRms < SILENCE_RMS && vad < SILENCE_VAD_MAX;
                    const forceDenoised = !this.speaking || trueSilent;
                    const mix = this.updateMix(vad, forceDenoised);

                    if (mix < 0.999) {
                        for (let i = 0; i < FRAME_SIZE; i++) {
                            denoised[i] = raw[i] * (1 - mix) + denoised[i] * mix;
                        }
                    }

                    // Makeup: learn + apply only on “real speech energy” frames
                    const makeup = this.updateMakeup(raw, denoised, vad, rawRms);
                    const activeSpeechNow = this.isSpeechish(vad, rawRms, isImpulse);
                    const effectiveMakeup = activeSpeechNow ? makeup : 1.0;

                    const totalGain = OUTPUT_GAIN * effectiveMakeup * gate;
                    this.applyGainAndLimit(denoised, totalGain);

                    if (ENABLE_DEBUG) {
                        this._dbgFrames++;
                        if (this._dbgFrames % DEBUG_EVERY_FRAMES === 0) {
                            let mode = "noise";
                            if (trueSilent) mode = "silence";
                            else if (this.speaking) mode = "speech";

                            this.port.postMessage({
                                type: "dbg",
                                mode,
                                inGrace: this.inStartupGrace(),
                                vad,
                                rawRms,
                                peak: p,
                                crest,
                                impulse: isImpulse,
                                speaking: this.speaking,
                                activeSpeechNow,
                                speechHold: this.speechHold,
                                gate,
                                makeup,
                                effectiveMakeup,
                                mix,
                                totalGain,
                            });
                        }
                    }

                    this.outputQueue.push(denoised);
                }

                this.frameOffset = 0;
            }
        }

        // Drain queue
        let outOff = 0;
        while (outOff < outputChannel.length) {
            if (this.outputQueue.length === 0) {
                outputChannel.set(inputChannel.subarray(outOff), outOff);
                break;
            }

            const frame = this.outputQueue[0];
            const available = frame.length - this.outputOffset;
            const toWrite = Math.min(available, outputChannel.length - outOff);

            outputChannel.set(frame.subarray(this.outputOffset, this.outputOffset + toWrite), outOff);

            outOff += toWrite;
            this.outputOffset += toWrite;

            if (this.outputOffset >= frame.length) {
                this.outputQueue.shift();
                this.outputOffset = 0;
            }
        }

        // Copy mono to other channels
        for (let c = 1; c < output.length; c++) {
            output[c].set(outputChannel);
        }

        return true;
    }
}

registerProcessor("rnnoise-worklet-processor", RNNoiseWorkletProcessor);
