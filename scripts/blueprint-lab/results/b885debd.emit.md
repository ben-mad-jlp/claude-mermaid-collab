I have everything I need. Here is the implementation blueprint.

## Blueprint: prune stale post-land worktrees so fully-on-master branches GC

### Problem
`gcEpicBranches` (`src/services/landed-epic-sweep.ts`) deletes a fully-on-master branch via `runner.deleteBranch(branch)` → `git branch -D`. That command **fails** when the branch is checked out in a worktree — which is exactly the state of the 9 landed epics: each branch is still bound to a stale `.collab/agent-sessions/worktrees/__epic-*__` worktree. So `deleteBranch` returns false, the branch is counted `skipped`, and it survives every sweep.

### Fix shape
Add an **optional** `pruneWorktreeFor(branch)` method to `BranchGcRunner` that removes the branch's worktree with plain `git worktree remove` (**no `--force`**). Git refuses to remove a worktree with uncommitted changes, so an active build or an ahead>0 epic is preserved and its branch stays undeleted — only stale, clean, fully-on-master worktrees are freed, after which `git branch -D` succeeds. Call it immediately before `deleteBranch` in **both** the live-epic pass and the orphan pass. Guard with `?.` since injected mocks may omit it.

### Changes

**1. `src/services/landed-epic-sweep.ts` — extend the `BranchGcRunner` interface** (after `aheadCount`, ~line 98):
```ts
  /** Remove the worktree currently holding `branch` via `git worktree remove` WITHOUT
   *  --force, so a dirty worktree (active build, or an ahead>0 epic) is preserved and its
   *  branch stays checked-out (and thus undeleted). Best-effort/no-op when no worktree holds
   *  the branch. Optional: injected test mocks may omit it. */
  pruneWorktreeFor?(branch: string): void;
```

**2. `src/services/landed-epic-sweep.ts` — implement it in `makeBranchGcRunner`** (add a method to the returned object, ~after `aheadCount`, line 137):
```ts
    pruneWorktreeFor(branch: string): void {
      const list = runGitLocal(project, ['worktree', 'list', '--porcelain']);
      if (list.code !== 0) return;
      let curPath: string | null = null;
      for (const line of list.stdout.split('\n')) {
        if (line.startsWith('worktree ')) curPath = line.slice('worktree '.length).trim();
        else if (line.startsWith('branch ')) {
          if (line.slice('branch '.length).trim() === `refs/heads/${branch}` && curPath) {
            runGitLocal(project, ['worktree', 'remove', curPath]); // no --force: dirty worktree preserved
          }
        } else if (line === '') curPath = null;
      }
    },
```
(`git worktree list --porcelain` emits blank-line-separated blocks, each with a `worktree <path>` line and, for a branch-bound tree, a `branch refs/heads/<name>` line — same parse shape already used in `leaf-worktree-reaper.ts:201`.)

**3. `src/services/landed-epic-sweep.ts` — call prune before delete in the LIVE-epic loop** (between `revParse` at line 181 and `deleteBranch` at line 183):
```ts
    const tip = runner.revParse(e.branch);
    if (tip == null) { skipped++; continue; }
    runner.pruneWorktreeFor?.(e.branch);
    if (runner.deleteBranch(e.branch)) {
```

**4. `src/services/landed-epic-sweep.ts` — call prune before delete in the ORPHAN loop** (between `revParse` at line 203 and `deleteBranch` at line 204):
```ts
    const tip = runner.revParse(branch);
    if (tip == null) { skipped++; continue; }
    runner.pruneWorktreeFor?.(branch);
    if (runner.deleteBranch(branch)) {
```

