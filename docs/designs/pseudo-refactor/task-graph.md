# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 17
- **Total waves:** 6
- **Max parallelism:** 7

## Execution Waves

**Wave 1:** pseudo-api-types
**Wave 2:** pseudo-viewer, pseudo-block, calls-popover, function-jump-panel, pseudo-file-tree, pseudo-search
**Wave 3:** calls-link
**Wave 4:** pseudo-page
**Wave 5:** delete-parse-pseudo
**Wave 6:** test-pseudo-block, test-calls-popover, test-calls-link, test-function-jump-panel, test-pseudo-page, test-pseudo-file-tree, test-pseudo-search

## Task Graph (YAML)

```yaml
tasks:
  - id: pseudo-api-types
    files: [ui/src/lib/pseudo-api.ts]
    tests: []
    description: "Add PseudoFileSummary, PseudoMethod, PseudoFileWithMethods types. Update fetchPseudoFiles return to PseudoFileSummary[]. Update fetchPseudoFile return to PseudoFileWithMethods. Remove old string-extraction logic."
    parallel: true
    depends-on: []
  - id: pseudo-viewer
    files: [ui/src/pages/pseudo/PseudoViewer.tsx]
    tests: []
    description: "Remove parsePseudo import. Replace content:string state with file:PseudoFileWithMethods|null. Read title/purpose/syncedAt/methods directly. Pass methods to onFunctionsChange."
    parallel: false
    depends-on: [pseudo-api-types]
  - id: pseudo-block
    files: [ui/src/pages/pseudo/PseudoBlock.tsx]
    tests: []
    description: "Replace ParsedFunction with PseudoMethod. Replace body[].map(renderBodyLine) with steps[].map(renderStep). Use step.depth for indentation. Rename isExport→isExported, updatedAt→date."
    parallel: true
    depends-on: [pseudo-api-types]
  - id: calls-popover
    files: [ui/src/pages/pseudo/CallsPopover.tsx]
    tests: []
    description: "Remove parsePseudo import. Change content prop to fileData:PseudoFileWithMethods. Read title/purpose/exports directly from structured data."
    parallel: true
    depends-on: [pseudo-api-types]
  - id: function-jump-panel
    files: [ui/src/pages/pseudo/FunctionJumpPanel.tsx]
    tests: []
    description: "Replace ParsedFunction with PseudoMethod. Update isExport→isExported in export dot render."
    parallel: true
    depends-on: [pseudo-api-types]
  - id: pseudo-file-tree
    files: [ui/src/pages/pseudo/PseudoFileTree.tsx]
    tests: []
    description: "Change fileList prop from string[] to PseudoFileSummary[]. Extract filePath for buildTree. Add method/export count badges on leaf nodes."
    parallel: true
    depends-on: [pseudo-api-types]
  - id: pseudo-search
    files: [ui/src/pages/pseudo/PseudoSearch.tsx]
    tests: []
    description: "Full rewrite for code quality. Clean up flat result handling, remove dead code paths."
    parallel: true
    depends-on: [pseudo-api-types]
  - id: calls-link
    files: [ui/src/pages/pseudo/CallsLink.tsx]
    tests: []
    description: "Update fetchPseudoFile call (returns PseudoFileWithMethods). Change popoverState.content to fileData. Pass fileData prop to CallsPopover."
    parallel: false
    depends-on: [calls-popover]
  - id: pseudo-page
    files: [ui/src/pages/pseudo/PseudoPage.tsx]
    tests: []
    description: "Replace ParsedFunction with PseudoMethod. Replace string[] with PseudoFileSummary[] for fileList. Delete fileCache state. Update child component props."
    parallel: false
    depends-on: [pseudo-viewer, pseudo-block, pseudo-file-tree, function-jump-panel, calls-link, pseudo-search]
  - id: delete-parse-pseudo
    files: [ui/src/pages/pseudo/parsePseudo.ts]
    tests: [ui/src/pages/pseudo/parsePseudo.test.ts]
    description: "Delete parsePseudo.ts and parsePseudo.test.ts. Verify no remaining imports across codebase."
    parallel: false
    depends-on: [pseudo-page]
  - id: test-pseudo-block
    files: [ui/src/pages/pseudo/PseudoBlock.test.tsx]
    tests: []
    description: "Replace ParsedFunction fixtures with PseudoMethod. Change isExport→isExported, updatedAt→date, body→steps."
    parallel: true
    depends-on: [delete-parse-pseudo]
  - id: test-calls-popover
    files: [ui/src/pages/pseudo/CallsPopover.test.tsx]
    tests: []
    description: "Replace raw text content with PseudoFileWithMethods objects. Update prop names from content to fileData."
    parallel: true
    depends-on: [delete-parse-pseudo]
  - id: test-calls-link
    files: [ui/src/pages/pseudo/CallsLink.test.tsx]
    tests: []
    description: "Update mock fetchPseudoFile to return PseudoFileWithMethods instead of raw string."
    parallel: true
    depends-on: [delete-parse-pseudo]
  - id: test-function-jump-panel
    files: [ui/src/pages/pseudo/FunctionJumpPanel.test.tsx]
    tests: []
    description: "Replace ParsedFunction fixtures with PseudoMethod. Update isExport→isExported."
    parallel: true
    depends-on: [delete-parse-pseudo]
  - id: test-pseudo-page
    files: [ui/src/pages/pseudo/PseudoPage.test.tsx]
    tests: []
    description: "Update mock fetchPseudoFiles to return PseudoFileSummary[]. Update mock fetchPseudoFile to return PseudoFileWithMethods."
    parallel: true
    depends-on: [delete-parse-pseudo]
  - id: test-pseudo-file-tree
    files: [ui/src/pages/pseudo/PseudoFileTree.test.tsx]
    tests: []
    description: "Change fileList fixtures from string[] to PseudoFileSummary[]. Verify badge rendering."
    parallel: true
    depends-on: [delete-parse-pseudo]
  - id: test-pseudo-search
    files: [ui/src/pages/pseudo/PseudoSearch.test.tsx]
    tests: []
    description: "Review for consistency with rewritten component. May need DOM query updates."
    parallel: true
    depends-on: [delete-parse-pseudo]
```

