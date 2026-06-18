---
name: vibe-checkpoint
description: Checkpoint the session before a /clear — writes "where we are" into the vibe.vibeinstructions ## Checkpoint section so the next session can resume from it
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash
---

# Vibe Checkpoint

Save the current state of the vibe before clearing context.

The checkpoint lives **in the session's `vibe.vibeinstructions` document**, in a dedicated `## Checkpoint` section — NOT on a todo. A checkpoint is volatile "where are we right now" state; it belongs with the session's orientation, not in the work-graph.

**Do not create a todo to hold the checkpoint.** Earlier versions of this skill wrote the checkpoint into the `in_progress` todo's description. The claimability model no longer keeps an interactive `in_progress` todo (only the daemon claims work), so that anchor is gone — and minting a `planned` marker todo purely to carry checkpoint text abuses the work-graph as a notepad. The document is the home.

Model:
- **`vibe.vibeinstructions` → `## Goal` / `## Context`** → stable high-level orientation. Not rewritten here.
- **`vibe.vibeinstructions` → `## Checkpoint`** → the volatile "where we left off" detail. This is what resume reads to pick up mid-task. Rewritten each checkpoint.
- **Session todos** → the real work list (epics/leaves). Already durable server-side. Reconciled here, never used as a checkpoint store.

## Steps

### Step 1 — Read the current vibeinstructions

Call `mcp__plugin_mermaid-collab_mermaid__list_documents` for the current project and session, find the document whose `name` ends with `vibeinstructions`, and `get_document` to read its full content.

If no `vibeinstructions` document exists, create one first with `create_document` (name `vibe.vibeinstructions`) containing `## Goal` and `## Context` sections inferred from the recent conversation, then continue.

### Step 2 — Write the checkpoint into the `## Checkpoint` section

Based on the recent conversation, compose a concise checkpoint (3–8 bullet points) covering:
- What has been done so far this session (and what is committed/deployed vs. not)
- What the next concrete step is
- Relevant files / components / artifacts / todo ids (refer to todo/epic ids by their last 4)
- Any decisions made or blockers hit

Then write it back with `update_document`, preserving `## Goal` and `## Context` verbatim and replacing (or appending, if absent) a single `## Checkpoint` section at the end:

```
## Checkpoint
_Updated <date> — resume reads this section._

- …bullets…
```

Use `update_document` (full content) so `lastModified` bumps — the watchdog gate in Step 4 verifies that recency. Never edit `## Goal`/`## Context` unless the session's goal itself was redefined.

### Step 3 — Reconcile the todo list

Make the session todos match reality so resume is trustworthy — but **only with real work**, never a checkpoint marker:
- Mark any todo finished this session as `done`.
- Add todos for concrete work that surfaced but isn't captured yet (every work todo belongs to an epic).
- Leave priorities/order alone unless something is clearly mis-ranked.

### Step 4 — Signal the context-watchdog (persisted-checkpoint gate)

Tell the server the checkpoint is durably persisted so an autonomous context-watchdog may safely `/clear` this session. The server re-verifies the document was JUST written (the HARD GATE — it never trusts a self-report) before recording readiness:

```
Tool: mcp__plugin_mermaid-collab_mermaid__checkpoint_ready
Args: { "project": "<cwd>", "session": "<session>", "checkpointDocId": "<the vibeinstructions document id from Step 1>" }
```

If it returns `persisted: false` (e.g. `checkpoint-stale` / `checkpoint-doc-not-found` / `no-lastModified`), the checkpoint did NOT take — fix it (re-run Step 2) rather than clearing. This step is a no-op for unsupervised sessions beyond recording the marker.

### Step 5 — Confirm

Tell the user:
```
Checkpoint saved to the vibe.vibeinstructions ## Checkpoint section.

Your Goal/Context and this Checkpoint section persist across /clear. You can clear now.
When you return, vibe-active restores Goal/Context, the open todos, and the
Checkpoint section tells us exactly where we left off.
```
