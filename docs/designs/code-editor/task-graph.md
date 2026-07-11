# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 14
- **Total waves:** 4
- **Max parallelism:** 7

## Execution Waves

**Wave 1:** snippet-editor, types, websocket, session-registry, collab-state, item-type, api-client
**Wave 2:** unified-editor, snippet-manager, session-store
**Wave 3:** api-routes, data-loader, sidebar
**Wave 4:** mcp-tools

## Task Graph (YAML)

```yaml
tasks:
  - id: snippet-editor
    files: [ui/src/components/editors/SnippetEditor.tsx]
    tests: [ui/src/components/editors/__tests__/SnippetEditor.test.tsx]
    description: "New SnippetEditor component with CodeMirror, toolbar, diff toggle, line highlighting"
    parallel: true
    depends-on: []
  - id: unified-editor
    files: [ui/src/components/editors/UnifiedEditor.tsx]
    tests: []
    description: "Add snippet type routing to UnifiedEditor"
    parallel: false
    depends-on: [snippet-editor]
  - id: types
    files: [src/types.ts]
    tests: []
    description: "Add Snippet, SnippetMeta, SnippetListItem interfaces"
    parallel: true
    depends-on: []
  - id: websocket
    files: [src/websocket/handler.ts]
    tests: []
    description: "Add snippet_created, snippet_updated, snippet_deleted to WSMessage union"
    parallel: true
    depends-on: []
  - id: session-registry
    files: [src/services/session-registry.ts]
    tests: []
    description: "Add snippets/ directory creation in registerSession"
    parallel: true
    depends-on: []
  - id: collab-state
    files: [src/mcp/tools/collab-state.ts]
    tests: []
    description: "Include snippets directory in archiveSession"
    parallel: true
    depends-on: []
  - id: snippet-manager
    files: [src/services/snippet-manager.ts]
    tests: [src/services/__tests__/snippet-manager.test.ts]
    description: "New SnippetManager class with CRUD for .snippet.json files"
    parallel: false
    depends-on: [types]
  - id: api-routes
    files: [src/routes/api.ts]
    tests: [src/routes/__tests__/api-snippets.test.ts]
    description: "Add 5 CRUD routes and snippetManager to createManagers"
    parallel: false
    depends-on: [snippet-manager, session-registry, websocket]
  - id: mcp-tools
    files: [src/mcp/setup.ts]
    tests: []
    description: "Register create/get/list/update/delete/history/revert_snippet MCP tools"
    parallel: false
    depends-on: [api-routes]
  - id: item-type
    files: [ui/src/types/item.ts]
    tests: []
    description: "Add 'snippet' to Item type union"
    parallel: true
    depends-on: []
  - id: api-client
    files: [ui/src/lib/api.ts]
    tests: []
    description: "Add getSnippets, getSnippet, updateSnippet, deleteSnippet methods"
    parallel: true
    depends-on: []
  - id: session-store
    files: [ui/src/stores/sessionStore.ts]
    tests: []
    description: "Add snippet state and CRUD actions following design pattern"
    parallel: false
    depends-on: [item-type]
  - id: data-loader
    files: [ui/src/hooks/useDataLoader.ts]
    tests: []
    description: "Add getSnippets to parallel fetch and WebSocket handlers"
    parallel: false
    depends-on: [api-client, session-store]
  - id: sidebar
    files: [ui/src/components/layout/Sidebar.tsx]
    tests: []
    description: "Add snippet entries with Code icon to artifact list"
    parallel: false
    depends-on: [session-store]
```

## Dependency Visualization

```mermaid
graph TD
    snippet-editor["snippet-editor<br/>"New SnippetEditor component w..."]
    unified-editor["unified-editor<br/>"Add snippet type routing to U..."]
    types["types<br/>"Add Snippet, SnippetMeta, Sni..."]
    websocket["websocket<br/>"Add snippet_created, snippet_..."]
    session-registry["session-registry<br/>"Add snippets/ directory creat..."]
    collab-state["collab-state<br/>"Include snippets directory in..."]
    snippet-manager["snippet-manager<br/>"New SnippetManager class with..."]
    api-routes["api-routes<br/>"Add 5 CRUD routes and snippet..."]
    mcp-tools["mcp-tools<br/>"Register create/get/list/upda..."]
    item-type["item-type<br/>"Add 'snippet' to Item type un..."]
    api-client["api-client<br/>"Add getSnippets, getSnippet, ..."]
    session-store["session-store<br/>"Add snippet state and CRUD ac..."]
    data-loader["data-loader<br/>"Add getSnippets to parallel f..."]
    sidebar["sidebar<br/>"Add snippet entries with Code..."]

     --> snippet-editor
    snippet-editor --> unified-editor
     --> types
     --> websocket
     --> session-registry
     --> collab-state
    types --> snippet-manager
    snippet-manager --> api-routes
    session-registry --> api-routes
    websocket --> api-routes
    api-routes --> mcp-tools
     --> item-type
     --> api-client
    item-type --> session-store
    api-client --> data-loader
    session-store --> data-loader
    session-store --> sidebar

    style snippet-editor fill:#c8e6c9
    style types fill:#c8e6c9
    style websocket fill:#c8e6c9
    style session-registry fill:#c8e6c9
    style collab-state fill:#c8e6c9
    style item-type fill:#c8e6c9
    style api-client fill:#c8e6c9
    style unified-editor fill:#bbdefb
    style snippet-manager fill:#bbdefb
    style session-store fill:#bbdefb
    style api-routes fill:#fff3e0
    style data-loader fill:#fff3e0
    style sidebar fill:#fff3e0
    style mcp-tools fill:#f3e5f5
```

## Tasks by Wave

### Wave 1

- **snippet-editor**: "New SnippetEditor component with CodeMirror, toolbar, diff toggle, line highlighting"
- **types**: "Add Snippet, SnippetMeta, SnippetListItem interfaces"
- **websocket**: "Add snippet_created, snippet_updated, snippet_deleted to WSMessage union"
- **session-registry**: "Add snippets/ directory creation in registerSession"
- **collab-state**: "Include snippets directory in archiveSession"
- **item-type**: "Add 'snippet' to Item type union"
- **api-client**: "Add getSnippets, getSnippet, updateSnippet, deleteSnippet methods"

### Wave 2

- **unified-editor**: "Add snippet type routing to UnifiedEditor"
- **snippet-manager**: "New SnippetManager class with CRUD for .snippet.json files"
- **session-store**: "Add snippet state and CRUD actions following design pattern"

### Wave 3

- **api-routes**: "Add 5 CRUD routes and snippetManager to createManagers"
- **data-loader**: "Add getSnippets to parallel fetch and WebSocket handlers"
- **sidebar**: "Add snippet entries with Code icon to artifact list"

### Wave 4

- **mcp-tools**: "Register create/get/list/update/delete/history/revert_snippet MCP tools"
