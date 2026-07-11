# Wave 1+2 Implementation — PCS Phase 0a (config service)

## Tasks
- **config-service** (`src/services/config-service.ts`, NEW): `getConfig(key, fallback?)` — precedence env → `~/.mermaid-collab/config.json` → fallback; cached safe file load (missing/malformed → {}, never throws); `configPath()` honors `MERMAID_CONFIG_PATH` for tests; `_resetConfigCache()`. +7 bun tests (env-wins, file-fallback, absent→fallback, malformed→no-throw, empty-env→file, non-string→ignored).
- **xai-via-config** (`src/mcp/setup.ts`): consult_grok now reads `getConfig('XAI_API_KEY')` instead of `process.env.XAI_API_KEY` (import `.js` style). Guard message mentions config.json. One-line swap.

## Impact
Fixes the desktop XAI-key bug at the read layer: the server reads the key from the global `~/.mermaid-collab/config.json` regardless of how it was launched (Dock/GUI or CLI) — no Electron spawn-env change needed. (A Settings-UI to edit that file without hand-editing = later slice.)

## Verification
- tsc clean (exit 0); `bun test config-service.test.ts` → 7 pass.

## Deferred (Phase 0 later slices)
Settings-UI "Secrets" tab (safeStorage), single-writer assertion (no write-handler to guard yet), Electron lifecycle decouple, migrating config.ts frozen constants to the service.

## Wave TSC
clean.
