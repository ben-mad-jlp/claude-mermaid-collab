# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 20
- **Total waves:** 3
- **Max parallelism:** 10

## Execution Waves

**Wave 1:** alias-chip, api-methods, alias-schema, graph-utils, api-method, sidebar-nav, backend-support, alias-constants, keyword-extraction, alias-expansion
**Wave 2:** alias-editor, alias-query, alias-manage, graph-page, generator-core
**Wave 3:** topic-detail-integration, mcp-tools, routing, generator-tests, skill-definition

## Task Graph (YAML)

```yaml
tasks:
  - id: alias-chip
    files: [ui/src/components/kodex/AliasChip.tsx]
    tests: [ui/src/components/kodex/__tests__/AliasChip.test.tsx]
    description: Create AliasChip component for rendering single alias with remove button
    parallel: true
    depends-on: []
  - id: alias-editor
    files: [ui/src/components/kodex/AliasEditor.tsx]
    tests: [ui/src/components/kodex/__tests__/AliasEditor.test.tsx]
    description: Create AliasEditor component for managing alias list
    parallel: false
    depends-on: [alias-chip]
  - id: api-methods
    files: [ui/src/lib/kodex-api.ts]
    tests: [ui/src/lib/__tests__/kodex-api.test.ts]
    description: Add addAlias and removeAlias HTTP methods to API client
    parallel: true
    depends-on: []
  - id: topic-detail-integration
    files: [ui/src/pages/kodex/TopicDetail.tsx]
    tests: [ui/src/pages/kodex/__tests__/TopicDetail.test.tsx]
    description: Integrate AliasEditor in TopicDetail page
    parallel: false
    depends-on: [alias-editor, api-methods]
  - id: alias-schema
    files: [src/services/kodex-manager.ts]
    tests: [src/services/__tests__/kodex-manager.test.ts]
    description: Add aliases column to topics table, update TypeScript types
    parallel: true
    depends-on: []
  - id: alias-query
    files: [src/services/kodex-manager.ts]
    tests: [src/services/__tests__/kodex-manager.test.ts]
    description: Implement getTopic() with alias fallback search
    parallel: false
    depends-on: [alias-schema]
  - id: alias-manage
    files: [src/services/kodex-manager.ts]
    tests: [src/services/__tests__/kodex-manager.test.ts]
    description: Implement addAlias() and removeAlias() methods
    parallel: false
    depends-on: [alias-schema]
  - id: mcp-tools
    files: [src/mcp/setup.ts]
    tests: [src/mcp/__tests__/tools.test.ts]
    description: Register kodex_add_alias and kodex_remove_alias tools
    parallel: false
    depends-on: [alias-manage]
  - id: graph-utils
    files: [ui/src/lib/graph-utils.ts]
    tests: [ui/src/lib/__tests__/graph-utils.test.ts]
    description: Implement graph utility functions (parsing, edge building, Mermaid generation)
    parallel: true
    depends-on: []
  - id: api-method
    files: [ui/src/lib/kodex-api.ts]
    tests: [ui/src/lib/__tests__/kodex-api.test.ts]
    description: Add listTopicsWithContent() method to API client
    parallel: true
    depends-on: []
  - id: graph-page
    files: [ui/src/pages/kodex/Graph.tsx]
    tests: [ui/src/pages/kodex/__tests__/Graph.test.tsx]
    description: Create Graph page component
    parallel: false
    depends-on: [graph-utils, api-method]
  - id: sidebar-nav
    files: [ui/src/components/kodex/KodexSidebar.tsx]
    tests: [ui/src/components/kodex/__tests__/KodexSidebar.test.tsx]
    description: Add Graph link to sidebar navigation
    parallel: true
    depends-on: []
  - id: routing
    files: [ui/src/App.tsx]
    tests: []
    description: Add /kodex/graph route
    parallel: false
    depends-on: [graph-page]
  - id: backend-support
    files: [src/routes/kodex-api.ts]
    tests: [src/routes/__tests__/kodex-api.test.ts]
    description: Add includeContent query param support to /topics endpoint
    parallel: true
    depends-on: []
  - id: alias-constants
    files: [src/services/alias-generator.ts]
    tests: []
    description: Define SYNONYMS and ABBREVIATIONS constant maps
    parallel: true
    depends-on: []
  - id: keyword-extraction
    files: [src/services/alias-generator.ts]
    tests: [src/services/__tests__/alias-generator.test.ts]
    description: Implement extractTitleKeywords and extractContentKeywords
    parallel: true
    depends-on: []
  - id: alias-expansion
    files: [src/services/alias-generator.ts]
    tests: [src/services/__tests__/alias-generator.test.ts]
    description: Implement expandWithSynonyms and expandWithAbbreviations
    parallel: true
    depends-on: []
  - id: generator-core
    files: [src/services/alias-generator.ts]
    tests: [src/services/__tests__/alias-generator.test.ts]
    description: Implement main generateAliases() function
    parallel: false
    depends-on: [alias-constants, keyword-extraction, alias-expansion]
  - id: generator-tests
    files: [src/services/__tests__/alias-generator.test.ts]
    tests: []
    description: Complete test suite for generator
    parallel: false
    depends-on: [generator-core]
  - id: skill-definition
    files: [skills/kodex-generate-aliases/SKILL.md]
    tests: []
    description: Create skill definition for manual alias generation
    parallel: true
    depends-on: [generator-core]
```

