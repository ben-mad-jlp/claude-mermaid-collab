# Blueprint — L1: `epicBuildBaseStaleness()` pure-git staleness detector

## Goal
Add an exported, **pure-read** git staleness detector to `WorktreeManager` that reports
whether an epic's accumulation branch has drifted dangerously behind trunk. No merge, no
land, no mutation. Mirrors the existing read-only detectors (`epicBehindBase`,
`epicAheadOfMaster`, `listUnlandedEpics`) in shape and never-throw discipline.

## Files to touch
- **Edit** `src/agent/worktree-manager.ts` — add `StalenessResult` interface + `epicBuildBaseStaleness()` method.
- **Create** `src/agent/__tests__/worktree-freshness.test.ts` — hermetic temp-git unit tests.

## Existing primitives to reuse (all already in the class)
- `private async resolveBase(baseRef: string): Promise<string>` — line ~891. Maps `master`→detected default on a `main` repo; returns the requested ref when it exists. **Use for trunk.**
- `epicBranchName(epicId: string): string` — line ~720. Returns `collab/epic/<id8>`.
- `private runGit(cwd, args, timeoutMs?, onProgress?): Promise<SpawnResult>` — line ~1675. `SpawnResult = { code, stdout, stderr }`. Always `.catch(() => ({ code: 1, stdout: '', stderr: '' }))` like the siblings.
- `private async isGitRepo(): Promise<boolean>` — line ~1608. Guard at top.
- `QUICK_TIMEOUT_MS` constant (used by every sibling read).
- `this.opts.projectRoot` — the repo root all reads run in.

## Interface (exported, place near `ForwardIntegrateResult`/`LandResult` block ~line 94–130)
```ts
export interface StalenessResult {
  stale: boolean;
  commitsAhead: number;          // trunk commits the epic has NOT integrated
  maxAhead: number;              // the threshold N actually used
  trunkSha: string;              // resolved trunk tip ('' if unresolved)
  epicSha: string;               // epic branch tip ('' if branch missing)
  mergeBase: string;             // '' if no merge-base / branch missing
  overlap: string[];             // files touched on BOTH sides since mergeBase
  reason: 'fresh' | 'ahead-exceeds-max' | 'file-overlap';
}
```

## Method (add alongside the other read-only detectors, e.g. just after `epicAheadOfMaster` ~line 775)
Signature exactly:
```ts
async epicBuildBaseStaleness(
  epicId: string,
  baseRef: string = 'master',
  opts: { maxAhead?: number } = {},
): Promise<StalenessResult> { ... }
```

### Algorithm (every step via `runGit(this.opts.projectRoot, ...)` with `.catch` fallback)
Compute `N` first so it is always present in the fresh-return:
```ts
const N = opts.maxAhead ?? (Number(process.env.MERMAID_LAND_STALE_MAX_AHEAD) || 20);
```
Note: `Number('') || 20` → 20; an unset/blank env var falls through to 20. Keep this exact expression (matches description).

Build a single `fresh` helper for every early-out:
```ts
const fresh: StalenessResult = {
  stale: false, commitsAhead: 0, maxAhead: N,
  trunkSha: '', epicSha: '', mergeBase: '', overlap: [], reason: 'fresh',
};
```

1. `if (!(await this.isGitRepo())) return fresh;`
2. `const trunk = await this.resolveBase(baseRef);`
3. `const epicBranch = this.epicBranchName(epicId);`
4. **Epic branch existence** — `git rev-parse --verify --quiet refs/heads/<epicBranch>` (same form as `resolveBase`). If `code !== 0` or empty stdout → `return fresh;`. Capture `epicSha = stdout.trim()`.
5. **Trunk sha** — `git rev-parse --verify --quiet refs/heads/<trunk>` → `trunkSha`. If it fails → `return fresh;` (best-effort).
6. **mergeBase** — `git merge-base <epicBranch> <trunk>`. If `code !== 0` or empty → `return fresh;`. `const mergeBase = stdout.trim();`
7. **commitsAhead** — `git rev-list --count <epicBranch>..<trunk>` → `parseInt(stdout.trim() || '0', 10) || 0`. (Trunk commits not yet in the epic.)
8. **trunkChangedFiles** — `git diff --name-only <mergeBase>..<trunk>` → split on `\n`, trim, filter Boolean.
9. **epicChangedFiles** — `git diff --name-only <mergeBase>..<epicBranch>` → same parse.
10. **overlap** — intersection: build `const epicSet = new Set(epicChangedFiles); const overlap = trunkChangedFiles.filter(f => epicSet.has(f));`
11. **Decision**:
```ts
const overlapHit = overlap.length > 0;
const aheadHit = commitsAhead > N;
const stale = commitsAhead > 0 && (aheadHit || overlapHit);
const reason: StalenessResult['reason'] =
  !stale ? 'fresh' : overlapHit ? 'file-overlap' : 'ahead-exceeds-max';
```
Precedence note: `file-overlap` wins when both conditions hold (overlap is the stronger conflict signal). Acceptance tests only exercise one condition at a time, so either order passes; choose overlap-first.
12. Return the assembled `StalenessResult` with all real values.

### Robustness
- Never `throw`. Every `runGit` call ends in `.catch(() => ({ code: 1, stdout: '', stderr: '' }))`.
- A missing branch, empty merge-base, or non-git repo all funnel to the `fresh` object (with `maxAhead: N` preserved).
- Pure read: only `rev-parse`, `merge-base`, `rev-list`, `diff` — no `merge`/`add`/`commit`/`worktree`.

