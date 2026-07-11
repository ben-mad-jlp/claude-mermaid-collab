Blueprint written. Full text below.

---

# L3 Blueprint — Tests for the hardened land path

**Leaf:** L3: Tests — dirty-main refusal, allowDirty bypass, validation isolation, worktree todo-resolution
**Depends on:** L1 (the land-path hardening these tests pin)

## Goal

Add **bun** (`bun:test`) per-file tests that lock in the L1 behaviors:

1. `landEpic` REFUSES when the main checkout is dirty; the result lists the dirty paths.
2. `allowDirty:true` bypasses the refusal — the land commit carries an `Allow-Dirty:` trailer, and an orchestration friction note (`retryReason: 'land-allow-dirty'`) is recorded.
3. The dry-merge validation (`epicMergeClean`) runs in an **isolated** detached worktree, never the main checkout — a dirty main does not contaminate validation.
4. `trackingProjectRoot` maps a worktree cwd → tracking repo root (the resolution the L2 interactive-worktree flow depends on), and the todo-store resolves a worktree cwd to the tracking repo's `todos.db`.

These tests are the entire deliverable — **no production code changes**. If a test cannot pass against current `master` behavior, that is an L1 regression to report, not something to "fix" by editing production code from this leaf.

## Code under test (real symbols)

- `src/services/coordinator-live.ts`
  - `landEpic(project, escalationId, opts?: { allowDirty?: boolean })` — lines ~1273-1390.
    - Clean-tree guard: `wm.dirtyPaths()`; if non-empty and `!opts.allowDirty` → returns `{ ok:false, landed:false, reason:'dirty-tree', epicId, epicBranch, dirtyPaths }` (line ~1296-1300) **before** any tsc/dry-merge.
    - `allowDirty` branch (line ~1302-1311) records friction `{ layer:'orchestration', retryReason:'land-allow-dirty', todoId: epicId, detail: '... paths: <dirty>' }` **before** `validateStewardProof` runs.
    - On a green verdict, calls `wm.landEpicToMaster(epicId, dirty.length>0 && opts.allowDirty ? { allowDirtyPaths: dirty } : undefined)` (line ~1346).
  - `getWorktreeManager(projectRoot)` (line ~533) — caches a `WorktreeManager` keyed on root with `baseDir=<root>/.collab/agent-sessions/worktrees`, `persistDir=<root>/.collab/agent-sessions`.
- `src/agent/worktree-manager.ts`
  - `dirtyPaths()` (line ~1206) — `git status --porcelain`, strips the 3-char status prefix, returns non-empty trimmed paths.
  - `landEpicToMaster(epicId, opts?: LandOpts)` (line ~1228) — `LandOpts.allowDirtyPaths` (line ~86-88) appends `\nAllow-Dirty: <paths.join(', ')>` to the merge commit message (line ~1285-1287); default `baseRef='master'`. Returns `{ landed, conflict, reason?, masterSha? }`.
  - `epicBranchName(epicId)` (line ~677) → `collab/epic/<id8>`; `ensureEpic(epicId)` creates branch+worktree.
- `src/services/steward-proof.ts`
  - `realRunners.epicMergeClean(masterCwd, epicBranch)` (line ~116-147) — creates a detached trial worktree off `master` (NEVER checks out `master` itself, never merges in `masterCwd`), runs `git merge --no-commit --no-ff <epicBranch>`, aborts, tears down. Returns `true` on clean merge, `false` on conflict or setup failure.
- `src/services/project-registry.ts`
  - `trackingProjectRoot(path)` (line ~37-40) — regex `^(.*?)[/\\]\.collab[/\\]agent-sessions[/\\]/` → repo root; identity for non-worktree paths.
- `src/services/todo-store.ts` — `openDb()` (line ~277) normalizes `project = trackingProjectRoot(project)` then opens `<root>/.collab/todos.db`; `createTodo`, `getTodo`, `_closeProject`.
- Stores & isolation seams:
  - `src/services/friction-store.ts` — `recordFriction(project, input)`, `listFriction(project, filter)`; DB is `<project>/.collab/friction.db` (per-repo → temp repo isolates naturally), keyed by `retryReason`/`todoId`.
  - `src/services/supervisor-store.ts` — `createEscalation({ project, session, kind, questionText, todoId })`, `_closeDb()`; the global supervisor DB is isolated via `process.env.MERMAID_SUPERVISOR_DIR` set **before import**.

## Test-harness facts (must respect)

