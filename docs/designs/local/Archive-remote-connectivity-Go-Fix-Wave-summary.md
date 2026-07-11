# Fix Wave Summary (remote-connectivity review)

## Issues Fixed
- **bug-critical-ws-binary-frames** (`desktop/src/main/server-proxy.ts`) — The WS proxy forwarded every frame as binary (`ws` v8 `send(data)` defaults to binary; the `message` event always yields a Buffer). The collab server sends JSON as TEXT frames and the browser does `JSON.parse(event.data)` expecting a string → every collab/terminal message would be silently dropped. Fix: forward with `{ binary: isBinary }` using the `message` event's `isBinary` flag.
- **bug-followup-ws-early-frame** (same file, surfaced by the new WS test) — A client frame sent before the upstream socket opened was dropped (no buffering). Fix: queue client→upstream frames and flush on upstream `open`.
- **bug-minor-mcp-overexempt** (`src/auth.ts`) — `startsWith('/mcp')` over-exempted paths like `/mcpfoo`. Fix: exempt exact `/mcp` and `/mcp/` sub-paths only.

## New regression guard
- Added a **WS-forwarding test** to `server-proxy.test.ts`: connects a real ws client through the proxy to a real upstream echo server, asserts a text frame round-trips as text (`isBinary === false`). This is the coverage gap that let the critical bug through (prior proxy tests were HTTP-only).

## Files Changed
- `desktop/src/main/server-proxy.ts` — binary-flag fix + early-frame buffer.
- `src/auth.ts` — exact `/mcp` exemption.
- `desktop/src/main/__tests__/server-proxy.test.ts` — new WS test.

## Verification
- Tests: 12/12 (server-proxy 6 incl new WS test, server-auth 6). Full group still green.
- `electron-vite build`: clean.
- tsc: clean on touched files.

## Deferred (filed as todo, linked to blueprint task connection-store)
- ConnectionStore mutators use fire-and-forget `void persist()` (minor durability gap). Proper fix touches the sync API/tests — deferred.

## Final TSC
clean (only the pre-existing binding-sweeper.ts import-extension warning)
