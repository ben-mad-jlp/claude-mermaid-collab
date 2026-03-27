# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 14
- **Total waves:** 2
- **Max parallelism:** 10

## Execution Waves

**Wave 1:** pseudo-page, sidebar-nav, pseudo-api-route, pseudo-file-tree, parse-pseudo, pseudo-block, calls-popover, pseudo-api-client, pseudo-search, function-jump-panel
**Wave 2:** main-routes, server-registration, pseudo-viewer, calls-link

## Task Graph (YAML)

```yaml
tasks:
  - id: pseudo-page
    files: [ui/src/pages/pseudo/PseudoPage.tsx]
    tests: [ui/src/pages/pseudo/PseudoPage.test.tsx]
    description: "Implement PseudoPage layout shell with state, 3-col layout, Cmd+K handler"
    parallel: true
    depends-on: []
  - id: main-routes
    files: [ui/src/main.tsx]
    tests: []
    description: "Add /pseudo and /pseudo/* routes before App catch-all"
    parallel: false
    depends-on: [pseudo-page]
  - id: sidebar-nav
    files: [ui/src/components/layout/Sidebar.tsx]
    tests: []
    description: "Add pseudo nav link in cross-links section"
    parallel: true
    depends-on: []
  - id: pseudo-api-route
    files: [src/routes/pseudo-api.ts]
    tests: [src/routes/pseudo-api.test.ts]
    description: "Create handlePseudoAPI with /files, /file, /search endpoints using Bun.Glob"
    parallel: true
    depends-on: []
  - id: server-registration
    files: [src/server.ts]
    tests: []
    description: "Import handlePseudoAPI and register /api/pseudo route before /api/ catch-all"
    parallel: false
    depends-on: [pseudo-api-route]
  - id: pseudo-file-tree
    files: [ui/src/pages/pseudo/PseudoFileTree.tsx]
    tests: [ui/src/pages/pseudo/PseudoFileTree.test.tsx]
    description: "Implement PseudoFileTree with buildTree, filter, collapse, localStorage persistence"
    parallel: true
    depends-on: []
  - id: parse-pseudo
    files: [ui/src/pages/pseudo/parsePseudo.ts]
    tests: [ui/src/pages/pseudo/parsePseudo.test.ts]
    description: "Implement parsePseudo pure function with single linear pass"
    parallel: true
    depends-on: []
  - id: pseudo-block
    files: [ui/src/pages/pseudo/PseudoBlock.tsx]
    tests: [ui/src/pages/pseudo/PseudoBlock.test.tsx]
    description: "Render one FUNCTION block with purple/green/orange/muted styling"
    parallel: true
    depends-on: []
  - id: pseudo-viewer
    files: [ui/src/pages/pseudo/PseudoViewer.tsx]
    tests: [ui/src/pages/pseudo/PseudoViewer.test.tsx]
    description: "Fetch+parse+render file, forwardRef with scrollToFunction + getFunctions"
    parallel: false
    depends-on: [pseudo-block]
  - id: calls-popover
    files: [ui/src/pages/pseudo/CallsPopover.tsx]
    tests: [ui/src/pages/pseudo/CallsPopover.test.tsx]
    description: "320px portal card showing path, title, subtitle, exports from parsed pseudo"
    parallel: true
    depends-on: []
  - id: calls-link
    files: [ui/src/pages/pseudo/CallsLink.tsx]
    tests: [ui/src/pages/pseudo/CallsLink.test.tsx]
    description: "Orange link with 400ms hover → fetch + show popover; 300ms grace period"
    parallel: false
    depends-on: [calls-popover]
  - id: pseudo-api-client
    files: [ui/src/lib/pseudo-api.ts]
    tests: [ui/src/lib/pseudo-api.test.ts]
    description: "Implement three typed fetch wrappers for /api/pseudo endpoints"
    parallel: true
    depends-on: []
  - id: pseudo-search
    files: [ui/src/pages/pseudo/PseudoSearch.tsx]
    tests: [ui/src/pages/pseudo/PseudoSearch.test.tsx]
    description: "Cmd+K search with 200ms debounce, grouped dropdown, keyboard navigation"
    parallel: true
    depends-on: []
  - id: function-jump-panel
    files: [ui/src/pages/pseudo/FunctionJumpPanel.tsx]
    tests: [ui/src/pages/pseudo/FunctionJumpPanel.test.tsx]
    description: "220px panel with IntersectionObserver active tracking and click-to-scroll"
    parallel: true
    depends-on: []
```

