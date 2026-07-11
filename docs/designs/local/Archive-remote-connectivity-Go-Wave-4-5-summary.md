# Waves 4–5 Implementation (remote-connectivity)

## Tasks
- **server-context** ✅ — Created `ui/src/contexts/ServerContext.tsx`: thin `ServerProvider` + `useServer()`. Holds `servers`/`activeId` (from `window.mc.listServers/getActiveServer`), `switchServer(id)` → `mc.switchServer` + `resetWebSocketClient()` + version bump that remounts the subtree (keyed `React.Fragment`) so collab views refetch through the repointed proxy. Guards all `window.mc` access → no-op pass-through in a plain browser tab. Declares the global `Window.mc` type. Wired into `ui/src/main.tsx` (wraps `<App/>` on the catch-all route). Test (2): browser-tab no-op + list/switch behavior.
- **switcher-ui** ✅ — Created `ui/src/components/ServerSwitcher.tsx` (Level 1): active-server pill with status dot, dropdown list (status dot + label + host:port + active ✓), click-to-switch, inline add-server form (label/host/port/token), remove (✕) for manual entries. Renders nothing without `window.mc`. Test (3): browser-tab nothing, open+list, click-to-switch.

## Verification
- UI tests: 5/5 pass (ServerContext 2, ServerSwitcher 3) via `bun run test:ci`.
- tsc: my files (ServerContext, ServerSwitcher, main.tsx, onboarding-api, websocket.ts) are clean.
- **Pre-existing build caveat:** `ui` `npm run build` runs `tsc` which fails on PRE-EXISTING errors in untouched files (TopicDetail.tsx, PseudoFileTree.tsx, PseudoPage.tsx, agentStore.ts, ComposerPendingApprovalActions.tsx). Not caused by this work — the UI does not currently pass `tsc` clean.

## Follow-ups (noted, not blockers)
- **Mount the switcher** into the app chrome/header (blueprint scoped switcher-ui to the component; placing it in App layout is a small integration step).
- **Live health probe** of remote servers needs an `mc.probeServer` IPC (renderer can't reach other origins cross-origin); status dots are currently static.
- GUI runtime of the full switch flow needs a manual two-server check.

## Wave TSC
clean (my files); pre-existing UI tsc errors unrelated to this work
