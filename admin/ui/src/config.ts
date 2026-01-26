type UiEnv = {
  VITE_DEFAULT_PLAY_URI?: string;
  VITE_DEFAULT_ROOM_URL?: string;
  VITE_DEFAULT_WORLD_SLUG?: string;
  VITE_DEFAULT_USER_IDENTIFIER?: string;
};

const env = import.meta.env as UiEnv;

export const DEFAULT_PLAY_URI = env.VITE_DEFAULT_PLAY_URI ?? "";
export const DEFAULT_ROOM_URL = env.VITE_DEFAULT_ROOM_URL ?? "";
export const DEFAULT_WORLD_SLUG = env.VITE_DEFAULT_WORLD_SLUG ?? "";
export const DEFAULT_USER_IDENTIFIER = env.VITE_DEFAULT_USER_IDENTIFIER ?? "";

export function inferWorldSlug(roomUrl: string) {
  const segments = roomUrl.split("/").filter(Boolean);
  if (!segments.length) {
    return "";
  }
  if (segments[0] === "@") {
    if (segments.length >= 3) {
      return segments[2];
    }
    if (segments.length >= 2) {
      return segments[1];
    }
  }
  if (segments[0] === "~") {
    return segments[1] ?? "";
  }
  return "";
}

export function inferWorldDomain(playUri: string) {
  try {
    return new URL(playUri).host;
  } catch {
    return "";
  }
}
