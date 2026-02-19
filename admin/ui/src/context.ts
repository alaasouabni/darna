import { useSyncExternalStore } from "react";
import {
  DEFAULT_PLAY_URI,
  DEFAULT_ROOM_URL,
  DEFAULT_USER_IDENTIFIER,
  DEFAULT_WORLD_SLUG,
  inferWorldSlug,
} from "./config";

export type AdminContext = {
  playUri: string;
  roomUrl: string;
  worldSlug: string;
  userIdentifier: string;
};

const STORAGE_KEY = "wa-admin-context";
const listeners = new Set<() => void>();
let contextStore = loadContext();
let storageSyncBound = false;

function getDefaultContext(): AdminContext {
  const inferredWorld = DEFAULT_WORLD_SLUG || inferWorldSlug(DEFAULT_ROOM_URL);
  return {
    playUri: DEFAULT_PLAY_URI,
    roomUrl: DEFAULT_ROOM_URL,
    worldSlug: inferredWorld,
    userIdentifier: DEFAULT_USER_IDENTIFIER,
  };
}

function loadContext(): AdminContext {
  if (typeof window === "undefined") {
    return getDefaultContext();
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return getDefaultContext();
    }
    const parsed = JSON.parse(stored) as Partial<AdminContext>;
    const defaults = getDefaultContext();
    return {
      playUri: parsed.playUri ?? defaults.playUri,
      roomUrl: parsed.roomUrl ?? defaults.roomUrl,
      worldSlug: parsed.worldSlug ?? defaults.worldSlug,
      userIdentifier: parsed.userIdentifier ?? defaults.userIdentifier,
    };
  } catch {
    return getDefaultContext();
  }
}

function notifyContextChange() {
  listeners.forEach((listener) => listener());
}

function persistContext(value: AdminContext) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage errors.
  }
}

function setContextStore(value: AdminContext) {
  contextStore = value;
  persistContext(value);
  notifyContextChange();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return contextStore;
}

function getServerSnapshot() {
  return getDefaultContext();
}

function ensureStorageSync() {
  if (storageSyncBound || typeof window === "undefined") {
    return;
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    contextStore = loadContext();
    notifyContextChange();
  });

  storageSyncBound = true;
}

export function useAdminContext() {
  ensureStorageSync();
  const context = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const updateContext = (patch: Partial<AdminContext>) => {
    setContextStore({
      ...contextStore,
      ...patch,
    });
  };

  return { context, updateContext };
}
