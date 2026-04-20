# Spike: cwd + worktree + resume

## Question

Does `claude --resume <sid>` find its JSONL transcript when `cwd` changes between invocations?

Phases 1–3 spawn claude with `cwd = projectRoot`. Phase 4 wants either:

- **A)** `cwd = worktreePath`, migrate the JSONL on first resume, or
- **B)** `cwd = projectRoot` + `--add-dir <worktreePath>` appended — worktree is writable but cwd is unchanged.

Which keeps `--resume` working and preserves transcript continuity for sessions created before Phase 4?

## Evidence gathered

### Where claude stores transcripts

Confirmed empirically on this machine. Directory listing of `~/.claude/projects`:

```
-home-qbintelligence
-home-qbintelligence-code-claude-mermaid-collab
-srv-codebase-claude-mermaid-collab
...
```

The slug is simply `cwd.replace(/\//g, '-')` — a direct path-to-dash transform, **not** a hash. Each directory contains `<claudeSessionId>.jsonl` files.

Our own code already encodes this assumption in two places:

- `src/agent/session-registry.ts:213` — `claudeSessionExists(cwd, claudeSessionId)`:
  ```ts
  const slug = cwd.replace(/\//g, '-');
  const p = path.join(home, '.claude', 'projects', slug, `${claudeSessionId}.jsonl`);
  ```
- `src/agent/session-registry.ts:377–380` — `backfillHistory(sessionId, cwd, claudeSessionId)` uses the identical slug computation to replay historical JSONL into the in-memory ring on resume.

Both are keyed off the same `cwd` the child was spawned with. If we change `cwd` between runs, **both** the resume lookup and the history backfill break for pre-existing sessions.

### `claude --resume <uuid>` behavior

`claude --resume <sessionId>` reads the JSONL at `~/.claude/projects/<slug(cwd)>/<sessionId>.jsonl`. The slug is derived from the cwd of the process invoking claude, not anything persisted in the JSONL itself. No flag overrides the lookup path.

### `--add-dir <path>` behavior

`--add-dir` extends claude's read/write allowlist to include additional directories. It does **not** change cwd, does **not** alter the project-slug directory, and does **not** affect `--resume` at all. This matches our existing Phase-3 wiring in `src/agent/child-manager.ts:64` where `extraArgs` can be appended to argv.

### Design doc context (design-phase4-worktree-pr §12.6)

The design doc explicitly flags this as the open question for Phase 4 and records the pending preference:

> "Switching cwd from project root to worktree path between Phase 1 and Phase 4 **breaks resume for existing Phase 1 sessions** — their JSONL is under the project-root slug, not the worktree slug. Mitigation: one-time migration on Phase 4 rollout (copy JSONL files from old slug to new). Alternative: always keep cwd=projectRoot, use `--add-dir worktreePath` only. Decision pending a 1-hour spike; prefer cwd=worktree for tool path ergonomics."

## Options

### A) cwd = worktreePath, migrate JSONL on first resume

**Pros**
- Tool calls default-CWD to the worktree — no path prefixes needed, Bash without explicit cwd lands inside the worktree, relative paths from the model resolve there.
- Clean mental model: the session literally "lives" in its worktree.
- Matches the design doc's preferred ergonomics.

**Cons**
- First resume after switching to a worktree **must** migrate the JSONL from `slug(projectRoot)/<sid>.jsonl` to `slug(worktreePath)/<sid>.jsonl`. That's a cross-directory copy/move at server startup for every pre-Phase-4 session.
- Partial-failure surface: if migration copies but fails to delete, we have duplicates and `--resume` may pick the wrong one; if copy fails mid-write, the new file is corrupt.
- `backfillHistory` (`session-registry.ts:377`) also needs to read from the new location — it will, because it uses `cwd`, but only after migration lands.
- Worktrees come and go. Every `git worktree remove` leaves an orphaned `~/.claude/projects/<slug>` dir that's tied to a now-deleted path. Garbage accumulates; cleanup is an extra chore.
- The slug depends on the worktree's absolute path, so moving/renaming the worktree directory also breaks resume. We don't do that today, but it's another invariant to hold.
- Compounding with §4's slugify collision handling: two sessions with the same slug get suffixes → worktree paths differ → JSONL slugs differ → can't be collapsed later.

### B) cwd = projectRoot + `--add-dir <worktreePath>`

**Pros**
- Resume is trivial. JSONL stays at `~/.claude/projects/<slug(projectRoot)>/<sid>.jsonl` forever. Existing `claudeSessionExists` and `backfillHistory` work unchanged.
- No migration code. No orphaned transcript dirs on worktree removal.
- Single source of truth for slug across all phases; survives worktree churn.
- Wire change is minimal: `ChildManager` already supports `extraArgs` (`child-manager.ts:59–68`). We only append `['--add-dir', worktreePath]`.
- The worktree auto-allow rule in §7 is path-based and cwd-agnostic — unaffected.

