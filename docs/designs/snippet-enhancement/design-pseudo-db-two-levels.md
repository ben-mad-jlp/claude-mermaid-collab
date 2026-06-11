# Design: Pseudo-DB — Two-Level Code Indexing (SQLite-Only, Committed to Git)

Phase 6 of the snippet-enhancement migration. Splits pseudo-db population into a cheap structural layer that runs on every commit and an expensive prose layer that stays LLM-driven and opt-in. Deletes the `.pseudo` file format entirely. Commits the SQLite db to git so the indexed knowledge is shared across team members without any export/import dance.

## Locked Decisions

- **SQLite is the single source of truth.** No `.pseudo` files in any form — not as inputs, not as outputs, not as a migration source. Any `.pseudo` files currently in the repo get deleted as part of Phase 6.
- **The db lives in git.** `.collab/pseudo/pseudo.db` is removed from `.gitignore` via a surgical exception. The WAL sidecars stay ignored. A `PRAGMA wal_checkpoint(FULL)` runs before any commit that includes db changes, so the on-disk file is always a clean snapshot.
- **Name stays as "pseudo".** `method_steps` contains literal pseudocode (plain-English descriptions of what methods do). `pseudo-db` is still an accurate name for the content. The file format is dying, not the concept.
- **Two-level indexing.**
  - **Level 1 (structural):** regex scanner over source files, runs on every commit via git hook, no LLM, fast. Populates `files` + `methods` tables with signatures and line numbers.
  - **Level 2 (prose):** LLM reads source + current db state, writes prose directly to db via MCP tool. Opt-in via `/pseudocode` slash command. Populates `method_steps`, `method_calls`, file-level `title` / `purpose` / `module_context`.
- **One phase.** All of it — source scanner, new db methods, MCP tools, CLI, git hook, skill rewrite, parser deletion, `.pseudo` file purge, gitignore exception — ships as Phase 6.
- **Linked code snippets (Source B in Cmd+K) stay personal.** Sessions remain gitignored. Phase 6 doesn't touch session persistence.
- **Hard-delete on method removal.** When Level 1 scans a file and a method is gone, delete the row. Prose is lost with it; the committed db history is the safety net.

## 1. Motivation

### Today (post Phase 3)

Populating the db goes through:

1. `/pseudocode` skill has Claude write a sibling `.pseudo` file with prose.
2. The parser reads that file, the ingest layer writes it to SQLite.
3. Line numbers get layered on during ingest via `scanSourceFileForLines`.

Problems:

- **Staleness.** Line numbers drift between commits because nothing refreshes structural data automatically.
- **Coverage holes.** New files are invisible to search / navigation until someone hand-runs the LLM flow on them.
- **Two sources of truth.** Files on disk and db in SQLite disagree after partial syncs.
- **Parser complexity for no reason.** ~400 lines of tokeniser + marker parsing for a file format whose sole purpose is being parsed back into SQLite.
- **Git noise.** `.pseudo` diffs on every source edit.
- **Team sharing is awkward.** `.pseudo` files ARE in git today, but the db gets rebuilt locally per user via ingest, producing flaky indexing behavior.

### The fix

Delete the file layer. The db becomes the primary (and only) store. Two independent update paths both read code files directly:

- **Level 1** is automatic and cheap. Runs on every commit. Keeps structural data fresh.
- **Level 2** is manual and expensive. Runs when you want prose. Writes to the db directly.

The committed db solves team sharing for free.

---

## 2. Model

### Level 1 — Structural Index

**Goal:** for every source code file in the project, know its functions: name, params, return type, line span, visibility, async flag, kind, owning symbol.

**How:** regex-based scanner per language. Reuses the per-language regex patterns from Phase 3's `findMethodLineForLanguage` but returns the full list of methods in a file instead of looking up one.

**Writes:** `files` + `methods` tables, structural columns only.

**Does NOT touch:** `method_steps`, `method_calls`, `files.title`, `files.purpose`, `files.module_context` — those belong to Level 2.

**Triggered by:**
- Git pre-commit hook (automatic, every commit)
- MCP tool `pseudo_index_structural(project, filePath)`
- CLI `bin/structural-index.ts`
- Server startup if `schema_version < 2` or db is empty (one-time full-project scan)

**Language coverage:** TypeScript/JavaScript primary. C#/C++/Python good-effort. Unknown languages skipped silently.

**Performance budget:** <1s for a 10-file commit, synchronous in the hook. No LLM cost.

