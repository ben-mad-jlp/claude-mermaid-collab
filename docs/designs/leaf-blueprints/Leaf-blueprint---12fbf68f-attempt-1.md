A complete, accurate blueprint already exists at the target path (line numbers are marginally stale — actual `forwardIntegrateEpic` is at worktree-manager.ts:1135, `ensureEpic` at 1029, `ForwardIntegrateResult` at ~95 — but the symbols, contracts, and change shape are all verified correct). It needs no changes. Emitting it verbatim as required:

# Blueprint — L2: `revalidateStaleEpic()` forward-integrate + re-run gate

## Goal

Add ONE pure-orchestration function `revalidateStaleEpic(project, epicId, baseRef)`
that, for an epic L1 has flagged stale, (1) forward-integrates trunk into the epic
accumulation branch and (2) re-runs the project's acceptance gate **in the epic
worktree**, returning a machine-checkable verdict the land path (L3) consumes.

It composes EXISTING primitives only — no new git plumbing, no new test runner.

## Where it lives — decision

Put it in **`src/services/coordinator-live.ts`**, exported, immediately **above
`landEpic`** (currently line 1294). That file already imports every primitive the
function needs and is where the land caller (L3) lives:

- `getWorktreeManager(project)` → `WorktreeManager` (has `forwardIntegrateEpic`, `ensureEpic`)
- `runRegistryGate` (line 25) — the authoritative gate runner
- `loadProjectManifest` (line 24)
- `execAsync` (line 89) — already shaped as a `GateExec` (`(cmd, {cwd,capture}) => {code,stdout,stderr}`)
- `getTodo` (line 3), `resolveEpicId` (in-file)

Putting it on `WorktreeManager` (src/agent) is REJECTED: that class is gate-runner-free
and lives in the domain-free agent layer; pulling `runRegistryGate`/manifest into it
would invert the dependency direction. Keep gate orchestration in the service layer.

## Existing primitives (verified)

### `WorktreeManager.forwardIntegrateEpic(epicId, baseRef='master', opts?)` — worktree-manager.ts:1015
Returns `ForwardIntegrateResult` (worktree-manager.ts:94):
```ts
{ integrated: boolean; advanced: boolean; conflict: boolean;
  skippedReason?: string; conflictedPaths?: string[] }
```
- `conflict===true` → epic branch UNTOUCHED (merge aborted), `conflictedPaths` populated.
- already-up-to-date or clean merge → `integrated:true` (`advanced` distinguishes no-op vs merged).
- `skippedReason` set for non-git / trunk-missing / dirty epic worktree (NOT a conflict).

### `WorktreeManager.ensureEpic(epicId)` — worktree-manager.ts:909
Idempotent; returns the epic accumulation worktree record `{ path, ... }` (or null on
non-git). `epic.path` is the provisioned epic worktree where deps resolve (node_modules
symlinked via `linkNodeModules` at creation; python/other via project gate env). This is
the `cwd` the gate must run in — same path `landEpic` feeds to `validateStewardProof` as
`epicWorktreeCwd` (coordinator-live.ts:1357).

### `runRegistryGate(subject)` — gate-runner.ts:121, returns `GateVerdict | null`
`GateVerdict` (coordinator-daemon.ts:117): `{ passed: boolean; reasons: string[]; metrics?: ... }`.
`GateSubject` (gate-runner.ts:46): `{ project, gateProject, todoId, todo, manifest, exec, laneCwd?, integrationBase? }`.
The project-tier `manifestCommandGatePlugin` (gate-runner.ts:401) runs `manifest.gateCommand`
via `exec(['sh','-c',cmd], { cwd: ctx.laneCwd ?? ctx.gateProject, capture:true })` — the
**f27d5e91 / 944408c2 `laneCwd ?? gateProject` cwd rule**. So setting `laneCwd = epic.path`
makes the gate run IN THE EPIC WORKTREE. `null` = no applicable gate plugin (no manifest
gateCommand) → honor prior no-gate behavior.
- Leave `integrationBase` UNDEFINED: we want the WHOLE epic re-validated (full gate run),
  not change-set scoping. On a red exit the plugin's whole-tree fallback (`fetchChangeSet`
  → `git status` in `laneCwd`) applies harmlessly; a clean exit short-circuits before it.

