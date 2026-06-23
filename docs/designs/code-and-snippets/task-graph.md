# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 18
- **Total waves:** 6
- **Max parallelism:** 5

## Execution Waves

**Wave 1:** types-backend, types-ui
**Wave 2:** artifact-manager-base, unified-editor-routing, code-editor-v2, snippet-editor-tags, artifact-tree-split
**Wave 3:** code-file-manager, snippet-manager-v2, pseudo-tree-v2, pin-to-artifact, cleanup-deletions
**Wave 4:** session-registry-v2, migration-script, mcp-snippet-tools-v2
**Wave 5:** backend-code-routes, mcp-code-tools-v2
**Wave 6:** mcp-setup-v2

## Task Graph (YAML)

```yaml
tasks:
  - id: types-backend
    files: [src/types.ts]
    tests: []
    description: "Add SnippetTag, ProposedEdit, CodeFile interfaces; rewrite Snippet to flat fields (no envelope)"
    parallel: true
    depends-on: []
  - id: types-ui
    files: [ui/src/types/item.ts]
    tests: []
    description: "Add 'code' to ItemType union; add isCodeFile guard; update label/icon/color maps"
    parallel: true
    depends-on: []
  - id: artifact-manager-base
    files: [src/services/artifact-manager.ts]
    tests: []
    description: "New generic ArtifactManager<T> base class with CRUD + history used by both SnippetManager and CodeFileManager"
    parallel: false
    depends-on: [types-backend]
  - id: code-file-manager
    files: [src/services/code-file-manager.ts]
    tests: []
    description: "New CodeFileManager extending ArtifactManager<CodeFile>; handles .codefile storage, idempotent create by filePath"
    parallel: false
    depends-on: [artifact-manager-base]
  - id: snippet-manager-v2
    files: [src/services/snippet-manager.ts]
    tests: [src/mcp/tools/__tests__/snippet.test.ts]
    description: "Extend ArtifactManager<Snippet>; update storage format from JSON envelope to flat fields (content, language, tags)"
    parallel: false
    depends-on: [artifact-manager-base]
  - id: session-registry-v2
    files: [src/services/session-registry.ts]
    tests: []
    description: "Add 'code-files' to resolvePath type union; mkdir code-files/ in session init"
    parallel: false
    depends-on: [code-file-manager]
  - id: migration-script
    files: [src/migrations/migrate-linked-snippets.ts]
    tests: []
    description: "Idempotent migration: linked snippets → .codefile records; plain snippets → flat format; backup + sentinel"
    parallel: false
    depends-on: [code-file-manager, snippet-manager-v2]
  - id: backend-code-routes
    files: [src/routes/code-api.ts]
    tests: []
    description: "All push/sync/diff/proposed-edit handlers use CodeFileManager; add GET /exists; remove envelope.linked guards; update code search"
    parallel: false
    depends-on: [code-file-manager, session-registry-v2]
  - id: mcp-code-tools-v2
    files: [src/mcp/tools/code.ts]
    tests: []
    description: "Rename link_code_file → create_code; add update_code and get_code; update all tools to use CodeFileManager; emit code_file_updated events"
    parallel: false
    depends-on: [code-file-manager, session-registry-v2]
  - id: mcp-snippet-tools-v2
    files: [src/mcp/tools/snippet.ts]
    tests: [src/mcp/tools/__tests__/snippet.test.ts, src/mcp/tools/__tests__/snippet-anchors.test.ts]
    description: "Remove sourcePath/startAt/endAt/groupId/groupName from create_snippet; add tags param to create_snippet and update_snippet"
    parallel: false
    depends-on: [snippet-manager-v2]
  - id: mcp-setup-v2
    files: [src/mcp/setup.ts]
    tests: [src/mcp/setup.test.ts]
    description: "Register create_code, update_code, get_code; deregister link_code_file; update snippet tool registrations"
    parallel: false
    depends-on: [mcp-code-tools-v2, mcp-snippet-tools-v2]
  - id: unified-editor-routing
    files: [ui/src/components/editors/UnifiedEditor.tsx]
    tests: [ui/src/components/editors/__tests__/UnifiedEditor.test.tsx]
    description: "Replace JSON.parse content-routing with item.type switch: 'code' → CodeEditor, 'snippet' → SnippetEditor"
    parallel: false
    depends-on: [types-ui]
  - id: code-editor-v2
    files: [ui/src/components/editors/CodeEditor.tsx]
    tests: []
    description: "Props: snippetId → codeFileId; use useCodeFile hook; remove parseLinkedEnvelope; update toolbar to code_file_updated WS events"
    parallel: false
    depends-on: [types-ui]
  - id: snippet-editor-tags
    files: [ui/src/components/editors/SnippetEditor.tsx]
    tests: []
    description: "Add tag strip UI with on-demand /exists resolution; remove filePath display; remove groupId/groupName rendering"
    parallel: false
    depends-on: [types-ui]
  - id: artifact-tree-split
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.test.tsx]
    description: "Split sidebar into 'Code Files' (type:code) and 'Snippets' (type:snippet) sections, each independently collapsible"
    parallel: false
    depends-on: [types-ui]
  - id: pseudo-tree-v2
    files: [ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx]
    tests: []
    description: "Annotate file nodes using Code File artifacts by filePath instead of parsing snippet envelope.linked"
    parallel: false
    depends-on: [artifact-tree-split]
  - id: pin-to-artifact
    files: [ui/src/lib/promote-code-file.ts]
    tests: []
    description: "Update pin action: call POST /api/code/create → receive code artifact id → set item.type='code' in tab state; add Pin button to ephemeral code browser tab"
    parallel: false
    depends-on: [code-editor-v2]
  - id: cleanup-deletions
    files: []
    tests: []
    description: "Delete SnippetGroupView; confirm HunkActionRow/HunkOverlay/hunkUtils already removed; remove parseLinkedEnvelope helper"
    parallel: false
    depends-on: [unified-editor-routing, snippet-editor-tags]
```

