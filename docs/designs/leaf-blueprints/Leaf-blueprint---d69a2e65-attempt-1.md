# L1: Harden land path — isolated validation (B) + clean-tree guard + allowDirty (A)

## Goal
Two independent hardenings of the LAND path (LAND only — do not touch leaf-start or deploy):

- **(B) Isolated dry-merge validation.** Today `epicMergeClean`'s trial `git merge --no-commit --no-ff` runs with `cwd = masterCwd` — and `masterCwd` is the MAIN checkout (`targetProject`). A trial merge in the live working tree is unsafe. Run it in an ISOLATED detached worktree off master HEAD instead, mirroring the `__land-master__` lifecycle `landEpicToMaster` uses. The main checkout must never be the merge cwd.
- **(A) Clean-tree guard + per-call `allowDirty`.** Before validation+merge, `git status --porcelain` the MAIN checkout. Dirty → REFUSE with a clear error listing dirty paths. Add a per-call `allowDirty` boolean (NOT a persistent flag/env) to `landEpic` + the `land_epic` tool that bypasses the refusal but (1) still prints the dirty paths, (2) appends an `Allow-Dirty: <paths>` trailer to the land commit message, (3) records a friction note (`reason 'land-allow-dirty'`, the epic todoId).

## Files to touch (real symbols)
- `src/services/steward-proof.ts` — `realRunners.epicMergeClean` (currently lines 113–128). (B)
- `src/agent/worktree-manager.ts` — `LandOpts` (81–86), `landEpicToMaster` mergeMessage (1269–1271), + new `dirtyPaths()` method. (A)
- `src/services/coordinator-live.ts` — `landEpic` (1271–1365), `LandEpicOutcome` (1142+). (A)
- `src/mcp/setup.ts` — `land_epic` tool inputSchema (2168) + handler `case 'land_epic'` (3932–3938). (A)

Note: `validateStewardProof` and the `ProofRunners` are SYNCHRONOUS (`execFileSync`). Keep them sync — do NOT introduce async into the proof gate. The isolation for (B) is done synchronously inside the existing sync runner.

---

## (B) Isolated dry-merge — `src/services/steward-proof.ts`

Rewrite `realRunners.epicMergeClean(masterCwd, epicBranch)` so the trial merge runs in a throwaway detached worktree off master HEAD. `masterCwd` is used ONLY as the repo to administer the worktree from (`git -C masterCwd worktree add/remove`); it is NEVER the merge cwd.

Add imports to the existing node imports at the top of the file:
```ts
import { existsSync, mkdtempSync } from 'node:fs';   // add mkdtempSync
import { join } from 'node:path';                      // already present
import { tmpdir } from 'node:os';                      // new
```

New implementation shape (replaces lines 113–128):
```ts
epicMergeClean(masterCwd, epicBranch) {
  // Isolated trial: create a detached worktree pinned at master HEAD and run the
  // dry merge THERE — never in the main checkout (masterCwd). Mirrors the
  // __land-master__ lifecycle (worktree-manager.landEpicToMaster). Setup failure
  // is treated as not-clean (safe-refuse).
  const trial = join(tmpdir(), `collab-land-trial-${process.pid}-${process.hrtime.bigint()}`);
  const sh = (args: string[], cwd: string) =>
    execFileSync('git', ['-C', cwd, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
  const teardown = () => {
    try { execFileSync('git', ['-C', masterCwd, 'worktree', 'remove', '--force', trial], { stdio: 'pipe' }); } catch { /* gone */ }
    try { execFileSync('git', ['-C', masterCwd, 'worktree', 'prune'], { stdio: 'pipe' }); } catch { /* best-effort */ }
  };
  try {
    // Detached worktree off master HEAD (do NOT check out the `master` branch — it is
    // live in the main tree; `git worktree add master` would fail "already checked out").
    execFileSync('git', ['-C', masterCwd, 'worktree', 'add', '--detach', trial, 'master'], { stdio: 'pipe' });
  } catch {
    teardown(); // path may have been partially created
    return false; // cannot set up an isolated trial → refuse (do not fall back to masterCwd)
  }
  try {
    sh(['merge', '--no-commit', '--no-ff', epicBranch], trial);
    // Clean (or already-up-to-date). Abort to leave the trial pristine before teardown.
    try { sh(['merge', '--abort'], trial); } catch { /* nothing to abort */ }
    return true;
  } catch {
    try { sh(['merge', '--abort'], trial); } catch { /* nothing to abort */ }
    return false; // conflict
  } finally {
    teardown();
  }
}
```