### L1 coordination — `StalenessResult` (worktree-manager.ts:122)
`epicBuildBaseStaleness(epicId, baseRef, {maxAhead?})` returns `{ stale, reason, commitsAhead, ... }`.
`revalidateStaleEpic` is the L2 RESPONSE that runs only when `stale===true`. It does NOT
re-check staleness itself (no duplicated logic) — the L3 caller gates on L1, then calls L2.

## The change shape

### 1. Result type + injectable deps (new, exported, in coordinator-live.ts)

```ts
/** Machine-checkable verdict for the land path (L3): an epic L1 flagged stale was
 *  forward-integrated and re-gated in its accumulation worktree. */
export type RevalidateResult =
  | { ok: true; note?: 'no-gate' }                                  // gate green (or no gate applies)
  | { ok: false; reason: 'forward-integrate-conflict'; conflictedPaths: string[] }
  | { ok: false; reason: 'revalidation-gate-failed'; output: string }
  | { ok: false; reason: 'non-git' | 'epic-missing' };             // could not provision/integrate

/** Seam for testing: stub forwardIntegrate + the gate without real git. Defaults
 *  bind to the live WorktreeManager + runRegistryGate for `project`. */
export interface RevalidateDeps {
  forwardIntegrate(epicId: string, baseRef: string): Promise<ForwardIntegrateResult>;
  ensureEpicPath(epicId: string): Promise<string | null>;
  runGate(subject: GateSubject): Promise<GateVerdict | null>;
  manifest: ProjectManifest | null;
  getEpicTodo(epicId: string): Todo | null;
  exec: GateExec;
}
```
Add imports as needed: `ForwardIntegrateResult` (from `../agent/worktree-manager`),
`GateSubject`/`GateExec` (from `./gate-runner` — currently only `runRegistryGate` is
imported; widen the import), `ProjectManifest` (from `../config/project-manifest`).
`GateVerdict` + `Todo` are already imported.

### 2. The function (new, exported)

```ts
export async function revalidateStaleEpic(
  project: string,
  epicId: string,
  baseRef: string = 'master',
  deps?: Partial<RevalidateDeps>,
): Promise<RevalidateResult> {
  const wm = getWorktreeManager(project);
  const d: RevalidateDeps = {
    forwardIntegrate: (e, b) => wm.forwardIntegrateEpic(e, b),
    ensureEpicPath: async (e) => (await wm.ensureEpic(e).catch(() => null))?.path ?? null,
    runGate: runRegistryGate,
    manifest: loadProjectManifest(project),
    getEpicTodo: (e) => getTodo(project, e),
    exec: execAsync,
    ...deps,
  };

  // 1. Forward-integrate trunk INTO the epic branch.
  const fi = await d.forwardIntegrate(epicId, baseRef);
  if (fi.conflict) {
    return { ok: false, reason: 'forward-integrate-conflict', conflictedPaths: fi.conflictedPaths ?? [] };
  }
  // skippedReason (non-git / trunk-missing / dirty) is NOT a conflict — proceed to gate
  // on the current epic tip (no worse than today; matches forwardIntegrate's own contract).

  // 2. Resolve the epic worktree (where deps resolve) + re-run the gate THERE.
  const epicPath = await d.ensureEpicPath(epicId);
  if (!epicPath) return { ok: false, reason: 'epic-missing' };

  const verdict = await d.runGate({
    project,
    gateProject: project,
    todoId: epicId,
    todo: d.getEpicTodo(epicId),
    manifest: d.manifest,
    exec: d.exec,
    laneCwd: epicPath,        // ← runs the manifest gateCommand IN the epic worktree (f27d5e91 rule)
    // integrationBase intentionally omitted: re-validate the FULL epic, not a change-set.
  });

  // 3. Verdict → machine-checkable result.
  if (verdict === null) return { ok: true, note: 'no-gate' };   // no applicable gate — honor self-report
  if (verdict.passed) return { ok: true };
  return { ok: false, reason: 'revalidation-gate-failed', output: (verdict.reasons ?? []).join('\n') };
}
```

Notes:
- **No new build machinery / no teardown needed**: `forwardIntegrateEpic` already
  aborts+restores on conflict; `ensureEpic` is idempotent and owns the shared epic
  worktree (do NOT remove it). There is no private temp state to tear down here.
- **Cross-project**: L3 passes the TARGET project (`child.targetProject ?? project`,
  as `landEpic` resolves at coordinator-live.ts:1306-1308) as `project`. Document this
  in the doc-comment; the function keys `gateProject = project` accordingly.
