# Vibe: local

## Goal
Shipped the cross-server unified UX arc (watching + terminals + per-server icons + theme-aligned todo detail pane). Currently iterating on UX polish for the sidebar Servers section, the Subscribe modal tree, and the todo detail viewer; just executed the sidebar-servers-and-header-simplification blueprint via /vibe-go and reviewed it via /vibe-review.

## Context
mermaid-collab desktop app + plugin + VSCodium extension. Branch `feat/native-app-foundation` is ~16 commits ahead of origin. Local `:9002` server runs the merged code (own-session-todos filter active). Trimaxion at 192.168.1.123:9002 reachable via the per-server `mc.invokeOnServer` IPC. App runs via `desktop/scripts/debug-app.sh --no-build`.

## Pair Mode
Disabled

## Agent Mode
Enabled

## Currently Doing
- Executing blueprint: Implementing/kill-active-server
- Wave 2/5 complete — 14 tasks done, 6 remaining
- SidebarView path corrected: ui/src/views/SidebarView.tsx
- Next step: Wave 3 — artifact-tree-multi-server, create-session-picker, sidebar-view-search-params

## Previously

- **Sidebar-servers / header / modal blueprint COMPLETE + reviewed (0 gaps, 2 minor bugs fixed).** Last committed work is `683456e` (the arc) + `f0ea53d` (cross-server hardening fixes). Many follow-on tweaks since the commits are UNCOMMITTED in the working tree.
- **Working tree (uncommitted, ready to commit):**
  - SubscriptionsPanel.tsx — handleAddProject fallthrough bug fix; modal tree bullets (▸ projects, · sessions); per-project `<details>` collapsible (start closed); server group `<details open={hasContent}>` so empty servers start collapsed.
  - terminalStore.ts — openFor catch now logs without rethrowing (kills unhandledrejection).
  - Header.tsx — refresh button + handler removed.
  - TodoDetailView.tsx — #{last-4} id chip added; edit mode entered ONLY via the Edit button (text clicks no longer enter edit).
  - TodosTreeSection.tsx — sidebar todo rows show #{last-4} id chip.
- **Plus .claude/settings.json (statusline removal, unrelated, intentional residue).**
- **NEXT options:**
  1. Commit this polish batch (suggested message: "polish: modal collapse + tree bullets + id chips + edit-via-button + nits").
  2. /vibe-review again across the polish to be safe — likely overkill.
  3. Archive `Implementing/` for this blueprint (the work is done & reviewed; archiving moves Wave 1/2/3 + Review docs under `Archive/sidebar-servers-and-header-simplification/`).
  4. Push the branch (16+ ahead of origin) and/or rebuild signed `.dmg` for distribution.
- **Big-picture follow-ons (lower priority):**
  - `/api/ide/create-terminal` returns 500 on trimaxion (server-side; cross-server row click was firing this fire-and-forget — harmless to the in-app terminal which uses `/api/terminal/sessions`, but worth investigating server-side).
  - Auto-update feed, Windows signing, CI cross-builds (from the older roadmap).
  - Todos Phase 2 (Asana sync) — designed, not built.

**Open todos:**
- #7d03 ConnectionStore: make add/remove/setActive persistence durable ↳ Implementing-remote-connectivity · connection-store
- #f991 "new assignment" toast can double-fire on rapid updates ↳ Implementing-todos-phase1-managing-session · app-refetch-guard
- #c2c8 Desktop epic tests: 2 deferred (browser-pane + SubscriptionsPanel) ↳ Implementing-desktop-features-epic
