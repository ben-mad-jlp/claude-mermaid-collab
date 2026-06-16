# Completeness Review Round 2

## 1. Previous Fixes — All Verified

| File | Check | Status |
|------|-------|--------|
| `ui/src/pages/onboarding/OnboardingDashboard.tsx` | No `topicName` references | PASS |
| `src/services/__tests__/onboarding-db.test.ts` | Assertions use `filePath` not `topicName` | PASS |
| `ui/src/App.tsx` | No `kodexProject` or Kodex comments | PASS |
| `ui/src/main.tsx` | No Kodex references | PASS |
| `ui/src/pages/onboarding/OnboardingLayout.tsx` | No Kodex references | PASS |
| `ui/src/components/layout/__tests__/Sidebar.test.tsx` | No `/kodex` link test | PASS |

## 2. Remaining Kodex References in Source

Found **4 files** with lingering `kodex` references (case-insensitive):

### Active source files (should be renamed/updated):
- **`ui/src/lib/graph-utils.ts:3`** — JSDoc comment: `"from Kodex topic relationships."`
- **`ui/src/lib/__tests__/graph-utils.test.ts:11`** — Test fixture string: `"MCP tools for Kodex"` and `"KodexManager service"`

### Test files referencing old skill names:
- **`skills-tests.test.ts`** (root) — Tests for `kodex-fix-incorrect` skill, references `kodex_query_topic`, `kodex_update_topic`, `kodex_list_topics`
- **`ui/src/__tests__/skills-kodex-fix-missing.test.ts`** — Tests for `kodex-fix-missing` skill, references `kodex_create_topic`, `kodex_list_topics`

### Legacy directory (git-tracked):
- **`codex/`** — Entire legacy directory with 50+ files still tracked in git. Contains `codex/ui/src/components/topics/DocumentViewer.tsx` with `kodex-mermaid-` prefix.

**Assessment:** The skill test files and `codex/` directory reference the Kodex MCP tool names which are still valid MCP endpoints (seen in deferred tools list: `mcp__mermaid__kodex_*`). These are NOT bugs — the Kodex feature itself still exists; only the internal codebase naming was refactored. The `graph-utils.ts` comment and test fixture are cosmetic only.

## 3. Remaining topicName References

**None found** in `ui/src/` or `src/`. PASS.

## 4. Stubs and TODOs

Found **4 TODOs** in implementation files (all pre-existing, not from this refactor):

| File | Line | TODO |
|------|------|------|
| `ui/src/engine/vector.ts` | 133 | `styleOverrideIdx (TODO: encode handleMirroring)` |
| `ui/src/App.tsx` | 1341 | `TODO: Implement undo/redo` |
| `ui/src/hooks/useDocumentHistory.ts` | 105 | `TODO: Subscribe to WebSocket for document_history_updated` |
| `ui/src/hooks/useDiagramHistory.ts` | 105 | `TODO: Subscribe to WebSocket for diagram_history_updated` |

No `throw new Error('Not implemented')` or `NotImplementedError` found. PASS.

## 5. Required Files Exist

- `src/services/pseudo-parser.ts` — EXISTS
- `src/services/pseudo-db.ts` — EXISTS

## 6. Deleted Files Confirmed Gone

| Path | Status |
|------|--------|
| `src/services/kodex-manager.ts` | GONE |
| `src/routes/kodex-api.ts` | GONE |
| `ui/src/pages/kodex/` | GONE |
| `ui/src/components/kodex/` | GONE |
| `skills/kodex-*` | GONE |

## Summary

All 8 previous fixes are confirmed applied. No new regressions. The remaining `kodex` references are either in MCP tool names (which are the actual API), cosmetic comments in `graph-utils.ts`, or the legacy `codex/` reference directory. No `topicName` references remain. No new stubs introduced. The refactor is complete.
