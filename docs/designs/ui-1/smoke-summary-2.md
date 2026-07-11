# Terminal Component Set — 5-line summary

1. **TerminalDrawer.tsx** — right-side resizable column hosting ONE persistent console (one WS per server) that re-points to the active `(serverId, session)` tmux target on switch, instead of one xterm+PTY per tab; keeps the server picker + controls.
2. **TerminalPane.tsx** — the console pane itself (the xterm surface bound to the single persistent connection).
3. **SessionSwitcher.tsx** — left rail listing every OPEN terminal session across servers with a liveness status dot (red=needs-you, amber=active, green=waiting, grey=unknown); selecting a row flips the console target without spawning/tearing down a PTY. Liveness is derived inline from `subscriptionStore` + supervisor todo cache (no new WS events/polling — constraint b2fe36b1).
4. **InputRail.tsx** — the ~26px quick-reply chip bar (QR1 default chips + QR2 custom chips w/ persistence, inline add, right-click manage, drag-reorder); tapping a chip types its text into the live `claude` REPL via tmux-send-keys, with a per-chip ~800ms lock to kill rage-double-taps.
5. **Tests** — `SessionSwitcher.test.tsx` and `TerminalPane.test.tsx` cover the switcher's liveness/selection behavior and the pane's render/connection wiring.