- **Default branch must be `master`.** `landEpicToMaster` defaults `baseRef='master'` and `epicMergeClean` hardcodes `'master'`. Init temp repos with `git init -q -b master` (NOT `main`, which the existing DOGFOOD test uses).
- Set git identity per-repo (`user.email`/`user.name`) or via env `GIT_AUTHOR_*`/`GIT_COMMITTER_*` (mirror `integration.worktree.test.ts` runGit).
- A `runGit(cwd, args)` helper via `Bun.spawn` — copy the shape from `src/agent/__tests__/worktree-integration.test.ts` (lines 21-35).
- Isolate the supervisor store: `const dir = mkdtempSync(...); process.env.MERMAID_SUPERVISOR_DIR = dir;` BEFORE importing supervisor-store; `_closeDb()` in `beforeAll`/`afterAll`; `delete` the env in `afterAll` (mirror `supervisor-store.escalation-project.test.ts` lines 6-18).
- **Avoid `realRunners.tscClean`** (`npx tsc --noEmit`) in any path you expect to *succeed*. A temp repo has no tsconfig → tsc fails → `validateStewardProof('land_epic', …)` returns `tsc-failed`. Therefore:
  - The refusal (1) and the friction-note (2a) assertions land on code paths that run **before** the verdict — they are cheap and tsc-independent.
  - The actual `Allow-Dirty` trailer (2b) is asserted directly at the `landEpicToMaster` seam, bypassing `landEpic`'s verdict entirely.
- `getWorktreeManager` caches by `projectRoot`; fresh temp paths never collide. Each test's repo is its own root → friction/todo DBs are isolated by path.

## Files to create

### File A — `src/services/__tests__/land-dirty-tree.test.ts` (bun:test)
Covers (1) and (2a) via `landEpic`, plus (2b) via `landEpicToMaster`.

**Common setup (`beforeEach`):**
- `mkdtemp` a repo; `git init -q -b master`; config identity; commit a `base.txt`.
- Set `process.env.MERMAID_SUPERVISOR_DIR` to a fresh temp dir (in a module-top block, before importing supervisor-store), `_closeDb()` in before/after.
- Seed the work-graph in the repo's todo-store (resolves to `<repo>/.collab/todos.db`):
  - `createTodo(repo, { title: '[EPIC] land test', type: 'epic', ... })` → `epic`.
  - `createTodo(repo, { title: '[LAND] → master', parentId: epic.id, ... })` → `landChild`.
  - `createEscalation({ project: repo, session: 'sX', kind: 'epic-ready-to-land', questionText: '...', todoId: landChild.id })` → `esc`.

**Test (1) — dirty refusal:**
- Write an untracked file into the repo root (e.g. `dirty.txt`) so `git status --porcelain` is non-empty.
- `const out = await landEpic(repo, esc.id);`
- Assert `out.ok === false`, `out.landed === false`, `out.reason === 'dirty-tree'`.
- Assert `out.dirtyPaths` is a non-empty array containing `'dirty.txt'`.
- (Optional) the epic branch need NOT exist — the guard returns before `landEpicToMaster`.

