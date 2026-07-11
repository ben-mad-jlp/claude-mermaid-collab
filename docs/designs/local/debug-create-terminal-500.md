# Debug: `/api/ide/create-terminal` returns 500 on trimaxion

## Root cause hypothesis

The handler unconditionally calls `Bun.spawn(['tmux', 'new-session', '-d', '-s', tmuxSession], ...)`. Bun's `spawn` throws **synchronously** when the binary cannot be found on `PATH` (ENOENT). The throw is caught by the surrounding `try/catch` and converted into a `500` with the error message.

Trimaxion (192.168.1.123:9002) is almost certainly running the collab server without `tmux` installed (or without it on the server process's `PATH`). The local dev box has `tmux` available, so the same call succeeds (or, if the session already exists, `proc.exited` resolves with a non-zero exit code which is intentionally ignored).

Secondary, less likely causes considered and ruled out:

- `req.json()` failure — the UI always sends a well-formed JSON body `{ session, project }` (see `SubscriptionsPanel.tsx:208`), and a malformed body would 400 before reaching the spawn.
- `tmuxBaseName` — pure string transform, cannot throw.
- `wsHandler.broadcastToChannel` — only runs after spawn; if it threw it would still 500 but the symptom would be intermittent rather than consistent. Spawn-missing-binary explains a deterministic 500 on a specific host.
- Trimaxion running an older build — possible, but the route has existed for a while; the differential between hosts is environment (tmux availability), not code.

## Affected files

- `src/routes/ide-routes.ts:56-81` — handler; `Bun.spawn(['tmux', ...])` at line 66-69 is the throw site; outer `catch` at line 78-80 returns the 500.
- `src/services/tmux-naming.ts:12` — pure helper, not at fault.
- `ui/src/components/layout/SubscriptionsPanel.tsx:199-227` — cross-server row click; fires `/api/ide/create-terminal` via `mc.invokeOnServer` at `sub.serverId`, with body `{ session, project }`. Also at lines 304-313 and 622-631 for other entry points.

## Evidence

1. The route's only external dependency that can throw is `Bun.spawn`. Bun documents that `spawn` throws synchronously on ENOENT (binary not found). That hits the catch and returns `jsonError(err.message, 500)`.
2. The local box (developer macOS) has tmux; remote trimaxion server likely does not — explains the host-specific symptom.
3. The UI caller payload is correct: `body: { session: sub.session, project: sub.project }` — both are non-empty strings sourced from the subscription row, so 400 branches are not hit.
4. The handler's WS broadcast is harmless to in-app terminals (which use `/api/terminal/sessions` per the checkpoint note), so the 500 is purely cosmetic/log-noise from the fire-and-forget.

## Proposed fix

Two layered options; ideally apply both:

1. **Server: tolerate missing tmux.** In `src/routes/ide-routes.ts`, wrap the `Bun.spawn` in a narrower try/catch and treat ENOENT (tmux not installed) as a soft no-op — still broadcast the WS event (the desktop IDE-side consumer may not care about tmux on this host) or return `200 { success: false, reason: 'tmux-unavailable' }`. Optionally probe `tmux` availability once at startup and short-circuit.

   ```ts
   try {
     const proc = Bun.spawn(['tmux', 'new-session', '-d', '-s', tmuxSession],
       { stdout: 'ignore', stderr: 'ignore' });
     await proc.exited;
   } catch (e: any) {
     if (e?.code !== 'ENOENT') throw e;
     // tmux not installed on this host — degrade gracefully
   }
   wsHandler.broadcastToChannel('ide', { ... });
   return Response.json({ success: true, tmux: 'spawned' /* or 'unavailable' */ });
   ```

2. **Client: stop firing cross-server.** In `SubscriptionsPanel.tsx`, only invoke `/api/ide/create-terminal` when the row's `sub.serverId` matches the currently active server (i.e. the user is on the IDE host). Cross-server clicks should skip the IDE side-effect entirely — the in-app terminal is opened separately by `useTerminalStore.openFor(...)` and does not depend on this endpoint.

Option 2 is the cleaner fix per the checkpoint context ("harmless to the in-app terminal"); option 1 is defense-in-depth for any other caller and for mixed-host fleets.
