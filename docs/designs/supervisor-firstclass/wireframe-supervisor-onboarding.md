# Wireframe — "Become Supervisor" Onboarding Front Door (#5)

> The #5 gap: there's no clear front door to *start being* a supervisor. The capability exists but is discoverable only as a tiny ▶ play icon in the sidebar `SupervisorPanel` header, with no explanation of what it does. A first-class feature needs an obvious, explained entry point.

## What already exists (grounding)

- `SupervisorPanel.handleStartSupervisor()` — reads `GET /api/supervisor/config` for `{ supervisorProject, supervisorSession }`, then `POST /api/ide/launch-session` with `{ role: 'supervisor', invokeSkill: '/supervisor', allowedTools: '…' }`. Surfaced only as a small ▶ icon.
- `handleOpenConsole()` — opens the supervisor's terminal tab (title `collab-supervisor`).
- `register_supervisor {project, session, serverId}` — the skill self-registers on start; sets the singleton supervisor identity server-side.
- `GET /api/supervisor/config` — where the supervisorProject/session come from. **Where is that configured?** (open question — likely needs a config UI).

## State-driven front door (the home view's empty/identity state)

The dedicated Supervisor view adapts based on whether a supervisor is running:

### State A — No supervisor configured/running (first run)
```
┌──────────────────────────────────────────────────────────────┐
│                        🛡                                       │
│                 Become the Supervisor                          │
│                                                                │
│  One foreground session that plans roadmaps with you and       │
│  oversees your worker sessions — nudging idle ones, escalating │
│  decisions to you, never answering on your behalf.             │
│                                                                │
│   It will:  ✓ watch sessions   ✓ nudge idle workers            │
│             ✓ escalate decisions to you                        │
│   It won't: ✗ answer prompts   ✗ make decisions for you        │
│                                                                │
│   Supervisor session:  [ supervisor-firstclass        ▾ / new ]│
│   Project scope:       [ claude-mermaid-collab        ▾ ]      │
│                                                                │
│              [  🛡  Start supervising  ]                        │
│   (launches a Claude window, runs /supervisor, registers it)   │
└──────────────────────────────────────────────────────────────┘
```

### State B — Supervisor running (the normal home shell)
Identity bar shows `● running · <session> · [⤓ console]`; the rest is the home shell (escalations / roadmap / sessions). The "Start" CTA is replaced by status + a `[⏹ stand down]` affordance.

### State C — Configured but not running (crashed / closed)
```
│ 🛡 Supervisor — not running                                    │
│ Last seen: <session> · 14m ago                                 │
│ [ ▶ Restart supervisor ]   [ ⤓ open console ]                  │
```

## Entry points (make it discoverable)

| Where | Affordance |
|-------|-----------|
| **Left rail** | Shield icon → opens the Supervisor view (State A/B/C as appropriate). Badge = open escalations. |
| **Sidebar `SupervisorPanel` header** | Keep the ▶ but add a label/tooltip "Start supervising" and, when none running, an inline "Become supervisor →" link into the view. |
| **Command palette / `/supervisor`** | Already the skill entry; the UI front door complements it for non-CLI starts. |

## Interactions

| Action | Behavior |
|--------|----------|
| Start supervising | The existing `handleStartSupervisor` flow: resolve/confirm project+session, `POST /api/ide/launch-session {role:'supervisor', invokeSkill:'/supervisor'}`. On launch, skill self-registers via `register_supervisor`. |
| Session ▾ / new | Pick an existing session or name a new one → writes `/api/supervisor/config` (**needs a config write path** if not present). |
| Stand down | Stop treating the session as supervisor (clear identity) — does it kill the process or just unregister? (open question). |

## New work this implies (later)

- A read/write `/api/supervisor/config` UI (project + session) — confirm the write path exists.
- State A/B/C detection in the view (is supervisor running? → reuse status/heartbeat).
- "Stand down" semantics (unregister vs terminate).

## Open questions (carried)

1. Where does `supervisorProject/supervisorSession` get configured today, and is there a write endpoint? (front door needs one)
2. "Stand down" = unregister only, or also stop the tmux/claude process?
3. Should starting the supervisor be allowed from any machine, or pinned to local? (singleton + cross-machine federation interplay)

---
*Status: state-driven front door (A first-run / B running / C crashed) + discoverable entry points proposed, built on existing handleStartSupervisor + register_supervisor.*
