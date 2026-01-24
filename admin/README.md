# WorkAdventure Admin Service

This directory hosts the standalone Admin service for WorkAdventure. It provides:

- Admin API consumed by Play/Back/Uploader via `ADMIN_API_URL`
- Admin UI (React + Vite) exposed via `ADMIN_URL` / `ADMIN_BO_URL`

Docs:
- `admin/docs/contract.md` - API contract expected by Play/Back
- `admin/docs/data-model.md` - data model and role/tag mapping

Key principles:
- Service-to-service authentication uses the raw `Authorization` header with `ADMIN_API_TOKEN`.
- Human admin access uses Keycloak OIDC (Bearer access tokens).
- Tags drive map access and editor rights; roles map to tags.
- Livekit and Coturn are supported even when hosted on separate VPS.

Planned layout:
- `admin/api` - Node + TypeScript API server
- `admin/ui` - Vite + React UI
- `admin/docs` - specs and design notes
