/**
 * These declarations tell TypeScript that we allow import of images, e.g.
 * ```
 <script lang='ts'>
 import successkid from 'images/successkid.jpg';
 </script>
 <img src="{successkid}">
 ```
 */
declare module "*.gif" {
    const value: string;
    export = value;
}

declare module "*.jpg" {
    const value: string;
    export = value;
}

declare module "*.jpeg" {
    const value: string;
    export = value;
}

declare module "*.png" {
    const value: string;
    export = value;
}

declare module "*.svg" {
    const value: string;
    export = value;
}

declare module "*.webp" {
    const value: string;
    export = value;
}

declare module "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js" {
    const createRNNWasmModuleSync: () => {
        ready: Promise<unknown>;
        HEAPF32: Float32Array;
        _malloc: (size: number) => number;
        _free: (ptr: number) => void;
        _rnnoise_create: () => number;
        _rnnoise_destroy: (state: number) => void;
        _rnnoise_process_frame: (state: number, out: number, input: number) => number;
    };
    export default createRNNWasmModuleSync;
}
