import { writable } from "svelte/store";

/**
 * When true, profile edit scenes are opened from inside the game.
 * We should NOT leave the room or switch to the camera/enable flow.
 */
export const inGameProfileEditStore = writable<boolean>(false);

