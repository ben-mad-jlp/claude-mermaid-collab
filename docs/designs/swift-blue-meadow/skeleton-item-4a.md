# Skeleton: Item 4a - Collab Codex MCP Server Core

## Planned Files

| File | Purpose |
|------|---------|
| `codex/src/mcp/server.ts` | MCP server entry point, tool registration |
| `codex/src/mcp/tools/query-topic.ts` | query_topic endpoint implementation |
| `codex/src/mcp/tools/flag-topic.ts` | flag_topic endpoint implementation |
| `codex/src/mcp/tools/list-topics.ts` | list_topics endpoint implementation |
| `codex/src/types/index.ts` | Shared type definitions |

## Task Dependency Graph

```yaml
tasks:
  - id: 4a-types
    files: [codex/src/types/index.ts]
    description: Create shared type definitions for topics, flags, confidence tiers
    parallel: true

  - id: 4a-mcp-server
    files: [codex/src/mcp/server.ts]
    description: Create MCP server entry point with tool registration
    depends-on: [4a-types]

  - id: 4a-query-topic
    files: [codex/src/mcp/tools/query-topic.ts]
    description: Implement query_topic endpoint with file reading and access logging
    depends-on: [4a-types, 4b-services]

  - id: 4a-flag-topic
    files: [codex/src/mcp/tools/flag-topic.ts]
    description: Implement flag_topic endpoint with validation
    depends-on: [4a-types, 4b-services]

  - id: 4a-list-topics
    files: [codex/src/mcp/tools/list-topics.ts]
    description: Implement list_topics endpoint with enriched metadata
    depends-on: [4a-types, 4b-services]
```

## Execution Order

1. **Parallel batch 1:** 4a-types (can start immediately)
2. **Parallel batch 2:** 4a-mcp-server (after types)
3. **Parallel batch 3:** 4a-query-topic, 4a-flag-topic, 4a-list-topics (after services from 4b)

## Notes

- Depends on 4b (storage layer) for service classes
- MCP server follows existing mermaid-collab MCP patterns
- Topic files stored at `codex/topics/{name}/` with 4 markdown files each