## Test file — `src/agent/__tests__/worktree-freshness.test.ts`
Follow `worktree-forward-integrate.test.ts` exactly: top-level `runGit` helper (Bun.spawn with the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env), `beforeEach` that `git init -q -b master`, sets user config, makes a `base.txt` commit, and constructs `mgr = new WorktreeManager({ projectRoot: repo, baseDir, persistDir })`. `afterEach` rm's the temp dirs.

Use `mgr.ensureEpic(EPIC, undefined, 'master')` to create the epic accumulation branch (it branches off master's tip). `commitOnMaster(file, content)` helper (copy from forward-integrate test) advances trunk. Use a `const EPIC = 'epic-cccccccc';` (8-char id token).

Helper to advance trunk by K disjoint commits:
```ts
async function commitOnMaster(file, content) { write file in repo; git add -A; git commit -q -m ... }
```

### Cases (each its own `it`)
**(a) epic == trunk → not stale.**
```ts
await mgr.ensureEpic(EPIC, undefined, 'master');
const r = await mgr.epicBuildBaseStaleness(EPIC, 'master');
expect(r.stale).toBe(false);
expect(r.reason).toBe('fresh');
expect(r.commitsAhead).toBe(0);
```

**(b) trunk ahead by 1 commit, DISJOINT file → not stale.**
```ts
await mgr.ensureEpic(EPIC, undefined, 'master');
await commitOnMaster('trunk-only.txt', 'x\n');
const r = await mgr.epicBuildBaseStaleness(EPIC, 'master');
expect(r.commitsAhead).toBe(1);
expect(r.overlap).toEqual([]);
expect(r.stale).toBe(false);
expect(r.reason).toBe('fresh');
```
(Default N=20, no env set, 1 ≤ 20, no overlap.)

**(c) trunk ahead touching an OVERLAPPING file → stale 'file-overlap'.**
Make the epic touch `shared.txt`, then trunk also touch `shared.txt` (different content, after the epic branched — they share `mergeBase` = the original epic fork point). Epic edits go in the epic worktree returned by `ensureEpic` (`epic.path`); commit there with `runGit(epic.path, [...])`.
```ts
const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
// epic side touches shared.txt
await fs.writeFile(path.join(epic!.path, 'shared.txt'), 'epic\n');
await runGit(epic!.path, ['add', '-A']);
await runGit(epic!.path, ['commit', '-q', '-m', 'epic: shared']);
// trunk side touches the SAME file after the fork
await commitOnMaster('shared.txt', 'trunk\n');
const r = await mgr.epicBuildBaseStaleness(EPIC, 'master');
expect(r.commitsAhead).toBe(1);
expect(r.overlap).toContain('shared.txt');
expect(r.stale).toBe(true);
expect(r.reason).toBe('file-overlap');
```

**(d) trunk ahead by > N commits, DISJOINT files → stale 'ahead-exceeds-max'.**
Use `opts.maxAhead` to keep the test fast (don't make 21 commits). Set `maxAhead: 2` and make 3 disjoint trunk commits.
```ts
await mgr.ensureEpic(EPIC, undefined, 'master');
await commitOnMaster('a.txt', '1\n');
await commitOnMaster('b.txt', '2\n');
await commitOnMaster('c.txt', '3\n');
const r = await mgr.epicBuildBaseStaleness(EPIC, 'master', { maxAhead: 2 });
expect(r.commitsAhead).toBe(3);
expect(r.maxAhead).toBe(2);
expect(r.overlap).toEqual([]);
expect(r.stale).toBe(true);
expect(r.reason).toBe('ahead-exceeds-max');
```

(Optional but cheap, add if trivial) **(e) missing epic branch → fresh.**
```ts
const r = await mgr.epicBuildBaseStaleness('epic-deadbeef', 'master');
expect(r.stale).toBe(false);
expect(r.reason).toBe('fresh');
```

## Acceptance
- `bunx tsc --noEmit` (or project's `tsc`) clean — exported interface, typed `reason` union.
- `bun test src/agent/__tests__/worktree-freshness.test.ts` green (cases a–d, plus e if added).

## Notes / gotchas
- `ensureEpic` returns `null` on a non-git fallback; in the temp-git tests it returns a record with `.path`. Use `epic!.path` (non-null assert) as the forward-integrate test does.
- `commitsAhead` counts `epicBranch..trunk` — commits on trunk NOT reachable from the epic. Right-hand side is the trunk in `..` notation; double-check operand order against `epicBehindBase` (line ~747) which uses the identical `${epicBranch}..${trunk}` form — copy it.
- Keep `maxAhead` in the result equal to the resolved `N`, even on the fresh early-returns (callers may read it).
- Do NOT add the method behind `withWorktreeLock` — it's a pure read; the siblings (`epicBehindBase`, etc.) take no lock.

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/agent/__tests__/worktree-freshness.test.ts"],
  "filesToEdit": ["src/agent/worktree-manager.ts"],
  "tasks": [
    { "id": "impl-staleness", "files": ["src/agent/worktree-manager.ts"], "description": "Add exported StalenessResult interface + pure-git epicBuildBaseStaleness() method reusing resolveBase/epicBranchName/runGit, never-throw." },
    { "id": "tests-freshness", "files": ["src/agent/__tests__/worktree-freshness.test.ts"], "description": "Hermetic temp-git bun:test covering fresh, disjoint-not-stale, file-overlap, ahead-exceeds-max (and optional missing-branch)." }
  ] }
```
