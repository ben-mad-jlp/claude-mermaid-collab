## Implementation Patterns

### Tool Handler Pattern
```typescript
case 'tool_name': {
  const { project, session, ...params } = args as ToolArgs;
  if (!project || !session) throw new Error('Missing required: project, session');
  const result = await toolImplementation(project, session, params);
  return JSON.stringify(result, null, 2);
}
```

### URL Building
```typescript
function buildUrl(path: string, project: string, session: string): string {
  const url = new URL(path, API_BASE_URL);
  url.searchParams.set('project', project);
  url.searchParams.set('session', session);
  return url.toString();
}
```

### Patch Operations
Patch tools (patch_document, patch_diagram) use search-replace with uniqueness validation:
```typescript
const occurrences = content.split(oldString).length - 1;
if (occurrences === 0) throw new Error('old_string not found');
if (occurrences > 1) throw new Error('old_string matches multiple locations');
```