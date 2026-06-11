# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 4
- **Total waves:** 1
- **Max parallelism:** 4

## Execution Waves

**Wave 1:** fix-api-routes, fix-mcp-schemas, fix-api-client-urls, create-embed-tests

## Task Graph (YAML)

```yaml
tasks:
  - id: fix-api-routes
    files: [src/routes/api.ts]
    tests: []
    description: "Fix embedManager.create() return handling (Bug 1+5), fix type annotations (Bug 2)"
    parallel: true
    depends-on: []
  - id: fix-mcp-schemas
    files: [src/mcp/tools/embed.ts]
    tests: []
    description: "Fix width/height schema types from number to string, update handler signature (Bug 3)"
    parallel: true
    depends-on: []
  - id: fix-api-client-urls
    files: [ui/src/api/embeds.ts]
    tests: []
    description: "Fix fetchEmbeds and deleteEmbed URLs to match server routes (Gap 3)"
    parallel: true
    depends-on: []
  - id: create-embed-tests
    files: [src/services/__tests__/embed-manager.test.ts]
    tests: [src/services/__tests__/embed-manager.test.ts]
    description: "Create EmbedManager test suite with vitest (Gap 1)"
    parallel: true
    depends-on: []
```

## Dependency Visualization

```mermaid
graph TD
    fix-api-routes["fix-api-routes<br/>"Fix embedManager.create() ret..."]
    fix-mcp-schemas["fix-mcp-schemas<br/>"Fix width/height schema types..."]
    fix-api-client-urls["fix-api-client-urls<br/>"Fix fetchEmbeds and deleteEmb..."]
    create-embed-tests["create-embed-tests<br/>"Create EmbedManager test suit..."]

     --> fix-api-routes
     --> fix-mcp-schemas
     --> fix-api-client-urls
     --> create-embed-tests

    style fix-api-routes fill:#c8e6c9
    style fix-mcp-schemas fill:#c8e6c9
    style fix-api-client-urls fill:#c8e6c9
    style create-embed-tests fill:#c8e6c9
```

## Tasks by Wave

### Wave 1

- **fix-api-routes**: "Fix embedManager.create() return handling (Bug 1+5), fix type annotations (Bug 2)"
- **fix-mcp-schemas**: "Fix width/height schema types from number to string, update handler signature (Bug 3)"
- **fix-api-client-urls**: "Fix fetchEmbeds and deleteEmbed URLs to match server routes (Gap 3)"
- **create-embed-tests**: "Create EmbedManager test suite with vitest (Gap 1)"
