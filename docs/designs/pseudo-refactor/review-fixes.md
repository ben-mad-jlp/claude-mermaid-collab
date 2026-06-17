# Review Fixes Applied

## Bug Fixes

### A. Critical — FTS orphan rows (`src/services/pseudo-db.ts`)
- **upsertFile()**: Added FTS cleanup before cascade delete. Queries method IDs for the existing file, then deletes matching `pseudo_fts` rows before deleting the file row.
- **deleteFile()**: Same FTS cleanup added — queries method IDs, deletes FTS entries, then deletes the file row.

### B. Important — FTS query injection (`src/services/pseudo-db.ts`)
- **search()**: Added input sanitization. Query is now escaped (double quotes doubled) and wrapped in double quotes before passing to FTS5 MATCH: `const safeQuery = '"' + query.replace(/"/g, '""') + '"';`

### C. Minor — Orphan detection (`src/services/pseudo-db.ts`)
- **getOrphanFunctions()**: LEFT JOIN on `method_calls` now matches both `callee_name = m.name` AND `callee_file_stem = f.file_path`, preventing false negatives from name collisions across files.

### D. Minor — Impact analysis (`src/services/pseudo-db.ts`)
- **getImpactAnalysis()**: Recursive CTE now includes `AND mc2.callee_file_stem = f_match.file_path` to avoid false transitive matches on methods with the same name in different files.

### E. Minor — Swallowed errors (`src/server.ts`)
- Replaced two empty `catch {}` blocks with descriptive comments: `catch (_e) { /* skip unreadable pseudo file */ }` and `catch (_e) { /* skip unreadable directory */ }`.

## Completeness Fixes

### F. OnboardingDashboard.tsx — topicName → filePath
- Renamed `topicName` to `filePath` in the `WhatNextSuggestion` interface and all usages throughout the file (interface field, JSX keys, links, display text, computeWhatNext return).
- Fixed `p.topicName` → `p.filePath` on progress entries to match the actual `ProgressEntry` type.

### G. onboarding-db.test.ts — topicName → filePath
- Updated all test assertions referencing `topicName` to use `filePath` instead, matching the actual `SearchResult` and `ProgressEntry` types from `onboarding-db.ts`.

### H. Leftover Kodex naming
- **ui/src/App.tsx**: Renamed `kodexProject`/`setKodexProject` to `syncedProject`/`setSyncedProject`. Updated comments to remove Kodex references.
- **ui/src/main.tsx**: Updated comment from "Kodex sections" to "Onboarding, and Pseudo sections".
- **ui/src/pages/onboarding/OnboardingLayout.tsx**: Removed "Matches KodexLayout pattern" comment. Changed "Select a project from Kodex or Collab" to "Select a project to get started".
- **ui/src/pages/pseudo/PseudoPage.test.tsx**: Updated comments from "kodex store" to "project store".
- **ui/src/components/layout/__tests__/Sidebar.test.tsx**: Removed outdated test expecting a `/kodex` link (Sidebar no longer renders one). Replaced with a simple render verification test.

## Verification
- `npx tsc --noEmit` — no new TypeScript errors introduced. All errors in output are pre-existing in unrelated test files.
