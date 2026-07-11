# Wave 3 Implementation — pseudo-skills-db-cleanup

## Tasks
- **Deleted skills**: `skills/pseudocode/` + `skills/pseudocode-seed/` (git rm -r; each had tracked SKILL.md). No skills-array references in plugin.json/marketplace.json to clean.
- **plugin.json**: removed the pseudo SessionStart hook entry (the `pseudo-rescan-${PWD}.marker` touch command) + fixed trailing comma. Kept `session-start-hook.sh`. JSON validated; SessionStart now has 1 hook entry.
- **Committed db**: `git rm .collab/pseudo/pseudo.db` (only tracked file in that dir; wal/shm/cache were untracked).
- **vitest.config.ts**: removed 3 stale excludes pointing at now-deleted files — `src/routes/pseudo-api.test.ts`, `src/services/__tests__/pseudo-db.test.ts`, `src/services/__tests__/source-scanner.test.ts`. Kept non-pseudo bun:test excludes.
- **.gitignore**: removed the pseudo block (pseudo.db-wal/shm, cache/, `!pseudo.db` negation, prose/, .migrated*, the "main pseudo-db IS committed" comment) and the legacy `*.pseudo` block; trimmed the "Local runtime artifacts" comment to drop kodex/pseudo wording. Kept all unrelated ignore lines.

## Verification
- `node JSON.parse` plugin.json → VALID.
- Repo-wide pseudo sweep (excluding docs/.collab/node_modules/dist/md): remaining hits are all COMMENTS or the backend `kind: 'pseudo'` search-result string in `code-search-api.ts` (core `/api/code/search` route, not a deleted module). No imports of deleted modules anywhere (`rg` for pseudo-api/pages-pseudo/components-pseudo → CLEAN).
- `npx vitest list` → config loads, exit 0 (a pre-existing bun:test collection warning for worktree-diff.test.ts is unrelated — never in our excludes).
- skills/ dir no longer contains pseudocode or pseudocode-seed.

## Wave TSC / Build
No code compiled in this wave (config/skills/db only). Backend tsc + UI vite build remain green from Wave 2.

## Note (cosmetic, deferred to review)
A few harmless leftover `pseudo`/`pseudocode` mentions remain in comments (FunctionJumpDropdown, ReferencesPopover, extract-functions, child-manager) and the `kind: 'pseudo'` type in code-search-api.ts. None are load-bearing; the backend search may simply stop returning pseudo-kind results. Out of blueprint scope.
