---
name: vibe-checkpoint
description: Checkpoint the in-progress session todo before a /clear — writes "where we are" into the active todo's description so the next session can resume from it
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash
---

# Vibe Checkpoint

Save the current state of the vibe before clearing context.

The checkpoint lives **on the todo currently being worked on**, not in the `.vibeinstructions` snippet. Session todos are already persisted server-side, so they survive `/clear` for free. The only thing worth saving is the fine-grained "where am I" detail for the active task — and that belongs in that task's todo.

Model:
- **`vibe.vibeinstructions`** → stable high-level orientation only (Goal, Context). Not touched here.
- **Session todos** → the live work list. Already durable.
- **The `in_progress` todo's `description`** → the checkpoint. This is what resume reads to pick up mid-task.

## Steps

### Step 1 — Find the active todo

Call `mcp__plugin_mermaid-collab_mermaid__list_session_todos` for the current project and session with `includeCompleted: false`.

Find the todo with `status: "in_progress"`.

- **Exactly one `in_progress`:** that is the todo to checkpoint. Continue to Step 2.
- **None `in_progress`:** infer which todo the recent conversation was actually working on. Tell the user which one you picked and set its `status` to `in_progress` via `update_session_todo` before continuing. If no todo matches the current work, add one with `add_session_todo` (status `in_progress`), then continue.
- **More than one `in_progress`:** pick the one the recent conversation was actually advancing, checkpoint that one, and mention the others to the user.

### Step 2 — Write the checkpoint into the todo description

Based on the recent conversation, write a concise checkpoint (3–8 bullet points) into the active todo's `description`, covering:
- What has been done so far on this task
- What the next concrete step is
- Relevant files / components / artifacts
- Any decisions made or blockers hit

Call `mcp__plugin_mermaid-collab_mermaid__update_session_todo` with the todo `id` and the new `description`. Do not change `text`/`title` unless the task itself was redefined.

### Step 3 — Reconcile the rest of the list

Quickly make the todo list match reality so resume is trustworthy:
- Mark any todo finished this session as `done` (or `completed: true`).
- Add todos for concrete work that surfaced but isn't captured yet.
- Leave priorities/order as they are unless something is clearly mis-ranked.

### Step 4 — Signal the context-watchdog (persisted-checkpoint gate)

After the checkpoint is written and the list is reconciled, tell the server the
checkpoint is durably persisted so a supervisor's context-watchdog may safely
`/clear` this session. The server re-verifies the todo was just written before
recording readiness (the HARD GATE — it never trusts a self-report):

```
Tool: mcp__plugin_mermaid-collab_mermaid__checkpoint_ready
Args: { "project": "<cwd>", "session": "<session>", "checkpointTodoId": "<the in_progress todo id from Step 1>" }
```

If it returns `persisted: false` (e.g. `checkpoint-stale` / `checkpoint-todo-not-found`), the checkpoint did NOT take — fix it (re-run Step 2) rather than clearing. This step is a no-op for unsupervised sessions beyond recording the marker.

### Step 5 — Confirm

Tell the user:
```
Checkpoint saved to the in-progress todo: "{todo title}".

Your todos are the checkpoint — they persist across /clear. You can clear now.
When you return, vibe-active restores Goal/Context + open todos, and this todo's
description tells us exactly where we left off.
```
