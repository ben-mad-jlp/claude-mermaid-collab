# Active-Server Concept Audit

Post cross-server epic: watching, terminals, todos, subscriptions are all server-scoped (carry `serverId`). The renderer-side "active server" is now a much narrower concept than it used to be. This document audits every reader and asks whether it is (a) genuinely needs-default, (b) legacy/removable, or (c) should be per-action context.

## Source of truth

**`ui/src/contexts/ServerContext.tsx`** is the single store. Architecture (lines 1-9, 80-160):

- The Electron main process holds the canonical state via `ConnectionStore` (`desktop/src/main/connection-store.ts`) and a `ServerProxy` that the renderer always talks to as a single origin.
- "Active server" = which upstream the renderer's HTTP/WS proxy points at.
- `switchServer(id)` (lines 122-132) calls `mc.switchServer` IPC, which:
  - calls `store.setActive(id)` + `proxy.setUpstream(...)` in main (`desktop/src/main/index.ts:34-41`),
  - resets the renderer WS singleton, and
  - bumps `version` to remount the entire child tree so collab queries refetch.
- In a plain browser (no Electron / no `window.mc`), the provider returns `NO_PROVIDER` with `activeId: null` and zero servers.

Notable: cross-server reads do NOT go through the proxy. `mc.listSessionsForServer` and `mc.invokeOnServer` (lines 53-60) fetch directly against any registered server using its stored token. The WatchAggregator opens its own WS to every watched server. So "active" only governs (i) the proxy upstream for the renderer's default fetch/WS, and (ii) which server identifier to tag unattributed WS events with.

## Readers

| Location | What it gates | Category | Reasoning |
|---|---|---|---|
| `ui/src/App.tsx:292` (`activeServerId`) | Used as a tag for incoming WS messages on the proxy WS | (b) legacy hack | The proxy WS only carries the active server's events. Once the WatchAggregator delivers all cross-server events with proper `serverId`, this is just patching a missing field. If `claude_session_registered` / `claude_session_status` / `claude_context_update` came through the aggregator instead (which already streams them tagged), this would disappear. |
| `ui/src/App.tsx:962-964` `claude_session_registered` → `updateStatus(activeServerId, ...)` | Tags Claude session reg with active id | (b) legacy hack | Same as above — should arrive via aggregator already tagged. |
| `ui/src/App.tsx:969-971` `claude_session_status` → `updateStatus(activeServerId, ...)` | Same pattern | (b) | Same. |
| `ui/src/App.tsx:973, 992` notification key prefix `${activeServerId}:${project}:${session}` | Builds subscription key to dedupe/look up | (b) | The event source's serverId should be used, not the global active. |
| `ui/src/App.tsx:989-991` `claude_context_update` → `updateContextPercent` | Same tagging pattern | (b) | Same. |
| `ui/src/App.tsx:297` one-shot `getActiveServer()` for `migrateLegacyEntries` | Migrates legacy pre-cross-server localStorage keys | (a) needs-default | One-shot migration: legacy entries had no serverId, so we tag them with the boot-time active id. This is fine — it could equally use "primary local" but the active id is a reasonable choice. |
| `ui/src/views/SidebarView.tsx:17, 25-26, 33` | Same active-id tagging for WS events (sidebar mode) | (b) | Identical pattern to App.tsx; same conclusion. |
| `ui/src/components/layout/SubscriptionsPanel.tsx:208` `isActiveServerRow = sub.serverId === activeServerId` | Gates whether clicking a watched row fires `/api/ide/create-terminal` and `/api/browser/focus-tab` on that server | (c) per-action | The endpoints exist per-server; the gate exists because remote hosts may not have tmux. This should be a server-capability check (or simply attempted-and-ignore), not "is this the active server." Side-effect: only the local server can ever get IDE/browser-focus side effects from a click. |
| `ui/src/components/layout/SubscriptionsPanel.tsx:310` action-button `if (activeServerId && sub.serverId !== activeServerId) return;` | Same: blocks tmux create on non-active | (c) per-action | Same reasoning — should be capability-driven, not active-driven. |
| `ui/src/components/layout/SubscriptionsPanel.tsx:349, 369-379` `servers, activeId` | Reads `servers` array only to build label/icon maps; `activeId` flows to `SubscriptionRow` as `activeServerId` | (b/c) | The `servers` map use is legitimate and orthogonal. The `activeId` prop is only consumed by the (c) gates above. |
| `ui/src/components/layout/sidebar-tree/ServersTreeSection.tsx:32, 93, 103` `activeId`, `switchServer` | Renders the bold/accent indicator on the active row; click = `switchServer` | (a) needs-default IF the switcher is kept; otherwise (b) | This is the user-facing switcher. Whether it should exist at all is the meta-question (see Recommendation). |
| `ui/src/components/terminal/TerminalDrawer.tsx:23, 27-32` `openForActive` | Fallback "+ new terminal" button — opens a terminal on the active server's current session | (a) needs-default — narrow | Genuinely needs *some* default when the user clicks "+" without context. But note: every other terminal entry point (clicking a watched row, line 237 of SubscriptionsPanel) already passes an explicit serverId. The "+" button could instead prompt or use "the last terminal's server." |
| `ui/src/components/terminal/TerminalDrawer.tsx:54` `servers.find(s => s.id === tab.serverId)` | Looks up label/icon by tab.serverId — does NOT use activeId | n/a | This is per-tab context, already correct. |
| `desktop/src/main/index.ts:27, 34-41` `mc:getActiveServer`, `mc:switchServer` | IPC for the bridge | supports the above | These exist to serve the renderer's proxy-pointing concept. They remain necessary as long as the proxy is single-upstream. |
| `desktop/src/preload/index.ts:9` | Preload bridge wiring | supports | Same. |