Behavior preserved: returns `true` iff the epic branch merges cleanly into master HEAD, `false` on conflict; never commits; master ref + main checkout untouched. The only change is WHERE the merge runs.

Notes:
- `process.hrtime.bigint()` keeps the path unique without `Date.now()`/`Math.random()`.
- `git worktree add` creates `trial`; do not pre-create it.
- The doc-comment on the `ProofRunners.epicMergeClean` field (lines 85–88) should be updated to say the dry-merge runs in an ISOLATED detached worktree off master HEAD, not in `masterCwd` directly.
- No change to `validateStewardProof`, `ProofContext`, the `epic-landable` branch, or any caller wiring — the runner contract `(masterCwd, epicBranch) => boolean` is unchanged.

---

## (A) Clean-tree guard + allowDirty

### A1 — `src/agent/worktree-manager.ts`

**New method** (near `landEpicToMaster`), a read-only porcelain status of the MAIN checkout (`this.opts.projectRoot`):
```ts
/** Uncommitted/untracked paths in the main checkout — the clean-tree guard for LAND.
 *  Empty array === clean. Read-only; never throws. */
async dirtyPaths(): Promise<string[]> {
  if (!(await this.isGitRepo())) return [];
  const res = await this.runGit(this.opts.projectRoot, ['status', '--porcelain'], QUICK_TIMEOUT_MS)
    .catch(() => ({ code: 1, stdout: '', stderr: '' }));
  if (res.code !== 0) return [];
  return res.stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
}
```
(Porcelain lines are `XY <path>`; `slice(3)` drops the 2 status cols + space.)

**`LandOpts`** (81–86): add an optional field
```ts
/** When set, append an `Allow-Dirty: <paths>` trailer to the land commit message
 *  (the operator overrode the clean-tree guard for this land). */
allowDirtyPaths?: string[];
```

**`landEpicToMaster` mergeMessage** (1269–1271): append the trailer when present:
```ts
let mergeMessage =
  `collab: land epic ${this.epicId8(epicId)} → ${baseRef}\n\n` +
  `Collab-Epic: ${epicId}\nCollab-Land: ${epicBranch}`;
if (opts?.allowDirtyPaths && opts.allowDirtyPaths.length > 0) {
  mergeMessage += `\nAllow-Dirty: ${opts.allowDirtyPaths.join(', ')}`;
}
```
(Trailer also flows into the lockfile-resolve `git commit --no-edit` path since that completes the same in-progress merge whose message was set by `-m`.)

### A2 — `src/services/coordinator-live.ts` `landEpic`

**Signature**: add an opts param:
```ts
export async function landEpic(
  project: string,
  escalationId: string,
  opts?: { allowDirty?: boolean },
): Promise<LandEpicOutcome>
```

**`LandEpicOutcome`** (1142+): add optional
```ts
/** Dirty paths in the main checkout when the land was refused (clean-tree guard). */
dirtyPaths?: string[];
```

**Clean-tree guard** — inside `withLandMutex`, AFTER `targetProject`/`wm`/`epicBranch` are known and BEFORE `validateStewardProof` (i.e. at the top of the `try`, ~line 1285). Use the SAME `wm` (its `projectRoot === targetProject`, the MAIN checkout):
```ts
const dirty = await wm.dirtyPaths().catch(() => [] as string[]);
if (dirty.length > 0) {
  if (!opts?.allowDirty) {
    recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'refused', reason: 'dirty-tree', dirtyPaths: dirty }) });
    return {
      ok: false, landed: false, reason: 'dirty-tree', epicId, epicBranch, dirtyPaths: dirty,
      // surfaced verbatim to the caller; the tool layer renders the instruction text.
    };
  }
  // allowDirty: proceed, but make the override loud + durable.
  console.warn(`[land] allowDirty override — main checkout dirty:\n${dirty.map((p) => `  ${p}`).join('\n')}`);
  try {
    await recordFriction(targetProject, {
      layer: 'orchestration',
      retryReason: 'land-allow-dirty',
      todoId: epicId,
      detail: `land of epic ${epicBranch} proceeded over a dirty main checkout (allowDirty). paths: ${dirty.join(', ')}`,
    });
  } catch { /* best-effort */ }
}
```

**Thread the trailer into the real merge** — at the `wm.landEpicToMaster(epicId)` call (line 1318):
```ts
const land = await wm.landEpicToMaster(epicId, dirty.length > 0 && opts?.allowDirty ? { allowDirtyPaths: dirty } : undefined);
```

