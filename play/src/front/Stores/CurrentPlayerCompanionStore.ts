import { writable } from "svelte/store";

export const currentPlayerCompanionStore = writable<string | undefined>(undefined);
