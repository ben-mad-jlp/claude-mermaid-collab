# Fix Wave Summary (multi-server-watch)

## Issues Fixed
- **bug-important-reconnect-leak** — `desktop/src/main/watch-aggregator.ts` `connect()`: on the reconnect path it overwrote `conns.get(id).ws` without tearing down the previous socket → leaked socket that could double-forward messages and fire stale close/error (bumping the new attempt counter / scheduling duplicate reconnects). Fix: at the top of `connect()`, if a previous ConnState exists, clear its timer + `prev.ws.removeAllListeners(); prev.ws.terminate()` (try/catch) before creating the new socket.
- **gap-watch-aggregator-test** — wrote `desktop/src/main/__tests__/watch-aggregator.test.ts` (13 tests): setWatched diff (connect new / leave unchanged / terminate removed), message filtering (only claude_session_* forwarded, tagged serverId; non-watched ignored; invalid JSON no-throw), **reconnect teardown** (asserts the previous fake ws had removeAllListeners + terminate before a new instance is created — locks in the bug fix), stop() teardown. Mocks the `ws` module via vi.hoisted FakeWS.
- **gap-watch-store-test** — wrote `ui/src/stores/__tests__/watchStore.test.ts` (11 tests): toggle add/remove + isWatched, localStorage persistence, mc.setWatchedServers push with correct id arrays, no-throw without window.mc.

## Files Changed
- `desktop/src/main/watch-aggregator.ts` — reconnect-teardown fix; tsc clean; 13/13 tests pass post-fix.
- `desktop/src/main/__tests__/watch-aggregator.test.ts` — NEW, 13 pass.
- `ui/src/stores/__tests__/watchStore.test.ts` — NEW, 11 pass.

## Final TSC
Clean (watch-aggregator + tests). 24 new test assertions green.
