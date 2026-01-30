import createRNNWasmModuleSync from "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js";

const FRAME_SIZE = 480;

type RnnoiseModule = {
    ready: Promise<unknown>;
    HEAPF32: Float32Array;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    _rnnoise_create: () => number;
    _rnnoise_destroy: (state: number) => void;
    _rnnoise_process_frame: (state: number, out: number, input: number) => number;
};

class RNNoiseWorkletProcessor extends AudioWorkletProcessor {
    private frameBuffer = new Float32Array(FRAME_SIZE);
    private frameOffset = 0;
    private outputQueue: Float32Array[] = [];
    private outputOffset = 0;

    private ready = false;
    private failed = false;
    private module: RnnoiseModule | null = null;
    private statePtr = 0;
    private inPtr = 0;
    private outPtr = 0;
    private processFrameFn: ((state: number, out: number, input: number) => number) | null = null;

    constructor() {
        super();
        this.initModule().catch((e) => {
            this.failed = true;
            this.port.postMessage({ type: "error", message: e?.message ?? String(e) });
        });
    }

    private async initModule(): Promise<void> {
        const module = createRNNWasmModuleSync() as RnnoiseModule;
        await module.ready;
        if (!module._malloc || !module._rnnoise_create || !module._rnnoise_process_frame) {
            throw new Error("RNNoise module missing required exports.");
        }
        this.module = module;
        this.statePtr = module._rnnoise_create();
        this.inPtr = module._malloc(FRAME_SIZE * 4);
        this.outPtr = module._malloc(FRAME_SIZE * 4);
        this.processFrameFn = module._rnnoise_process_frame;
        this.ready = true;
        this.port.postMessage({ type: "ready" });
    }

    private processFrame(frame: Float32Array): Float32Array {
        if (!this.ready || !this.module || !this.processFrameFn || this.inPtr === 0 || this.outPtr === 0) {
            return frame;
        }

        const inputOffset = this.inPtr / 4;
        const outputOffset = this.outPtr / 4;
        const heapF32 = this.module.HEAPF32;
        heapF32.set(frame, inputOffset);
        this.processFrameFn(this.statePtr, this.outPtr, this.inPtr);
        return heapF32.subarray(outputOffset, outputOffset + FRAME_SIZE).slice();
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const outputChannel = output[0];
        if (!inputs || inputs.length === 0 || inputs[0].length === 0) {
            outputChannel.fill(0);
            return true;
        }

        const inputChannel = inputs[0][0];
        let inputOffset = 0;

        while (inputOffset < inputChannel.length) {
            const remaining = FRAME_SIZE - this.frameOffset;
            const toCopy = Math.min(remaining, inputChannel.length - inputOffset);
            this.frameBuffer.set(inputChannel.subarray(inputOffset, inputOffset + toCopy), this.frameOffset);
            this.frameOffset += toCopy;
            inputOffset += toCopy;

            if (this.frameOffset === FRAME_SIZE) {
                const processed = this.failed ? this.frameBuffer.slice() : this.processFrame(this.frameBuffer);
                this.outputQueue.push(processed);
                this.frameOffset = 0;
            }
        }

        let outOffset = 0;
        while (outOffset < outputChannel.length) {
            if (this.outputQueue.length === 0) {
                outputChannel.fill(0, outOffset);
                break;
            }
            const frame = this.outputQueue[0];
            const available = frame.length - this.outputOffset;
            const toWrite = Math.min(available, outputChannel.length - outOffset);
            outputChannel.set(frame.subarray(this.outputOffset, this.outputOffset + toWrite), outOffset);
            outOffset += toWrite;
            this.outputOffset += toWrite;
            if (this.outputOffset >= frame.length) {
                this.outputQueue.shift();
                this.outputOffset = 0;
            }
        }

        for (let c = 1; c < output.length; c++) {
            output[c].set(outputChannel);
        }

        return true;
    }
}

registerProcessor("rnnoise-worklet-processor", RNNoiseWorkletProcessor);
export {};