## Dependency Visualization

```mermaid
graph TD
    pseudo-api-types["pseudo-api-types<br/>"Add PseudoFileSummary, Pseudo..."]
    pseudo-viewer["pseudo-viewer<br/>"Remove parsePseudo import. Re..."]
    pseudo-block["pseudo-block<br/>"Replace ParsedFunction with P..."]
    calls-popover["calls-popover<br/>"Remove parsePseudo import. Ch..."]
    function-jump-panel["function-jump-panel<br/>"Replace ParsedFunction with P..."]
    pseudo-file-tree["pseudo-file-tree<br/>"Change fileList prop from str..."]
    pseudo-search["pseudo-search<br/>"Full rewrite for code quality..."]
    calls-link["calls-link<br/>"Update fetchPseudoFile call (..."]
    pseudo-page["pseudo-page<br/>"Replace ParsedFunction with P..."]
    delete-parse-pseudo["delete-parse-pseudo<br/>"Delete parsePseudo.ts and par..."]
    test-pseudo-block["test-pseudo-block<br/>"Replace ParsedFunction fixtur..."]
    test-calls-popover["test-calls-popover<br/>"Replace raw text content with..."]
    test-calls-link["test-calls-link<br/>"Update mock fetchPseudoFile t..."]
    test-function-jump-panel["test-function-jump-panel<br/>"Replace ParsedFunction fixtur..."]
    test-pseudo-page["test-pseudo-page<br/>"Update mock fetchPseudoFiles ..."]
    test-pseudo-file-tree["test-pseudo-file-tree<br/>"Change fileList fixtures from..."]
    test-pseudo-search["test-pseudo-search<br/>"Review for consistency with r..."]

     --> pseudo-api-types
    pseudo-api-types --> pseudo-viewer
    pseudo-api-types --> pseudo-block
    pseudo-api-types --> calls-popover
    pseudo-api-types --> function-jump-panel
    pseudo-api-types --> pseudo-file-tree
    pseudo-api-types --> pseudo-search
    calls-popover --> calls-link
    pseudo-viewer --> pseudo-page
    pseudo-block --> pseudo-page
    pseudo-file-tree --> pseudo-page
    function-jump-panel --> pseudo-page
    calls-link --> pseudo-page
    pseudo-search --> pseudo-page
    pseudo-page --> delete-parse-pseudo
    delete-parse-pseudo --> test-pseudo-block
    delete-parse-pseudo --> test-calls-popover
    delete-parse-pseudo --> test-calls-link
    delete-parse-pseudo --> test-function-jump-panel
    delete-parse-pseudo --> test-pseudo-page
    delete-parse-pseudo --> test-pseudo-file-tree
    delete-parse-pseudo --> test-pseudo-search

    style pseudo-api-types fill:#c8e6c9
    style pseudo-viewer fill:#bbdefb
    style pseudo-block fill:#bbdefb
    style calls-popover fill:#bbdefb
    style function-jump-panel fill:#bbdefb
    style pseudo-file-tree fill:#bbdefb
    style pseudo-search fill:#bbdefb
    style calls-link fill:#fff3e0
    style pseudo-page fill:#f3e5f5
    style delete-parse-pseudo fill:#ffccbc
    style test-pseudo-block fill:#c8e6c9
    style test-calls-popover fill:#c8e6c9
    style test-calls-link fill:#c8e6c9
    style test-function-jump-panel fill:#c8e6c9
    style test-pseudo-page fill:#c8e6c9
    style test-pseudo-file-tree fill:#c8e6c9
    style test-pseudo-search fill:#c8e6c9
```

