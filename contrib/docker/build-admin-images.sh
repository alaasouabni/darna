#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)

set -a
source "$SCRIPT_DIR/.env"
set +a

: "${ADMIN_API_IMAGE:?ADMIN_API_IMAGE is required}"
: "${ADMIN_UI_IMAGE:?ADMIN_UI_IMAGE is required}"

docker build -f "$ROOT_DIR/admin/api/Dockerfile" -t "$ADMIN_API_IMAGE" "$ROOT_DIR"

docker build -f "$ROOT_DIR/admin/ui/Dockerfile" \
  --build-arg VITE_API_BASE_URL="/api" \
  --build-arg VITE_KEYCLOAK_URL="${VITE_KEYCLOAK_URL:-}" \
  --build-arg VITE_KEYCLOAK_REALM="${VITE_KEYCLOAK_REALM:-}" \
  --build-arg VITE_KEYCLOAK_CLIENT_ID="${VITE_KEYCLOAK_CLIENT_ID:-}" \
  --build-arg VITE_DEFAULT_PLAY_URI="${VITE_DEFAULT_PLAY_URI:-}" \
  --build-arg VITE_DEFAULT_ROOM_URL="${VITE_DEFAULT_ROOM_URL:-}" \
  --build-arg VITE_DEFAULT_WORLD_SLUG="${VITE_DEFAULT_WORLD_SLUG:-}" \
  --build-arg VITE_DEFAULT_USER_IDENTIFIER="${VITE_DEFAULT_USER_IDENTIFIER:-}" \
  -t "$ADMIN_UI_IMAGE" "$ROOT_DIR"

docker push "$ADMIN_API_IMAGE"
docker push "$ADMIN_UI_IMAGE"
