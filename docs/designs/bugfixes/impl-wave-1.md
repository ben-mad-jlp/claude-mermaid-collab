# Wave 1 Implementation (pseudo-db-rebuild)

## Tasks
- **pseudo-id** — `src/services/pseudo-id.ts` (new): MethodIdentity type, computeMethodId (SHA1 → m_xxxxxxxx), normalizeParams, computeBodyFingerprint (bag-of-words, stop-words, capped at 500, h_empty___ edge case)
- **pseudo-schema** — `src/services/pseudo-schema.ts` (new): SCHEMA_VERSION=3, createSchema/dropSchema, all v3 tables + FTS5 virtual + indices
- **pseudo-path-escape** — `src/services/pseudo-path-escape.ts` (new): Windows reserved-name escape, forbidden-char replacement, collision hash suffix
- **source-walker** — `src/services/source-scanner.ts` (modified): added SCANNER_EXCLUDES, walkProject async generator (git ls-files + fs fallback with symlink cycle detection + .pseudoignore layering + AbortSignal)
- **pseudo-docstring** — `src/services/pseudo-docstring.ts` (new): extractors for JSDoc, PEP257 (Google/NumPy), C# XML, Doxygen + dispatcher

## Verification
- `npx tsc --noEmit` — zero errors in all 5 files
- Pre-existing errors in unrelated files (terminal-ws-server, validator, PTYManager, types/question) ignored
- All 5 tasks marked completed
