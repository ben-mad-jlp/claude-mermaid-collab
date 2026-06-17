# Wave 1 Implementation

## Tasks

### relocate-shared-infra
- Renamed `kodexStore.ts` → `projectStore.ts` (interface `KodexState` → `ProjectState`, hook `useKodexStore` → `useProjectStore`)
- Moved `ProjectSelector.tsx` from `components/kodex/` to `components/shared/`
- Updated imports in 21 consuming files (14 .tsx + 7 .pseudo)
- All git mv operations + content edits successful

### fix-parser-regex
- Updated FUNCTION header regex in `parsePseudo.ts` to handle both `EXPORT [date]` and `[date] EXPORT` orderings
- Updated `isExport` and `updatedAt` extraction to check both capture group positions

## Verification
- TypeScript: pre-existing errors in test files only, none related to refactor
- No remaining references to old paths (`kodexStore`, `components/kodex/ProjectSelector`)
- New files confirmed at correct paths
- parsePseudo tests: 35/35 passed
- Both tasks marked completed