import { useEffect, useState } from "react";
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

export function useAdminContext() {
  const [context, setContext] = useState<AdminContext>(() => loadContext());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(context));
    } catch {
      // Ignore storage errors.
    }
  }, [context]);

  const updateContext = (patch: Partial<AdminContext>) => {
    setContext((prev) => ({ ...prev, ...patch }));
  };

  return { context, updateContext };
}
