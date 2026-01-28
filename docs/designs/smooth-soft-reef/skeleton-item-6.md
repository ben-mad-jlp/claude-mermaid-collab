# Skeleton: Item 6

## Auto-flag Kodex topics from skills

### Task Graph

```yaml
tasks:
  - id: item6-kodex-hasflag
    file: src/services/kodex-manager.ts
    action: modify
    description: Add hasFlag method to check for existing flags
    depends: []
    
  - id: item6-kodex-createflag
    file: src/services/kodex-manager.ts
    action: modify
    description: Add createFlag method with dedupe support
    depends: [item6-kodex-hasflag]
    
  - id: item6-query-autoflag
    file: src/mcp/setup.ts
    action: modify
    description: Update kodex_query_topic to auto-flag missing and add hint
    depends: [item6-kodex-createflag]
```

### Stub Code

#### src/services/kodex-manager.ts

```typescript
// ADD: Interface for createFlag options
interface CreateFlagOptions {
  context?: string;
  dedupe?: boolean;
}

// ADD: hasFlag method
async hasFlag(topicName: string, type: FlagType): Promise<boolean> {
  // TODO: Get open flags, check for matching topic+type
  throw new Error('Not implemented');
}

// ADD: createFlag method  
async createFlag(
  topicName: string,
  type: FlagType,
  description: string,
  options?: CreateFlagOptions
): Promise<{ created: boolean; reason?: string }> {
  // TODO: Check dedupe if enabled
  // TODO: Build description with context
  // TODO: Save flag
  throw new Error('Not implemented');
}
```

#### src/mcp/setup.ts

```typescript
// MODIFY: kodex_query_topic handler
case 'kodex_query_topic': {
  const topic = await kodexManager.queryTopic(project, name, { includeContent });
  
  if (!topic) {
    // TODO: Call kodexManager.createFlag with dedupe: true
    // TODO: Return { found: false, flagged: true/false }
  }
  
  // TODO: Return { found: true, topic, hint: '...' }
}
```

### Verification Checklist

- [x] All files from interface listed with tasks
- [x] Task dependencies form valid DAG
- [x] 3 tasks - appropriate granularity
- [x] hasFlag before createFlag dependency