**Cons**
- Tool calls run with `cwd = projectRoot`. Edit/Write/Read using absolute paths work fine (that's already the dominant pattern). **Relative** paths from the model (mostly in `Bash` and occasionally `Grep`) resolve against projectRoot, not the worktree.
- Bash defaults cwd to the child's cwd. Commands like `git status`, `ls`, `npm test` will run at projectRoot, touching the main checkout rather than the worktree. This defeats the whole point of the worktree for shell-oriented work.
- Mitigations for Bash:
  1. Prompt-engineer the model to pass the worktree via `cd <worktree> &&` or explicit `--cwd` when relevant. Fragile.
  2. Have the harness rewrite Bash `command` to prepend `cd <worktree> && ` when we detect the session has a worktree. Invasive and changes observed behavior compared to raw claude.
  3. Inject a `CLAUDE_SESSION_WORKTREE` env var and ask the model (via system prompt or skill) to use it. Also fragile.
- None of these mitigations are clean. Phase 4's value prop (worktrees isolate experimentation) largely comes from shell commands — if `Bash` runs in projectRoot by default, the isolation leaks.

## Decision

**A) cwd = worktreePath, with a one-time JSONL migration on first post-Phase-4 resume.**

Rationale:

1. The entire premise of Phase 4 is that **the worktree is where work happens**. If `Bash` runs from projectRoot by default, we've given ourselves worktree-the-directory without worktree-the-sandbox — the isolation is half-applied. Every workaround for B (prepend `cd`, env var, system prompt) is a leaky abstraction that will bite us in Phase 5 when the terminal drawer goes away and Bash becomes the only shell.
2. The migration risk in A is real but bounded. It's a one-time move per pre-existing session, not an ongoing operation. We implement it as: detect old slug's JSONL → `fs.copyFile` → fsync → write sentinel `.migrated-to-<newslug>` in the old dir → keep the old file around as a read-only backup for one release. No destructive delete until we've verified the new path works.
3. Orphaned transcript dirs on worktree removal are a cosmetic concern, not a correctness one. A background sweep (§12.2 already proposes idle-worktree cleanup; extend it to also rm the matching `~/.claude/projects/<slug>`) handles it.
4. The design doc (§12.6) already flags "prefer cwd=worktree for tool path ergonomics" as the leaning; this spike confirms that lean after weighing the migration cost against the Bash-semantics cost of B.

**Caveat:** if we discover during implementation that the migration is materially harder than expected (e.g. claude-cli writes additional sidecar files under the slug dir that we don't know about, or introduces a binary index), we fall back to **B + a `CLAUDE_SESSION_CWD` env injection + a Bash wrapper skill**. That's a documented fallback, not a parallel plan.

## Follow-up implementation notes

- **`WorktreeManager.ensure` signature** (§4): returns `WorktreeInfo | NonGitFallback` as designed. No change from the spike.

- **`child-manager.ts` extraArgs wiring** (lines 59–68): already in place from Phase 3. Phase 4 just passes `extraArgs: ['--add-dir', projectRoot]` when spawning in a worktree — the model still needs read access to the original project files (e.g. to reference docs or run project-level scripts that live outside the worktree).

- **`session-registry.ts` cwd plumbing**:
  - `startChild(sessionId, cwd)` — the passed-in `cwd` becomes advisory. Call `worktreeManager.ensure(sessionId)`; if `isGitRepo`, use `wt.path` as the effective cwd, else fall back to the original `cwd`.
  - `claudeSessionExists(effectiveCwd, claudeSessionId)` — lookup uses the effective (worktree) slug. For brand-new Phase 4 sessions this is correct from day one.
  - `backfillHistory(sessionId, effectiveCwd, claudeSessionId)` — also uses the worktree slug. For pre-Phase-4 sessions, this only finds history after migration runs.

- **Migration routine** (new — e.g. `src/agent/jsonl-migration.ts`):
  - Input: `sessionId`, `claudeSessionId`, `oldCwd` (from persisted `PersistRecord.cwd`), `newCwd` (worktree path).
  - Compute `oldSlug`, `newSlug`.
  - If `~/.claude/projects/<oldSlug>/<claudeSessionId>.jsonl` exists and `<newSlug>/...` does not: `mkdir -p <newSlug>`, `copyFile` + fsync, write `<oldSlug>/.migrated-to-<newSlug>` sentinel. Do **not** delete the source yet.
  - Idempotent: sentinel presence short-circuits repeat runs.
  - Call site: inside `startChild`, after `ensure()` resolves with `isGitRepo`, before `claudeSessionExists`.

- **Persistence**: extend `PersistRecord` with `worktreePath?: string` as the design doc already calls out in §5. `record.cwd` keeps the **original** projectRoot cwd (so migration can find the source slug on first run); `record.worktreePath` is the new effective cwd going forward.

- **Tests** (new `src/agent/__tests__/jsonl-migration.test.ts`):
  - Happy path: fake home with JSONL at old slug → migration copies to new slug, sentinel written.
  - Idempotent: second run is a no-op when sentinel present.
  - No-op when source missing (fresh session).
  - No-op when destination already exists (don't clobber).

- **Cleanup** (`WorktreeManager.remove`): after `git worktree remove --force`, also `rm -rf ~/.claude/projects/<slug(worktreePath)>`. Gate behind a "we own this dir" check (sentinel file we drop when first creating the worktree-slug dir) to avoid nuking unrelated state.

- **Fallback trigger**: if migration throws or the post-migration `claudeSessionExists` still reports false, log and fall back to spawning with `cwd = oldCwd` + `--add-dir <worktreePath>` — the model loses Bash-in-worktree semantics for that session but keeps resume working.
