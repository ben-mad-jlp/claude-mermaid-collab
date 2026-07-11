# Supervisor — Design Doc (v2)

Supersedes [[design-supervisor-v1]]. Informed by [[research-single-supervisor-roadmaps]] and [[research-supervisor-v2-design-memo]]. Transcript-reading mechanism verified empirically.

## Summary

There is **one** supervisor: a normal Claude Code session the user collaborates with in the foreground. It plans **major work per project via a roadmap**, and — with the user's approval — **creates collab session records and assigns todos** for groups of work. The **user** then opens a real Claude Code window and runs `/collab` to bind a Claude to each session. The supervisor keeps supervised, idle sessions moving by **nudging** them (`tmux send-keys`), and **escalates anything past a nudge to the user**. It never drives, course-corrects, answers, or relays.

All sessions are **human-launched Claude Code windows**. There is **no server-side background watcher** and **no in-server agent spawning**.

## Core principles

1. **Single supervisor** — not per-session, not assignable. It's "the session running the supervisor skill."
2. **Nudge-only action vocabulary** — nudge an idle supervised worker, or escalate to the user. Nothing else. This is the safety boundary: the supervisor has no authority to answer questions, make decisions, or drive a session.
3. **Stateless pull** — the supervisor re-derives worker state every turn from `session-status.db` + transcript tails. The only durable supervisor state is unanswered escalations (the one fact not safely re-derivable).
4. **Human attaches** — the supervisor creates a session record + todos; a human opens Claude and binds it. The supervisor never spawns a process.
5. **Never inject into the foreground** — the supervisor session (where the user types) is never sent keys; it pulls state on its own turns. Injection (`tmux send-keys`) targets only unattended worker windows.

## Watching vs supervising

Supervision is a **flag on a watched session**, reusing the existing Watching/subscription infrastructure:
- **watched-only** — observe status, no nudging.
- **watched + supervised** — eligible for nudge/escalate.

A per-row **"supervise" toggle** in the Watching UI. No separate membership store.

## Behavior model (per supervised worker)

