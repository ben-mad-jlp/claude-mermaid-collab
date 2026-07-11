# Blueprint: Rip out deprecated subsystems (kodex · onboarding · pseudo)

## Source Artifacts
- `research-rip-out-deprecated` (complete DELETE + UNWIRE inventory with file:line — the authoritative file lists; this blueprint references it rather than re-enumerating every file)

## 1. Structure Summary
Full removal of three deprecated subsystems. Order matters: **kodex → onboarding → pseudo** (onboarding-manager imports `getPseudoDb`, so onboarding must go before pseudo). Code **file-viewer + Cmd+K search KEEP working** — only pseudo-powered nav (definition-jump/call-chain) is stripped from the editors.

### Critical cautions (from research)
1. **`ui/src/lib/pseudo-api.ts` is mixed** — also exports core `fetchCodeFile`/`CodeFileResponse`/`CodeFileNotFoundError`/`CodeFilePathError` (hit the core `/api/code/file` route, used by the file viewer + GlobalSearch). **Split these into a new `ui/src/lib/code-file-api.ts` FIRST**, repoint importers, then pseudo-api.ts can be deleted.
2. **Core editors import pseudo for nav**: `CodeEditor.tsx`, `CodeFileView.tsx`, `GlobalSearch.tsx`, `LinkAndNavigateDialog.tsx`, `DefinitionPickerPopover.tsx` — surgically remove the pseudo-powered features (keep file view + search), don't delete the components.

### Key wiring points (must edit, not delete)
- `src/server.ts`: imports 28/30; dispatch blocks 259-262 (pseudo) + 269-272 (onboarding); startup `initPseudoDbV6(cwd)` ~1011-1025.
- `src/mcp/setup.ts`: 9 pseudo tool imports (~196-215), 27 tool defs (2211-2604), 27 case handlers (4227-4500).
- `ui/src/main.tsx`: onboarding imports/routes (20-55), pseudo route (28, 58-59).
- `vitest.config.ts`: excludes (12,14,16,17). `.claude-plugin/plugin.json:30`: SessionStart `pseudo-rescan-*.marker` hook. `.gitignore`: pseudo/kodex lines + the committed `.collab/pseudo/pseudo.db`.

