# Pseudocode: Item 1 - Create Kodex skill

## Skill Execution Logic

This skill provides guidance, not procedural steps. The "pseudocode" describes how Claude should apply the guidance.

### When to Query Kodex

```
1. At the start of any task:
   - IF task involves code, architecture, or patterns
   - THEN consider querying Kodex
   
2. Infer topic names from context:
   - Extract key concepts from task description
   - Common patterns: "{concept}", "{concept}-patterns", "{concept}-conventions"
   
3. Query decision:
   - Use judgment - query when project knowledge could help
   - Don't query for trivial or unrelated tasks
```

### How to Query

```
1. Infer topic name from current context
   - Look at task/item being worked on
   - Extract primary concept (e.g., "authentication", "error-handling")

2. Call kodex_query_topic:
   Tool: mcp__mermaid__kodex_query_topic
   Args: { "project": "<cwd>", "name": "<inferred-topic>" }

3. Handle result:
   - IF topic found: Display content as context
   - IF topic not found: Try alternative names or continue without
   - IF error: Log and continue (non-blocking)
```

### When to Flag

```
1. After querying a topic AND reading actual code:
   - Compare topic content to code reality
   
2. IF discrepancy detected:
   - Verify by reading the actual source files
   - Confirm the topic is genuinely outdated/incorrect
   
3. IF verified discrepancy:
   Tool: mcp__mermaid__kodex_flag_topic
   Args: {
     "project": "<cwd>",
     "name": "<topic-name>",
     "type": "outdated" | "incorrect",
     "description": "<what's wrong and what the code actually does>"
   }

4. Never flag without verification against code
```

## Error Handling

- Query failures: Non-blocking, continue without topic
- Flag failures: Log error, continue with task

## Edge Cases

- No relevant topics exist: Continue without Kodex context
- Topic partially outdated: Flag specific incorrect parts
- Multiple related topics: Query each, combine context