## Tasks by Wave

### Wave 1

- **pseudo-api-types**: "Add PseudoFileSummary, PseudoMethod, PseudoFileWithMethods types. Update fetchPseudoFiles return to PseudoFileSummary[]. Update fetchPseudoFile return to PseudoFileWithMethods. Remove old string-extraction logic."

### Wave 2

- **pseudo-viewer**: "Remove parsePseudo import. Replace content:string state with file:PseudoFileWithMethods|null. Read title/purpose/syncedAt/methods directly. Pass methods to onFunctionsChange."
- **pseudo-block**: "Replace ParsedFunction with PseudoMethod. Replace body[].map(renderBodyLine) with steps[].map(renderStep). Use step.depth for indentation. Rename isExport→isExported, updatedAt→date."
- **calls-popover**: "Remove parsePseudo import. Change content prop to fileData:PseudoFileWithMethods. Read title/purpose/exports directly from structured data."
- **function-jump-panel**: "Replace ParsedFunction with PseudoMethod. Update isExport→isExported in export dot render."
- **pseudo-file-tree**: "Change fileList prop from string[] to PseudoFileSummary[]. Extract filePath for buildTree. Add method/export count badges on leaf nodes."
- **pseudo-search**: "Full rewrite for code quality. Clean up flat result handling, remove dead code paths."

### Wave 3

- **calls-link**: "Update fetchPseudoFile call (returns PseudoFileWithMethods). Change popoverState.content to fileData. Pass fileData prop to CallsPopover."

### Wave 4

- **pseudo-page**: "Replace ParsedFunction with PseudoMethod. Replace string[] with PseudoFileSummary[] for fileList. Delete fileCache state. Update child component props."

### Wave 5

- **delete-parse-pseudo**: "Delete parsePseudo.ts and parsePseudo.test.ts. Verify no remaining imports across codebase."

### Wave 6

- **test-pseudo-block**: "Replace ParsedFunction fixtures with PseudoMethod. Change isExport→isExported, updatedAt→date, body→steps."
- **test-calls-popover**: "Replace raw text content with PseudoFileWithMethods objects. Update prop names from content to fileData."
- **test-calls-link**: "Update mock fetchPseudoFile to return PseudoFileWithMethods instead of raw string."
- **test-function-jump-panel**: "Replace ParsedFunction fixtures with PseudoMethod. Update isExport→isExported."
- **test-pseudo-page**: "Update mock fetchPseudoFiles to return PseudoFileSummary[]. Update mock fetchPseudoFile to return PseudoFileWithMethods."
- **test-pseudo-file-tree**: "Change fileList fixtures from string[] to PseudoFileSummary[]. Verify badge rendering."
- **test-pseudo-search**: "Review for consistency with rewritten component. May need DOM query updates."
