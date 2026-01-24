-- Seed a world + room for the admin database.
-- Replace the placeholders before running.
-- Example values:
--   WORLD_SLUG=darna
--   WORLD_NAME=Darna
--   WORLD_DOMAIN=darna.lightency.io
--   ROOM_SLUG=office
--   ROOM_URL=/@/darna/office
--   WAM_URL=https://darna.lightency.io/map-storage/darna/office.wam

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

WITH upsert_world AS (
  INSERT INTO "World"(id, slug, name, domain, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid(),
    'WORLD_SLUG',
    'WORLD_NAME',
    'WORLD_DOMAIN',
    now(),
    now()
  )
  ON CONFLICT (slug)
  DO UPDATE SET
    name = EXCLUDED.name,
    domain = EXCLUDED.domain,
    "updatedAt" = now()
  RETURNING id
),
upsert_room AS (
  INSERT INTO "Room"(id, "worldId", slug, "roomUrl", "wamUrl", tags, "isActive", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid(),
    id,
    'ROOM_SLUG',
    'ROOM_URL',
    'WAM_URL',
    ARRAY[]::text[],
    true,
    now(),
    now()
  FROM upsert_world
  ON CONFLICT ("roomUrl")
  DO UPDATE SET
    "worldId" = EXCLUDED."worldId",
    slug = EXCLUDED.slug,
    "wamUrl" = EXCLUDED."wamUrl",
    "updatedAt" = now()
  RETURNING id, "worldId"
)
UPDATE "World" w
SET "defaultRoomId" = upsert_room.id, "updatedAt" = now()
FROM upsert_room
WHERE w.id = upsert_room."worldId";
