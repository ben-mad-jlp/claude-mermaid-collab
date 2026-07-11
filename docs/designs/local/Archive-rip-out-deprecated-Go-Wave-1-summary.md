# Wave 1 Implementation — rip-out-deprecated

## Tasks
- **kodex-remove** — file deletions (skills-kodex-fix-missing.test.ts, graph-utils.ts + test) were already staged; remaining work was removing the standalone `/.collab/kodex/` line from `.gitignore`. Done. (The runtime `.collab/kodex/` dir is now untracked/ignorable — pre-existing local cache.)
- **code-file-api-extract** — created `ui/src/lib/code-file-api.ts` with verbatim copies of the four core code-file exports (`fetchCodeFile`, `CodeFileResponse`, `CodeFileNotFoundError`, `CodeFilePathError`) + local `API_BASE`. Repointed the only true core importer `CodeFileView.tsx` (split its import; `peekPseudoFile` stays on pseudo-api). Updated `CodeFileView.test.tsx` to split the vi.mock and repoint value imports. The other blueprint-listed editors (CodeEditor/GlobalSearch/LinkAndNavigateDialog/DefinitionPickerPopover) import only pseudo symbols → left untouched.
- **onboarding-remove** — onboarding files (services/route/test/lib/8 pages) were already staged for deletion. Unwired `src/server.ts` (removed import + `/api/onboarding` dispatch), `ui/src/main.tsx` (header comment + 8 page imports + `/onboarding` route block; PseudoPage kept), `vitest.config.ts` (2 stale onboarding excludes). `App.tsx:1271` is comment-only cross-route sync still needed for pseudo → no change.

## Verification
- `git status`: onboarding files D; new `code-file-api.ts` untracked; modified server.ts/main.tsx/vitest.config.ts/CodeFileView(.test).tsx/.gitignore.
- Grep: zero `onboarding`/`handleOnboardingAPI` refs in server.ts/main.tsx/vitest.config.ts.
- UI tsc + backend tsc: no errors referencing any wave-touched file (repo has known pre-existing errors elsewhere).
- CodeFileView test: 5 pass / 1 fail — the 1 failure ("renders CodeMirror on text success", CodeMirrorWrapper mock) is **PRE-EXISTING** (verified identical on HEAD before our edits). Not introduced by this wave.

## Wave TSC
Clean for all wave-touched files (pre-existing repo-wide errors unrelated to this wave).
