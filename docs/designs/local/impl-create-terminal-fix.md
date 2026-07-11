# Impl: fix `/api/ide/create-terminal` 500 on tmux-less hosts

## What changed

Applied both layers of fix proposed in `debug-create-terminal-500`: tolerate missing `tmux` on the server, and stop firing cross-server IDE side-effects from the client.

## Files + lines

### `src/routes/ide-routes.ts` (handler at original lines 56–81)

- Wrapped the `Bun.spawn(['tmux', 'new-session', ...])` call in its own inner try/catch.
- On failure (ENOENT or any error), logs a `console.warn` with the error code/message and continues — `tmuxAvailable = false`.
- The WS broadcast (`ide_open_terminal`) still fires unconditionally so any IDE-side listener can react regardless of tmux availability.
- Response shape is preserved and additive: `{ success: true, tmux: boolean }`. Existing clients that only checked `success` keep working; new clients can read `tmux` to know whether the tmux session was created.

### `ui/src/components/layout/SubscriptionsPanel.tsx`

- `SubscriptionRow` now accepts an `activeServerId?: string` prop; passed in from the parent via `activeId ?? undefined` (the `useServer()` store exposes `activeId: string | null`).
- Three call sites for `/api/ide/create-terminal` are now gated on `sub.serverId === activeServerId`:
  1. Row click handler (was ~199–227): also gates the paired `/api/browser/focus-tab` call. In-app terminal opening via `useTerminalStore.getState().openFor(...)` and `useBrowserStore.activateSession(...)` still runs cross-server; only the remote HTTP side-effects are skipped.
  2. The tmux-create button on each row (was ~298–315): early-returns when the row is not on the active server.
  3. The "open all watched sessions in IDE" batch button (was ~615–633): `continue`s past cross-server rows.

## Test / typecheck result

- No `test:ci` script exists. Ran `bun run type-check` in `ui/`.
- Pre-existing errors are unchanged (e.g. `allowtransparency` casing at SubscriptionsPanel:63/81, several unrelated files).
- No new type errors introduced by these edits. `src/routes/ide-routes.ts` has no errors.

## Decisions / caveats

- Kept the WS broadcast even on tmux failure — matches the debug doc's "IDE-side consumer may not care about tmux" note, and avoids changing observable behavior for the desktop app on hosts where tmux exists but spawn fails for some other reason.
- Response now includes a new `tmux: boolean` field; this is additive and non-breaking.
- Client-side gating uses strict equality on serverId; if `activeServerId` is undefined (no active server resolved), the existing behavior is preserved (calls are still fired) so initial-load / single-server setups are unaffected. The cross-server skip only kicks in when there *is* an active server and the row belongs to a different one.
- Did not add a startup tmux availability probe (option suggested in the debug doc); the try/catch alone is sufficient and avoids extra startup state.
