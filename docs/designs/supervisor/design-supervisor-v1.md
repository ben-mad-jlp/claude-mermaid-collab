# Supervisor — Design Doc (v1)

## Summary

A **supervisor** is a Claude Code session running a dedicated `supervisor` skill. Its job: watch the other collab sessions on the user's machine, notice when one goes **idle while it still has open todos**, and inject a short directional nudge ("continue working on your existing todos") to keep it moving. It escalates to the user when a session is blocked or needs a decision, and the user can collaborate with the supervisor to add/refine todos.

All sessions — supervisor and supervised — always run as **local Claude Code CLI processes** on the user's machine. This makes `tmux send-keys` the primary control mechanism.

## Scope (v1)

In scope:
- Discover collab sessions and their bound tmux/PID on the local machine.
- Track each session's last-known status (active / waiting / permission).
- For a session that is `waiting` AND has open todos → inject "continue" nudge.
- Escalate blocked sessions / questions to the user.
- Let the user add/refine session todos via the supervisor.

Explicitly OUT of scope (later):
- Supervisor answering permission prompts (the **user always handles permissions**).
- Generating prompts containing task content (we only nudge — the session already knows its todos).
- Task decomposition / autonomous planning.
- Cross-machine / remote sessions.

## Per-session state machine

| Status | Has open todos | Supervisor action |
|--------|----------------|-------------------|
| `active` | — | Leave alone (it's working) |
| `permission` | — | Leave alone — **user handles permissions** |
| `waiting` | yes | `send-keys` nudge incl. open-todo count (e.g. "You have N open todos — continue working on them") → mark nudged |
| `waiting` | no | Idle with nothing to do → report to user |
| unknown / stale | — | Report; do not nudge |

Nudge guard: never send-keys to a session that is not `waiting`. Avoid double-nudging — track last-nudge time per session and require a status transition (active→waiting) before nudging again.

## Architecture

```
flowchart TD
  subgraph supervisor["Supervisor session (local claude CLI)"]
    loop["Supervisor skill loop"]
  end
  subgraph server["collab server (:9002)"]
    statusStore["Persisted status store (NEW)"]
    todos["Session todos (SQLite)"]
    sendkeys["tmux send-keys route (NEW)"]
    ws["WebSocket bus"]
  end
  subgraph supervised["Supervised sessions (local claude CLIs in tmux)"]
    s1["session A"]
    s2["session B"]
  end

  s1 -. status hooks .-> ws
  s2 -. status hooks .-> ws
  ws --> statusStore
  loop -->|"query who's idle"| statusStore
  loop -->|"read open todos"| todos
  loop -->|"nudge idle+todos"| sendkeys
  sendkeys -->|"tmux send-keys"| s1
  loop -->|"escalate blocked/Qs"| supervisor
```

## What we need to build

### 1. `tmux send-keys` route (NEW)
- Endpoint e.g. `POST /api/ide/tmux-send-keys` taking `{ project, session, text }`.
- Resolves the stable tmux name via `tmuxBaseName(project, session)`.
- Sends the text, then a separate `Enter` keystroke (TUI sometimes needs the paste and submit split).
- Returns success/failure; failures are non-fatal to the supervisor loop.
- **Safety**: route itself just sends; the *decision* to send only when `waiting` lives in the supervisor skill.

### 2. Persisted status store (NEW)
- **Confirmed: status is stored NOWHERE today.** `POST /api/session-notify` (`src/routes/api.ts:2376-2427`) validates the status, reads the binding file only as a trust check, then does exactly one thing: `wsHandler.broadcast({ type: 'claude_session_status', ... })` (`api.ts:2417`). No Map, no SQLite, no file. The WS handler does not cache it either — a late subscriber misses it permanently (`handler.ts:127-138` only replays `ide_status`). `/api/session-state` is unrelated (reads `collab-state.json`).
- Add a **SQLite-backed** store (decided — survives server restart) updated inside the `session-notify` handler on every status event, holding `{ project, session, status, updatedAt }`.
- Expose via a query endpoint (e.g. `GET /api/session-status`). Optionally also replay last-known status to new WS subscribers (mirrors the `ide_status` replay pattern).
- Staleness: if no update within N seconds, treat status as `unknown` (don't nudge).

### 3. `supervisor` skill (NEW)
- Entry: register the supervisor's own Claude session; identify the project; list candidate sessions (exclude itself).
- Loop (paced, NOT busy-spin):
  1. Query status store + open todos per session.
  2. Apply the state-machine table above.
  3. Nudge eligible sessions via the send-keys route.
  4. Collect blocked/question signals → escalate to user in the supervisor console.
  5. Sleep / wake on WS events rather than tight polling.
- Collaboration: user can ask the supervisor to add/edit todos for any session.

## Loop architecture (avoid busy-spin)

- Prefer **event-driven**: subscribe to the WS bus; react to `claude_session_status` transitions (esp. → `waiting`) and `session_todos_updated`.
- Fallback **slow poll** (e.g. every 20–30s) as a heartbeat in case an event is missed.
- Debounce: a session must transition into `waiting` (not merely still be waiting) before re-nudging.

## Known traps

- **Permission status**: must never be auto-answered. Detect and skip; surface to user.
- **Mid-stream injection**: only send-keys when `waiting`; never `active`.
- **Double-nudge / nudge storms**: require a status transition + last-nudge cooldown.
- **Supervisor itself going idle**: the supervisor loop must keep itself alive (it's also a `waiting`-prone Claude session). It should not nudge itself.
- **Feedback loops**: a nudge flips a session to `active`; ensure we wait for the next real `waiting` before acting again.

## Loop driver: self-scheduling wake (decided)

The supervisor skill drives itself via a **self-scheduling wake loop** (e.g. `ScheduleWakeup`) rather than manual `/supervisor` re-entry. Each wake: query status store + todos, apply the state machine, nudge eligible sessions, escalate, then reschedule the next wake. Pace it slowly enough to avoid busy-spin; the optional watch→tmux push (below) can wake it sooner on real events.

## Optional: watch system pushes events into the supervisor's tmux (to investigate)

A faster, event-driven alternative/supplement to polling. The cross-server watch pipeline **already passes through a server-side chokepoint** with shell/tmux access:

1. Each watched server broadcasts `claude_session_status` over `/ws`.
2. Desktop main process `WatchAggregator` (`desktop/src/main/watch-aggregator.ts`) ws-clients each server, filters to watched types, and calls `forward(e)`.
3. `forward` is wired at `desktop/src/main/index.ts:273` → currently `mainWindow.webContents.send('mc:watch-event', e)` (renderer only; `useWatchEvents.ts` just updates badge state).

**The tap point** is that `forward` callback (Electron main, has tmux access). When an event matches a supervised session + condition (e.g. → `waiting`), call the new `send-keys` op to inject a line into the **supervisor's** tmux — effectively waking/informing the supervisor in real time instead of waiting for its next poll. Requires: (a) the new `send-keys` primitive, (b) a designated "supervisor session" identity to resolve its tmux name via `tmuxBaseName`.

## Supervisor membership: user-assigned (decided)

**The user explicitly assigns sessions to a supervisor** — supervision is an opt-in set, mirroring how the Watching feature works (not auto-discovery of all sessions). This resolves the "how is a supervisor identified" question:
- A supervisor owns an **assignment list** of `{ project, session }` it supervises.
- The user manages this list from the UI (add/remove a session to/from the supervisor), analogous to the watch subscription store.
- Persist the assignment set (SQLite or alongside the subscription store) so it survives restarts.
- The supervisor skill reads its assignment list to decide which sessions to poll/nudge; it never acts on unassigned sessions.

## UI: Supervisor section (decided)

Each supervisor gets **its own section in the sidebar, above the Watching section** — listing its **assigned** sessions and their current status, with controls to add/remove sessions from the supervisor. Mirrors the existing watch UI layout.

## Open questions (remaining)

1. Status store staleness threshold N (seconds) before a session is treated as `unknown`.
2. Escalation surface — supervisor console is confirmed; do we also want a UI badge/notification on the supervisor section?
3. Watch→tmux push: implement in v1 alongside polling, or ship polling first and add the push as a fast-path follow-up?
4. ~~How is a supervisor designated?~~ **Resolved: user-assigned membership set (see above).**
