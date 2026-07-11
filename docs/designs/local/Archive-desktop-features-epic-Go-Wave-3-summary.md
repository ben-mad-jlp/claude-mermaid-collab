# Wave 3 Implementation

## Tasks
- **cdp-session-select** — `src/services/cdp-session.ts`: `selectElectronViewTarget(tabs, session?)` now matches `mc-browser-pane:<session>` (exact title or url-includes) with EXACT bare-marker fallback (no `.includes`, so `mc-browser-pane:user:*` / other-session tabs are never mis-selected); `createOrReplaceTab` passes `sessionName`; `ensureTab` electron-view path POSTs `${MC_DESKTOP_CONTROL_URL}/panes/ensure` (Bearer `MC_DESKTOP_CONTROL_TOKEN`) before `CDP.List` + per-session select, try/catch surfaces actionable error; non-electron Chrome path untouched. Test file extended with 3 cases.
- **watching-drive** — `ui/src/components/layout/SubscriptionsPanel.tsx`: `SubscriptionRow` onClick now ALSO calls `useBrowserStore.getState().activateSession(sub.session)` + `void useTerminalStore.getState().openFor(sub.project, sub.session)` (in addition to the pre-existing onNavigate + /api/ide/create-terminal + /api/browser/focus-tab fetches). `App.tsx`: no edit — live `claude_session_*` → subscriptionStore path confirmed already wired (and now functional in the packaged app thanks to the WS-proxy fix `764015f`).

## Verification
- `bunx vitest run cdp-session.target.test.ts` → 7/7 pass.
- server tsc: cdp-session.ts clean.
- ui tsc: SubscriptionsPanel — only PRE-EXISTING `<iframe>` attribute-typing errors at lines 49/67 (confirmed present in HEAD; my change was 4 insertions: 2 imports + 2 store calls).

## Wave TSC
Wave-3 files clean (cdp-session tests green; SubscriptionsPanel errors pre-existing). Remaining repo tsc noise unchanged (../src/agent test files, api.ts:693, the iframe typings).
