# Admin API Contract (Phase 1)

This contract is derived from the current WorkAdventure codebase usage:
- `play/src/pusher/services/AdminApi.ts`
- `back/src/Services/AdminApi.ts`
- `play/src/room-api/authentication/AdminAuthenticator.ts`

Auth modes:
- Service token: `Authorization: <ADMIN_API_TOKEN>`
- Bearer token: `Authorization: Bearer <access_token>` (Keycloak)
- Public: `GET /api/capabilities`

Conventions:
- `playUri` is the full URL to the room.
- `roomUrl` is a WorkAdventure path (e.g. `/@/team/world/room`).
- Errors follow `libs/messages/src/JsonMessages/ErrorApiData.ts`.

## Endpoints

### Capabilities
- `GET /api/capabilities`
  - Response: `Capabilities` (`libs/messages/src/JsonMessages/CapabilitiesData.ts`)
  - No auth required.

### Map and room access
- `GET /api/map`
  - Query: `playUri`, `userId?`, `accessToken?`
  - Response: `MapDetailsData | RoomRedirect | ErrorApiData`
- `GET /api/room/access`
  - Query: `userIdentifier`, `accessToken?`, `playUri`, `ipAddress`, `characterTextureIds[]`, `companionTextureId?`, `chatID?`
  - Response: `FetchMemberDataByUuidResponse`
    - Success payload:
      - `status: "ok"`
      - `email: string | null`
      - `username?: string | null`
      - `userUuid: string`
      - `tags: string[]`
      - `visitCardUrl: string | null`
      - `isCharacterTexturesValid: boolean`
      - `characterTextures: WokaDetail[]`
      - `isCompanionTextureValid: boolean`
      - `companionTexture?: CompanionDetail | null`
      - `messages: unknown[]`
      - `userRoomToken?: string`
      - `activatedInviteUser?: boolean`
      - `applications?: ApplicationDefinitionInterface[] | null`
      - `canEdit?: boolean | null`
      - `world: string`
      - `chatID?: string`
    - Error payload: `ErrorApiData`

### Woka and companion catalogs
- `GET /api/woka/list`
  - Query: `roomUrl`, `uuid`
  - Response: `WokaList`
- `GET /api/companion/list`
  - Query: `roomUrl`, `uuid`
  - Response: `CompanionTextureCollection[]`

### Save user profile
- `POST /api/save-name`
  - Body: `playUri`, `userIdentifier`, `name`
  - Response: `204`
- `POST /api/save-textures`
  - Body: `playUri`, `userIdentifier`, `textures[]`
  - Response: `204`
- `POST /api/save-companion-texture`
  - Body: `playUri`, `userIdentifier`, `texture` (nullable)
  - Response: `204`

### Login token (magic link)
- `GET /api/login-url/{organizationMemberToken}`
  - Query: `playUri?`
  - Response: `AdminApiData`

### Domain verification
- `GET /api/domain/verify`
  - Query: `uri`
  - Response: `204` if valid, `403` if invalid

### Reports and bans
- `GET /api/reports`
  - Query: `status?`, `worldSlug?`, `take?`, `skip?`
  - Response: `{ total: number, reports: Report[] }`
  - `Report` fields: `id`, `worldSlug`, `status`, `comment`, `createdAt`, `reportedMember`, `reporterMember`
- `POST /api/report`
  - Body: `reportedUserUuid`, `reportedUserComment`, `reporterUserUuid`, `reportWorldSlug`
  - Response: `200`
- `GET /api/bans`
  - Query: `worldSlug?`, `activeOnly?`, `take?`, `skip?`
  - Response: `{ total: number, bans: Ban[] }`
  - `Ban` fields: `id`, `worldSlug`, `targetIdentifier`, `reason`, `expiresAt`, `createdAt`, `createdBy`
- `GET /api/ban`
  - Query: `ipAddress`, `token`, `roomUrl`
  - Response: `{ is_banned: boolean, message: string }`
- `POST /api/ban`
  - Body: `uuidToBan`, `playUri`, `name`, `message`, `byUserUuid`
  - Response: `200` or `204` (boolean body optional)

### Room list and tags
- `GET /api/room/sameWorld`
  - Query: `roomUrl`, `tags?`, `bypassTagFilter?`
  - Response: `ShortMapDescriptionList`
- `GET /api/room/tags`
  - Query: `roomUrl`
  - Response: `string[]`
- `GET /api/world/tags`
  - Query: `playUri`, `searchText?`
  - Response: `string[]`

### Members
- `GET /api/members`
  - Query: `playUri`, `searchText`
  - Response: `MemberData[]`
- `GET /api/members/{memberUUID}`
  - Response: `MemberData`
- `GET /api/members/active`
  - Query: `minutes?`, `limit?`, `searchText?`
  - Response: `{ total: number, members: MemberData[] }`
- `PUT /api/members/{userIdentifier}/chatId`
  - Body: `chatId`, `userIdentifier`, `roomUrl`
  - Response: `200`

`MemberData` fields include `lastSeenAt` (ISO timestamp or null) and `lastRoomUrl` (string or null).

### Keycloak directory
- `GET /api/keycloak/users`
  - Query: `searchText?`, `first?`, `max?`, `enabled?`
  - Response: `{ total: number, users: KeycloakUser[] }`
  - `KeycloakUser` fields: `id`, `username`, `email`, `firstName`, `lastName`, `enabled`, `createdAt`

### Chat
- `GET /api/chat/members`
  - Query: `playUri`, `searchText?`
  - Response: `{ total: number, members: { uuid, wokaName?, email?, chatId?, tags[] }[] }`

### Livekit and ICE
- `GET /api/livekit/credentials`
  - Query: `playUri`
  - Response: `{ livekitHost, livekitApiKey, livekitApiSecret }`
- `GET /api/ice-servers`
  - Query: `roomUrl`, `userIdentifier`
  - Response: `IceServer[]` where `IceServer` has `urls`, `username?`, `credential?`, `credentialType?`

### Room API authorization
- `GET /api/room-api/authorization`
  - Header: `X-API-Key`
  - Query: `roomUrl`
  - Response:
    - `{ success: true }`
    - `{ success: false, error: "UNAUTHENTICATED" | "NOT_FOUND" | "PERMISSION_DENIED" | "INTERNAL" | "UNKNOWN", message: string }`

### Misc
- `GET /white-label/cf-challenge`
  - Query: `host`
  - Response: `string`
- `GET /oauth/logout`
  - Query: `token`
  - Response: `200`
- `GET /workadventure/login`
  - UI endpoint: accepts `token` and `playUri`, creates an authenticated admin session
- `GET /profile`
  - UI endpoint: accepts `accessToken` and `playUri`, shows profile view