## Dependency Visualization

```mermaid
graph TD
    types-backend["types-backend<br/>"Add SnippetTag, ProposedEdit,..."]
    types-ui["types-ui<br/>"Add 'code' to ItemType union;..."]
    artifact-manager-base["artifact-manager-base<br/>"New generic ArtifactManager<T..."]
    code-file-manager["code-file-manager<br/>"New CodeFileManager extending..."]
    snippet-manager-v2["snippet-manager-v2<br/>"Extend ArtifactManager<Snippe..."]
    session-registry-v2["session-registry-v2<br/>"Add 'code-files' to resolvePa..."]
    migration-script["migration-script<br/>"Idempotent migration: linked ..."]
    backend-code-routes["backend-code-routes<br/>"All push/sync/diff/proposed-e..."]
    mcp-code-tools-v2["mcp-code-tools-v2<br/>"Rename link_code_file → creat..."]
    mcp-snippet-tools-v2["mcp-snippet-tools-v2<br/>"Remove sourcePath/startAt/end..."]
    mcp-setup-v2["mcp-setup-v2<br/>"Register create_code, update_..."]
    unified-editor-routing["unified-editor-routing<br/>"Replace JSON.parse content-ro..."]
    code-editor-v2["code-editor-v2<br/>"Props: snippetId → codeFileId..."]
    snippet-editor-tags["snippet-editor-tags<br/>"Add tag strip UI with on-dema..."]
    artifact-tree-split["artifact-tree-split<br/>"Split sidebar into 'Code File..."]
    pseudo-tree-v2["pseudo-tree-v2<br/>"Annotate file nodes using Cod..."]
    pin-to-artifact["pin-to-artifact<br/>"Update pin action: call POST ..."]
    cleanup-deletions["cleanup-deletions<br/>"Delete SnippetGroupView; conf..."]

     --> types-backend
     --> types-ui
    types-backend --> artifact-manager-base
    artifact-manager-base --> code-file-manager
    artifact-manager-base --> snippet-manager-v2
    code-file-manager --> session-registry-v2
    code-file-manager --> migration-script
    snippet-manager-v2 --> migration-script
    code-file-manager --> backend-code-routes
    session-registry-v2 --> backend-code-routes
    code-file-manager --> mcp-code-tools-v2
    session-registry-v2 --> mcp-code-tools-v2
    snippet-manager-v2 --> mcp-snippet-tools-v2
    mcp-code-tools-v2 --> mcp-setup-v2
    mcp-snippet-tools-v2 --> mcp-setup-v2
    types-ui --> unified-editor-routing
    types-ui --> code-editor-v2
    types-ui --> snippet-editor-tags
    types-ui --> artifact-tree-split
    artifact-tree-split --> pseudo-tree-v2
    code-editor-v2 --> pin-to-artifact
    unified-editor-routing --> cleanup-deletions
    snippet-editor-tags --> cleanup-deletions

    style types-backend fill:#c8e6c9
    style types-ui fill:#c8e6c9
    style artifact-manager-base fill:#bbdefb
    style unified-editor-routing fill:#bbdefb
    style code-editor-v2 fill:#bbdefb
    style snippet-editor-tags fill:#bbdefb
    style artifact-tree-split fill:#bbdefb
    style code-file-manager fill:#fff3e0
    style snippet-manager-v2 fill:#fff3e0
    style pseudo-tree-v2 fill:#fff3e0
    style pin-to-artifact fill:#fff3e0
    style cleanup-deletions fill:#fff3e0
    style session-registry-v2 fill:#f3e5f5
    style migration-script fill:#f3e5f5
    style mcp-snippet-tools-v2 fill:#f3e5f5
    style backend-code-routes fill:#ffccbc
    style mcp-code-tools-v2 fill:#ffccbc
    style mcp-setup-v2 fill:#c8e6c9
```

