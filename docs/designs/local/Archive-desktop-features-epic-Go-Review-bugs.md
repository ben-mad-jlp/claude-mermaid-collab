# Bug Review — Desktop Feature Epic

Reviewed working tree vs HEAD for INTRODUCED bugs (correctness only).

## Critical

### 1. tmux `new-session -t base` targets a session that never exists
**File:** `src/terminal/PTYManager.ts` (~line 115, tmux branch)

```sh
(tmux has-session -t '${grouped}' 2>/dev/null || tmux new-session -d -s '${grouped}' -t '${base}') && tmux attach-session -t '${grouped}'
```

`tmux new-session -t <target>` creates a new session **in the session group of an existing target session**. Here `base` is only a *name string* (`mc-{proj}-{session}`); no session named `base` is ever created. On the very first invocation `has-session -t grouped` fails (correct), then `new-session -d -s grouped -t base` fails because target `base` does not exist → the `&&` short-circuits → `attach-session` never runs → the PTY immediately exits. The terminal tab never works on first open.

**Fix:** Either create/ensure the base session first, or drop the grouping target on first creation:
```sh
(tmux has-session -t '${grouped}' 2>/dev/null \
  || tmux has-session -t '${base}' 2>/dev/null \
  || tmux new-session -d -s '${base}') ; \
tmux new-session -d -s '${grouped}' -t '${base}' 2>/dev/null ; \
tmux attach-session -t '${grouped}'
```
i.e. ensure `base` exists before using it as a group target. (Confirm against the intended grouping design, but as written the first run cannot succeed.)

## Important

### 2. DesktopControl HTTP server is never stopped — leaked http.Server
**Files:** `desktop/src/main/index.ts:143-144`, `desktop/src/main/desktop-control.ts:66`

```ts
const control = new DesktopControl(paneManager);
const { url, token } = await control.start();
```
`control` is a function-local const in `bootstrap()`. It is never stored on a module-level variable and `control.stop()` is never called. The `before-quit` handler (index.ts:198-201) only stops `proxy` and `supervisor`. The loopback control server stays listening until process exit. `stop()` exists but is dead code.

**Fix:** Hoist to a module-level `let control: DesktopControl | null = null;` and add `void control?.stop();` to the `before-quit` handler alongside proxy/supervisor.

### 3. terminalStore.openFor — double-create race on fast repeated clicks
**File:** `ui/src/stores/terminalStore.ts` (openFor)

Dedup reads `tabs` synchronously and looks for `t.title === session`, but the tab is only appended **after** the `await fetch(...)` resolves. Two rapid clicks (or the SubscriptionsPanel click firing alongside the drawer auto-open effect) both pass the `existing` check while the first request is still in flight, so two PTY/tmux sessions get created and two tabs appear for the same session.

Note the dedup key `t.title === session` is also weak: user-created tabs share the title, and two projects with the same session name would collide (though tmux naming now includes project).

**Fix:** Track in-flight sessions in a `Set`/Map (keyed by `project+session`) and short-circuit while a create is pending, mirroring the `inFlight` map already used in `BrowserPaneManager.ensureSessionTab`.

## Minor

### 4. ensureTab fetch result ignored — control failures other than network are swallowed
**File:** `src/services/cdp-session.ts` (ensureTab, electron-view branch)

The `fetch(.../panes/ensure)` response is awaited but `res.ok` is never checked. A 401 (token mismatch), 400, or 500 from the control server resolves the fetch normally (no throw); only a transport error is caught. The code then proceeds to `CDP.List` + `selectElectronViewTarget`, which throws a less specific `embedded view target not found` if the pane was not actually created. Functionally it still surfaces *an* error, so this is minor, but the diagnostic is misleading.

**Fix:** After the fetch, `if (!res.ok) throw new Error(...)` to surface the real failure reason.

## Checked — NOT bugs

- **activateTab re-addChildView (browser-pane.ts):** Re-adding an already-attached child via `contentView.addChildView` raises z-order in Electron; it does not double-insert or leak. Correct.
- **window-close cleanup iterating listTabs while closeTab mutates (index.ts):** `listTabs()` returns a fresh `Array.from(...).map(...)` snapshot, so mutating the underlying Map during iteration is safe.
- **ResizeObserver cleanup (BrowserPanel.tsx):** `observer.disconnect()` on unmount and bounds zeroed on hide/cleanup; effect re-runs on `[visible, activeId]` and tears down the prior observer. No leak.
- **desktop-control body parsing:** Empty body → `JSON.parse('')` throws → caught → 400; non-string `session` → 400; missing route → 404; bad token → 401. Correct.
- **closeTab store next-active selection (terminalStore):** Picks last remaining tab, nulls when empty, closes drawer when empty. Correct.
- **selectElectronViewTarget session matching (cdp-session.ts):** Session-specific exact/url match, falls back to bare marker by exact title only (won't match other sessions or user tabs). Matches the added tests. Correct.
