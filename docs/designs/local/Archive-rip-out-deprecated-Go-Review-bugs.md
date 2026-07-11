# Bug Review

Scope: edited (surviving) files only, in a deletion-heavy change removing kodex/onboarding/pseudo subsystems. Deleted files cannot contain bugs.

## Result: No bugs found.

### Files reviewed and findings

**ui/src/lib/code-file-api.ts (NEW)** — Faithful extraction of `fetchCodeFile` + `CodeFileResponse` + `CodeFileNotFoundError` + `CodeFilePathError` from the old `pseudo-api.ts`. Byte-for-byte identical logic (URL build, status handling, runtime shape validation). No bug.

**ui/src/components/editors/CodeEditor.tsx** — Pseudo nav fully stripped. Verified:
- All removed imports (PseudoSideBySideView, ReferencesPopover, pseudo-api, definition-resolver, DefinitionPickerPopover, LinkAndNavigateDialog) have zero remaining references.
- Removed state/refs (showPseudo, popover, pickerState, linkDialog, snippets, snippetsRef, currentSessionRef, filePathRef, navPushRef, jumpToLineRef) have no dangling uses.
- `useTier2` initial flipped to `true`; Tier-2 extraction effect fires on content changes as intended. Deps `[useTier2, code, language]` correct.
- `setUseTier2` is now a dead setter (never called) — harmless, not a bug; Tier-2 mode is intentionally always-on.
- FunctionJumpDropdown still wired with `functions` + `jumpToLine`. MonacoWrapper no longer passes the removed symbol-click handlers (correct).
- `mergedControls` useMemo dep array correctly dropped `showPseudo` and `handleSymbolClick`/`handleGoToDefinition`; remaining deps all live.
- `currentSession` still used (toolbar + kebab props).

**ui/src/components/editors/CodeFileView.tsx** — Prose toggle + PseudoViewer lazy + drift/pseudo useMemo removed. Core text/image/binary render path intact. `mark()` calls (code-fetch-start/end, code-first-paint) still present; `reportEditorDirty` still used. Import repointed to `@/lib/code-file-api`. No bug.

**ui/src/components/editors/LinkAndNavigateDialog.tsx** — `SourceLinkCandidate` rehomed as exported local interface. Field shape is identical to the old pseudo-api definition (sourceFilePath, sourceLine, sourceLineEnd, language, isExported). No bug.

**ui/src/components/layout/GlobalSearch.tsx** — Type import repointed to LinkAndNavigateDialog; shape matches usage. No bug.

**ui/src/components/layout/editor/PaneContent.tsx** — `codeFirstView` selector removed; code-file case now unconditionally renders `<CodeEditor filePath={tab.filePath ?? tab.artifactId} project={project} />`. Confirmed no other `codeFirstView` reference remains in the file. PseudoViewer import removed and unused. No bug.

**src/server.ts** — Removed `handlePseudoAPI`/`handleOnboardingAPI` imports and their route branches. Confirmed no remaining references to either symbol. Control flow intact. (Pre-existing tsc error at line 47 — `.ts` extension import on BindingSweeper — is unrelated to this diff and is a documented repo-wide issue.)

**src/mcp/setup.ts** — 737 lines of pure deletion, no added/stitched lines. Backend `tsc --noEmit` shows no errors in setup.ts, confirming the array/object/switch structure remains syntactically valid after the tool-def and handler removals.

**ui/src/main.tsx** — Onboarding + pseudo route blocks and their imports removed cleanly. Remaining `<Routes>` structure valid. No dangling imports.

**.claude-plugin/plugin.json** — Valid JSON (verified).

**vitest.config.ts** — Exclude array well-formed after removing deleted test entries.

**.gitignore** — Consistent removal of pseudo/kodex/onboarding ignore rules.

### Tests
Ran the two edited test files: 16 passed, 2 failed. Both failures are exactly the documented pre-existing failures:
- CodeFileView "renders CodeMirror on text success" (CodeMirrorWrapper mock)
- SplitPaneParity "task-details → placeholder (not yet implemented)"

No new test failures introduced.