## Dependency Visualization

```mermaid
graph TD
    pseudo-page["pseudo-page<br/>"Implement PseudoPage layout s..."]
    main-routes["main-routes<br/>"Add /pseudo and /pseudo/* rou..."]
    sidebar-nav["sidebar-nav<br/>"Add pseudo nav link in cross-..."]
    pseudo-api-route["pseudo-api-route<br/>"Create handlePseudoAPI with /..."]
    server-registration["server-registration<br/>"Import handlePseudoAPI and re..."]
    pseudo-file-tree["pseudo-file-tree<br/>"Implement PseudoFileTree with..."]
    parse-pseudo["parse-pseudo<br/>"Implement parsePseudo pure fu..."]
    pseudo-block["pseudo-block<br/>"Render one FUNCTION block wit..."]
    pseudo-viewer["pseudo-viewer<br/>"Fetch+parse+render file, forw..."]
    calls-popover["calls-popover<br/>"320px portal card showing pat..."]
    calls-link["calls-link<br/>"Orange link with 400ms hover ..."]
    pseudo-api-client["pseudo-api-client<br/>"Implement three typed fetch w..."]
    pseudo-search["pseudo-search<br/>"Cmd+K search with 200ms debou..."]
    function-jump-panel["function-jump-panel<br/>"220px panel with Intersection..."]

     --> pseudo-page
    pseudo-page --> main-routes
     --> sidebar-nav
     --> pseudo-api-route
    pseudo-api-route --> server-registration
     --> pseudo-file-tree
     --> parse-pseudo
     --> pseudo-block
    pseudo-block --> pseudo-viewer
     --> calls-popover
    calls-popover --> calls-link
     --> pseudo-api-client
     --> pseudo-search
     --> function-jump-panel

    style pseudo-page fill:#c8e6c9
    style sidebar-nav fill:#c8e6c9
    style pseudo-api-route fill:#c8e6c9
    style pseudo-file-tree fill:#c8e6c9
    style parse-pseudo fill:#c8e6c9
    style pseudo-block fill:#c8e6c9
    style calls-popover fill:#c8e6c9
    style pseudo-api-client fill:#c8e6c9
    style pseudo-search fill:#c8e6c9
    style function-jump-panel fill:#c8e6c9
    style main-routes fill:#bbdefb
    style server-registration fill:#bbdefb
    style pseudo-viewer fill:#bbdefb
    style calls-link fill:#bbdefb
```

## Tasks by Wave

### Wave 1

- **pseudo-page**: "Implement PseudoPage layout shell with state, 3-col layout, Cmd+K handler"
- **sidebar-nav**: "Add pseudo nav link in cross-links section"
- **pseudo-api-route**: "Create handlePseudoAPI with /files, /file, /search endpoints using Bun.Glob"
- **pseudo-file-tree**: "Implement PseudoFileTree with buildTree, filter, collapse, localStorage persistence"
- **parse-pseudo**: "Implement parsePseudo pure function with single linear pass"
- **pseudo-block**: "Render one FUNCTION block with purple/green/orange/muted styling"
- **calls-popover**: "320px portal card showing path, title, subtitle, exports from parsed pseudo"
- **pseudo-api-client**: "Implement three typed fetch wrappers for /api/pseudo endpoints"
- **pseudo-search**: "Cmd+K search with 200ms debounce, grouped dropdown, keyboard navigation"
- **function-jump-panel**: "220px panel with IntersectionObserver active tracking and click-to-scroll"

### Wave 2

- **main-routes**: "Add /pseudo and /pseudo/* routes before App catch-all"
- **server-registration**: "Import handlePseudoAPI and register /api/pseudo route before /api/ catch-all"
- **pseudo-viewer**: "Fetch+parse+render file, forwardRef with scrollToFunction + getFunctions"
- **calls-link**: "Orange link with 400ms hover → fetch + show popover; 300ms grace period"
