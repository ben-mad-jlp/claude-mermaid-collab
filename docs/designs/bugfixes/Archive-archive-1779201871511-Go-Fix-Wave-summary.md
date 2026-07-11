# Fix Wave Summary — one-click-collab-launch

All 9 review bugs fixed in main context (single shared file `ui-half.ts` made parallel agents unsafe). Pair mode off → no approval gate.

## Issues Fixed

| ID | Sev | Fix |
|----|-----|-----|
| C1 | Critical | `child.once('exit'/'error')` → `onServerGone`: cancels pending awaiters, sets `failed` if this child still owns state. No green bar on dead server. |
| I1 | Important | `onInstanceUp` dedupes by `remotePort`; `fs.watch` ignores non-`.json`, debounced 250ms. No tunnel churn. |
| I2 | Important | `readLocalInstances` filters dead-pid instances (`process.kill(pid,0)`). |
| I3 | Important | `pendingInstanceUp` entries carry `cancel`; `cancelAllPending()` from stop/dispose/server-gone; post-await state guards. |
| I4 | Important | Local path sets `skew` (compares `inst.serverVersion` vs extension version). |
| M1 | Minor | Awaiter resolved only after `serverUrl` write; local port from resolved tunnel. |
| M2 | Minor | `instancesWatcher.on('error')` → poll fallback; timers disposed. |
| M3 | Minor | `spawn-server.ts` `setEncoding('utf8')`. |
| M4 | Minor | `findHighestSemverDir` handles `X.Y.Z-pre`. |

## Files Changed
- `extensions/vscode/src/ui-half.ts` — C1,I1,I2,I3,I4,M1,M2 + `collabStateKind()` helper + `export` on 4 pure helpers (for tests; structural)
- `extensions/vscode/src/spawn-server.ts` — M3
- `extensions/vscode/src/server-resolver.ts` — M4
- `vitest.config.ts` — include extension tests + `vscode` resolve.alias
- `extensions/vscode/tsconfig.json` — exclude `src/__tests__`
- NEW: `extensions/vscode/src/__tests__/vscode-mock.ts` + 4 test files

## Tests (completeness gap CLOSED)
34 tests passing together under root vitest:
- server-resolver.test.ts — 14 (rootDir/bun resolution branches, semver incl. pre-release)
- spawn-server.test.ts — 7 (sha1 sessionId, AlreadyRunning live/dead pid, pid-undefined, pipeLines+utf8, AbortSignal)
- ui-half-button.test.ts — 9 (I2 dead-pid filter, I3 cancel, bar states, C1 exit→failed, skew)
- workspace-half-startserver.test.ts — 4 (return shape, AlreadyRunning adoption, error propagation, output memoization)

## Final TSC
- Extension (own tsconfig, `src/__tests__` excluded): **clean**
- Root project: pre-existing test-file noise only; no new errors in changed files.

## Status: COMPLETE — pending .vsix build + manual button test, then archive.
