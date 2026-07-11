# Fix Wave Summary (electron-agent-bridge review)

## Issues Fixed
- **bug-important-cdp-port-nan** — `packages/electron-agent-bridge/src/electron-main.ts` `enableCdp`: a malformed `MC_CDP_PORT` (e.g. "abc") → `Number()` = NaN passed the truthy guard and became the debug port ("NaN"). Now parses env once, and only uses a candidate port when `Number.isFinite(candidate) && candidate > 0`, else falls back to `getFreePort()`. Covers both `opts.port` and env NaN.
- **bug-minor-screenshot-ext** — `src/mcp/setup.ts` desktop_screenshot: save path hardcoded `.png` even for `format:'jpeg'`. Now uses `.jpg` for jpeg, `.png` otherwise.

## Accepted (not fixed) with rationale
- **_dd not invalidated on later op failure** (Minor): edge case (app restart on a new port). Driver methods connect-per-op, so a stale singleton just fails the next call; initial-failure reset already retries. Low value.
- **listTargets [] for wsUrl-only** (Minor, cosmetic): discovery path always carries a port; never hit in practice.
- **discovery field webSocketDebuggerUrl vs fromDiscovery reads wsUrl** (cosmetic): INTENTIONAL — using the cached ws URL would defeat per-call target resolution (stale on renderer reload). The port + CDP.List-per-call path is the robust one (and what Wave-4 exercised). Field left as informational.

## Verification
- tsc clean on electron-main.ts and setup.ts (no non-TS5097 errors).

## Completeness
- No gaps — all 7 tasks complete, app-agnostic boundary holds.

## Final TSC
clean for the fixed files.
