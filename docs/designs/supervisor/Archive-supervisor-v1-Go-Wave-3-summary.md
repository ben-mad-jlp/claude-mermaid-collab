# Wave 3 Implementation

## Tasks
- **ui-sidebar-wire** — Mounted `<SupervisorPanel>` directly ABOVE `<SubscriptionsPanel>` in BOTH render sites: `ui/src/views/SidebarView.tsx` (VSCode sidebar, props `currentProject={project} currentSession={session}` from searchParams) and `ui/src/components/layout/Sidebar.tsx` (in-app sidebar, props from `currentSession?.project/.name`).
- **supervisor-skill** — NEW `skills/supervisor/SKILL.md`. Self-scheduling wake loop: identify supervisor + assigned targets (`GET /api/supervisor/targets`), poll `GET /api/session-status` + `list_session_todos`, apply the state machine, nudge `waiting`+open-todos via `POST /api/ide/tmux-send-keys` (with N-todo count), escalate `permission`/`blocked` to the user, reschedule via ScheduleWakeup (~1200s). Never answers permissions; never nudges itself; debounces double-nudges.
- **watch-tmux-push** — **DEFERRED** (left pending). Reverse lookup ("who supervises this waiting session?") is under-determined by per-supervisor-project DB partitioning, and pushing keystrokes into the supervisor's own terminal is unsettled UX. The self-scheduling wake loop already delivers the functionality; this was always the optional fast-path follow-up.

## Verification
- Sidebar wiring: tsc clean — no errors on SidebarView.tsx or Sidebar.tsx.
- supervisor-skill: markdown, frontmatter matches sibling skills (name/description/user-invocable/allowed-tools).
- Pre-existing-pattern note: SupervisorPanel.tsx carries 2 replicated `allowtransparency` TS2322 errors identical to SubscriptionsPanel's.

## Wave TSC
clean for wired files (no new errors from the sidebar edits)
