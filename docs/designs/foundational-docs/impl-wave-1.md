# Wave 1 Implementation

## Tasks (6, all parallel)

| Task | Files | Summary |
|---|---|---|
| `pseudo-schema-v4` | `src/services/pseudo-schema.ts` | SCHEMA_VERSION bumped 3→4. Added `callee_name_hint TEXT` + `resolution_quality TEXT NOT NULL DEFAULT 'unresolved'` to `method_calls`. Added index `idx_method_calls_resolution`. |
| `scanner-receiver-hint` | `src/services/source-scanner.ts` | `StructuralMethod.call_edges` type extended with `receiver_hint: string \| null`. `extractCallEdges` parses outermost LHS identifier from captured dotted chain; dedup key widened to `${receiver_hint ?? ''}::${last}` (fixes the `this.foo()` vs `obj.foo()` collapse bug). |
| `pseudo-resolver-module` | `src/services/pseudo-resolver.ts` (new) | Exports `resolveCallEdges(db, opts?)` with 6-round SQL resolver (exact, same_file, class, same_dir, import, ambiguous/unresolved). Plus `ResolutionQuality` union, `ResolverReport` interface, `ResolveCallEdgesOptions`. Scope-filtered when `scopeFiles` provided; no transaction ownership. |
| `prose-path-util` | `src/services/pseudo-path-escape.ts` | Added `toRelPosixPath(project, input)` — fast-path for clean rel POSIX paths, Windows-absolute heuristic (`/^[A-Za-z]:[/\\]/`), `path.relative` + backslash normalization, throws on `..`. |
| `pseudo-query-module` | `src/services/pseudo-query.ts` (new) | V2-surface query layer over V6 tables with synthesized fields per the degradation ledger. 15 exports: listFiles, getFile, getFileByStem, search, getReferences, getCallGraph, getExports, getImpactAnalysis, getOrphanFunctions, getCoverage, getSourceLink, getFunctionsForSource, getStats, getFilesByDirectory, getMethodLocation. Uses V6 FTS via the auxiliary `pseudo_fts_rowid` table. |
| `snapshot-cache-relocate` | `src/services/pseudo-snapshot.ts`, `src/services/pseudo-db.ts`, `src/services/__tests__/pseudo-integration.multiplatform.test.ts`, `.gitignore` | Snapshot cache moved from `.cache/derived.sqlite` → `.collab/pseudo/cache/derived.sqlite`. `.gitignore` adds `/.collab/pseudo/cache/`. |

## Verification

- TypeScript: `bunx tsc --noEmit` clean on all wave files.
- Pre-existing errors in unrelated files: `src/lib/mermaid.ts:2` and `src/services/renderer.ts:2` (TS5097, outside wave scope).
- Grep sanity checks passed:
  - `resolveCallEdges` exported (`pseudo-resolver.ts:36`)
  - `toRelPosixPath` exported (`pseudo-path-escape.ts:129`)
  - `SCHEMA_VERSION = 4` (`pseudo-schema.ts:11`)
  - `callee_name_hint` + `resolution_quality` present in method_calls DDL

## Notes captured during Wave 1

- Degradation ledger added to `pseudo-db-unification-design` — explicitly documents V2 fields synthesized as null/empty/0 because V6 schema is narrower (files.language, methods.params/return_type/visibility/kind/date/param_count/step_count, method_steps.depth, method_calls.callee_file_stem, SearchResult.methodName, SourceLink.language).
- V6 FTS discovery: `pseudo_fts` is contentless with columns `(title, purpose, step_content, method_names)` and no `file_path` — joined via auxiliary `pseudo_fts_rowid(rowid, file_path)`. `pseudo-query.search` uses this join pattern.
- `getMethodLocation` intentionally switched from V2's `(filePath, methodName)` to `(methodId)`. Wave 5 reroute (`code-api.ts:640`) rewrites the caller.
- `getStaleFunctions` deleted — no V6 `methods.date` column.
