# Wave 2 Implementation

## Tasks
- **session-store-persist** — `sessionStore.ts` wrapped in zustand `persist` middleware (key `session-current`, partialize currentSession only). Added `hydrated` flag + `validateAgainstServers(servers)` action. `ServerContext.tsx` runs validation effect when servers + hydration both ready.
- **session-creation-serverid** — `api.ts.createSession` takes new `serverId` param; `App.tsx` passes `activeId ?? 'local'`; `views/SidebarView.tsx` adds `serverId` to setCurrentSession.
- **subscriptions-capability-gates** — `SubscriptionsPanel.tsx` added module-level `capsCache` + `fetchCapabilities(serverId)` helper. All 3 gate sites switched to `caps.tmux`. Browser focus-tab no longer gated. `activeServerId` prop removed from `SubscriptionRow`.
- **app-consume-aggregator** — `App.tsx:959-1018`: removed `updateStatus`/`updateContextPercent` calls from `claude_session_*` and `claude_context_update` cases (aggregator path handles them). Kept downstream notification logic and subscription-key references to `activeServerId`.
- **sidebarview-consume-aggregator** — `views/SidebarView.tsx`: serverId now resolved via `(msg as any).serverId ?? searchParams.get('srv') ?? activeServerId`. Effect deps include searchParams.
- **resolve-image-src-srv** — `resolveImageSrc.ts`: added `serverId` to context; `withServer` helper prefixes `/srv/${id}` for `/api/...` URLs when serverId is set. All 4 branches wrapped.
- **milkdown-embed-bridge-srv** — `milkdownEmbedBridge.ts.resolveEmbedSrc` takes optional `serverId` and prefixes when set. `diagramEmbedView.tsx` threads `serverId` through props to the bridge.
- **terminal-drawer-picker** — `TerminalDrawer.tsx`: `+` button is now `+ ▾` dropdown listing online servers. Defaults to `currentSession?.serverId` if online, else local, else first. Keyboard nav + outside-click close.
- **add-project-picker** — New `AddProjectDialog.tsx` (mirrors CreateSessionDialog styling). Server `<select>` + path input. `App.tsx.handleAddProject` opens dialog; submit calls `mc.invokeOnServer(serverId, ...)` with fetch fallback. Exported from `dialogs/index.ts`.
- **parse-deep-link-srv** — `desktop/src/main/index.ts.parseDeepLink` extracts `srv`. `dispatchDeepLink` resolves fallback to local-or-active and sends `mc:deeplink` IPC; `pendingDeepLink` flushed on `did-finish-load`.

## Verification
All 13 implement agents returned done. Wave-level tsc shows no errors in any of the edited files. (Pre-existing iframe `allowtransparency`, RefObject `null`, t3chat `unknown` errors are unrelated.)

## Wave TSC
Clean for Wave 2 files. Pre-existing errors remain in `src/`, `src/agent/__tests__`, and unrelated UI components.
