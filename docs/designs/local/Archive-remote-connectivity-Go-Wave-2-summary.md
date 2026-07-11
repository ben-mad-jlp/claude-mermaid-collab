# Wave 2 Implementation (remote-connectivity)

## Tasks
- **server-auth-gate** ✅ — Added `checkAuth(req, url)` in new module `src/auth.ts` (extracted, not inline in server.ts, so tests don't pull in Bun.serve + jsdom renderer). Reads `MERMAID_AUTH_TOKEN` at call-time; 401 when token set + missing/wrong Bearer; exempts `/api/health` and `/mcp*`; null (allow) when token unset. `src/server.ts` imports it and gates at the top of `fetch()` before WS/MCP/API dispatch. Test `src/__tests__/server-auth.test.ts` (6). Diagram: `Implementing/Go/Wave 2/server-auth-gate/server.ts`.
- **server-proxy** ✅ — Created `desktop/src/main/server-proxy.ts`: `ServerProxy` (HTTP + WS) on a loopback port; forwards to active upstream, injects `Authorization: Bearer <token>`; `setUpstream()` repoints + drops open WS pairs; 503 no-upstream, 502 upstream-error. Added `ws` + `@types/ws` to `desktop/package.json` (npm install). Test `desktop/src/main/__tests__/server-proxy.test.ts` (5, real fake-upstream http server; WS proxying is manual-verify scope).

## Verification
- Tests: 11/11 (server-auth 6, server-proxy 5).
- tsc: clean on touched files. (One pre-existing unrelated error: `src/server.ts:44` imports `binding-sweeper.ts` with a `.ts` extension — predates this work; Bun allows it.)

## Note
- Same extraction lesson as the foundation: a pure function imported by tests must NOT live in a module that runs side effects (Bun.serve) at import — hence `src/auth.ts`.

## Wave TSC
clean (only the pre-existing binding-sweeper.ts import extension warning)
