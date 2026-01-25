# Pseudocode: Item 3 - Integrate Kodex into rough-draft

## Step 0 Execution Logic (Per Phase)

Each rough-draft sub-skill gets its own Step 0 with phase-specific topic focus.

### rough-draft-interface: Types/Patterns Focus

```
1. Get work item context from design doc

2. Build topic candidates (interface focus):
   candidates = []
   FOR each keyword from item:
     candidates.push(keyword + "-types")
     candidates.push(keyword + "-patterns")
   candidates.push("type-conventions")
   candidates.push("coding-standards")
   
3. Query each candidate:
   FOR each candidate:
     result = kodex_query_topic(project, candidate)
     IF result.found:
       display("Type/pattern context: " + result.content)

4. Use found topics to inform:
   - Type naming conventions
   - Interface structure patterns
   - Common type definitions to reuse
```

### rough-draft-pseudocode: Error/Logic Focus

```
1. Get work item context from design doc

2. Build topic candidates (pseudocode focus):
   candidates = []
   FOR each keyword from item:
     candidates.push(keyword + "-error-handling")
     candidates.push(keyword + "-logic")
   candidates.push("error-patterns")
   candidates.push("validation-patterns")
   
3. Query each candidate:
   FOR each candidate:
     result = kodex_query_topic(project, candidate)
     IF result.found:
       display("Error/logic context: " + result.content)

4. Use found topics to inform:
   - Error handling approach
   - Validation patterns
   - Common logic flows
```

### rough-draft-skeleton: File Structure Focus

```
1. Get work item context from design doc

2. Build topic candidates (skeleton focus):
   candidates = []
   FOR each keyword from item:
     candidates.push(keyword + "-file-structure")
   candidates.push("file-naming")
   candidates.push("directory-conventions")
   candidates.push("project-structure")
   
3. Query each candidate:
   FOR each candidate:
     result = kodex_query_topic(project, candidate)
     IF result.found:
       display("File structure context: " + result.content)

4. Use found topics to inform:
   - File placement decisions
   - Naming conventions
   - Directory organization
```

## Error Handling

- Same as Item 2: Non-blocking, continue if query fails

## Edge Cases

- Phase doesn't need Kodex context: Still query, may find useful info
- Conflicting topic info: Prefer more specific topic over general
- No topics for this phase: Display nothing, proceed normally
