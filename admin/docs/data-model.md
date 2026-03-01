# Admin Data Model (Phase 1)

This is the initial data model for the admin service. It is designed to support:
- the Admin API contract consumed by Play/Back
- multi-world installs
- Keycloak roles mapped to WorkAdventure tags
- Livekit and Coturn on external VPS

## Core entities

World
- id (uuid)
- slug (string, unique, used in URLs)
- name (string)
- domain (string, optional)
- defaultRoomId (fk Room)
- settings (json)
- createdAt, updatedAt

Room
- id (uuid)
- worldId (fk World)
- slug (string)
- roomUrl (string, full WA path, unique per world)
- mapUrl (string, optional)
- wamUrl (string, optional)
- tags (string[])
- isActive (boolean)
- metadata (json, map meta overrides)
- createdAt, updatedAt

Member
- id (uuid)
- externalId (string, Keycloak subject or email)
- email (string, nullable)
- displayName (string, nullable)
- visitCardUrl (string, nullable)
- chatId (string, nullable)
- characterTextureIds (string[], saved Woka textures)
- companionTextureId (string, nullable, saved companion texture)
- lastSeenAt (timestamp, nullable)
- lastRoomUrl (string, nullable)
- createdAt, updatedAt

MemberTag
- memberId (fk Member)
- tag (string)

WorldTag
- worldId (fk World)
- tag (string)

RoomTag
- roomId (fk Room)
- tag (string)

Report
- id (uuid)
- worldId (fk World)
- reportedMemberId (fk Member)
- reporterMemberId (fk Member)
- comment (string)
- status (enum: open, resolved, rejected)
- createdAt, updatedAt

Ban
- id (uuid)
- worldId (fk World)
- targetIdentifier (string, email or uuid)
- ipAddress (string, nullable)
- reason (string, nullable)
- expiresAt (timestamp, nullable)
- createdByMemberId (fk Member, nullable)
- createdAt, updatedAt

LoginToken
- id (uuid)
- token (string, unique)
- memberId (fk Member)
- roomId (fk Room)
- expiresAt (timestamp)
- createdAt

InviteToken
- id (uuid)
- token (string, unique)
- worldId (fk World)
- roomId (fk Room, nullable)
- createdByMemberId (fk Member, nullable)
- usedByMemberId (fk Member, nullable, last user who consumed)
- allowedEmail (string, nullable)
- maxUses (int, nullable for unlimited)
- useCount (int)
- expiresAt (timestamp)
- revokedAt (timestamp, nullable)
- lastUsedAt (timestamp, nullable)
- createdAt (timestamp)

WokaCollection
- id (uuid)
- name (string)
- worldId (fk World, nullable for global)

WokaTexture
- id (uuid)
- collectionId (fk WokaCollection)
- name (string)
- url (string)
- tintable (boolean)

CompanionCollection
- id (uuid)
- name (string)
- worldId (fk World, nullable for global)

CompanionTexture
- id (uuid)
- collectionId (fk CompanionCollection)
- name (string)
- url (string)
- behavior (enum: cat, dog, red_panda)

LivekitConfig
- id (uuid)
- worldId (fk World)
- host (string)
- apiKey (string)
- apiSecret (string)

IceConfig
- id (uuid)
- worldId (fk World)
- stunUrls (string[])
- turnUrls (string[])
- turnUser (string, optional)
- turnPassword (string, optional)
- turnStaticAuthSecret (string, optional)

## Role and tag mapping

Keycloak roles map to WorkAdventure tags:
- wa-admin -> admin
- wa-editor -> editor
- wa-moderator -> moderator
- wa-viewer -> viewer

Final tag set for a user:
- tags from Keycloak access token roles
- tags from MemberTag

## Access logic (first pass)

- /api/room/access
  - If room has required tags, user must match at least one tag.
  - If no room tags are defined, access is allowed.
  - canEdit if user has tag admin or editor.
- /api/room/sameWorld
  - If bypassTagFilter is true, return all rooms in the world.
  - Otherwise, return rooms whose tags intersect the user tags.

## Livekit and Coturn

Because Livekit and Coturn are hosted on separate VPS:
- LivekitConfig is stored per world and returned by /api/livekit/credentials.
- ICE servers are generated from IceConfig (or global env fallback).
  - If turnStaticAuthSecret is set, generate ephemeral credentials per user.