## Dependency Visualization

```mermaid
graph TD
    alias-chip["alias-chip<br/>Create AliasChip component for..."]
    alias-editor["alias-editor<br/>Create AliasEditor component f..."]
    api-methods["api-methods<br/>Add addAlias and removeAlias H..."]
    topic-detail-integration["topic-detail-integration<br/>Integrate AliasEditor in Topic..."]
    alias-schema["alias-schema<br/>Add aliases column to topics t..."]
    alias-query["alias-query<br/>Implement getTopic() with alia..."]
    alias-manage["alias-manage<br/>Implement addAlias() and remov..."]
    mcp-tools["mcp-tools<br/>Register kodex_add_alias and k..."]
    graph-utils["graph-utils<br/>Implement graph utility functi..."]
    api-method["api-method<br/>Add listTopicsWithContent() me..."]
    graph-page["graph-page<br/>Create Graph page component"]
    sidebar-nav["sidebar-nav<br/>Add Graph link to sidebar navi..."]
    routing["routing<br/>Add /kodex/graph route"]
    backend-support["backend-support<br/>Add includeContent query param..."]
    alias-constants["alias-constants<br/>Define SYNONYMS and ABBREVIATI..."]
    keyword-extraction["keyword-extraction<br/>Implement extractTitleKeywords..."]
    alias-expansion["alias-expansion<br/>Implement expandWithSynonyms a..."]
    generator-core["generator-core<br/>Implement main generateAliases..."]
    generator-tests["generator-tests<br/>Complete test suite for genera..."]
    skill-definition["skill-definition<br/>Create skill definition for ma..."]

     --> alias-chip
    alias-chip --> alias-editor
     --> api-methods
    alias-editor --> topic-detail-integration
    api-methods --> topic-detail-integration
     --> alias-schema
    alias-schema --> alias-query
    alias-schema --> alias-manage
    alias-manage --> mcp-tools
     --> graph-utils
     --> api-method
    graph-utils --> graph-page
    api-method --> graph-page
     --> sidebar-nav
    graph-page --> routing
     --> backend-support
     --> alias-constants
     --> keyword-extraction
     --> alias-expansion
    alias-constants --> generator-core
    keyword-extraction --> generator-core
    alias-expansion --> generator-core
    generator-core --> generator-tests
    generator-core --> skill-definition

    style alias-chip fill:#c8e6c9
    style api-methods fill:#c8e6c9
    style alias-schema fill:#c8e6c9
    style graph-utils fill:#c8e6c9
    style api-method fill:#c8e6c9
    style sidebar-nav fill:#c8e6c9
    style backend-support fill:#c8e6c9
    style alias-constants fill:#c8e6c9
    style keyword-extraction fill:#c8e6c9
    style alias-expansion fill:#c8e6c9
    style alias-editor fill:#bbdefb
    style alias-query fill:#bbdefb
    style alias-manage fill:#bbdefb
    style graph-page fill:#bbdefb
    style generator-core fill:#bbdefb
    style topic-detail-integration fill:#fff3e0
    style mcp-tools fill:#fff3e0
    style routing fill:#fff3e0
    style generator-tests fill:#fff3e0
    style skill-definition fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **alias-chip**: Create AliasChip component for rendering single alias with remove button
- **api-methods**: Add addAlias and removeAlias HTTP methods to API client
- **alias-schema**: Add aliases column to topics table, update TypeScript types
- **graph-utils**: Implement graph utility functions (parsing, edge building, Mermaid generation)
- **api-method**: Add listTopicsWithContent() method to API client
- **sidebar-nav**: Add Graph link to sidebar navigation
- **backend-support**: Add includeContent query param support to /topics endpoint
- **alias-constants**: Define SYNONYMS and ABBREVIATIONS constant maps
- **keyword-extraction**: Implement extractTitleKeywords and extractContentKeywords
- **alias-expansion**: Implement expandWithSynonyms and expandWithAbbreviations

### Wave 2

- **alias-editor**: Create AliasEditor component for managing alias list
- **alias-query**: Implement getTopic() with alias fallback search
- **alias-manage**: Implement addAlias() and removeAlias() methods
- **graph-page**: Create Graph page component
- **generator-core**: Implement main generateAliases() function

### Wave 3

- **topic-detail-integration**: Integrate AliasEditor in TopicDetail page
- **mcp-tools**: Register kodex_add_alias and kodex_remove_alias tools
- **routing**: Add /kodex/graph route
- **generator-tests**: Complete test suite for generator
- **skill-definition**: Create skill definition for manual alias generation
