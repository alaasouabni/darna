## Cache/Login Loop Fix (401 + Stale Client)

This note documents the changes made to prevent “old cached clients” from getting stuck
with 401 errors and to force a clean login when tokens are stale.

### 1) Admin API: stricter auth for `/api/room/access`
File: `admin/api/src/modules/access/routes.ts`

- Reject requests without a valid, non‑expired OIDC access token **when `DISABLE_ANONYMOUS=true`**.
- Require a non‑empty identifier (no empty / “-” placeholder).
- Effect: prevents creating placeholder members (name/email “-”) from stale cached sessions.

### 2) Play backend: treat any `/room/access` 401 as “token expired”
File: `play/src/pusher/services/AdminApi.ts`

- On `axios` error with **status 401**, throw `JsonWebTokenError`.
- This makes the socket flow emit `tokenExpiredMessage`, which triggers logout
  and redirects to login.

### 3) Client boot: version check + forced reload
File: `play/src/svelte.ts`

- Fetch `/version.json` with `cache: "no-store"`.
- Compare `hash` to `localStorage.waClientHash`.
- If mismatch: clear `authToken` and `window.location.reload()`.

### 4) Build: emit `version.json` with git hash
File: `play/vite.config.mts`

- Added a Vite plugin that emits `version.json` at build time.
- Hash source order:
  - `VITE_BUILD_HASH` → `SENTRY_RELEASE` → `GIT_HASH` → `git rev-parse --short HEAD`
  - Fallback to timestamp.

### 5) Docker: pass git hash to the build
File: `play/Dockerfile`

- Added `ARG GIT_HASH` and `ENV VITE_BUILD_HASH=$GIT_HASH`.
- Build example:
  ```
  docker build --build-arg GIT_HASH=$(git rev-parse --short HEAD) -f play/Dockerfile -t <image> .
  ```

### 6) Service Worker: immediate takeover + cache eviction
File: `play/public/service-worker-prod.js`

- `self.skipWaiting()` on install.
- `clients.claim()` on activate.
- Deletes old cache names on activate.
- Cache name bumped to `workadventure-cache-v2`.

---

## How to verify

1) Check the version endpoint:
   - `https://<your-domain>/version.json`
2) Confirm local storage key:
   - `localStorage.waClientHash` should match the hash in `version.json`.
3) Simulate stale session (short token TTL in Keycloak) and confirm:
   - client redirects to login (no stuck 401 loop).

