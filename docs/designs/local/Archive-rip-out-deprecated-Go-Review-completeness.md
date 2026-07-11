# Completeness Review — rip-out-deprecated removal blueprint

**Verdict: Everything complete. 0 gaps found.**

## 1. Deletions (all confirmed gone)
- src/services/pseudo-*.ts, onboarding-db.ts, onboarding-manager.ts, source-scanner.ts — gone
- src/mcp/tools/pseudo-*.ts (9) — gone (no pseudo files remain in src/mcp/tools)
- src/routes/pseudo-api.ts, onboarding-api.ts — gone
- bin/bootstrap-pseudo.ts, structural-index.ts, structural-index-project.ts — gone
- scripts/pre-commit — gone
- ui/src/pages/ entirely absent (pseudo + onboarding 8 pages) — gone
- ui/src/components/pseudo/ — gone
- ui/src/components/editors/DefinitionPickerPopover.tsx, PseudoSideBySideView.tsx, PseudoTreeBody.tsx — gone (DefinitionPickerPopover per approved deviation)
- ui/src/lib/pseudo-api.ts, onboarding-api.ts, graph-utils.ts, definition-resolver.ts — gone
- skills/pseudocode, skills/pseudocode-seed — gone

## 2. Unwirings (no dangling references)
Grep across src, ui/src, bin, scripts (excluding node_modules/dist) for: handlePseudoAPI, handleOnboardingAPI, /api/pseudo, /api/onboarding, initPseudoDbV6, getPseudoDb, @/lib/pseudo-api, @/lib/onboarding-api, pages/pseudo, pages/onboarding, components/pseudo, bootstrap-pseudo, structural-index, definition-resolver, DefinitionPickerPopover, graph-utils, source-scanner, PseudoSideBySideView, PseudoTreeBody — **zero matches**.
- src/mcp/setup.ts: **0** occurrences of `pseudo_` (all 27 tool defs/handlers + 9 imports + startup initPseudoDbV6 removed).
- src/server.ts: no pseudo/onboarding references.
- ui/src/main.tsx: no pseudo/onboarding route references.

## 3. NEW ui/src/lib/code-file-api.ts
Exists with all 4 core exports: `fetchCodeFile`, `CodeFileResponse`, `CodeFileNotFoundError`, `CodeFilePathError`. Importers (CodeFileView.tsx + its test) resolve to `@/lib/code-file-api`.

## 4. plugin.json + tracked db
- plugin.json: valid JSON; SessionStart hook now only runs session-start-hook.sh — **no pseudo hook**; no `pseudo` substring anywhere in file.
- `git ls-files .collab/pseudo/` returns nothing — db untracked.

## 5. Kept editors (functional, pseudo-nav stripped)
- CodeEditor.tsx, CodeFileView.tsx, LinkAndNavigateDialog.tsx, GlobalSearch.tsx (in components/layout) all exist.
- GlobalSearch retains Cmd+K overlay and imports only live modules (code-search-api, link-file, LinkAndNavigateDialog). Its remaining `kind:'pseudo'` references are the backend search-result kind (explicitly acceptable per blueprint check 6), not imports of deleted code.
- DefinitionPickerPopover deleted per approved deviation.
- PaneContent.tsx renders CodeEditor by default (imports + uses CodeEditor; no pseudo).

## 6. Config cleanup
- .gitignore: no pseudo/onboarding/kodex lines.
- package.json: no pseudo/onboarding/structural/bootstrap references.
- vitest.config.ts / ui/vitest.config.ts: no pseudo/onboarding/structural/source-scanner/graph-utils/definition excludes remaining.

## Notes
- `npx tsc --noEmit` on ui produced pre-existing type errors (CollapsibleDetails, DocumentEditor.legacy, SplitPane, SubscriptionsPanel) — none reference removed subsystems or missing modules; unrelated to this removal.
