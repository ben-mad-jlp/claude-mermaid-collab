# Design: Multi-Session Coordination (assign work across concurrent sessions)

Synthesis of codebase research (`research-multi-session-coordination`) + a Grok architecture consult. Goal: let one collab session delegate a todo/document (and eventually blueprint tasks) to another session, and facilitate concurrent multi-session work.

## What the codebase already gives us (grounded)
- **Session directory is free.** `SessionRegistry.list()` enumerates all sessions in a project; `resolvePath()` resolves any session's on-disk folder. Cross-session read/write is mechanically possible today — todo/doc tools take explicit `(project, session)` with no caller-identity check. Only the *semantics* (ownership/assignment) are missing.
- **Artifacts are per-session on disk** under `.collab/sessions/<session>/`. No existing copy/move between sessions (`archive_by_prefix` is intra-session).
- **Claude↔session binding** lives in `/tmp/.mermaid-collab-binding-*.json` (written by `register_claude_session`, trust-gated by `/tmp/.claude-session-id-<pid>`).
- **Liveness pattern exists** in `instance-discovery.ts` (`process.kill(pid,0)`, lockfiles) — reusable for "is session X's Claude alive?"

## The key disagreement (resolved)
Grok's design leans on **PID-notify push** to wake a peer Claude session ("you've been assigned work"). The codebase research found **no existing channel to wake a peer Claude process** — WS broadcasts go only to UI clients; `/api/session-notify` announces a session's *own* status to the UI. 

**Resolution: the core delivery mechanism is PULL (an inbox the assignee reads), with push as a best-effort enhancement only if we can verify a peer-wake path.** A pull inbox degrades gracefully (works even if the target is mid-thinking or dead-then-restarted); push alone silently drops work. This is the single most important design call.

## Data model (minimal)
Add to `SessionTodo` (and parallel fields on document `ItemMetadata`):
```ts
ownerSession?: string;     // session that owns the file on disk (rarely changes)
assignedTo?: string;       // target session, or undefined
assignedBy?: string;       // provenance
assignedAt?: string;       // ISO
// status stays as completed:boolean for MVP; richer status later
```
We already have a per-session numeric `id`; cross-session references use the pair **(ownerSession, id)** rather than introducing Grok's `globalId` (keeps it simpler; revisit if collisions matter).

## Primitives (real back-end tools) vs Skills (playbooks)
**Primitives** (must be correct/fast; touch another session's space):
- `list_project_sessions` — `SessionRegistry.list()` + liveness (alive/dead via pid). The session directory.
- `assign_todo_to_session(project, fromSession, id, toSession, note?)` — sets assignee fields, validates target exists, writes an inbox entry.
- `list_my_assignments(project, session)` — the pull inbox: todos/docs across the project whose `assignedTo === session`.
- (later) `assign_document_to_session`, generic `send_to_session` message bus, `complete_linked_todos`-style completion events.

**Skills** (decide who/why, no raw cross-session writes):
- `/delegate <todo> to <session> [note]` — calls `assign_todo_to_session` + a tidy summary.
- `/inbox` — reads `list_my_assignments`, lets the session accept (mirror into its own todos, linked back) / re-delegate / decline.
- Later: `/partition-wave` (split a blueprint wave across sessions by task `files[]`), `/handoff`.

## Inbox mechanics (MVP)
- Assignment writes the assignee fields on the *owner's* todo AND drops a small entry the target can pull. Two options: (a) keep assignment purely as a field and have `list_my_assignments` scan sibling sessions' todos for `assignedTo === me`; (b) a literal `.collab/sessions/<target>/inbox/` dir. **Recommend (a) for MVP** — no new storage, the todo is the source of truth, scanning N sessions in a project is cheap.
- Best-effort notify: broadcast a WS `assignment_created` event (UI already listens) so a human watching the dashboard sees it. Peer-Claude wake is deferred pending a verified mechanism.

## Locking / conflict avoidance
- Grok proposes `claims.json` + heartbeats + a reaper. **Defer for MVP.** The existing discipline (blueprint tasks carry `files[]`; waves are already partitioned by file) plus "one session owns a todo" is enough to start. Add file-claims only if real collisions show up.
- Stale cleanup: when `list_my_assignments`/`list_project_sessions` runs, mark assignments to a dead session (pid not alive) as reclaimable and surface them to the assigner. Cheap, no daemon.

## Failure modes to avoid (from Grok, endorsed)
- No synchronous waiting on another session (fire-and-forget + completion events only).
- No notification storms (batch; rate-limit any future push).
- No orphaned `assignedTo` pointing at a non-existent/dead session (liveness check covers it).
- Don't build a workflow engine / queues / CRDTs. Keep it `ls`/`cat`-debuggable.
- Stable session names (registry already keys on name).

## Recommended MVP (smallest valuable slice)
1. Add `ownerSession?/assignedTo?/assignedBy?/assignedAt?` to `SessionTodo` (additive, backward-compatible — mirrors the recent `link` change).
2. Primitives: `list_project_sessions`, `assign_todo_to_session`, `list_my_assignments`.
3. Skill `/delegate` (assign) + `/inbox` (pull, accept→mirror into own todos linked back via the existing `link`/a new `assignedFrom`).
4. WS `assignment_created` broadcast for UI visibility; a small "Assigned to you" affordance reusing the todo chip pattern.
Defer: document assignment, blueprint wave partitioning, claims.json/file-locking, peer-Claude push notify.

## Open questions for the human
1. **Notify**: accept pull-only inbox for MVP, or do you want me to first investigate whether a peer-Claude wake (PID-notify) is actually achievable here?
2. **Scope of MVP**: todos only, or include document assignment from the start?
3. **Accept model**: does an assigned todo appear directly in the target's list (auto-adopt), or land in an inbox requiring explicit `/inbox` accept (Grok's safer default)?
