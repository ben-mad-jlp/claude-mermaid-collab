# Blueprint: Periodic safety-net reaper for orphaned leaf-exec worktrees

## Context

Phase A (remove-on-terminal in `runLeaf`) stops NEW worktree leaks on the normal path
(`finishWith` calls `wm.remove(sessionKey)` on accepted/blocked/rejected/split).
It cannot help the **epoch-death case**: a leaf-executor process killed mid-run before
`finishWith` executes leaves its `collab/leaf-exec-<id8>` worktree directory on disk.

This blueprint adds a **periodic safety-net reaper** that:
1. Enumerates the WorktreeManager records for `leaf-exec-*` session IDs
2. For each, checks that the leaf todo is terminal (done/dropped) AND not in the live
   `leaf_inflight` table
3. Calls `wm.remove(sessionId)` to delete the worktree directory (branch is preserved)
4. Throttles to at most once per 5 minutes per project
5. Fires inside the existing `reapOrphanedLeaves` coordinator-deps callback (already called
   each tick) — no new timer, no server.ts change

---

## Key symbols / files to understand first

| Symbol | File | Line |
|---|---|---|
| `LEAF_EXEC_PREFIX = 'leaf-exec-'` | `src/services/leaf-executor.ts` | `leafSessionKey()` L859 |
| `leafSessionKey(leaf)` → `leaf-exec-${leaf.id.slice(0,8)}` | `src/services/leaf-executor.ts` | L859 |
| `getWorktreeManager(projectRoot)` (memoised factory) | `src/services/coordinator-live.ts` | L534 |
| `WorktreeManager.list()` → `WorktreeInfo[]` | `src/agent/worktree-manager.ts` | L526 |
| `WorktreeInfo.sessionId`, `.path`, `.branch` | `src/agent/contracts.ts` | L78 |
| `WorktreeManager.remove(sessionId)` | `src/agent/worktree-manager.ts` | L398 |
| `listLeafInflight(opts?)` → `InflightRow[]` | `src/services/worker-ledger.ts` | L403 |
| `InflightRow.leafId` (= full todo UUID) | `src/services/worker-ledger.ts` | DDL L144 |
| `getTodo(project, id)` (resolves by `id.startsWith`) | `src/services/todo-store.ts` | L637 |
| `reapOrphanedLeaves` callback | `src/services/coordinator-live.ts` | L1858 |
| `reapStaleInflight()` (already called in that callback) | `src/services/worker-ledger.ts` | ~L322 |

---

## Scope limitation (acknowledged, intentional)

The reaper handles the **common case**: tracking project === targetProject.
Cross-project leaves (e.g. build123d/other-repo worktrees under a separate targetProject dir)
are NOT enumerated here because the coordinator tick only has the tracking project path and
`getWorktreeManager(project)` gives the tracking project's wm — those orphans live in a
different project's `.collab/agent-sessions/worktrees/` tree.
The description explicitly calls this out as "not yet swept". Deferred.

---

## File 1 (CREATE): `src/services/leaf-worktree-reaper.ts`

```typescript
import { getWorktreeManager } from './coordinator-live.js';
import { listLeafInflight } from './worker-ledger.js';
import { getTodo } from './todo-store.js';

const LEAF_EXEC_PREFIX = 'leaf-exec-';
const REAP_THROTTLE_MS = 5 * 60_000;

const lastReapMs = new Map<string, number>();

/**
 * Safety-net reaper for orphaned leaf-exec worktrees (epoch-death case).
 *
 * Called inside the coordinator's reapOrphanedLeaves tick callback. Throttled to once
 * per REAP_THROTTLE_MS per project so filesystem + git ops don't run every 30 s.
 *
 * Scope: only handles tracking-project === targetProject. Cross-project worktrees
 * (build123d / other repos) are deferred.
 */
export async function reapOrphanedLeafWorktrees(project: string): Promise<number> {
  const now = Date.now();
  if ((now - (lastReapMs.get(project) ?? 0)) < REAP_THROTTLE_MS) return 0;
  lastReapMs.set(project, now);

  const wm = getWorktreeManager(project);
  let records;
  try {
    records = await wm.list();
  } catch {
    return 0;
  }

  const leafRecords = records.filter((r) => r.sessionId.startsWith(LEAF_EXEC_PREFIX));
  if (leafRecords.length === 0) return 0;

  // Build the live-inflight set once (all projects share the same DB).
  const inflight = new Set(listLeafInflight().map((r) => r.leafId));

  let reaped = 0;
  for (const rec of leafRecords) {
    // Session key is 'leaf-exec-<id8>' or 'leaf-exec-<id8>-<suffix>' on collision.
    // id8 is always the first 8 hex chars after the prefix.
    const id8 = rec.sessionId.slice(LEAF_EXEC_PREFIX.length, LEAF_EXEC_PREFIX.length + 8);
    if (id8.length < 8) continue;

    const todo = getTodo(project, id8);
    if (!todo) continue; // can't verify terminal status — skip (conservative)

    const isTerminal = todo.status === 'done' || todo.status === 'dropped';
    if (!isTerminal) continue;

    if (inflight.has(todo.id)) continue; // actively running — never touch it

    try {
      await wm.remove(rec.sessionId);
      reaped++;
      console.log(
        `[worktree-reaper] reaped orphaned worktree ${rec.sessionId} (${rec.path}), ` +
        `todo=${todo.id.slice(0, 8)} status=${todo.status}`,
      );
    } catch {
      // best-effort; wm.remove already handles "not a working tree" gracefully
    }
  }

  return reaped;
}
```