### Level 2 — Prose Generation

**Goal:** for each method, generate plain-English step descriptions and cross-file CALLS references. For each file, generate title / purpose / module-level context.

**How:** `/pseudocode` skill has Claude:
1. Read the source code file from disk.
2. Query the current db state via an MCP read (existing methods, existing prose, `prose_updated_at`).
3. Decide what needs regenerating (first run → all; subsequent → methods whose source hash changed since last prose write).
4. Generate prose.
5. Call `pseudo_upsert_prose(project, filePath, data)` which writes directly to the db.

**Writes:** `method_steps`, `method_calls`, `files.title`, `files.purpose`, `files.module_context`, `files.prose_updated_at`, `files.has_prose`.

**Does NOT touch:** structural columns. Assumes Level 1 is already accurate.

**Triggered by:** user action only. Never automatic.

### Interaction rules

| Source file state | Level 1 | Level 2 |
|---|---|---|
| Known to db | Refreshes structural columns, preserves prose | Refreshes prose, preserves structure |
| New to db | Inserts `files` + `methods` rows with empty prose | Same, then fills prose |
| Source deleted | Deletes the `files` row (cascades to `methods` / `method_steps` / `method_calls`) | n/a |

Level 1 and Level 2 write to disjoint column sets. Neither destroys the other's content.

---

## 3. Schema (v2)

### What has to change from v1

The current schema has legacy artifacts from the pseudo-file era:

- `files.file_path` stores the `.pseudo` file path today. Change to store the **source code file path**.
- `files.file_stem` derives from the `.pseudo` basename. Keep the column but derive from the source file basename instead (`src/auth.ts` → `auth`).
- `files.source_file_path` is Phase 3's auxiliary column. Gone — merged into `file_path`.
- `files.synced_at` was the `.pseudo` file save timestamp. Rename to `prose_updated_at`.

### Proposed v2 layout

```sql
CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,        -- absolute source code file path
  file_stem TEXT NOT NULL DEFAULT '',    -- basename without extension
  language TEXT,                          -- typescript / python / csharp / cpp / etc.
  source_mtime TEXT,
  source_hash TEXT,
  line_count INTEGER,

  -- Level 2 fields (prose)
  title TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  module_context TEXT NOT NULL DEFAULT '',

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  structural_indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  prose_updated_at TEXT,
  has_prose INTEGER NOT NULL DEFAULT 0
);
```

`methods`, `method_steps`, `method_calls` stay mostly as-is from Phase 3. CALLS resolution (joining `method_calls.callee_file_stem` against `files.file_stem`) continues to work — the stems are now derived from source file basenames instead of pseudo file basenames, but the join logic is identical.

### Migration v1 → v2

The db is committed (see Section 5), so an upgrade is disruptive if mishandled. The migration runs on next server startup:

1. Detect `schema_version < 2`.
2. `DROP TABLE` all data tables (files, methods, method_steps, method_calls, pseudo_fts).
3. Create v2 schema.
4. **Run a full-project Level 1 scan** immediately, walking every source file in the project and calling `upsertStructural`. This gives the db complete structural coverage before the user does anything.
5. Bump `schema_version` to 2.
6. Commit the migration via the next pre-commit hook run, so teammates pulling master get the v2 db directly without having to re-migrate locally.

