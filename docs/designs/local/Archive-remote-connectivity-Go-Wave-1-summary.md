# Wave 1 Implementation (remote-connectivity)

## Tasks
- **config-bind-auth** ✅ — `src/config.ts`: `HOST` now resolves `MERMAID_BIND_HOST ?? HOST ?? '127.0.0.1'` (flipped default from `0.0.0.0` to loopback, safe-by-default); added `MERMAID_AUTH_TOKEN` export (default `''`). Test `src/__tests__/config-bind-auth.test.ts` (5). Diagram: `Implementing/Go/Wave 1/config-bind-auth/config.ts`. **Behavioral note:** default no longer binds all interfaces — opt back in via `MERMAID_BIND_HOST=0.0.0.0` (intended; document in release notes).
- **connection-store** ✅ — Created `desktop/src/main/connection-store.ts`: `ConnectionStore` with injectable `userDataDir`/`instancesDir`/`safeStorage`; `init/list/get/add/remove/setActive/getActive/refreshLocal`. Tokens safeStorage-encrypted at rest, `list()` omits them. `refreshLocal()` reads `~/.mermaid-collab/instances/*.json`, maps to local `ServerEntry`s, dedupes vs manual by host:port, prunes stale. Test (10).
- **ws-singleton-switch** ✅ — `ui/src/lib/onboarding-api.ts` `buildUrl` now returns a relative URL (drops `window.location.origin`) so it rides the proxy. `websocket.ts` needed **no change** — `resetWebSocketClient()` already fully disconnects+nulls and the next `getWebSocketClient()` rebuilds from the current origin (research-confirmed). Added `ui/src/lib/websocket.test.ts` (2). Diagram: `Implementing/Go/Wave 1/ws-singleton-switch/websocket.ts`.

## Verification
- Backend: 15/15 (config-bind-auth 5, connection-store 10).
- UI: 2/2 (websocket singleton lifecycle).
- tsc: clean on touched files.

## Wave TSC
clean
