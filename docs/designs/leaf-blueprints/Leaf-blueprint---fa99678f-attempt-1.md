# Blueprint — DF2: watcher detectors record operational friction (unlanded epics, stale worktrees)

## Goal

Add a **deterministic, periodic** watcher pass that records DF1 operational-layer
friction (`layer:'operational'`) for the issues a daemon can SEE, so they're captured
silently with **no LLM**:

- **(a) unlanded-epic backlog over a threshold** — reuse the same derivation behind
  `/api/supervisor/unlanded-epics` (`WorktreeManager.listUnlandedEpics`).
- **(b) stale worktrees** — `git worktree list` + age / branch-gone.
- **(c) land-path hook** — record on a merge / node_modules conflict when an epic→master
  land fails to merge cleanly.

**Dedup**: each standing condition must record at most ONCE per edge (threshold-cross /
new stale worktree / new conflict), not every 30s tick. Dedup state is kept in a small
durable KV table in the SAME `friction.db` (NOT polluting `friction_notes` with
"cleared"/"under-threshold" rows), so it survives restarts.

## Existing facts (cited)

- `src/services/friction-store.ts`
  - `recordFriction(project, input: RecordFrictionInput)` — `layer` accepts
    `'operational'` (line 24, `VALID_LAYERS` line 126), `todoId` is nullable (operational
    notes are not leaf-scoped). Per-project DB at `<project>/.collab/friction.db`,
    opened by `openDb(project)` (line 77), serialized writes via `withLock` (line 117).
  - `listFriction(project, {layer})` (line 164) — filterable read.
- `src/agent/worktree-manager.ts`
  - `class WorktreeManager` (line 124); `runGit(cwd, args, timeoutMs, onProgress?)` →
    `{code,stdout,stderr}`; `private isGitRepo()` (line 1353); `this.now()` (line 132,
    injectable clock); `QUICK_TIMEOUT_MS` (line 122); `epicBranchName` (public, line 675).
  - `listUnlandedEpics(baseRef='master')` (line 754) → `Array<{branch, epicId8, ahead}>`.
- `src/services/coordinator-live.ts`
  - `getWorktreeManager(projectRoot)` (line 532) — memoised per repo root.
  - `getConfig` already imported (line 62, `import { getConfig } from './config-service'`).
  - land_epic site: `const land = await wm.landEpicToMaster(epicId)` (line 1317); the
    **conflict branch** is line 1318 `if (land.conflict) { … createEscalation … }` — this
    is where the land-path friction hook goes.
- `src/services/orchestrator-live.ts`
  - `runOrchestratorTick` (line 215) iterates registered projects; the **notify pass**
    (line 264-271) runs for every WATCHED project **regardless of level** with
    `withPassTimeout(notify(project), NOTIFY_PASS_TIMEOUT_MS, …)`. The friction-watch pass
    mirrors this placement (operational observability must run even at level `on`/`off`).
  - `NOTIFY_PASS_TIMEOUT_MS` and `withPassTimeout` already exist in this file; `watched`
    set computed line 225 (`watchedProjects()`).

## Change shape

### 1. `src/services/friction-store.ts` (EDIT) — durable dedup KV

