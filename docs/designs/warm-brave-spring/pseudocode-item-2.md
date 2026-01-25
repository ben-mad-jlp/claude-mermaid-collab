# Pseudocode: Item 2 - Integrate Kodex into brainstorming

## Step 0 Execution Logic

This step runs at the very start of brainstorming-exploring, before reading any files.

### Topic Inference from Work Item

```
1. Get current work item context:
   - Read collab-state.json for currentItem
   - Read design doc for item title and description
   
2. Extract keywords:
   - Parse item title for nouns/concepts
   - Example: "Add user authentication" → ["user", "authentication"]
   
3. Build topic name candidates:
   candidates = []
   FOR each keyword:
     candidates.push(keyword)
     candidates.push(keyword + "-patterns")
     candidates.push(keyword + "-conventions")
   
4. Example for "Add user authentication":
   - "authentication"
   - "authentication-patterns"
   - "authentication-conventions"
   - "user"
   - "user-patterns"
```

### Query Execution

```
1. FOR each candidate topic name:
   result = mcp__mermaid__kodex_query_topic({
     project: cwd,
     name: candidate
   })
   
   IF result.found:
     found_topics.push(result)
   
2. IF found_topics.length > 0:
   Display: "Found project knowledge:"
   FOR each topic in found_topics:
     Display topic.content
     
3. IF found_topics.length == 0:
   Display: "No relevant project knowledge found. Proceeding with file exploration."
```

### Keyword Fallback

```
IF no topics found from item title:
  1. Try broader keywords from description
  2. Try removing suffixes (-patterns, -conventions)
  3. Try singular/plural variations
```

## Error Handling

- MCP tool errors: Log warning, continue to file exploration
- Empty topic content: Skip displaying, try next candidate

## Edge Cases

- Item title is very generic: Use description for keywords
- Multiple matching topics: Display all relevant ones
- Topic exists but empty: Skip, don't display
