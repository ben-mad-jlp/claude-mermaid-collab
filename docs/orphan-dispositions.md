# Orphan Commit Dispositions

Record of orphaned commits that have been addressed or superseded by subsequent work on master.

## Commit 9ab4b72f32c868959ea819ff1d2bfcd88beadd15

**Subject:** fix(base-red): un-red master — declare ensure_epic_worktree's own output, re-widen the sync-spawn count

**Date:** 2026-08-09

**Branch:** collab/epic/e2de2e48

**Verdict:** SUPERSEDED

**Superseded by:** master commit `0a8e7378885e11dfc6f1b64558d1ff1381fe830f`
("feat: Sanctioned-output allowlist for the main-checkout residue guard"). Confirmed via `git merge-base --is-ancestor 0a8e7378 HEAD`.

### Arm-by-Arm Citations

All citations verified at HEAD 5219976d:

| Arm | File | Symbol/Test | Line | Status |
|-----|------|------------|------|--------|
| (a) | `src/services/main-checkout-invariant.ts` | `isSanctionedResidue` function | 65 | Exported and implemented |
| (a) | `src/services/main-checkout-invariant.ts` | `allowedResidue?: string[]` field | 137 | Present in `withMainCheckoutInvariant` opts |
| (a) | `src/services/main-checkout-invariant.ts` | Filter application | 166 | `addedResidue.filter(r => !isSanctionedResidue(...))` applied before throw and quarantine |
| (b) | `src/agent/worktree-manager.ts` | `allowedResidue:` wrap site #1 | 343 | In `ensure()` method |
| (b) | `src/agent/worktree-manager.ts` | `allowedResidue:` wrap site #2 | 1504 | In `ensureEpic()` method |
| (b) | `src/agent/worktree-manager.ts` | `allowedResidue:` wrap site #3 | 2451 | In `removeEpic()` method |
| (c) | `src/services/__tests__/main-checkout-allowlist.test.ts` | `'sanctioned residue does NOT trigger throw and quarantineDir is not created'` | 101 | Test green: `bun test src/services/__tests__/main-checkout-allowlist.test.ts` → 10 pass, 0 fail |
| (d) | `src/services/__tests__/main-checkout-wrap-audit.test.ts` | `'ensureEpic wrap site carries both quarantineDir and allowedResidue'` | 213 | Present |
| (d) | `src/services/__tests__/main-checkout-wrap-audit.test.ts` | `'ensure wrap site carries allowedResidue (no quarantineDir)'` | 221 | Present |
| (e) | `src/services/__tests__/no-sync-spawn.test.ts` | `'services/worktree-write-leak.ts'` ALLOWLIST entry | 63 | `count: 6` in ALLOWLIST map |

### Closure Evidence

**Git cherry status:** `git cherry master collab/epic/e2de2e48` continues to print `+ 9ab4b72f32c868959ea819ff1d2bfcd88beadd15` (never cherry-picked). Patch-id matching cannot detect a re-implementation that moved the contract from the guard module to the call site, so any "clean cherry" closure condition is unsatisfiable by design. This written citation serves as the closure evidence instead.

### Root Cause of False Absence

The original triage's "genuinely absent from trunk" verdict came from a path-scoped symbol grep:
```bash
git grep -c ensure_epic_worktree master -- src/services/main-checkout-invariant.ts
```
This returns no matches (exit 1) at HEAD 5219976d because the contract was re-implemented via a different approach: instead of declaring `ensure_epic_worktree`'s output inside the guard module, the solution moved the contract to the three call sites in `worktree-manager.ts` via `allowedResidue:` wrap-site declarations (lines 343, 1504, 2451). A path-scoped grep cannot see this re-implementation pattern.

### Non-Re-Landing Directive

**Do NOT re-land, cherry-pick, or re-derive any of 9ab4b72f's content.** Every arm is already present at HEAD 5219976d via the superseding implementation in commit 0a8e7378.
