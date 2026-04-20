# Migration to v6

## Summary

v6 retires the persistent terminal panel from the default layout. The chat surface is now driven by the Claude Code agent, and a dedicated **Shell drawer** replaces the old always-on terminal.

## What Changed

- **Terminal retired from default layout.** The persistent `TerminalTabsContainer` that used to share space with the chat panel has been removed from the ChatPanel render path.
- **Chat is now Claude Code agent-driven.** `ChatPanel` renders `AgentChat` full-height when a session is active. MCP `render-ui` sheets continue to surface via the global question-panel (unchanged).
- **Shell drawer.** A dedicated, on-demand Shell drawer takes over the terminal use case. Open it with:
  - Keyboard shortcut: <kbd>⌘</kbd> + <kbd>`</kbd> (backtick)
  - Header: the **Shell** button toggle
- **UI store migration (v3 → v4).** `terminalPanelVisible` is automatically mapped to `shellDrawerVisible` the first time v6 loads. No user action is required.

## What You Need To Do

Nothing. Your `localStorage` preferences persist across the upgrade. The Zustand `ui-preferences` store runs a migration (see `ui/src/stores/uiStore.ts`) that preserves your previous terminal-open state as the initial Shell drawer state.

A one-time welcome banner (`MigrationBannerV5`) appears at the top of the chat panel on first run after upgrade. Dismiss it with the × button; the flag (`seenMigrationBannerV5`) is persisted so it will not reappear.

## Rollback

If you need to revert to v5 behavior, downgrade the package and clear `localStorage.ui-preferences` to drop the v4 schema. (Your split-pane sizes and zoom level will reset to defaults.)

## Related Design Notes

See `.collab/agent-sessions/t3-inspiration/` for the blueprint and task graph that drove this migration.
