# Phase 6 Wave 3 Implementation

## Tasks

### delete-pseudo-parser — done
- `git rm` on `src/services/pseudo-parser.ts` and `src/services/__tests__/pseudo-parser.test.ts`
- Pre-delete grep: zero production-code references (Wave 2 had already removed them)
- Post-delete grep: no unexpected hits

### pre-commit-hook — done
- Created `scripts/pre-commit` (executable, `-rwxr-xr-x`) — 6-line bash wrapper that calls `bun run bin/structural-index.ts "$PROJECT_ROOT"`
- `git rm` on `scripts/post-commit`, `scripts/pseudo-track-commit.sh`, `scripts/pseudo-hook-check.sh`
- Legacy `.pseudo` siblings already staged as deleted in git prior to this wave

### skill-rewrite — done
- Rewrote `skills/pseudocode/SKILL.md` from 268 lines → 50 lines
- Direct MCP tool calls via `pseudo_get_file_state` + `pseudo_upsert_prose`
- `git rm` on both `PSEUDOCODE_SPEC.md` copies (project root + skill dir)

## Verification

- **tsc:** clean of all pseudo-parser/parsePseudo/ParsedPseudoFile references. Pre-existing unrelated errors untouched.
- **pseudo-db.test.ts:** 32/32 pass (via `bun test`; file uses `bun:test` imports and can't run under vitest — runner mismatch pre-dates Phase 6)
- **pseudo-api.test.ts:** 17 pass / 13 fail. The `exports > stepSummary` block passes (confirms FTS5 fix). All 13 failures are the pre-existing unrelated `/files`, `/file`, `/search` blocks — no new failures.
- **SKILL.md:** 50 lines, no references to .pseudo files, install mode, sync mode
- **scripts/pre-commit:** executable

## Flags for follow-up

1. **`.claude/settings.json:18`** still references `bash scripts/pseudo-hook-check.sh`. The script was deleted in this wave so the hook is dangling. Needs to either point at `scripts/pre-commit` (via the git PostToolUse trigger) or be removed entirely. **Requires user decision.**
2. `scratch/test-pseudo.ts` — untracked dev harness still importing `parsePseudo`. Orphaned; won't compile if run but doesn't block anything. Safe to delete on next cleanup pass.
3. `.gitignore:10` still has `.pseudo-needs-update` entry — harmless, leftover from the old hook system.
4. `docs/designs/pseudo-viewer/*` — historical design docs reference `parsePseudo`. Documentation only, safe to leave.
5. `pseudo-db.test.ts` uses `bun:test` + `bun:sqlite` imports so it only runs under `bun test`, not the project's default `vitest` runner. Pre-existing mismatch worth standardizing, but not a Phase 6 regression.
