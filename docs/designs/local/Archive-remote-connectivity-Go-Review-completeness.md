# Completeness Review (remote-connectivity)

**Verdict: Everything complete (modulo 3 noted follow-ups). 0 true gaps.**

All 8 blueprint tasks are implemented with real (non-stub) code, fully wired in, and all 33 specified tests pass.

## Tasks — all 8 done
| Task | Status | Evidence |
|------|--------|----------|
| config-bind-auth | done | src/config.ts:46 HOST → MERMAID_BIND_HOST ?? HOST ?? '127.0.0.1'; :103 MERMAID_AUTH_TOKEN |
| connection-store | done | desktop/src/main/connection-store.ts — full ConnectionStore |
| ws-singleton-switch | done | ui/src/lib/onboarding-api.ts:100 relative buildUrl; websocket.ts unchanged (already resets correctly) |
| server-auth-gate | done | src/auth.ts checkAuth; wired in src/server.ts:191 |
| server-proxy | done | desktop/src/main/server-proxy.ts — full ServerProxy (HTTP+WS) |
| main-ipc-wiring | done | desktop/src/main/index.ts proxy+store+IPC; desktop/src/preload/index.ts mc bridge |
| server-context | done | ui/src/contexts/ServerContext.tsx; wrapped in main.tsx:68 |
| switcher-ui | done | ui/src/components/ServerSwitcher.tsx |

## Files — all exist, real implementations
- src/config.ts: CDP_PORT (:92) + MERMAID_AUTH_TOKEN (:103) + flipped HOST default (:46). Real.
- src/auth.ts: checkAuth reads token at call-time, exempts /api/health and /mcp*, 401 on missing/wrong Bearer, null otherwise. Real. (Deviation a confirmed.)
- desktop/src/main/server-proxy.ts: start/setUpstream/getPort/stop + handleRequest (503 no-upstream, 502 upstream error, Authorization injection) + handleUpgrade (WS proxy, token on upstream handshake, drops pairs on switch). Real.
- desktop/src/main/connection-store.ts: init/list/get/add/remove/setActive/getActive/refreshLocal + persist + pruneLocalNotIn. safeStorage-encrypted tokens, list() omits tokens, registry auto-list with host:port dedupe + stale prune. Real.
- desktop/src/main/index.ts: starts ServerProxy → sidecar (:137-139), creates ConnectionStore (:143), registerIpc with all 5 mc:* handlers (:22-37), loads renderer through proxy URL (:149), stops proxy on quit (:171). Real.
- desktop/src/preload/index.ts: mc bridge exposes all 5 methods via ipcRenderer.invoke; tokens never cross. Real.
- ui/src/lib/onboarding-api.ts: buildUrl returns relative URL (no window.location.origin). Real.
- ui/src/contexts/ServerContext.tsx: ServerProvider/useServer + switchServer (mc.switchServer → resetWebSocketClient → version remount), guarded for browser-tab no-op. Real.
- ui/src/components/ServerSwitcher.tsx: pill + dropdown list + click-to-switch + add form + remove-manual; renders null without window.mc. Real.

## Functions — all present, non-stub
- checkAuth ✓
- ServerProxy: start/setUpstream/stop + handleRequest/handleUpgrade ✓
- ConnectionStore: init/list/get/add/remove/setActive/getActive/refreshLocal ✓
- ServerProvider/useServer + switchServer ✓
- ServerSwitcher ✓

## Wire-in completeness — all confirmed
- checkAuth CALLED in src/server.ts:191 (top of fetch(), before WS/MCP/API dispatch). ✓
- ServerProvider WRAPS App in ui/src/main.tsx:68 (catch-all /* route). ✓
- mc bridge exposed in preload AND every method handled in main via ipcMain.handle (mc:listServers/getActiveServer/addServer/removeServer/switchServer). switchServer does setActive + proxy.setUpstream. ✓

## Tests — present and passing
- Backend/main (vitest): 26/26 — config-bind-auth 5, server-auth 6, connection-store 10, server-proxy 5.
- UI (bun run test:ci): 7/7 — websocket 2, ServerContext 2, ServerSwitcher 3.
- Total: 33/33 pass.

## Stubs — none
Grep of all new files for TODO/FIXME/Not implemented/throw-stub: NO STUBS FOUND.

## Deviations / follow-ups (NOT gaps)
- (a) checkAuth extracted to src/auth.ts (not inline in server.ts) for testability without pulling in Bun.serve+jsdom. Confirmed intentional, properly wired into server.ts fetch().
- (b) ServerSwitcher component created but NOT yet mounted into app chrome/header. Blueprint scoped switcher-ui to the component file — noted follow-up, not a gap.
- (c) Live health-probe dots are static (need mc.probeServer IPC since renderer can't reach cross-origin). Noted follow-up.

## Manual-verify caveats (from wave summaries, expected)
- Full two-server GUI switch flow needs a manual launch check (not headless-testable). Wave 3 smoke confirmed HTTP+WS forwarding through proxy works against the local sidecar.
- Pre-existing UI tsc errors in untouched files (TopicDetail/PseudoFileTree/PseudoPage/agentStore/ComposerPendingApprovalActions) — unrelated to this work.
