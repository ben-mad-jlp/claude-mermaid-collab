# Wireframe — System Map (live orchestration view)

The `[⤢Map]` target from SYSTEM (and the orchestration layer behind the Plan section's ⤢). A live, at-a-glance picture of the whole running system — who's doing what, what's healthy / stuck / escalating — with click-through to any **session's** tmux. The orchestration analog of the per-blueprint task graph. Rendered with the product's own engine (`MermaidPreview`), data from **server-side state** (Supervisor-core + Coordinator daemons + the session status feed) — NOT reverse-engineered from tmux (per the Grok consult).

## Two node KINDS — this is the core distinction
| Kind | Who | Shape | Click does |
|------|-----|-------|-----------|
| **Service** (no tmux) | Supervisor (1 global), Coordinator (per project) | hexagon / gear-square | open its **state panel** (not a terminal) |
| **Session** (watchable LLM in tmux) | Planner (per project), Worker (per todo) | rounded | **open its tmux** (`onJump`/`activateSessionCard`) |

Only session nodes are terminal-clickable. Services surface their *state*, because they're deterministic loops, not chats.

## Scope + layers (top bar)
`[ All projects | myproj ▾ ]   Layer: ( Orchestration ) (+ Plan overlay)   ◉ live   ⟳   ☑ show idle/done`
- **All projects** (overview) vs **single project** (focus).
- **Plan overlay** (single-project only): faint the project's plan todos under the worker on each.
- **show idle/done** toggles clutter — default collapses idle/done, foregrounds active.

## All-projects overview

```
                         ⬡ Supervisor              ⚠2
                         classifier · watchdog
            ┌───────────────────┼────────────────────┐
        ⚙ Coord:myproj      ⚙ Coord:webapp       ⚙ Coord:api
        ready2 · inflight2    ready0 · inflight1    idle
          │                     │
   ┌──────┴──────┐              │
 (◐ login-form    (◐ token-refresh   (◐ checkout
  fe · 62%)        api · ⚠)           be · 78%◷)        ← worker near 80% → amber watchdog tick
        ◗ Planner:myproj         ◗ Planner:webapp
        idle · 41% · 💬•          active · 67%
```
- Per-project **subgraphs** keep it from becoming a hairball; idle coordinators/planners shown small.
- Supervisor sits above all, edges = "oversees"; coordinators → workers = "spawned"; planner feeds its coordinator (plan→ready).

## Single-project focus (+ optional Plan overlay)

```
  ⬡ Supervisor (global)
        │ oversees
  ⚙ Coordinator: myproj    ready 2 · in-flight 2 · done 5
        │ spawned
  ┌─────┼───────────────┐
 ◐ Worker            ◐ Worker             ◷ (2 ready, unclaimed)
  login-form fe 62%    token-refresh api ⚠
  └ todo: login-form    └ todo: token-refresh      ← Plan overlay: the todo each worker holds
  ◗ Planner: myproj   idle · 41% · threads: Auth•, Onboarding
```

## Color by live status (reuse the classDef pattern)
`● running/active` blue · `idle` gray · `waiting/needs-input` amber · `⚠ escalation` red · `done` green · `blocked` amber-dashed. Nodes near 80% context **pulse amber** (watchdog about to fire). Same vocabulary as `roadmapToMermaid` classes + `get_task_graph`.

## Interactions
| Action | Result |
|--------|--------|
| Click **Planner / Worker** node | open its tmux (`onJump` → `activateSessionCard`) + select |
| Click **Supervisor** node | state panel: recent classifier decisions (turn → nudge/escalate/leave), open escalations, recent watchdog clears |
| Click **Coordinator** node | state panel: claim queue — ready todos, in-flight (todo↔worker), recently completed, spawn failures |
| Click a node's **⚠** | focus that escalation in the inbox |
| Click a **worker → todo** (overlay) | jump to that todo in the Plan section |
| Hover any node | tooltip: status · context% · last activity · profile |
| Toggle scope / layer / idle | re-render |

Live updates via the WS feed (subscription/session-status + supervisor-core/daemon state). No polling tmux.

## States
- **No roles running** → "No active sessions. Supervisor is the only service; start a Planner to begin." (links to onboarding).
- **Healthy/quiet** → mostly green/gray, idle collapsed.
- **Escalations present** → red nodes float to top; the Supervisor node carries the ⚠count.
- **Watchdog firing** → the node mid-cycle shows a transient "checkpointing → clearing → resuming" state (so a `/clear` isn't mistaken for a crash).

## Reuse map
| Element | Reuse | New |
|---------|-------|-----|
| Render | `MermaidPreview` | — |
| Graph source | the `roadmapToMermaid`/`get_task_graph` classDef + flowchart pattern | **`systemToMermaid(state)`** — roles+sessions+statuses → flowchart, node-id→entity map |
| Click → tmux | `onJump`/`activateSessionCard` (from `SessionCard`) | route by node kind (session vs service) |
| Escalation click | `EscalationInbox` | — |
| Plan overlay | the project todos (Plan section data) | faint-node overlay |
| Shell/host | `SupervisorView` (already built) — System Map is its primary "map" mode | scope/layer top bar; right detail rail |
| Service state panels | — | supervisor-decisions panel + coordinator-queue panel (read server-side state) |

## The one genuinely new engineering bit
**Mermaid node-click → entity.** Verify whether `MermaidPreview` can emit per-node click events; if not, render with a node-id→entity map and an SVG overlay / hit-testing layer. Everything else is data assembly + reuse. (Flagged in the Phase 6 todo.)

## Open
- All-projects at scale: subgraph-per-project + collapse idle is the v1 anti-hairball; may need pan/zoom or a list fallback beyond N projects.
- Is the System Map a **mode inside `SupervisorView`** (recommended — reuse the shell) or its own route? Lean: mode inside SupervisorView.
- Service state panels (supervisor decisions, coordinator queue) — how much history to show; live tail vs last-N.
- Worker→todo overlay only in single-project focus (too noisy all-projects) — confirm.
