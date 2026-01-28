# Interface Definition: Item 6

## Auto-flag Kodex topics from skills

### File Structure

- `src/mcp/setup.ts` - **MODIFY** - Update kodex_query_topic handler to auto-flag missing
- `src/services/kodex-manager.ts` - **MODIFY** - Add createFlag method, dedupe logic

### Type Definitions

```typescript
// src/services/kodex-manager.ts

interface CreateFlagOptions {
  /** Context about why/where the flag was created */
  context?: string;
  /** Skip if duplicate flag exists */
  dedupe?: boolean;
}

interface QueryTopicResult {
  found: boolean;
  topic?: KodexTopic;
  error?: string;
  flagged?: boolean;  // NEW: indicates auto-flag was created
  hint?: string;      // NEW: reminder to flag if outdated/incorrect
}
```

### Function Signatures

```typescript
// src/services/kodex-manager.ts
class KodexManager {
  /**
   * Create a flag for a topic.
   * @param topicName - The topic to flag
   * @param type - Flag type: 'missing' | 'outdated' | 'incorrect' | 'incomplete'
   * @param description - Description of the issue
   * @param options - Additional options including context and dedupe
   */
  async createFlag(
    topicName: string,
    type: FlagType,
    description: string,
    options?: CreateFlagOptions
  ): Promise<{ created: boolean; reason?: string }>;
  
  /**
   * Check if a flag already exists for topic+type combination.
   */
  async hasFlag(topicName: string, type: FlagType): Promise<boolean>;
}
```

```typescript
// src/mcp/setup.ts
// Modified return type for kodex_query_topic tool
// Returns QueryTopicResult instead of just topic content
```

### Component Interactions

1. Skill queries topic via `kodex_query_topic` tool
2. Tool handler calls `kodexManager.queryTopic(name)`
3. If topic not found:
   - Call `kodexManager.createFlag(name, 'missing', description, { dedupe: true })`
   - Return `{ found: false, flagged: true }`
4. If topic found:
   - Return `{ found: true, topic, hint: 'If outdated/incorrect, use kodex_flag_topic' }`

### Verification Checklist

- [x] All files from design are listed (2 files)
- [x] All public interfaces have signatures
- [x] Parameter types are explicit
- [x] Return types are explicit
- [x] Component interactions documented
