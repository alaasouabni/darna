let accessToken: string | undefined;
let refreshTokenHandler: (() => Promise<void>) | null = null;

export function setAccessToken(token?: string) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setRefreshTokenHandler(handler: (() => Promise<void>) | null) {
  refreshTokenHandler = handler;
}

export async function ensureFreshToken() {
  if (refreshTokenHandler) {
    await refreshTokenHandler();
  }
}