Add a second table to the existing `DDL` (extend the const at line 60, keep idempotent
`CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS friction_watch_state (
  signalKey TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

Export two helpers (mirror the `openDb`/`withLock`/`nowIso` patterns already in file):

```ts
export function getWatchState(project: string, signalKey: string): string | null {
  const db = openDb(project);
  const row = db.prepare('SELECT state FROM friction_watch_state WHERE signalKey = ?').get(signalKey) as { state?: string } | undefined;
  return row?.state ?? null;
}

export function setWatchState(project: string, signalKey: string, state: string): Promise<void> {
  return withLock(project, () => {
    const db = openDb(project);
    db.prepare(
      `INSERT INTO friction_watch_state (signalKey, state, updatedAt) VALUES (?,?,?)
       ON CONFLICT(signalKey) DO UPDATE SET state = excluded.state, updatedAt = excluded.updatedAt`
    ).run(signalKey, state, nowIso());
  });
}
```

(No migration concern — new table, `IF NOT EXISTS`.)

### 2. `src/agent/worktree-manager.ts` (EDIT) — `listStaleWorktrees`

Add a public method near `listUnlandedEpics` (after line 775). Deterministic git read:
parse `git worktree list --porcelain`, skip the MAIN worktree (`this.opts.projectRoot`),
and flag each linked worktree that is EITHER (i) **branch-gone** — its `branch
refs/heads/<x>` no longer resolves (the epic landed + branch was `-D`'d but the worktree
lingered), OR `prunable` is annotated by git — OR (ii) **stale by age** — HEAD commit
older than `maxAgeMs` (default 7 days), measured via `git log -1 --format=%ct` vs
`this.now()`.

```ts
/** Enumerate LINKED worktrees (excludes the main repo) that look abandoned:
 *  their branch ref is gone / git marks them prunable, or their HEAD commit is older
 *  than maxAgeMs. Pure git read — no prune, no removal. [] off non-git / on error. */
async listStaleWorktrees(opts: { maxAgeMs?: number } = {}): Promise<Array<{ path: string; branch: string | null; reason: 'branch-gone' | 'prunable' | 'stale'; ageMs: number }>> {
  if (!(await this.isGitRepo())) return [];
  const maxAgeMs = opts.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const list = await this.runGit(this.opts.projectRoot, ['worktree', 'list', '--porcelain'], QUICK_TIMEOUT_MS)
    .catch(() => ({ code: 1, stdout: '', stderr: '' }));
  if (list.code !== 0) return [];
  // Parse porcelain into records: blank-line-separated blocks of `key value` lines.
  const out: Array<{ path: string; branch: string | null; reason: 'branch-gone' | 'prunable' | 'stale'; ageMs: number }> = [];
  const blocks = list.stdout.split('\n\n');
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    let wtPath = ''; let branch: string | null = null; let prunable = false;
    for (const ln of lines) {
      if (ln.startsWith('worktree ')) wtPath = ln.slice('worktree '.length);
      else if (ln.startsWith('branch ')) branch = ln.slice('branch '.length).replace(/^refs\/heads\//, '');
      else if (ln === 'prunable' || ln.startsWith('prunable ')) prunable = true;
    }
    if (!wtPath) continue;
    if (path.resolve(wtPath) === path.resolve(this.opts.projectRoot)) continue; // skip main
    // branch-gone: a named branch that no longer resolves.
    let branchGone = false;
    if (branch) {
      const ok = (await this.runGit(this.opts.projectRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], QUICK_TIMEOUT_MS)
        .catch(() => ({ code: 1, stdout: '', stderr: '' }))).code === 0;
      branchGone = !ok;
    }
    // age: HEAD commit time in the worktree.
    let ageMs = 0;
    const ct = await this.runGit(wtPath, ['log', '-1', '--format=%ct'], QUICK_TIMEOUT_MS)
      .catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (ct.code === 0 && ct.stdout.trim()) ageMs = this.now() - parseInt(ct.stdout.trim(), 10) * 1000;
    const reason = branchGone ? 'branch-gone' : prunable ? 'prunable' : (ageMs > maxAgeMs ? 'stale' : null);
    if (reason) out.push({ path: wtPath, branch, reason, ageMs });
  }
  return out;
}
```

`path` is already imported at top of the file (`import * as path` — confirm; it uses
`path.join` throughout, e.g. line 805). Reuse it; do not add a duplicate import.

### 3. `src/services/friction-watch.ts` (CREATE) — the watcher pass

New small service. Pure/deterministic, best-effort, never throws into the tick.

```ts
import { getWorktreeManager } from './coordinator-live.ts';
import { recordFriction, getWatchState, setWatchState } from './friction-store.ts';
import { getConfig } from './config-service.ts';

/** Default unlanded-epic backlog threshold; override via FRICTION_UNLANDED_THRESHOLD. */
const DEFAULT_UNLANDED_THRESHOLD = 5;

