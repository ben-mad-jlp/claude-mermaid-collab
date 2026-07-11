# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 6
- **Total waves:** 3
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** kodex-remove, code-file-api-extract, onboarding-remove
**Wave 2:** pseudo-backend, pseudo-ui
**Wave 3:** pseudo-skills-db-cleanup

## Task Graph (YAML)

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

## Dependency Visualization

```mermaid
graph TD
    kodex-remove["kodex-remove<br/>"Delete dead kodex test + grap..."]
    code-file-api-extract["code-file-api-extract<br/>"Extract core code-file export..."]
    onboarding-remove["onboarding-remove<br/>"Delete onboarding services/ro..."]
    pseudo-backend["pseudo-backend<br/>"Delete src/services/pseudo-*...."]
    pseudo-ui["pseudo-ui<br/>"Delete ui/src/pages/pseudo + ..."]
    pseudo-skills-db-cleanup["pseudo-skills-db-cleanup<br/>"Delete skills/pseudocode + sk..."]

     --> kodex-remove
     --> code-file-api-extract
     --> onboarding-remove
    onboarding-remove --> pseudo-backend
    code-file-api-extract --> pseudo-ui
    onboarding-remove --> pseudo-ui
    pseudo-backend --> pseudo-skills-db-cleanup

    style kodex-remove fill:#c8e6c9
    style code-file-api-extract fill:#c8e6c9
    style onboarding-remove fill:#c8e6c9
    style pseudo-backend fill:#bbdefb
    style pseudo-ui fill:#bbdefb
    style pseudo-skills-db-cleanup fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **kodex-remove**: "Delete dead kodex test + graph-utils.ts (+its test); drop kodex .gitignore line. Zero live wiring."
- **code-file-api-extract**: "Extract core code-file exports (fetchCodeFile/CodeFileResponse/CodeFileNotFoundError/CodeFilePathError) from pseudo-api.ts into new code-file-api.ts; repoint the 5 core importers. Keep pseudo exports in pseudo-api.ts for now."
- **onboarding-remove**: "Delete onboarding services/route/lib/pages; unwire server.ts dispatch (269-272) + main.tsx routes. Removes the getPseudoDb importer, so must precede pseudo-backend."

### Wave 2

- **pseudo-backend**: "Delete src/services/pseudo-*.ts + tests + src/mcp/tools/pseudo-*.ts + pseudo-api route + bin/bootstrap-pseudo.ts. Unwire server.ts (dispatch 259-262 + initPseudoDbV6) and mcp/setup.ts (9 imports + 27 tool defs + 27 handlers). See research doc for full file list."
- **pseudo-ui**: "Delete ui/src/pages/pseudo + components/pseudo + PseudoSideBySideView/PseudoTreeBody + pseudo-api.ts; unwire main.tsx pseudo route + strip pseudo-nav from the 5 editors (keep file view/search via code-file-api). See research doc for full file list."

### Wave 3

- **pseudo-skills-db-cleanup**: "Delete skills/pseudocode + skills/pseudocode-seed; remove plugin.json SessionStart pseudo hook; git rm committed .collab/pseudo/pseudo.db; clean vitest excludes + .gitignore pseudo lines."