**No legacy content is preserved.** Any `.pseudo` files in the repo are ignored during migration (they're also deleted in Phase 6 as code). Prose has to be regenerated via `/pseudocode` for files the user cares about.

This is the one time the upgrade actually costs something — users lose their existing prose. Document it clearly in the Phase 6 notes: "Run /pseudocode on files you care about after upgrading to rebuild prose."

---

## 4. What Gets Deleted

**Code:**
- `src/services/pseudo-parser.ts` + tests (~400 lines)
- `upsertFile(filePath, parsed)` and `bulkIngest(files)` from `pseudo-db.ts` — replaced by `upsertStructural` + `upsertProse`
- `resolveSourceFilePath` and any pseudo-file-probing code from `pseudo-db.ts`
- `ParsedPseudoFile`, `ParsedMethod`, `ParsedStep` types and every consumer

**Skill content:**
- `skills/pseudocode/PSEUDOCODE_SPEC.md`
- `PSEUDOCODE_SPEC.md` (project-root copy)
- ~170 lines out of `skills/pseudocode/SKILL.md` — all the format spec, file header conventions, marker documentation, `install` mode that wires `.pseudo` tracking, `sync` mode that processes `.pseudo` files. The skill shrinks from ~200 lines to ~30.

**Scripts:**
- `scripts/pseudo-track-commit.sh` — replaced by the new structural-index path
- `scripts/pseudo-hook-check.sh` — obsolete
- `scripts/post-commit` — either deleted or converted to a thin wrapper for `bin/structural-index.ts`
- `.pseudo-needs-update` manifest convention
- `.pseudo-sync` timestamp convention

**Files in the repo:**
- **Every `.pseudo` file in the repo** — deleted in a dedicated cleanup commit within Phase 6
- Add `*.pseudo` to `.gitignore` as a belt-and-suspenders measure against future accidental commits

Net: **~2500 lines deleted** across code, tests, specs, skill content, and `.pseudo` files.

---

## 5. Committing the DB — Git Integration

### `.gitignore` changes

Current:
```
/.collab/
```

New (surgical exception for the db):
```
/.collab/sessions/
/.collab/pseudo/pseudo.db-wal
/.collab/pseudo/pseudo.db-shm
!/.collab/pseudo/pseudo.db
```

Effect:
- ✅ Committed: `.collab/pseudo/pseudo.db` (the main SQLite file)
- ❌ Gitignored: everything else under `.collab/` — sessions (personal), WAL sidecars (runtime only)

Belt-and-suspenders: also add `*.pseudo` to gitignore so no one accidentally commits pseudo files in the future.

### Pre-commit hook

Moved from post-commit to **pre-commit** so structural updates are atomic with the code change instead of appearing in the next commit.

```
.git/hooks/pre-commit fires
     │
     ▼
scripts/pre-commit calls bin/structural-index.ts
     │  (Level 1 only — fast, no LLM)
     ▼
structural-index.ts:
  - git diff --cached --name-only --diff-filter=AMR → staged source files
  - git diff --cached --name-only --diff-filter=D   → staged deletes
  - for each file: scan via source-scanner, call upsertStructural
  - for each delete: call deleteStructural
  - PRAGMA wal_checkpoint(FULL) to flush WAL into main db file
  - git add .collab/pseudo/pseudo.db
     │
     ▼
Commit proceeds with code changes + db change staged together.
```

**Atomic guarantee.** Every commit has a consistent (code, index) pair. No drift, no "db is one commit behind". Fresh checkouts get fully-indexed state immediately.

**Performance.** Level 1 is regex-based and operates only on staged files. For typical commits (1-10 files), runtime is well under 1 second. For large commits (50+ files) it may approach 2-3 seconds. Acceptable for a pre-commit hook.

**Error handling.** The hook exits 0 even on scanner errors — errors get logged to `.collab/pseudo/structural-index.log` but never block a commit. If `upsertStructural` throws (db corruption, disk full), the error propagates to stderr and the commit is blocked — that's a signal the user needs to investigate before proceeding.

**WAL checkpoint.** `PRAGMA wal_checkpoint(FULL)` before staging the db file ensures the main db file has all in-memory and WAL state flushed. Otherwise the committed snapshot could be missing recent writes.

### What happens on fresh checkouts

1. User clones / pulls master.
2. They have a fully-populated `.collab/pseudo/pseudo.db` — structural data for the entire project, plus whatever prose anyone has generated.
3. Server startup reads `schema_version` from the db, sees it's current, does nothing.
4. UI Cmd+K search works immediately. Function Jump Dropdown works immediately. Go-to-Definition works immediately. No warmup period.

### What happens on branch switches

1. User runs `git checkout feature-branch`.
2. The db file on disk changes to match that branch's committed db.
3. SQLite sees a different file on next open → fine, it's just a new snapshot.
4. WAL sidecars might be stale — checkpoint flushes them on next write, or the user can manually `rm .collab/pseudo/pseudo.db-wal` if there's any weirdness.

### What happens with merge conflicts

- SQLite is a binary format — git CANNOT auto-merge conflicting db files.
- Resolution path: pick one side of the conflict (typically `git checkout --theirs .collab/pseudo/pseudo.db`), then run the pre-commit hook manually or via `bin/structural-index.ts` to re-index any differences. Prose for methods that only existed on the other branch is lost — user can re-run `/pseudocode` on those files.
- **Document this in the Phase 6 README.** It's an acceptable trade-off for the simplicity of the db-in-git model.

### PR review

- Reviewers can see source code changes clearly.
- The db diff shows as a binary blob with size change. Reviewers treat it the way they'd treat a lockfile — glance at the size, don't scrutinize.
- If someone really wants to inspect what changed structurally, they can run `sqlite3 .collab/pseudo/pseudo.db .dump` on both sides of the PR.

---

## 6. API Surface

### `src/services/pseudo-db.ts` — additions

```typescript
interface StructuralMethod {
  name: string;
  params: string;
  returnType: string;
  sourceLine: number;
  sourceLineEnd: number | null;
  visibility: 'public' | 'private' | 'protected' | 'internal' | null;
  isAsync: boolean;
  kind: 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'callback' | null;
  isExported: boolean;
  owningSymbol: string | null;
}

interface ProseMethod {
  name: string;
  params?: string;  // disambiguator for overloads
  steps: Array<{ content: string; depth: number }>;
  calls: Array<{ name: string; fileStem: string }>;
}

class PseudoDbService {
  // Level 1 — structural
  upsertStructural(filePath: string, language: string, methods: StructuralMethod[]): void;
  deleteStructural(filePath: string): void;

  // Level 2 — prose
  upsertProse(filePath: string, data: {
    title?: string;
    purpose?: string;
    moduleContext?: string;
    methods: ProseMethod[];
  }): void;

  // Read the current state for a file, used by the /pseudocode skill
  // to decide what needs regenerating.
  getFileState(filePath: string): {
    methods: Array<{ name: string; params: string; sourceHash: string | null; hasSteps: boolean }>;
    proseUpdatedAt: string | null;
  } | null;

  // WAL management for pre-commit hook
  checkpointWal(): void;  // wraps PRAGMA wal_checkpoint(FULL)
}
```

### `src/services/pseudo-db.ts` — deletions

- `upsertFile(filePath, parsed)` — replaced
- `bulkIngest(files)` — replaced by full-project Level 1 scan
- `resolveSourceFilePath(pseudoFilePath, parsed)` — no pseudo path to resolve
- Any code that takes a `ParsedPseudoFile` as input

### New module `src/services/source-scanner.ts`

```typescript
/**
 * Scan a source code file for its functions/methods. Pure regex, no LLM.
 * Returns null for unsupported languages or file read failure.
 */
export function scanSourceFile(absPath: string): {
  language: string;
  methods: StructuralMethod[];
  lineCount: number;
  sourceHash: string;
} | null;
```

Dispatches to language-specific branches (TS/JS, C#, C++, Python). Reuses the regex logic from Phase 3's `findMethodLineForLanguage`, generalised to "find all methods in this file".

### New MCP tools

- `pseudo_index_structural(project, filePath)` — trigger Level 1 for one file
- `pseudo_index_project(project)` — trigger Level 1 full-project scan
- `pseudo_upsert_prose(project, filePath, data)` — trigger Level 2 (used by the skill)
- `pseudo_get_file_state(project, filePath)` — read current db state for the skill
- Keep all existing read-only tools: `pseudo_find_function`, `pseudo_coverage_report`, `pseudo_call_chain`, etc.

### New CLIs in `bin/`

- `bin/structural-index.ts` — called from pre-commit hook. Reads staged files from `git diff --cached`, runs `scanSourceFile` + `upsertStructural` + `deleteStructural` + `checkpointWal` + `git add` for the db.
- `bin/structural-index-project.ts` — one-shot full-project scan, used by v2 migration and by users who want to force a full re-index.

### Skill: `skills/pseudocode/SKILL.md` rewrite

Shrinks from ~200 lines to ~30. New flow:

1. Read the source code file from disk.
2. Call `pseudo_get_file_state(project, filePath)` to see what's in the db.
3. Compare source against current methods. For each method without `hasSteps` OR whose `sourceHash` differs from the source, generate prose.
4. Call `pseudo_upsert_prose(project, filePath, data)`.
5. Done. The pre-commit hook picks up the db change on the next commit.

Delete `skills/pseudocode/PSEUDOCODE_SPEC.md` and `PSEUDOCODE_SPEC.md` (project root) entirely.

### UI components — no changes needed

Phase 4/5 navigation features (`PseudoSideBySideView`, `FunctionJumpDropdown`, `ReferencesPopover`, `GlobalSearch`) all read from the db via existing MCP / HTTP endpoints. Phase 6 updates the underlying data but the API shapes stay compatible. Everything keeps working.

---

## 7. Commit-Time Flow Diagram

```
User edits src/services/auth.ts, stages it, runs `git commit`
     │
     ▼
Pre-commit hook fires → scripts/pre-commit → bin/structural-index.ts
     │
     ▼
For each staged file:
  - Run source-scanner on auth.ts → list of structural methods
  - Call db.upsertStructural('/abs/path/auth.ts', 'typescript', methods)
  - files row updated (line counts, hash, indexed_at)
  - methods rows upserted (line numbers, signatures, visibility)
  - PRESERVED: method_steps, method_calls, title, purpose (from prior Level 2)
     │
     ▼
db.checkpointWal()  // PRAGMA wal_checkpoint(FULL)
     │
     ▼
git add .collab/pseudo/pseudo.db
     │
     ▼
Commit proceeds. Source code + db update are atomic in the same commit.
     │
     ▼
Next teammate pulls. Their db is now up to date. Cmd+K search, Go-to-Definition,
Function Jump Dropdown all reflect the new code state immediately.

User later decides they want prose for a file whose logic changed:
     │
     ▼
/pseudocode src/services/auth.ts
     │
     ▼
Skill reads source, queries db state, generates prose for stale methods,
calls pseudo_upsert_prose, which writes method_steps + method_calls + files.title/purpose.
     │
     ▼
Next commit: pre-commit hook sees auth.ts isn't staged but the db is
dirty with prose changes. Hook stages the db via git add. Prose lands in git.
```

---

## 8. Open Questions

Most things are locked. Two small items remaining:

1. **Overload method matching in Level 2.** When `upsertProse` writes prose for a method named `login`, and the db has two `login` overloads, match by `name + params` string. Minor edge case: if params differ by formatting (whitespace), we create a new row instead of updating. **Accept as a known limitation.** Document in the skill that it's safe to delete and re-upsert a file's prose if overloads get confused.

2. **Should Level 2 auto-refresh structural data as step 0?** I.e., when `/pseudocode` runs on a file, should it silently re-run Level 1 first to guarantee structural freshness before generating prose? **Lean yes** — structural is cheap, and it guarantees the prose generation isn't based on stale signatures. Downside: slightly slower skill invocation (~tens of ms per file). Benefit outweighs the cost.

---

## 9. What This Buys

- **~2500 lines deleted** (parser + tests + specs + skill + `.pseudo` files)
- **Single source of truth** — SQLite, committed to git
- **Zero drift** — nothing to drift against
- **Clean commits** — no `.pseudo` noise, just a single binary db diff per commit
- **Team-shared code intelligence for free** — clone a repo and get the full index immediately
- **Automatic structural freshness** on every commit
- **No LLM cost** for Level 1 — pre-commit stays fast
- **Opt-in LLM prose** via Level 2 — users decide when to spend tokens
- **No warmup period** on fresh checkouts — Cmd+K search works immediately
- **Smaller skill surface** — ~30-line slash command instead of ~200

---

## 10. Phase 6 Task Outline (not a blueprint yet)

Rough sketch of the work, to be turned into a blueprint in a separate step:

**Wave 1 (parallel):**
- `source-scanner` module (new, pure function, unit tests per language)
- Schema migration v2 (pseudo-db.ts)
- `.gitignore` exception + `*.pseudo` global ignore
- Delete `src/services/pseudo-parser.ts` + tests (and update any callers — should be limited after the parser is no longer the main ingest path)

**Wave 2 (depends on Wave 1):**
- `upsertStructural`, `upsertProse`, `getFileState`, `checkpointWal` methods on `PseudoDbService`
- Delete `upsertFile`, `bulkIngest`, `resolveSourceFilePath`
- Update all test fixtures to use the new methods

**Wave 3 (depends on Wave 2):**
- `bin/structural-index.ts` CLI
- `bin/structural-index-project.ts` CLI
- New MCP tools: `pseudo_index_structural`, `pseudo_index_project`, `pseudo_upsert_prose`, `pseudo_get_file_state`
- Delete old MCP tool handlers that referenced pseudo files

**Wave 4 (depends on Wave 3):**
- Pre-commit hook script
- Rewrite `skills/pseudocode/SKILL.md` to ~30 lines
- Delete `skills/pseudocode/PSEUDOCODE_SPEC.md` and project-root copy
- Delete all `.pseudo` files in the repo (single large cleanup commit)

**Wave 5 (final verification):**
- Run the v2 migration once, verify full-project structural scan works
- Test Phase 4/5 UI features still function with the new db shape
- Test pre-commit hook with a test commit
- Document the upgrade path in a README update

Rough size: comparable to Phase 5. Not trivial, but straightforward once the design is locked.