/** One deterministic operational-friction watch pass for `project`. Records DF1
 *  operational-layer friction for issues a daemon can see, deduped on the edge via
 *  friction_watch_state so a STANDING condition records once, not every tick. No LLM. */
export async function runFrictionWatchPass(project: string): Promise<void> {
  const wm = getWorktreeManager(project);

  // (a) unlanded-epic backlog over threshold — record on the under→over edge only.
  try {
    const threshold = Number(getConfig('FRICTION_UNLANDED_THRESHOLD', '') || 0) || DEFAULT_UNLANDED_THRESHOLD;
    const epics = await wm.listUnlandedEpics();
    const over = epics.length >= threshold;
    const key = 'watch:unlanded-threshold';
    const prev = getWatchState(project, key);
    if (over && prev !== 'over') {
      await recordFriction(project, {
        layer: 'operational',
        retryReason: 'unlanded-epics-over-threshold',
        detail: `${epics.length} unlanded epic branch(es) ≥ threshold ${threshold}: ${epics.map((e) => `${e.epicId8}(+${e.ahead})`).join(', ')}`,
      });
    }
    await setWatchState(project, key, over ? 'over' : 'under');
  } catch { /* best-effort */ }

  // (b) stale worktrees — record once per newly-stale worktree identity (path).
  try {
    const stale = await wm.listStaleWorktrees();
    for (const wt of stale) {
      const key = `watch:stale-wt:${wt.path}`;
      if (getWatchState(project, key) === wt.reason) continue;
      await recordFriction(project, {
        layer: 'operational',
        retryReason: 'stale-worktree',
        detail: `stale worktree (${wt.reason}) ${wt.path}${wt.branch ? ` [branch ${wt.branch}]` : ''}, age ${Math.round(wt.ageMs / 3_600_000)}h`,
      });
      await setWatchState(project, key, wt.reason);
    }
  } catch { /* best-effort */ }
}
```

Note: importing `getWorktreeManager` from `coordinator-live.ts` is fine — it's a plain
exported function with no circular-init hazard (coordinator-live does not import
friction-watch). If a static cycle is flagged at build, fall back to a dynamic
`await import('./coordinator-live.ts')` inside the pass (the file already uses dynamic
imports to break cycles, e.g. `inProcessLaneAlive`).

### 4. `src/services/orchestrator-live.ts` (EDIT) — wire the pass in

Import and run for every WATCHED project, alongside the notify pass (it must run
regardless of level — operational observability is not gated on autonomous building).

- Add import near line 21: `import { runFrictionWatchPass } from './friction-watch.js';`
- In `runOrchestratorTick`, inside the `if (watched.has(project))` block (after the
  notify pass, ~line 271), add a guarded call reusing `withPassTimeout` +
  `NOTIFY_PASS_TIMEOUT_MS`:

```ts
try {
  currentPhase = `${project}:friction-watch`;
  await withPassTimeout(runFrictionWatchPass(project), NOTIFY_PASS_TIMEOUT_MS, `${project}:friction-watch`);
} catch (err) {
  console.warn(`[orchestrator] friction-watch failed for ${project}:`, err);
}
```

(Optionally add `friction?: (p: string) => Promise<void>` to `TickDeps` and default it to
`runFrictionWatchPass`, mirroring `notify`, so the unit test can inject a spy. Match the
existing `notify` dep wiring at line 220.)

### 5. `src/services/coordinator-live.ts` (EDIT) — land-path conflict hook

At the land_epic conflict branch (line 1318 `if (land.conflict) {`), AFTER the existing
`createEscalation` / `recordSupervisorAudit`, record operational friction deduped per
epic so a tick-retried land doesn't spam:

```ts
// DF2: silently capture the land-merge conflict as operational friction (deduped
// per-epic edge — record once until a later land of this epic succeeds).
try {
  const fkey = `watch:land-conflict:${epicId.slice(0, 8)}`;
  if (getWatchState(targetProject, fkey) !== 'conflict') {
    await recordFriction(targetProject, {
      layer: 'operational',
      retryReason: 'land-merge-conflict',
      detail: `epic ${epicBranch} did not merge cleanly into master (master untouched). reason=${land.reason ?? 'epic-merge-conflict'}`,
    });
    await setWatchState(targetProject, fkey, 'conflict');
  }
} catch { /* best-effort */ }
```

And on the SUCCESS path (after `land.landed`, near line 1337 `await wm.removeEpic(...)`),
reset the dedup state so a future conflict on a re-created epic records again:

```ts
try { await setWatchState(targetProject, `watch:land-conflict:${epicId.slice(0, 8)}`, 'landed'); } catch { /* best-effort */ }
```

Add to the existing friction-store import path in coordinator-live (there is none yet —
add `import { recordFriction, getWatchState, setWatchState } from './friction-store.ts';`
near the other service imports, e.g. by line 63). `targetProject` and `epicBranch` are
already in scope at the land_epic site (lines 1278-1281). `node_modules` conflicts surface
here as a non-lockfile `epic-merge-conflict` (landEpicToMaster auto-resolves only
lockfile-only conflicts, line 1228-1230; a node_modules-symlink conflict is non-lockfile →
`conflict:true`), so this single hook captures both merge and node_modules conflicts; the
`reason` field distinguishes them.

## Testing

Add `src/services/__tests__/friction-watch.test.ts` (bun:test, mirrors
`friction-store.test.ts` setup with a temp project dir):
- **dedup edge**: build a fake `wm` (or stub `listUnlandedEpics`) returning ≥threshold;
  run pass twice → exactly ONE `unlanded-epics-over-threshold` note; drop below threshold,
  run, raise again → a SECOND note (edge re-fires).
- **stale worktree**: stub `listStaleWorktrees` returning one entry → one `stale-worktree`
  note; re-run with same identity → no new note; new path → new note.
- `friction-store.test.ts`: extend with `getWatchState`/`setWatchState` round-trip +
  upsert.
- Inject the stubbed manager by exporting the pass with an optional `wm` override
  param (`runFrictionWatchPass(project, wm = getWorktreeManager(project))`) so the test
  needn't touch a real git repo — keeps it deterministic.

Run: `npm run test:ci -- friction-watch friction-store`.

## Non-goals / notes

- No LLM anywhere; all detectors are pure git/SQLite reads.
- `listStaleWorktrees` does NOT prune/remove — read-only detection only.
- Dedup state grows by one row per distinct stale-worktree path; acceptable (bounded by
  real worktree count). A "cleared" sweep for vanished worktrees is a future nicety, not
  in scope.
- The friction-watch pass runs for WATCHED projects regardless of orchestrator level,
  matching the notify pass — operational friction must be captured even when autonomous
  building is off.

```json
{ "schemaVersion": 1, "estimatedFiles": 5, "estimatedTasks": 5,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/friction-watch.ts", "src/services/__tests__/friction-watch.test.ts"],
  "filesToEdit": ["src/services/friction-store.ts", "src/agent/worktree-manager.ts", "src/services/orchestrator-live.ts", "src/services/coordinator-live.ts"],
  "tasks": [
    { "id": "friction-store-watch-state", "files": ["src/services/friction-store.ts", "src/services/__tests__/friction-store.test.ts"], "description": "Add friction_watch_state KV table + getWatchState/setWatchState helpers" },
    { "id": "worktree-list-stale", "files": ["src/agent/worktree-manager.ts"], "description": "Add listStaleWorktrees() — porcelain parse, branch-gone/prunable/age detection" },
    { "id": "friction-watch-service", "files": ["src/services/friction-watch.ts", "src/services/__tests__/friction-watch.test.ts"], "description": "Create runFrictionWatchPass: unlanded-threshold + stale-worktree detectors, deduped on edges" },
    { "id": "orchestrator-wire", "files": ["src/services/orchestrator-live.ts"], "description": "Run runFrictionWatchPass for watched projects (timeout-guarded, like notify)" },
    { "id": "land-conflict-hook", "files": ["src/services/coordinator-live.ts"], "description": "Record land-merge-conflict operational friction at land_epic conflict branch (deduped per epic, reset on land success)" }
  ] }
```