- Keep it ONE coherent function + its types. Do not modify `landEpic` (L3 wires it).

### 3. Test (new) — `src/services/__tests__/revalidate-stale-epic.test.ts`

Run with `bun test src/services/__tests__/revalidate-stale-epic.test.ts`. Pure unit test
via the `deps` seam — NO real git, NO sidecar. Pattern mirrors existing
`gate-runner-cwd.test.ts` / `coordinator-gate-crossproject.test.ts` (bun:test).

```ts
import { describe, test, expect } from 'bun:test';
import { revalidateStaleEpic, type RevalidateDeps } from '../coordinator-live';

const base = (over: Partial<RevalidateDeps>): Partial<RevalidateDeps> => ({
  ensureEpicPath: async () => '/tmp/epic-wt',
  getEpicTodo: () => null,
  manifest: { gateCommand: 'noop' } as any,
  exec: async () => ({ code: 0, stdout: '', stderr: '' }),
  ...over,
});

describe('revalidateStaleEpic', () => {
  test('forward-integrate conflict → ok:false forward-integrate-conflict', async () => {
    const r = await revalidateStaleEpic('proj', 'epic1', 'master', base({
      forwardIntegrate: async () => ({ integrated: false, advanced: false, conflict: true, conflictedPaths: ['a.ts'] }),
      runGate: async () => { throw new Error('gate must not run on conflict'); },
    }));
    expect(r).toEqual({ ok: false, reason: 'forward-integrate-conflict', conflictedPaths: ['a.ts'] });
  });

  test('gate red → ok:false revalidation-gate-failed', async () => {
    const r = await revalidateStaleEpic('proj', 'epic1', 'master', base({
      forwardIntegrate: async () => ({ integrated: true, advanced: true, conflict: false }),
      runGate: async () => ({ passed: false, reasons: ['tsc error X'] }),
    }));
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('revalidation-gate-failed');
    expect((r as any).output).toContain('tsc error X');
  });

  test('gate green → ok:true', async () => {
    let gateCwd: string | undefined;
    const r = await revalidateStaleEpic('proj', 'epic1', 'master', base({
      forwardIntegrate: async () => ({ integrated: true, advanced: false, conflict: false }),
      runGate: async (s) => { gateCwd = s.laneCwd; return { passed: true, reasons: [] }; },
    }));
    expect(r).toEqual({ ok: true });
    expect(gateCwd).toBe('/tmp/epic-wt');   // gate ran IN the epic worktree
  });
});
```

The third assertion (`laneCwd === epic worktree path`) pins the core contract — the gate
runs in the epic worktree, not the main checkout.

## Acceptance

1. `npx tsc --noEmit` clean (the project `gateCommand`).
2. `bun test src/services/__tests__/revalidate-stale-epic.test.ts` — all three cases green:
   conflict→`forward-integrate-conflict`; gate-red→`revalidation-gate-failed`; gate-green→`ok:true`.

## Risk / boundaries

- Export `RevalidateDeps`, `RevalidateResult`, `revalidateStaleEpic`. Widen the
  `./gate-runner` import to also bring `GateSubject`, `GateExec`. Add `ForwardIntegrateResult`
  + `ProjectManifest` type imports. No runtime/behavior change to existing exports.
- Coordinate with L1 (`StalenessResult`): L2 is the response, called only when `stale`.
  L3 wires `epicBuildBaseStaleness` → (if stale) `revalidateStaleEpic` → land.

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/__tests__/revalidate-stale-epic.test.ts"],
  "filesToEdit": ["src/services/coordinator-live.ts"],
  "tasks": [
    { "id": "revalidate-fn", "files": ["src/services/coordinator-live.ts"], "description": "Add RevalidateResult/RevalidateDeps types + exported revalidateStaleEpic(project,epicId,baseRef,deps?) above landEpic; widen gate-runner import for GateSubject/GateExec; orchestrate forwardIntegrateEpic→ensureEpic→runRegistryGate(laneCwd=epic.path)." },
    { "id": "revalidate-test", "files": ["src/services/__tests__/revalidate-stale-epic.test.ts"], "description": "bun:test unit using the deps seam asserting conflict→forward-integrate-conflict, gate-red→revalidation-gate-failed, gate-green→ok:true (+laneCwd=epic worktree)." }
  ] }
```