### Key design decisions in this file

- **`wm.list()` not disk enumeration**: reads the `.json` records from
  `<persistDir>/worktrees/*.json` (same dir as worktree dirs). An orphaned process that
  died after `wm.ensure()` wrote the record but before `wm.remove()` will have a .json
  record. A worktree dir without a .json record is invisible to this reaper (safe: no
  .json → no `wm.remove` attempt).

- **`wm.remove` already handles missing dirs**: `worktree-manager.ts:410-420` — stderr
  containing `"not a working tree"` / `"no such file"` is treated as benign. Safe to
  call even if the dir is already gone.

- **Conservative null todo skip**: if `getTodo(project, id8)` returns null (todo was
  somehow deleted, or it belongs to a different tracking project), we skip — never reap
  something we can't confirm is terminal.

- **Inflight check uses full leafId** (`todo.id`), which matches `InflightRow.leafId`.

---

## File 2 (EDIT): `src/services/coordinator-live.ts`

### 2a. Add import at the top (with the other service imports)

Find the existing import block (around line 1–50). Add:

```typescript
import { reapOrphanedLeafWorktrees } from './leaf-worktree-reaper.js';
```

Place it near the `worker-ledger` imports (around line where `reapStaleInflight` is
imported).

### 2b. Call the reaper inside `reapOrphanedLeaves` callback

Current code around L1875:
```typescript
    reapOrphanedLeaves: async (project: string): Promise<...> => {
      // ...
      reapStaleInflight();   // ← line ~1875
```

Add immediately after `reapStaleInflight()`:

```typescript
      // Safety-net: reap leaf-exec-* worktrees whose todo is terminal but worktree
      // survived (epoch-death case — process killed before finishWith ran). Throttled
      // to once per 5 min to avoid per-tick fs + git overhead.
      void reapOrphanedLeafWorktrees(project);
```

Fire-and-forget (`void`) because:
- The reaper is best-effort
- `reapOrphanedLeaves` is already async and its return value (reclaimed/exhausted arrays)
  must not be delayed by the reaper's filesystem + git ops (which can take seconds)
- The next tick's throttle guard ensures we don't pile up parallel reap calls

### Exact edit location

```
src/services/coordinator-live.ts
  function body of: reapOrphanedLeaves: async (project: string) => { ... }
  after line:  reapStaleInflight();
  insert:      void reapOrphanedLeafWorktrees(project);
               // (with the comment above)
```

---

## Wire-up verification (cheap to test manually)

1. Start the server; dispatch and immediately SIGKILL the node process mid-build
2. Restart; confirm the worktree dir `<project>/.collab/agent-sessions/worktrees/leaf-exec-<id8>`
   still exists on disk
3. Let the orchestrator tick once (~30 s after restart, OR kick via any todo-ready event)
4. Confirm the dir is gone; confirm the branch still exists (`git branch | grep leaf-exec-<id8>`)

---

## What is NOT changed

- `src/server.ts` — no startup hook added; first tick (within 30 s of restart) handles
  it, which is acceptable for a safety-net
- `src/agent/worktree-manager.ts` — no changes; `remove()` is used as-is
- `src/services/coordinator-daemon.ts` — no changes; the hook sits in the deps callback
- `src/services/worker-ledger.ts` — no changes; `listLeafInflight()` used read-only

---

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/leaf-worktree-reaper.ts"],
  "filesToEdit": ["src/services/coordinator-live.ts"],
  "tasks": [
    { "id": "create-reaper-module", "files": ["src/services/leaf-worktree-reaper.ts"], "description": "Create leaf-worktree-reaper.ts with reapOrphanedLeafWorktrees() — throttled reaper that enumerates wm.list(), filters leaf-exec-* records, checks terminal status + not-inflight, calls wm.remove()" },
    { "id": "wire-reaper-into-tick", "files": ["src/services/coordinator-live.ts"], "description": "Import reapOrphanedLeafWorktrees and fire it void inside reapOrphanedLeaves callback after reapStaleInflight() call" }
  ] }
```
