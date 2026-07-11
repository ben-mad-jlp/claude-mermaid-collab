# Wave 3 Implementation

## Tasks
- **supervisor-store-extend** (`ui/src/stores/supervisorStore.ts`): extended `loadEscalations(serverId, status?)` (appends `?status=`); added `nudge(serverId, project, session, text)→bool` (POST /nudge); added `SupervisorConfig` interface + `config` state (hydrated from `supervisor-config` localStorage key) + `loadConfig()` (GET /config) + `saveConfig()` (POST /config). All added to `SupervisorState`. Existing callers unaffected.

## Also (inserted before Wave 3): supervisor-config-store
- `src/services/supervisor-store.ts`: new `supervisor_config` singleton table + `SupervisorConfig` + `getSupervisorConfig`/`setSupervisorConfig` (INSERT OR REPLACE).
- `src/routes/supervisor-routes.ts`: GET/POST `/api/supervisor/config` now durable via the store (removed process.env). Per user design decision.

## Verification
- UI tsc (`tsc -p tsconfig.json`) clean; root tsc clean.

## Wave TSC
clean.