| Worker state | Supervisor action |
|---|---|
| not supervised (watched-only) | observe only |
| supervised, `active` / `permission` | leave alone (permissions are always the user's) |
| supervised, `waiting` + open todos, last turn `end_turn`, not a question | **nudge**: send-keys "You have N open todos — continue working on them." |
| supervised, `waiting`, last turn asked a question / `blocked` todo | **escalate to user** + set attended-lock; user handles directly |
| supervised, `waiting`, no open todos | report "group done" |
| planned / unattached (todos exist, no binding yet) | remind user to open & bind it; do not nudge |

### Question classification (2 buckets, cognitive)
On a `waiting` worker, the supervisor reads the last assistant `end_turn` text and decides:
- **continue** — not a real question / safe to proceed → nudge.
- **needs the user** — a question, decision, block, or anything uncertain → escalate. **When in doubt → escalate.**

The trailing-`?` heuristic is a cheap first filter; the supervisor (a Claude) makes the actual call by reading the text. It never answers — only nudge or escalate.

## Input & race model

- **Foreground supervisor** (user typing): never injected. Learns of events by re-deriving state on each turn (start-of-turn status check) + a ~12-min `ScheduleWakeup`. No race because nothing is pushed into the user's prompt.
- **Worker sessions** (unattended — the user is in the supervisor window): `tmux send-keys` nudges are safe. Only inject when `waiting` and last turn was `end_turn`.
- **Escalation → user intervenes directly**: the supervisor surfaces the verbatim question + a jump-to-session affordance. The user goes to that worker and answers it themselves. While they do, an **attended-lock** suppresses all supervisor injection into that worker until its status flips back to `active` (with a fresh `end_turn` after) — then the lock releases. Locks carry `expiresAt`; on expiry the escalation re-fires (never a silent strand). **No answer-relaying through the supervisor.**

## Catching idle workers without a watcher

Two triggers, both cheap, no daemon:
- **Start of every foreground turn** — the supervisor does a quick `GET /api/session-status` + todo read for supervised workers, so during active collaboration idle workers are caught promptly.
- **`ScheduleWakeup` ~12 min** — covers the user-away case.

This closes the gap a server watcher would have filled, without the server subsystem.

## Roadmaps (per project)

A **new per-project artifact**: `<project>/.collab/roadmap.db` (one roadmap per project, mirroring the `todo-store`/`session-status-store` SQLite pattern — bun:sqlite, WAL, per-project `dbCache`). Roadmaps are planning-grain (major items), distinct from per-session blueprints/task-graphs (execution-grain) and from todos.

**Schema sketch:**
```
roadmap_item(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT,            -- planned | in_progress | done | blocked
  ord INTEGER,
  parentId TEXT,
  dependsOn TEXT,         -- JSON array of item ids
  sessionName TEXT,       -- the collab session spawned for this item (nullable until blessed)
  blueprintId TEXT,       -- optional per-session blueprint seeded for this item
  createdAt INTEGER, updatedAt INTEGER
)
roadmap_item_todo(itemId TEXT, todoId TEXT)   -- 1:N bridge into todos.db
```

**Flow down:** a blessed roadmap item → (with approval) create a collab session → optionally seed a per-session blueprint (reuse `vibe-blueprint`/`vibe-go`) → emit assigned todos into the existing per-project `todos.db` with `assigneeSession` = the new session.

## Durable state: escalations only

Stateless pull for everything mechanical (finished / group-done / nudge-worthiness — all re-derivable, self-healing). One small durable table for **unanswered human-only escalations**, because a question the user hasn't answered can't be safely re-derived (transcript moves on; supervisor may `/clear`). Dedup by `(session, hash(questionText))`. Reconcile on supervisor session start.

## Approval-gated orchestration

Session creation + todo assignment happen only **with the user's blessing** — via `request_user_input` / `render_ui` (the pair-mode approval pattern). The supervisor proposes "create session X for work Y, assign these todos?" and waits.

## Persistence / restart survival

All on disk → survives collab restarts: per-project `roadmap.db`, `todos.db`, `session-status.db`, and a global supervisor/projects registry. `ScheduleWakeup` is harness-side, independent of the collab server. On restart/`/clear`, the supervisor resumes from these + its `vibeinstructions` checkpoint; the binding hook keeps its `claudeSessionId` current.

## Transcript reading (verified)

For a supervised worker, the last assistant message is reliably readable:
- Path: `~/.claude/projects/<cwd with "/"→"-">/<claudeSessionId>.jsonl` (binding file gives the live `claudeSessionId`, kept current across `/clear`/`/compact`).
- Extract: last entry where `type=="assistant" && message.stop_reason=="end_turn" && isSidechain != true`; text at `message.content[].text`.
- Caveats: tolerate a torn final line on a live file; trust the binding's id over any cached one.

## v1 disposition (uncommitted work)

| Verdict | Pieces |
|---|---|
| **KEEP as-is** | `src/services/session-status-store.ts`; `POST /api/ide/tmux-send-keys`; `/api/session-notify` persistence + `GET /api/session-status` |
| **REPLACE** | `src/services/supervisor-store.ts` (4-tuple membership → "supervised" flag on subscriptions); `src/routes/supervisor-routes.ts` (`/api/supervisor/targets` → roadmap + supervised-flag + escalations endpoints) |
| **DROP from supervisor path** | the inert WS `claude_session_status` replay scaffold (v2 is pull-based) |
| **REWORK** | `ui/.../SupervisorPanel.tsx` + `ui/.../supervisorStore.ts` (→ roadmap view + supervise toggle on Watching rows, escalation surfacing); `skills/supervisor/SKILL.md` (→ foreground planning + approval-gated session creation; start-of-turn + wake status checks; nudge/escalate state machine; transcript-aware question classification; attended-lock; "never answer/drive/relay") |

## New things to build (v2)

1. **Per-project roadmap store** (`roadmap.db`) + API + MCP tools (CRUD roadmap items, link to todos).
2. **"Supervise" flag** on watched sessions (extend subscription store/record) + UI toggle.
3. **Durable escalations table** + endpoints (enqueue on escalate, resolve on attended-lock release / user answer; dedup; reconcile-on-start).
4. **Attended-lock** primitive (per-session; `expiresAt`; released on `active`→fresh-`end_turn`; re-escalate on expiry).
5. **Transcript-tail reader** (claudeSessionId → last `end_turn` text) for the question classifier.
6. **Reworked supervisor skill** — the foreground planning + nudge/escalate loop tying it together.

## Top risks & mitigations

1. **Supervisor acts beyond its remit** — largely eliminated by the nudge-only vocabulary (no answering/driving/relaying). Reinforce in the skill with an explicit never-list and an audit log of every nudge.
2. **Silent stall / dropped question if the supervisor window closes** — durable escalations table + reconcile-on-start; surface "supervisor not running" so it's visible. A closed window genuinely halts orchestration (acceptable — supervisor is something you run).
3. **Attended-lock leak / premature release** — `expiresAt` + re-escalation; require a fresh `end_turn` after the `active` transition before releasing.

## Open / deferred

- Whether to ever add a server-side detector for sub-minute reaction (deferred — non-requirement; start-of-turn + wake suffices).
- `watch-tmux-push` (v1 backlog todo) — obsolete under v2's pull model; can be closed.
- Grok consult (`consult_grok`) blocked on an invalid `XAI_API_KEY`; default model `grok-4.20-reasoning` also likely invalid — fix key + pin a valid model id.
