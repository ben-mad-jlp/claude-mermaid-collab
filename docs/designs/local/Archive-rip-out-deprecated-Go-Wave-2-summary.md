# Wave 2 Implementation — rip-out-deprecated (pseudo backend + UI)

## Tasks

### pseudo-backend
- **Deleted**: all `src/services/pseudo-*.ts` (18) + their `__tests__/pseudo-*.test.ts` (7); `src/routes/pseudo-api.ts` (+test); all `src/mcp/tools/pseudo-*.ts` (9); `bin/bootstrap-pseudo.ts`.
- **Out-of-scope deps deleted** (surfaced by research, approved): `src/services/source-scanner.ts` (+test) — imported types from pseudo-db, used only by pseudo files; `bin/structural-index.ts` + `bin/structural-index-project.ts` (pseudo indexers) + `scripts/pre-commit` (its only job was running structural-index; not installed as an active hook).
- **Unwired** `src/server.ts`: removed `handlePseudoAPI` import + `/api/pseudo` dispatch.
- **Unwired** `src/mcp/setup.ts` (5 regions): top pseudo-db/ProseData/marker imports + dead readdirSync/extname; v6 tool-module import block (9); startup `initPseudoDbV6` try/catch in `setupMCPServer`; all 27 `pseudo_*` tool definitions; all 27 `pseudo_*` case handlers. setup.ts grep for pseudo = ZERO; tsc clean (only a pre-existing `import.meta.path` single-file artifact).

### pseudo-ui
- **Deleted**: `ui/src/pages/pseudo/` (dir), `ui/src/components/pseudo/` (dir), `PseudoSideBySideView.tsx`, `sidebar-tree/PseudoTreeBody.tsx`, `DefinitionPickerPopover.tsx`, `lib/definition-resolver.ts` (+test), and `lib/pseudo-api.ts` (+ both tests) LAST.
- **Unwired** `main.tsx`: PseudoPage import + `/pseudo/*` route + comment.
- **Stripped, kept working**:
  - `CodeEditor.tsx` — removed pseudo go-to-definition, symbol references, side-by-side view, Pseudo toggle, Tier-1 `fetchFunctionsForSource` effect. Function-jump dropdown KEPT by flipping `useTier2` initial to `true` (regex `extractFunctions` path). Back/nav-history kept. Cleaned orphaned refs/helpers.
  - `CodeFileView.tsx` — removed peekPseudoFile, PseudoViewerLazy, code/prose toggle, drift/pseudo memos, ProseMountedBeacon. Always renders core text view via code-file-api.
  - `GlobalSearch.tsx` — repointed `SourceLinkCandidate` type import to LinkAndNavigateDialog; Cmd+K core search untouched.
  - `LinkAndNavigateDialog.tsx` — rehomed `SourceLinkCandidate` as exported local interface (new canonical home).
  - `PaneContent.tsx` (build-critical, surfaced by research) — `code-file` case now always renders `<CodeEditor>` (was `codeFirstView ? CodeEditor : PseudoViewer`); removed PseudoViewer import + now-unused codeFirstView selector.
  - Tests: removed PseudoViewer/peekPseudoFile mocks from `CodeFileView.test.tsx`; `SplitPaneParity.test.tsx` updated to assert CodeEditor in the code-file pane.

## Verification
- Dangling-ref scan (backend + ui) for pseudo-api/pseudo-db/source-scanner/structural-index/pages-pseudo/components-pseudo/definition-resolver/DefinitionPickerPopover/PseudoSideBySideView/PseudoTreeBody/PseudoViewer → **CLEAN**.
- Backend `tsc --noEmit`: 64 errors, all pre-existing (baseline ~69), NONE reference the wave surface. The one `../code-api` "Cannot find module" is pre-existing (code-api.ts already absent; test not in our diff).
- UI `tsc` (in `tsc && vite build`): 14 errors, all pre-existing, ZERO reference any wave-touched file. (Repo's `npm run build` tsc gate was already red pre-existing; real path is vite-only.)
- **UI `vite build`: SUCCESS — ✓ built in 27.36s.** Bundle emits cleanly with pseudo/onboarding gone.
- `setup.ts`: zero pseudo → MCP `tools/list` no longer defines any `pseudo_*` tool.
- Known unrelated test failures (not introduced here): CodeFileView "renders CodeMirror on text success" (pre-existing CodeMirrorWrapper mock); SplitPaneParity "task-details → placeholder" (separate PaneContent task-details rewrite, pre-existing).

## Wave TSC / Build
Clean for all wave-touched files; UI vite production build green.

## Deviations from blueprint (approved by user)
source-scanner.ts(+test), bin/structural-index*.ts, scripts/pre-commit, definition-resolver(+test), DefinitionPickerPopover.tsx — deleted beyond the literal blueprint list because they were pseudo-only and would otherwise break the build. PaneContent.tsx rewritten (default file view had hard PseudoViewer dep).
