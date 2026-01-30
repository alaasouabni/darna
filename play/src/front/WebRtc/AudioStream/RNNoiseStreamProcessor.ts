import { audioContextManager } from "../AudioContextManager";

const RNNOISE_WORKLET_URL = "/rnnoise/rnnoise-worklet.js";

export class RNNoiseStreamProcessor {
    private readonly audioContext: AudioContext;
    private workletNode: AudioWorkletNode | null = null;
    private destination: MediaStreamAudioDestinationNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private currentSourceStream: MediaStream | null = null;
    private initPromise: Promise<void> | null = null;
    private initError: Error | null = null;

    constructor(sampleRate = 48000) {
        this.audioContext = audioContextManager.getContext(sampleRate);
    }

    private async init(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async () => {
            if (this.audioContext.sampleRate !== 48000) {
                throw new Error(
                    `RNNoise requires 48kHz audio. Current sample rate is ${this.audioContext.sampleRate}Hz.`
                );
            }
            console.info("[RNNoise] Initializing worklet");
            await this.audioContext.resume();
            try {
                await this.audioContext.audioWorklet.addModule(RNNOISE_WORKLET_URL);
            } catch (error) {
                console.error("[RNNoise] Failed to load worklet module", RNNOISE_WORKLET_URL, error);
                throw error;
            }
            this.workletNode = new AudioWorkletNode(this.audioContext, "rnnoise-worklet-processor", {
                processorOptions: {},
            });
            this.destination = this.audioContext.createMediaStreamDestination();
            this.workletNode.connect(this.destination);

            await new Promise<void>((resolve, reject) => {
                if (!this.workletNode) {
                    reject(new Error("RNNoise worklet node not initialized."));
                    return;
                }

                const timeout = window.setTimeout(() => {
                    reject(new Error("RNNoise worklet did not report ready state."));
                }, 5000);

                this.workletNode.port.start();
                this.workletNode.port.onmessage = (event: MessageEvent) => {
                    const data = event.data as { type?: string; message?: string };
                    if (!data || typeof data.type !== "string") return;
                    if (data.type === "ready") {
                        window.clearTimeout(timeout);
                        this.workletNode!.port.onmessage = null;
                        console.info("[RNNoise] Worklet ready");
                        resolve();
                    } else if (data.type === "error") {
                        window.clearTimeout(timeout);
                        this.workletNode!.port.onmessage = null;
                        reject(new Error(data.message || "RNNoise worklet failed to initialize."));
                    }
                };
            });
        })().catch((e) => {
            this.initError = e instanceof Error ? e : new Error(String(e));
            throw this.initError;
        });

        return this.initPromise;
    }

    private disconnectSource(): void {
        if (!this.sourceNode) return;
        try {
            if (this.workletNode) {
                this.sourceNode.disconnect(this.workletNode);
            } else {
                this.sourceNode.disconnect();
            }
        } catch {
            // ignore
        }
        this.sourceNode = null;
    }

    public async processStream(inputStream: MediaStream): Promise<MediaStream> {
        if (this.initError) {
            throw this.initError;
        }
        await this.init();

        if (!this.workletNode || !this.destination) {
            throw new Error("RNNoise worklet not initialized.");
        }

        if (this.currentSourceStream !== inputStream) {
            this.disconnectSource();
            this.sourceNode = this.audioContext.createMediaStreamSource(inputStream);
            this.sourceNode.connect(this.workletNode);
            this.currentSourceStream = inputStream;
        }

        const processedStream = new MediaStream();
        inputStream.getVideoTracks().forEach((track) => processedStream.addTrack(track));
        const processedAudioTrack = this.destination.stream.getAudioTracks()[0];
        if (processedAudioTrack) {
            processedStream.addTrack(processedAudioTrack);
        }
        return processedStream;
    }

    public stop(): void {
        this.disconnectSource();
        this.currentSourceStream = null;
    }
}