**5. `src/services/__tests__/landed-epic-sweep.test.ts` — add prune-before-delete ordering test** inside `describe('gcEpicBranches', …)` (after the existing tests, ~line 169):
```ts
  test('worktree is pruned BEFORE the branch is deleted (prune-before-delete ordering)', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] prune me', kind: 'epic', status: 'planned' });
    const branch = epicBranchName(epic.id);
    const probe: GitProbe = (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true } : { exists: false, ahead: null, behind: null, mergeable: null });
    const calls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => 'abc123',
      deleteBranch: (b) => { calls.push(`delete:${b}`); return true; },
      listEpicBranches: () => [],
      aheadCount: () => 0,
      pruneWorktreeFor: (b) => { calls.push(`prune:${b}`); },
    };

    const result = gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toContain(branch);
    expect(calls).toEqual([`prune:${branch}`, `delete:${branch}`]); // prune strictly precedes delete
  });
```
This lifts the `gcEpicBranches` block from 4 tests to 5; the full file goes 6→7. Existing mocks that omit `pruneWorktreeFor` keep compiling/passing because the field is optional and the calls are `?.`-guarded.

### Notes
- No change to the fail-closed rule: prune runs only on the ahead===0 path (after the `ahead !== 0` flag-and-continue and after `revParse`), so an ahead>0 or probe-error branch is never touched.
- Recovery-log semantics unchanged: tip is captured via `revParse` before the prune, and the log is still written only on a successful `deleteBranch`.
- No worker/coordinator wiring change — `makeBranchGcRunner` is the default runner already threaded through `runLandedEpicSweep`, so the live sweep picks up the new method automatically.

### Acceptance criteria (positive, citable)
1. `BranchGcRunner` interface in `src/services/landed-epic-sweep.ts` declares `pruneWorktreeFor?(branch: string): void;`.
2. `makeBranchGcRunner` in `src/services/landed-epic-sweep.ts` returns an object whose `pruneWorktreeFor` runs `git worktree list --porcelain`, matches `refs/heads/<branch>`, and calls `git worktree remove <path>` **without** `--force`.
3. The live-epic loop in `gcEpicBranches` calls `runner.pruneWorktreeFor?.(e.branch)` on the line directly before `runner.deleteBranch(e.branch)`.
4. The orphan loop in `gcEpicBranches` calls `runner.pruneWorktreeFor?.(branch)` on the line directly before `runner.deleteBranch(branch)`.
5. New test `worktree is pruned BEFORE the branch is deleted (prune-before-delete ordering)` in `landed-epic-sweep.test.ts` asserts `calls` equals `['prune:<branch>', 'delete:<branch>']`.
6. `tsc` is clean and the `landed-epic-sweep.test.ts` suite is 7/7 green.

```json
{ "schemaVersion": 2, "estimatedFiles": 2, "estimatedTasks": 3,
  "nonEnumerableFanout": false, "filesToCreate": [], "filesToEdit": ["src/services/landed-epic-sweep.ts", "src/services/__tests__/landed-epic-sweep.test.ts"],
  "tasks": [
    { "id": "runner-prune-method", "files": ["src/services/landed-epic-sweep.ts"], "description": "Add optional pruneWorktreeFor to BranchGcRunner interface and implement it in makeBranchGcRunner via `git worktree remove` (no --force)" },
    { "id": "call-prune-before-delete", "files": ["src/services/landed-epic-sweep.ts"], "description": "Call runner.pruneWorktreeFor?.(branch) immediately before deleteBranch in both the live-epic and orphan loops of gcEpicBranches" },
    { "id": "ordering-test", "files": ["src/services/__tests__/landed-epic-sweep.test.ts"], "description": "Add prune-before-delete ordering test asserting calls === ['prune:<branch>','delete:<branch>']" }
  ],
  "leafKind": "fix",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/landed-epic-sweep.ts", "symbol": "pruneWorktreeFor", "description": "optional worktree-prune method on BranchGcRunner, implemented in makeBranchGcRunner and invoked before each deleteBranch" },
    { "kind": "named-test", "testFile": "src/services/__tests__/landed-epic-sweep.test.ts", "testName": "worktree is pruned BEFORE the branch is deleted (prune-before-delete ordering)", "mechanical": true }
  ],
  "outOfScope": ["changing the ahead>0 / probe-error fail-closed rules", "recovery-log format changes", "coordinator/worker wiring beyond the default runner", "real-repo integration test of git worktree remove"] }
```