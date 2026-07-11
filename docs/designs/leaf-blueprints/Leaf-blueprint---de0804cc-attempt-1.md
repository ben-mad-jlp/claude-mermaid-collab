# Blueprint — E1: Process-group kill (track each run's pgid; kill the subprocess tree)

Epic e5acda93. Pairs with E2 (ownership-CAS, already landed `c1e04a4e`/`fd8d7218`) and 05b737fd.

## Goal

Stop zombie runs by killing the **actual subprocess tree**, not just signalling an
in-process abort. Each node CLI (`claude -p` / `grok`) is spawned in its **own process
group**; a process-keyed registry maps `leafId → pid (== pgid)`; on level→off, leaf
drop/hold, and server shutdown we `process.kill(-pgid, SIGTERM)` (SIGKILL escalation;
macOS recursive `pkill -P` fallback). A killed run then flows into **E2's** completion
CAS → `requireInProgress` fails → outcome discarded → no merge/accept, inflight cleared.

## Validated mechanism (spiked against Bun 1.3.6 on darwin)

- A normally-spawned `Bun.spawn` child **shares the server's PGID** → `process.kill(-pgid)`
  would kill the server. **Confirmed.**
- `Bun.spawn(argv, { detached: true })` makes the child a **process-group leader**
  (`pgid === pid`), `ppid` unchanged. **Confirmed.**
- `process.kill(-pid, 'SIGTERM')` on a detached child kills the whole subtree (the child
  `sh` + its grandchildren) and **leaves the parent (server) alive**. **Confirmed.**
- `detached: true` does **not** break the `stdin` pipe we feed (claude prompt) nor
  `proc.exited` / `proc.kill`. **Confirmed** (`cat` round-trips stdin→stdout under detached).

So the mechanism is: **spawn detached → record `proc.pid` (which is the pgid) → kill the
negative pgid.** No `setsid` needed (macOS lacks it). `pkill -P` is only a best-effort
mop-up for a grandchild that re-`setpgid`'d out of the group.

---

## Files

### CREATE `src/agent/run-registry.ts` (new, zero-import seam — mirrors `orchestrator-kick.ts`)

A tiny standalone module (imports NOTHING from the codebase, only `Bun`/`process`) so it is
safe to import from any layer (node-invoker, todo-store, orchestrator-config, server)
without cycles. In-process only (a pgid is meaningful only in the spawning process). All
functions best-effort, never throw into callers.

```ts
export interface RunHandle {
  /** pgid (== pid) of a detached subprocess run. Absent for the in-process (xAI-API) lane. */
  pid?: number;
  /** In-process abort lane (xAI-API fetch loop). Absent for subprocess runs. */
  controller?: AbortController;
  /** For project-scoped kills (level→off). */
  project?: string;
  epicId?: string | null;
}

const runs = new Map<string, RunHandle>();           // leafId → handle
const GRACE_MS = 3_000;                               // SIGTERM → SIGKILL escalation

export function registerRun(leafId: string | undefined, h: RunHandle): void { if (leafId) runs.set(leafId, h); }
export function unregisterRun(leafId: string | undefined): void { if (leafId) runs.delete(leafId); }
export function inflightRunIds(): string[] { return [...runs.keys()]; }   // test/telemetry

/** Best-effort kill of ONE run's subprocess tree (+ in-process abort) and de-register it. */
export function killRun(leafId: string, reason = 'killed'): boolean {
  const h = runs.get(leafId);
  if (!h) return false;
  runs.delete(leafId);
  try { h.controller?.abort(new Error(`run killed: ${reason}`)); } catch { /* */ }
  if (h.pid && h.pid > 1) killTree(h.pid, reason);
  return true;
}

/** Kill every run launched for `project` (level→off). */
export function killRunsForProject(project: string, reason = 'level-off'): number {
  let n = 0;
  for (const [leafId, h] of [...runs.entries()]) if (h.project === project) { if (killRun(leafId, reason)) n++; }
  return n;
}

/** Kill every run (server shutdown). */
export function killAllRuns(reason = 'shutdown'): number {
  let n = 0;
  for (const leafId of [...runs.keys()]) if (killRun(leafId, reason)) n++;
  return n;
}

function killTree(pgid: number, reason: string): void {
  // 1) negative-pgid SIGTERM (the detached child is a group leader → kills the whole group).
  try { process.kill(-pgid, 'SIGTERM'); } catch { /* group already gone */ }
  // 2) macOS mop-up: a grandchild that re-setpgid'd escapes the group. pkill -P walks
  //    direct children of the leader pid; best-effort, accepted local-tool limitation.
  try { Bun.spawn(['pkill', '-TERM', '-P', String(pgid)], { stdout: 'ignore', stderr: 'ignore' }); } catch { /* */ }
  // 3) escalation: if anything survives the grace window, SIGKILL the group.
  const t = setTimeout(() => {
    try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
    try { Bun.spawn(['pkill', '-KILL', '-P', String(pgid)], { stdout: 'ignore', stderr: 'ignore' }); } catch { /* */ }
  }, GRACE_MS);
  t.unref?.(); // never keep the process alive (esp. at shutdown)
}
```

