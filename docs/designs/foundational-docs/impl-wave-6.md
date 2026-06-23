# Wave 6 Implementation — Retire V2

## Task completed
- **retire-v2-class** — Deleted the V2 `PseudoDbService` class, V2 `SCHEMA_VERSION`/`SCHEMA` constants, V2 coverage helpers, and the V2-only `FileState` interface from `src/services/pseudo-db.ts`.

## Changes
- Deleted V2 SCHEMA banner + `SCHEMA_VERSION` + `SCHEMA` template literal (~lines 169-255 pre-edit).
- Deleted V2 coverage helpers block: `COVERAGE_EXTENSIONS`, `COVERAGE_EXCLUDES`, `isCoverageTestFile` (~lines 257-278 pre-edit).
- Deleted `PseudoDbService` class body (~lines 280-1120 pre-edit).
- Deleted `export interface FileState` (~lines 158-167 pre-edit).
- Fixed the `ReturnType<PseudoDbService['getFileState']>` cast in `PseudoDbV6Shim.getFileState` — replaced with an inline return shape, no cast.
- Removed unused imports: `relative`, `extname` from `path`; removed `existsSync`/`mkdirSync`/`readdirSync` import line entirely.
- Cosmetic: renamed banner comment `// ---- v2 types (two-level indexing) ----` to `// ---- shared types (V6 query surface) ----` to reflect these types now serve the V6 query layer.

## Result
- File shrank from **1624 lines to 659 lines** (60% reduction).
- Final structure: imports → shared type exports → `PseudoDbV6Shim` class + `getPseudoDb` factory → V6 in-memory bootstrap (initPseudoDbV6).

## Verification
- `tsc --noEmit`: 0 new errors.
- V6 test suites (pseudo-query, pseudo-resolver, pseudo-unification, pseudo-migration-rel): **53/53 pass**.
- No surviving references to `PseudoDbService` or `FileState` anywhere in `src/` outside the Wave-7-retired `pseudo-db.test.ts`.

## Known follow-ups (Wave 7)
- Retire `src/services/__tests__/pseudo-db.test.ts` — it still contains V2-era references and is the only file holding a `PseudoDbService` string.
- Consolidate `SCHEMA_VERSION` — now that V2 schema is gone, clean up any remaining V2 schema-version plumbing.
