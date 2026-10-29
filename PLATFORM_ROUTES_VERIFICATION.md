# Platform Routes Verification (TIS v0.2)

## Source of Truth
Platform PR: dunatron/new_talaria#234

## Ingest Routes Status

### ✅ Implemented and Verified
- **POST /v1/events** - Event batch ingest (packages/core/src/transport/events.ts)
- **POST /v1/spans** - Span batch ingest (packages/core/src/transport/spans.ts)
- **POST /v1/analytics** - Analytics batch ingest (packages/core/src/transport/analytics.ts)
- **POST /v1/replays** - Start replay session (packages/browser/src/transport/replays.ts)
- **POST /v1/replays/segments** - Upload replay segments (binary + RPC fallback)
- **PUT /v1/replays/{replayId}** - Finish replay session
- **POST /v1/heatmaps** - Heatmap batch ingest (packages/browser/src/transport/heatmaps.ts)
- **POST /v1/heatmaps/snapshots** - Heatmap snapshot upload (binary + RPC fallback)
- **POST /v1/source-maps** - Source map upload (packages/cli/src/upload.ts)

### ⚠️ ISSUE: Feature Flags Endpoint
- **POST /v1/flags** - Used by SDK (packages/core/src/transport/flags.ts)
- **STATUS**: Platform PR #234 does **not** include `/v1/flags` in the route table
- **ACTION NEEDED**: Either:
  1. Platform needs to add `/v1/flags` route, OR
  2. SDK needs to remove flags feature until platform implements it, OR
  3. Flags use a different endpoint (clarification needed)

### Not Used by JS SDK
- POST /v1/monitors/{slug}/check-ins - Monitor check-ins (API key auth)
- POST /v1/check-ins - Monitor check-ins (X-Talaria-Monitor-Token header, tal_mon_ tokens)
- /v1/screen-heatmaps/* - Screen heatmaps (mobile/native SDKs)
- /otlp/v1/* - OpenTelemetry protocol (direct OTLP clients)

### Not Changed (Non-Ingest Configuration Routes)
These routes are for SDK configuration and release management, not ingest:
- sdk/getConfig - SDK configuration fetch
- sdk/reportDiscards - SDK discard reporting
- releases/setCommits - Release commit attachment
- source/createProjectRelease - Legacy release creation
- sourceMaps/list - Source map verification

## Security Requirements
- ✅ Browser bundles expose **only** TALARIA_URL and TALARIA_BROWSER_API_KEY
- ✅ TALARIA_API_KEY and TALARIA_RELEASE_KEY are **never** exposed to client code
- ✅ Next.js: Explicit `env` object in next.config.js
- ✅ Vite: Explicit `define` for the two safe vars only