**Test (2a) — allowDirty records friction (reason `land-allow-dirty`) and does not refuse early:**
- Same dirty repo. `const out = await landEpic(repo, esc.id, { allowDirty: true });`
- Assert `out.reason !== 'dirty-tree'` (it proceeded past the guard; it will fail later on the verdict — `tsc-failed` or `epic-children-incomplete` — and that's fine; do NOT assert `landed:true` here).
- `const notes = listFriction(repo, {});` — assert a note exists with `retryReason === 'land-allow-dirty'`, `layer === 'orchestration'`, and `detail` includes `'dirty.txt'`.

**Test (2b) — Allow-Dirty trailer on the real land commit (direct `landEpicToMaster` seam):**
- Build a `WorktreeManager` on a clean temp repo (init `-b master`, base commit).
- `const epicId = 'trailer-epic';` create the epic branch with one extra commit that merges cleanly: `await mgr.ensureEpic(epicId)`; write a file in the epic worktree and `commitAndMergeToEpic` (or commit directly on `collab/epic/<id8>` via runGit) so the branch is ahead of master with a non-conflicting change.
- `const res = await mgr.landEpicToMaster(epicId, { allowDirtyPaths: ['foo.ts', 'bar.ts'] });`
- Assert `res.landed === true`, `res.conflict === false`.
- Read the land commit message: `runGit(repo, ['log', 'master', '-1', '--format=%B'])` → assert it contains `'Allow-Dirty: foo.ts, bar.ts'` and the `Collab-Epic:`/`Collab-Land:` trailers.
- (Optional) `landEpicToMaster(epicId)` with no opts → message does NOT contain `Allow-Dirty:`.

### File B — `src/services/__tests__/epic-merge-clean-isolation.test.ts` (bun:test)
Covers (3). Imports `epicMergeClean` — it is a member of the (non-exported) `realRunners`. **Verify the export surface first**: if `realRunners` / `epicMergeClean` is not exported, drive it through `validateStewardProof('land_epic', { kind:'epic-landable', epicId, epicBranch }, ctx)` with the `tscClean` runner stubbed to `() => true` and the store deps satisfied, so only `epicMergeClean` (the real runner) gates the verdict — and assert the verdict reflects mergeability. (Prefer the public `validateStewardProof` seam; cite `steward-proof.test.ts` for the `ctx()`/`deps()` helpers.)

**Setup:** temp repo init `-b master`, base commit. Create `collab/epic/<id8>` (use a `WorktreeManager.epicBranchName`/`ensureEpic`, or a plain branch) with a commit that adds a NEW file (clean, non-conflicting merge into master).

**Test 3a — clean merge passes; dirty main does NOT contaminate:**
- Make `master` checkout dirty: write an uncommitted/untracked file `contaminant.txt` in the repo root.
- Run the dry-merge validation (`epicMergeClean(repo, epicBranch)` directly, or via `validateStewardProof` with `tscClean: ()=>true` + satisfied `epicChildIds`/`getDep`, `masterCwd: repo`, `epicWorktreeCwd: repo`).
- Assert the validation passes (`true` / verdict `ok:true`).
- Assert the dirty file is **untouched** after validation: `contaminant.txt` still present with identical contents, and `git status --porcelain` in `repo` still shows it (proves validation ran in the isolated trial worktree, not in `masterCwd`).
- (Optional but strong) assert no `collab-land-trial-*` worktree leaked: `git worktree list` shows only the main tree (trial is torn down in `finally`).

**Test 3b — conflicting epic fails purely on mergeability, regardless of dirty main:**
- New temp repo. After base commit, commit a change to `conflict.txt` on `master`, then create the epic branch from an earlier point and commit a CONFLICTING change to the same file.
- Make main dirty again (unrelated file).
- Assert the validation returns `false` / verdict `epic-merge-conflict` — proving the verdict tracks epic-branch mergeability, not the dirty state of main.

### File C — `src/services/__tests__/tracking-project-root.test.ts` (bun:test)
Covers (4). Pure + store-level — no git needed beyond a temp dir tree.

**Test 4a — `trackingProjectRoot` maps a worktree cwd → repo root:**
- `const repo = '/Users/me/Code/claude-mermaid-collab';`
- `const wt = `${repo}/.collab/agent-sessions/worktrees/leaf-exec-abc`;`
- Assert `trackingProjectRoot(wt) === repo`.
- Assert identity for a plain root: `trackingProjectRoot(repo) === repo`.
- Assert a nested deeper worktree path still resolves to `repo` (regex is non-greedy to the first `.collab/agent-sessions/`).

**Test 4b — todo-store resolves a worktree cwd to the tracking repo's `todos.db`:**
- `mkdtemp` a real repo dir; create `<repo>/.collab/agent-sessions/worktrees/lane-1` on disk (mkdir -p).
- `const t = await createTodo(repo, { title: 'T', ... });`
- `const viaWorktree = getTodo(`${repo}/.collab/agent-sessions/worktrees/lane-1`, t.id);`
- Assert `viaWorktree` is non-null and `viaWorktree.id === t.id` — i.e. the worktree cwd opened the SAME `<repo>/.collab/todos.db`, not an empty worktree-local DB.
- Clean up with `_closeProject(repo)` in `afterEach` so the cached handle is dropped.

## Acceptance

- `npm run test:ci -- src/services/__tests__/land-dirty-tree.test.ts`
- `npm run test:ci -- src/services/__tests__/epic-merge-clean-isolation.test.ts`
- `npm run test:ci -- src/services/__tests__/tracking-project-root.test.ts`

(These are bun:test files; the dual-runner harness routes `bun:test` files to `bun test`. Run each per-file as above.) All three green; `tsc --noEmit` clean for the new files.

## Notes / gotchas

- Per `project_dual_test_runner` memory: backend tests use TWO runners and run with file-parallelism OFF (shared SQLite). Keep each file's temp dirs unique and close DB handles in teardown; do not rely on cross-file ordering.
- Do NOT `npm install` in `ui/`; these are backend tests only.
- The friction note (2a) and the trailer (2b) are deliberately tested at DIFFERENT seams because the `landEpic` success path passes through `realRunners.tscClean` (`npx tsc`), which cannot pass in a tsconfig-less temp repo. Document this in a comment so a future reader doesn't "simplify" 2b back into `landEpic`.
- If `epicMergeClean`/`realRunners` is not exported from `steward-proof.ts`, route File B through `validateStewardProof` (its public entrypoint) with `tscClean` stubbed — do not add an export from this test leaf.

```json
{ "schemaVersion": 1, "estimatedFiles": 3, "estimatedTasks": 3,
  "nonEnumerableFanout": false,
  "filesToCreate": [
    "src/services/__tests__/land-dirty-tree.test.ts",
    "src/services/__tests__/epic-merge-clean-isolation.test.ts",
    "src/services/__tests__/tracking-project-root.test.ts"
  ],
  "filesToEdit": [],
  "tasks": [
    { "id": "land-dirty-tree-test", "files": ["src/services/__tests__/land-dirty-tree.test.ts"], "description": "landEpic dirty-tree refusal (lists paths) + allowDirty friction note (land-allow-dirty) + Allow-Dirty trailer via landEpicToMaster" },
    { "id": "epic-merge-clean-isolation-test", "files": ["src/services/__tests__/epic-merge-clean-isolation.test.ts"], "description": "epicMergeClean runs in isolated trial worktree; dirty main does not contaminate validation; conflicting epic still fails" },
    { "id": "tracking-project-root-test", "files": ["src/services/__tests__/tracking-project-root.test.ts"], "description": "trackingProjectRoot maps worktree cwd -> repo root; todo-store resolves worktree cwd to tracking todos.db" }
  ] }
```