`recordFriction` is already imported (`src/services/friction-store`, line 64). The refusal message is machine-reason `dirty-tree`; the human-facing instruction ("file a todo for the daemon / EnterWorktree to hand-code / commit / discard") is rendered by the tool description + handler (A3), not baked into the reason string.

Notes:
- The auto-land call site in `sweepEpicRollups` (line 1254, `await landEpic(project, escalation.id)`) is left as-is — autonomous auto-land does NOT pass `allowDirty`, so a dirty tree correctly refuses the auto-land (no override without an explicit operator call). Confirm this site still compiles (new param is optional).

### A3 — `src/mcp/setup.ts` `land_epic` tool

**inputSchema** (line 2168): add property
```jsonc
allowDirty: { type: 'boolean', description: "Bypass the clean-tree guard: land even though the main checkout has uncommitted/untracked changes. The dirty paths are still printed, an `Allow-Dirty: <paths>` trailer is added to the land commit, and an orchestration friction note is recorded. Per-call only — NOT a persistent flag." }
```

**Handler** (3932–3938): plumb it + surface the refusal instruction:
```ts
case 'land_epic': {
  const { project, escalationId, allowDirty } = args as { project: string; escalationId: string; allowDirty?: boolean };
  if (!project || !escalationId) throw new Error('Missing required: project, escalationId');
  const result = await landEpic(project, escalationId, { allowDirty });
  getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
  // Clean-tree refusal: attach the operator instruction alongside the dirty paths.
  const payload = result.reason === 'dirty-tree'
    ? { ...result, instruction: 'Main checkout is dirty. File a todo for the daemon, or EnterWorktree to hand-code, or commit / discard the changes — then re-land. To override for this call, pass allowDirty:true.' }
    : result;
  return JSON.stringify(payload, null, 2);
}
```

Also update the `land_epic` tool `description` (line 2168) to mention the clean-tree guard + `allowDirty` override in one sentence.

---

## Verification
- `npx tsc --noEmit` clean (the project's gate). New `mkdtempSync`/`tmpdir` imports resolve; `LandOpts.allowDirtyPaths`, `LandEpicOutcome.dirtyPaths`, the `landEpic` opts param, and the `dirtyPaths()` method all type-check.
- Reason strings touched: new machine reason `dirty-tree` from `landEpic`; `epicMergeClean` still yields `epic-merge-conflict` via the unchanged proof branch on a real conflict.
- Scope check: no edits to leaf-start or deploy paths. `epicMergeClean` runner contract unchanged; `validateStewardProof` untouched.

## Risks / watch-outs
- `git worktree add --detach <trial> master` from `masterCwd`: detached HEAD at master's tip avoids the "branch already checked out" failure (same trick as `landEpicToMaster`, which pins to `oldBaseSha`). If preferred, resolve the sha first (`git -C masterCwd rev-parse refs/heads/master`) and add detached at that sha — equivalent and matches `landEpicToMaster` exactly.
- Trial worktree lives under `os.tmpdir()`; teardown is in `finally` + a setup-failure path. A crash mid-trial leaves a stale worktree that `git worktree prune` (run on the next trial/land) reaps.
- `dirtyPaths()` reads `this.opts.projectRoot` — verify `getWorktreeManager(targetProject)` sets `projectRoot === targetProject` so the guard inspects the MAIN checkout, not a worktree.

```json
{ "schemaVersion": 1, "estimatedFiles": 4, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/steward-proof.ts", "src/agent/worktree-manager.ts", "src/services/coordinator-live.ts", "src/mcp/setup.ts"],
  "tasks": [
    { "id": "isolated-trial-merge", "files": ["src/services/steward-proof.ts"], "description": "(B) Rewrite realRunners.epicMergeClean to run the dry merge in an isolated detached worktree off master HEAD, never in masterCwd" },
    { "id": "worktree-land-helpers", "files": ["src/agent/worktree-manager.ts"], "description": "(A) Add dirtyPaths() method + LandOpts.allowDirtyPaths + Allow-Dirty trailer in landEpicToMaster mergeMessage" },
    { "id": "landepic-clean-tree-guard", "files": ["src/services/coordinator-live.ts"], "description": "(A) landEpic opts.allowDirty: refuse dirty main checkout (reason dirty-tree + dirtyPaths), else print paths, append trailer, record land-allow-dirty friction" },
    { "id": "land-epic-tool-allowdirty", "files": ["src/mcp/setup.ts"], "description": "(A) Add allowDirty to land_epic inputSchema + handler plumbing + dirty-tree refusal instruction text" }
  ] }
```