## Tasks by Wave

### Wave 1

- **types-backend**: "Add SnippetTag, ProposedEdit, CodeFile interfaces; rewrite Snippet to flat fields (no envelope)"
- **types-ui**: "Add 'code' to ItemType union; add isCodeFile guard; update label/icon/color maps"

### Wave 2

- **artifact-manager-base**: "New generic ArtifactManager<T> base class with CRUD + history used by both SnippetManager and CodeFileManager"
- **unified-editor-routing**: "Replace JSON.parse content-routing with item.type switch: 'code' → CodeEditor, 'snippet' → SnippetEditor"
- **code-editor-v2**: "Props: snippetId → codeFileId; use useCodeFile hook; remove parseLinkedEnvelope; update toolbar to code_file_updated WS events"
- **snippet-editor-tags**: "Add tag strip UI with on-demand /exists resolution; remove filePath display; remove groupId/groupName rendering"
- **artifact-tree-split**: "Split sidebar into 'Code Files' (type:code) and 'Snippets' (type:snippet) sections, each independently collapsible"

### Wave 3

- **code-file-manager**: "New CodeFileManager extending ArtifactManager<CodeFile>; handles .codefile storage, idempotent create by filePath"
- **snippet-manager-v2**: "Extend ArtifactManager<Snippet>; update storage format from JSON envelope to flat fields (content, language, tags)"
- **pseudo-tree-v2**: "Annotate file nodes using Code File artifacts by filePath instead of parsing snippet envelope.linked"
- **pin-to-artifact**: "Update pin action: call POST /api/code/create → receive code artifact id → set item.type='code' in tab state; add Pin button to ephemeral code browser tab"
- **cleanup-deletions**: "Delete SnippetGroupView; confirm HunkActionRow/HunkOverlay/hunkUtils already removed; remove parseLinkedEnvelope helper"

### Wave 4

- **session-registry-v2**: "Add 'code-files' to resolvePath type union; mkdir code-files/ in session init"
- **migration-script**: "Idempotent migration: linked snippets → .codefile records; plain snippets → flat format; backup + sentinel"
- **mcp-snippet-tools-v2**: "Remove sourcePath/startAt/endAt/groupId/groupName from create_snippet; add tags param to create_snippet and update_snippet"

### Wave 5

- **backend-code-routes**: "All push/sync/diff/proposed-edit handlers use CodeFileManager; add GET /exists; remove envelope.linked guards; update code search"
- **mcp-code-tools-v2**: "Rename link_code_file → create_code; add update_code and get_code; update all tools to use CodeFileManager; emit code_file_updated events"

### Wave 6

- **mcp-setup-v2**: "Register create_code, update_code, get_code; deregister link_code_file; update snippet tool registrations"