### Counts
- (a) genuine default needed: 2 sites (migration one-shot; TerminalDrawer "+" fallback). Plus the switcher itself if retained.
- (b) legacy / removable: ~7-9 sites — all in App.tsx and SidebarView.tsx tagging WS messages with `activeServerId`.
- (c) should be per-action / capability check: 2 sites in SubscriptionsPanel that gate IDE/tmux side-effects on `sub.serverId === activeServerId`.

## What does "switch server" actually do today?

From `ServerContext.tsx:122-132` + `desktop/src/main/index.ts:34-41`:

1. Repoints the Electron proxy upstream to the new server (host/port/token).
2. Resets the renderer WS singleton so the next `getWebSocketClient()` connects to the new upstream.
3. Bumps a `version` counter that wraps the entire child tree, **remounting the whole app subtree** — every collab query refetches from the new upstream.

User-visible effects after a switch:
- Sidebar artifact tree, current-session view, snippets/diagrams/designs/docs — all reload from the new server (because the proxy now points there).
- The bolded row + accent bar in `ServersTreeSection` moves.
- WS events arriving without a `serverId` (from the proxy WS) get tagged with the new id.
- The Watching panel and TerminalDrawer keep showing cross-server content unchanged (they don't go through the proxy).
- The `+` new-terminal button now defaults to the new server.

So "switch server" is essentially "which server's artifact tree am I browsing?" — it changes the *primary* (current-session) view but not the cross-server panels.

## Recommendation: keep, but narrow

Active server is **not** vestigial — but it is over-scoped. Two real responsibilities remain:

1. **Choosing the upstream for the current-session artifact view.** The collab UI (selecting a session, browsing diagrams/docs/snippets) is currently single-server. Until those views also become server-aware (current-session knows its serverId, queries route per-server), one server must be the "primary." This is the (a) case.
2. **A sane default for ambiguous "new" actions** (the TerminalDrawer "+" button, the legacy-entry migration).

Everything else is removable or fixable:

- **(b) Drop the WS-event tagging hack in App.tsx and SidebarView.tsx.** Route `claude_session_registered`, `claude_session_status`, `claude_context_update` through the WatchAggregator's already-tagged stream. The proxy WS becomes purely about the active-server's *artifact* events. This deletes 7-9 `activeServerId` reads and a noisy effect dependency.
- **(c) Replace the IDE/tmux gates in SubscriptionsPanel** (`isActiveServerRow`, line 310 button gate) with either a per-server capability flag (e.g., `tmuxAvailable`, `ideAvailable` discovered via probe / `/api/health`) or a best-effort fire-and-ignore. Right now you can't open an IDE terminal on a non-active server even if it has one running — this is a behavior regression from the cross-server epic.
- **(a) Keep `ServersTreeSection`'s switcher** but reframe it in the UI as "Primary server / browse" rather than a global mode toggle. Long-term, make the artifact tree multi-server (sessions nested under each server) and the switcher disappears entirely — `activeId` collapses to "which session is currently selected in the tree, and what server does it belong to."

Proposed end-state: `activeId` becomes derivable from `currentSession.serverId` (when a session is selected) with a fallback for the unselected case. The explicit switcher remains only as a UX shortcut for "scope my browsing to server X" until artifact views are fully server-aware.
