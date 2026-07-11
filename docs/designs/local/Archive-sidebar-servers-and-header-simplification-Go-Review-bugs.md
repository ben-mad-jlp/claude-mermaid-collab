# Bug Review — sidebar-servers / header / modal blueprint + cross-server hardening (7ade06e..683456e)

Scope: introduced bugs only (correctness). Pre-existing `allowtransparency` iframe tsc errors in `ClaudePixAvatar` ignored per instructions.

---

## 1. Important — `SubscriptionsPanel.handleAddProject` falls through to "pending" fallback after a server-side failure

**File:** `ui/src/components/layout/SubscriptionsPanel.tsx:486-520`

**What's wrong:**
The IPC branch handles success with an explicit `return`, but the failure branch only calls `setAddProjectError(...)` and then continues straight into the fallback code:

```ts
if (mc?.invokeOnServer) {
  const res = await mc.invokeOnServer(...).catch(() => null);
  if (res?.ok) { ...; return; }
  setAddProjectError(...);            // <-- sets error message
}
// Fallback (intended for "no bridge" only):
setPendingProjects(p => ({ ...p, [serverId]: [...,path] }));
setAddProjectInput('');
setAddProjectOpenFor(null);           // <-- closes the form, so the error
                                      //     just set above is never displayed
```

Effects when `mc.invokeOnServer` exists but the server rejects (e.g. invalid path, duplicate, auth):
- The just-set error message is immediately hidden because the form is closed (`setAddProjectOpenFor(null)`).
- The rejected path is silently inserted into `pendingProjects`, masquerading as a successful "new — empty" project in the modal. The user then sees an empty project that the server has no knowledge of.
- The input is cleared.

**Fix:** Add an early `return` after `setAddProjectError(...)` in the IPC branch, or use an `else` to gate the fallback on the absence of the bridge:

```ts
if (mc?.invokeOnServer) {
  const res = await mc.invokeOnServer(...).catch(() => null);
  if (res?.ok) { ...; return; }
  setAddProjectError(...);
  return;                             // <-- add this
}
// Fallback only for plain browser (no mc bridge)
setPendingProjects(...);
...
```

---

## 2. Minor — `terminalStore.openFor` rethrows but every caller is `void`-prefixed

**File:** `ui/src/stores/terminalStore.ts:140-148`; callers in `ui/src/components/layout/SubscriptionsPanel.tsx:229`, `ui/src/components/terminal/TerminalDrawer.tsx:32`.

The new `catch { console.error(...); throw err; }` re-throws the rejection. Every caller in the wave uses `void useTerminalStore.getState().openFor(...)` / `void openFor(...)`, so the rethrown rejection surfaces as a global `unhandledrejection` on the renderer.

This is benign visually (the user already sees the console.error), but the rejection escaping a `void` expression is a code smell and will trigger any "no unhandled rejections" listeners (e.g. test harnesses, Sentry).

**Fix:** Either swallow after logging (`catch (err) { console.error(...); }` — no rethrow) since no caller awaits it, or add `.catch(() => {})` at each call site. The former is simpler given the existing call-site pattern.

---

## 3. Minor — `handleAddProject` does not depend on its setters but does omit a transitive lint smell

Not a bug — flagged for context only. `useCallback` deps `[addProjectInput]` are correct because React state setters are stable. No fix needed.

---

## Verified clean

- `ServersTreeSection`: `available` correctly gates `addServer` (line 54-57) and `removeServer` (line 68). `switchServer` is unguarded but ServerContext handles browser-mode no-op. No render crash when `available === false`.
- `subscriptionStore.hydrateSubscriptions`: dropped fields (`claudeSessionId`, `claudePid`, `contextPercent`) are all optional in the `SubscribedSession` interface; `subscribe()` signature unchanged. WatchAggregator repopulates them on live events. No type or runtime break.
- `subscriptionStore.subscribe` callers in SubscriptionsPanel still use the `(serverId, project, session)` 3-arg form — matches the store signature.
- `TerminalDrawer`: removing the auto-open `useEffect` left `useEffect` import unused — it's still cleanly removed in the diff (line 1 removed). No orphan references.
- `TerminalPane` WS error/close listeners are added before `onmessage` and don't replace existing handlers; no leak (the WS is cleaned up by the existing teardown in the component).
- `todo-store.listTodos`: tightening `session` filter to `ownerSession = ?` only is intentional and the SQL/param shape is correct (one `?`, one param).
- `TodosTreeSection`: `text-sm → text-xs` is pure styling.
- `SubscriptionsPanel.handleNavigate`: cross-server early return is correct. The `sub.serverId && activeId && sub.serverId !== activeId` guard safely skips legacy entries with empty `serverId` (they fall through to same-server path, which is the documented migration behavior).
- `SubscriptionsPanel.handleAddSession`: `mc?.invokeOnServer` is checked (line 529) before use. Pending-project promotion on success is racy with `refreshTick` (the next fan-out may not include the new project yet), but the order is "promote then refresh" so the worst case is one render where the project shows as real-AND-pending — and the dedupe in the modal (lines 753-771) correctly classifies a project as real when it appears in `group.items`, so no double-row. Clean.
- `tsc --noEmit` filtered to wave files: only the two pre-existing `allowtransparency` errors in `ClaudePixAvatar`. No new type errors.

---

**Result: 1 Important bug, 1 Minor bug.**