Notes:
- `process.kill(-pgid)` requires a real group leader; guaranteed because the spawns below
  pass `detached: true`. Guard `pid > 1` so we never signal pid 0 / -1 (the
  whole-process-group / every-process footguns).

### EDIT `src/agent/node-invoker.ts` — spawn detached + register/unregister (BOTH invokers)

Import: `import { registerRun, unregisterRun } from './run-registry';`

Add an optional project field to `NodeSpec` (≈ line 83, near `leafId`/`epicId`) so the
project-scoped level→off kill can find the run (`spec.cwd` is the worktree, not the
tracking project, so it can't be derived):
```ts
/** Tracking-project path for run-registry project-scoped kills (level→off). Optional. */
project?: string;
```

**`invokeNode`** (claude) — at the existing `Bun.spawn` (≈ line 462) add `detached: true`:
```ts
proc = Bun.spawn(argv, {
  cwd: spec.cwd,
  stdin: new TextEncoder().encode(spec.prompt),
  stdout: 'pipe',
  stderr: 'pipe',
  detached: true,                 // E1: own process group → killable subtree (pgid === proc.pid)
  env: worktreeSpawnEnv(spec.cwd),
});
```
Immediately after the successful spawn:
```ts
registerRun(spec.leafId, { pid: proc.pid, project: spec.project, epicId: spec.epicId });
```
Unregister after the bounded collection — BOTH the timed-out and normal paths flow through
`const exitCode = await capped(proc.exited, -1);` (≈ line 515) before returning. Insert
after the `clearTimeout` calls, before `const durationMs`:
```ts
unregisterRun(spec.leafId);
```
(The early spawn-failure `catch` return is before `registerRun`, so it needs no unregister.)

**`invokeGrokNode`** (grok) — identical: add `detached: true` to its `Bun.spawn`
(≈ line 923); `registerRun(spec.leafId, { pid: proc.pid, project: spec.project, epicId: spec.epicId })`
right after; `unregisterRun(spec.leafId)` after `const exitCode = await capped(proc.exited, -1);`
(≈ line 969). The `existsSync(spec.cwd)` early-return and the spawn-`catch` early returns
are all before `registerRun`, so no unregister is needed there.

### EDIT `src/agent/xai-api-invoker.ts` — in-process AbortSignal lane

The xAI-API node is an in-process `fetch` loop (no subprocess), so the pgid kill cannot
reach it. Give it the "thin AbortSignal" path the spec calls for.

Import: `import { registerRun, unregisterRun } from './run-registry';`

In `invokeXaiApiNode` (≈ line 161): create an `AbortController`, register it, OR it into
the existing fetch abort signal (≈ line 181, currently `AbortSignal.timeout(timeoutMs)`),
unregister in `finally`:
```ts
const ctrl = new AbortController();
registerRun(spec.leafId, { controller: ctrl, project: spec.project, epicId: spec.epicId });
try {
  // ...the existing read-only loop; in the fetch options replace
  //   AbortSignal.timeout(timeoutMs)
  // with
  //   AbortSignal.any([AbortSignal.timeout(timeoutMs), ctrl.signal])
  // (keep the existing option key — confirm whether it is `signal:` or `abortSignal:`).
} finally {
  unregisterRun(spec.leafId);
}
```
The existing aborted-detection (`e.name === 'AbortError'`, ≈ line 216) already maps an
abort to `ok:false` → "killed run produced no acceptance", which E2 then discards. No new
outcome shape needed.

### EDIT `src/services/orchestrator-config.ts` — kill on level→off (single chokepoint)

`setOrchestratorLevel` (≈ line 157) is the SOLE write for the level, reached by the route
POST handler, the MCP `orchestrator_off` kill-switch (via `orchestratorOff`, ≈ line 366),
the unwatched-auto-off sweep, and `forceAllOff`. Hook the kill here so every off-path is
covered with one edit:
```ts
import { killRunsForProject } from '../agent/run-registry';

export function setOrchestratorLevel(project: string, level: OrchestratorLevel): void {
  // ...existing persistence...
  if (level === 'off') {
    try { killRunsForProject(project, 'level-off'); } catch { /* best-effort brake */ }
  }
}
```
Idempotent: an already-off project with no live runs → no-op. (services → agent is the
normal import direction; run-registry has zero deps → no cycle.)

### EDIT `src/services/todo-store.ts` — kill on leaf drop / hold

Import: `import { killRun } from '../agent/run-registry';` (zero-cycle).

In `updateTodo`, after the row UPDATE and the existing kick logic (≈ line 842–878):

- **Hold** (heldAt null→non-null — the hold input edge, mirror of the `unheld` kick at
  line 848):
  ```ts
  if (existing.heldAt == null && heldAt != null) {
    try { killRun(id, 'held'); } catch { /* best-effort */ }
  }
  ```
- **Drop** (transition INTO `dropped`) — inside the existing
  `if (nowTerminal && !wasTerminal)` block (line 858), when `status === 'dropped'`:
  ```ts
  try { killRun(id, 'dropped'); } catch { /* best-effort */ }
  ```
- **Cascade drop** (EPIC close drops every descendant via the recursive SQL at line
  866–876): the recursive `UPDATE` doesn't return the dropped ids. Before that UPDATE,
  `SELECT` the descendant ids (reusing the same recursion) and `killRun` each:
  ```ts
  try {
    const kids = db.prepare(
      `WITH RECURSIVE descendants(did) AS (
         SELECT id FROM todos WHERE parentId = ?1
         UNION SELECT t.id FROM todos t JOIN descendants ON t.parentId = descendants.did)
       SELECT did FROM descendants`).all(id) as Array<{ did: string }>;
    for (const k of kids) killRun(k.did, 'epic-dropped');
  } catch { /* best-effort */ }
  ```

Note: this is a defense-in-depth ACTUATOR. The DURABLE guarantee that a killed run
merges/accepts nothing is **E2** (`completeTodo({ requireInProgress: true })` → `skipped`
→ no merge, `clearLeafInflight`). `killRun` just makes the still-running subprocess stop
burning budget/tokens promptly; ordering relative to the status write is not
safety-critical because E2 is the gate.

### EDIT `src/server.ts` — kill all runs on shutdown

Import `killAllRuns` from `./agent/run-registry`. Call it inside BOTH the SIGINT (≈ line
719) and SIGTERM (≈ line 736) handlers, in the `.finally(() => { ... })` block next to
`ptyManager.killAll();`, before `process.exit(0)`:
```ts
try { killAllRuns('shutdown'); } catch { /* best-effort */ }
```

### CREATE `src/agent/__tests__/run-registry.test.ts`

- **detached subtree dies within a tick**: `const p = Bun.spawn(['sh','-c','sleep 30 & sleep 30 & wait'], { detached: true, stdout:'pipe' })`;
  `registerRun('leaf-x', { pid: p.pid, project: '/proj' })`; assert `inflightRunIds()`
  contains it; `killRun('leaf-x')`; after a short delay assert `pgrep -P p.pid`
  (`Bun.spawnSync(['pgrep','-P',String(p.pid)]).stdout.toString().trim()`) is empty, the
  test process is still alive, and `inflightRunIds()` is empty. (Mirrors the spike above.)
- **project-scoped**: register two runs under different projects; `killRunsForProject('/a')`
  removes only `/a`'s and returns 1.
- **killAllRuns** empties the map and returns the count.
- **in-process lane**: register a run with only a `controller`; `killRun` aborts it
  (`controller.signal.aborted === true`) and de-registers.
- **idempotent**: `killRun('absent')` → `false`; double-kill → second call `false`.

Real-subprocess assertions only; generous timeouts. These are `bun:test` files (backend
dual-runner picks them up — see CLAUDE.md).

---

## Acceptance (from the task)

- `tsc` clean (`npx tsc --noEmit -p tsconfig.json` from repo root).
- Tests: dropping/holding a leaf or setting level off kills its subprocess group within a
  tick (run-registry test proves the kill primitive; the wiring edits route drop/hold/off
  to it); a killed run merges/accepts NOTHING — guaranteed by E2's `requireInProgress`
  CAS (already landed + tested in `todo-store.test.ts`), which this leaf depends on;
  registry empties (`unregisterRun` on every node-finish + `killRun` deletes on kill).

## Dependency / ordering note

E1 depends on **E2**: the negative-pgid kill is safe ONLY because a killed-but-still-
finishing run hits `completeTodo({ requireInProgress: true })` → `skipped` (the todo is no
longer `in_progress` after drop/hold/re-claim) → 0-row no-op → no merge-back, no accept,
inflight cleared (`coordinator-live.ts` continuation, `c1e04a4e`). E1 adds the actuator
(stop the process tree) and the registry; E2 is the catcher. Keep the thin AbortSignal for
the in-process xAI lane, but the pgid kill is the primary mechanism.

```json
{ "schemaVersion": 1, "estimatedFiles": 7, "estimatedTasks": 6,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/agent/run-registry.ts", "src/agent/__tests__/run-registry.test.ts"],
  "filesToEdit": ["src/agent/node-invoker.ts", "src/agent/xai-api-invoker.ts", "src/services/orchestrator-config.ts", "src/services/todo-store.ts", "src/server.ts"],
  "tasks": [
    { "id": "run-registry", "files": ["src/agent/run-registry.ts"], "description": "New zero-dep registry: register/unregister/killRun/killRunsForProject/killAllRuns with negative-pgid SIGTERM→SIGKILL + pkill -P mop-up." },
    { "id": "spawn-detached", "files": ["src/agent/node-invoker.ts"], "description": "Spawn claude & grok with detached:true; add NodeSpec.project; register pid on spawn, unregister after collection in both invokers." },
    { "id": "xai-abort", "files": ["src/agent/xai-api-invoker.ts"], "description": "In-process lane: register an AbortController, OR it into the fetch signal, unregister in finally." },
    { "id": "level-off-kill", "files": ["src/services/orchestrator-config.ts"], "description": "setOrchestratorLevel: killRunsForProject(project) when level==='off' (single chokepoint covering route/MCP/sweep/forceAllOff)." },
    { "id": "drop-hold-kill", "files": ["src/services/todo-store.ts"], "description": "updateTodo: killRun(id) on hold (heldAt null→set) and on drop (→dropped), plus killRun per descendant on EPIC cascade-drop." },
    { "id": "shutdown-kill-and-tests", "files": ["src/server.ts", "src/agent/__tests__/run-registry.test.ts"], "description": "killAllRuns in SIGINT/SIGTERM handlers; run-registry tests proving subtree death within a tick + registry empties." }
  ] }
```
