import { writable } from "svelte/store";

export const selectCompanionSceneVisibleStore = writable(false);
export const selectCompanionReadyStore = writable(false);

export type CompanionPreviewFrame = {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
} | null;

export const selectCompanionPreviewFrameStore = writable<CompanionPreviewFrame>(null);