## 2. Function/Task Blueprints
Per-task file scope (full lists in `research-rip-out-deprecated`):
- **kodex-remove** — delete `ui/src/__tests__/skills-kodex-fix-missing.test.ts`, `ui/src/lib/graph-utils.ts` (+ its test); drop the kodex `.gitignore` line. Zero live wiring.
- **code-file-api-extract** — NEW `ui/src/lib/code-file-api.ts` with the core code-file exports moved out of `pseudo-api.ts`; repoint importers (`CodeEditor`, `CodeFileView`, `GlobalSearch`, `LinkAndNavigateDialog`, `DefinitionPickerPopover`) to import those from the new module. Leave pseudo exports in pseudo-api.ts for now (pseudo-ui deletes the file). Verify: ui builds.
- **onboarding-remove** — delete `src/services/onboarding-db.ts`, `onboarding-manager.ts`, `src/routes/onboarding-api.ts` (+ tests), `ui/src/lib/onboarding-api.ts`, `ui/src/pages/onboarding/` (8 pages). Unwire `server.ts` (onboarding import + dispatch 269-272) and `ui/src/main.tsx` (onboarding imports/routes). Verify: server boots, ui builds.
- **pseudo-backend** — delete `src/services/pseudo-*.ts` (20) + `src/services/__tests__/pseudo-*.test.ts` (8) + `src/mcp/tools/pseudo-*.ts` (9) + `src/routes/pseudo-api.ts` (+test) + `bin/bootstrap-pseudo.ts`. Unwire `server.ts` (pseudo import + dispatch 259-262 + `initPseudoDbV6` startup) and `src/mcp/setup.ts` (9 imports + 27 tool defs 2211-2604 + 27 case handlers 4227-4500). Verify: server boots, `tools/list` excludes all `pseudo_*`, tsc/build.
- **pseudo-ui** — delete `ui/src/pages/pseudo/` (~20), `ui/src/components/pseudo/` (3), `PseudoSideBySideView.tsx`, `PseudoTreeBody.tsx`, and `ui/src/lib/pseudo-api.ts` (+test, after code-file-api-extract). Unwire `ui/src/main.tsx` (pseudo route 28/58-59) + remove pseudo-nav features from the 5 core editors (keep file view/search; switch their code-file imports to `code-file-api`). Verify: ui builds, editor + Cmd+K work.
- **pseudo-skills-db-cleanup** — delete `skills/pseudocode/` + `skills/pseudocode-seed/`; remove the `plugin.json:30` SessionStart pseudo hook; `git rm` the committed `.collab/pseudo/pseudo.db` (+ schema if committed); remove stale `vitest.config.ts` pseudo excludes + `.gitignore` pseudo lines. Verify: plugin.json valid, vitest runs.

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: kodex-remove
    files: [ui/src/__tests__/skills-kodex-fix-missing.test.ts, ui/src/lib/graph-utils.ts, .gitignore]
    tests: []
    description: "Delete dead kodex test + graph-utils.ts (+its test); drop kodex .gitignore line. Zero live wiring."
    parallel: true
    depends-on: []
  - id: code-file-api-extract
    files: [ui/src/lib/code-file-api.ts, ui/src/lib/pseudo-api.ts, ui/src/components/editors/CodeEditor.tsx, ui/src/components/editors/CodeFileView.tsx, ui/src/components/layout/GlobalSearch.tsx]
    tests: []
    description: "Extract core code-file exports (fetchCodeFile/CodeFileResponse/CodeFileNotFoundError/CodeFilePathError) from pseudo-api.ts into new code-file-api.ts; repoint the 5 core importers. Keep pseudo exports in pseudo-api.ts for now."
    parallel: true
    depends-on: []
  - id: onboarding-remove
    files: [src/server.ts, ui/src/main.tsx, src/services/onboarding-db.ts, src/services/onboarding-manager.ts, src/routes/onboarding-api.ts, ui/src/lib/onboarding-api.ts]
    tests: []
    description: "Delete onboarding services/route/lib/pages; unwire server.ts dispatch (269-272) + main.tsx routes. Removes the getPseudoDb importer, so must precede pseudo-backend."
    parallel: true
    depends-on: []
  - id: pseudo-backend
    files: [src/server.ts, src/mcp/setup.ts, src/routes/pseudo-api.ts]
    tests: []
    description: "Delete src/services/pseudo-*.ts + tests + src/mcp/tools/pseudo-*.ts + pseudo-api route + bin/bootstrap-pseudo.ts. Unwire server.ts (dispatch 259-262 + initPseudoDbV6) and mcp/setup.ts (9 imports + 27 tool defs + 27 handlers). See research doc for full file list."
    parallel: false
    depends-on: [onboarding-remove]
  - id: pseudo-ui
    files: [ui/src/main.tsx, ui/src/lib/pseudo-api.ts, ui/src/components/editors/CodeEditor.tsx, ui/src/components/editors/CodeFileView.tsx, ui/src/components/layout/GlobalSearch.tsx]
    tests: []
    description: "Delete ui/src/pages/pseudo + components/pseudo + PseudoSideBySideView/PseudoTreeBody + pseudo-api.ts; unwire main.tsx pseudo route + strip pseudo-nav from the 5 editors (keep file view/search via code-file-api). See research doc for full file list."
    parallel: false
    depends-on: [code-file-api-extract, onboarding-remove]
  - id: pseudo-skills-db-cleanup
    files: [.claude-plugin/plugin.json, vitest.config.ts, .gitignore]
    tests: []
    description: "Delete skills/pseudocode + skills/pseudocode-seed; remove plugin.json SessionStart pseudo hook; git rm committed .collab/pseudo/pseudo.db; clean vitest excludes + .gitignore pseudo lines."
    parallel: false
    depends-on: [pseudo-backend]
```

### Execution Waves
- **Wave 1 (parallel):** kodex-remove, code-file-api-extract, onboarding-remove (disjoint files)
- **Wave 2 (parallel):** pseudo-backend (←onboarding-remove), pseudo-ui (←code-file-api-extract, onboarding-remove)
- **Wave 3:** pseudo-skills-db-cleanup (←pseudo-backend)

### Summary
- Total tasks: 6
- Total waves: 3
- Max parallelism: 3
- ~60 files deleted across 3 subsystems; 27 MCP tools removed; 2 skills removed; committed pseudo.db dropped. Verify gates each wave: server boots, tsc/builds clean, MCP excludes pseudo_*, editor+Cmd+K work, tests green.
