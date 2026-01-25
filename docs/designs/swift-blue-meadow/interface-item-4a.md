# Interface: Item 4a - Collab Codex MCP Server Core

## Interface Definition

### File Structure

- `codex/src/mcp/server.ts` - MCP server entry point
- `codex/src/mcp/tools/query-topic.ts` - query_topic endpoint
- `codex/src/mcp/tools/flag-topic.ts` - flag_topic endpoint
- `codex/src/mcp/tools/list-topics.ts` - list_topics endpoint
- `codex/src/types/index.ts` - Shared type definitions

### Type Definitions

```typescript
// codex/src/types/index.ts

type ConfidenceTier = 'high' | 'medium' | 'low' | 'unknown';

interface TopicDocument {
  conceptual: string;
  technical: string;
  files: string;
  related: string;
}

interface TopicMetadata {
  name: string;
  confidence: ConfidenceTier;
  lastModified: string;      // ISO timestamp
  lastVerified: string;      // ISO timestamp
  accessCount: number;
  hasDraft: boolean;
  openFlagCount: number;
}

interface QueryTopicResponse {
  topic: string;
  confidence: ConfidenceTier;
  lastModified: string;
  lastVerified: string;
  accessCount: number;
  documents: TopicDocument;
}

interface FlagTopicInput {
  topicName: string;
  comment: string;
}

interface FlagTopicResponse {
  success: boolean;
  flagId: number;
  message: string;
}

interface ListTopicsResponse {
  topics: TopicMetadata[];
}
```

### Function Signatures

```typescript
// codex/src/mcp/tools/query-topic.ts
async function queryTopic(name: string): Promise<QueryTopicResponse>

// codex/src/mcp/tools/flag-topic.ts
async function flagTopic(input: FlagTopicInput): Promise<FlagTopicResponse>

// codex/src/mcp/tools/list-topics.ts
async function listTopics(): Promise<ListTopicsResponse>
```

### MCP Tool Registration

```typescript
// codex/src/mcp/server.ts
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case 'query_topic': return queryTopic(request.params.arguments.name);
    case 'flag_topic': return flagTopic(request.params.arguments);
    case 'list_topics': return listTopics();
  }
});
```
