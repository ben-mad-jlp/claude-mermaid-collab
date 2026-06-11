## Parameter Validation Pattern

```typescript
// Early return with 400 status
if (!rawProject || !session) {
  return Response.json(
    { error: 'project and session required' },
    { status: 400 }
  );
}
```

## Path Validation

```typescript
import { isAbsolute } from 'path';

if (!isAbsolute(path)) {
  throw new Error('Invalid project path: must be an absolute path');
}
if (!fs.existsSync(path)) {
  throw new Error(`Project path does not exist: ${path}`);
}
```

## Session Name Validation

```typescript
if (!session || !/^[a-zA-Z0-9-]+$/.test(session)) {
  throw new Error('Invalid session name: must be alphanumeric with hyphens only');
}
```

## UI Structure Validation (Type Assertion)

```typescript
export function validateUIStructure(ui: any): asserts ui is UIComponent {
  if (!ui || typeof ui !== 'object') {
    throw new Error('UI definition must be a non-null object');
  }
  if (typeof ui.type !== 'string' || !ui.type) {
    throw new Error('UI component must have a type property');
  }
  // Recursively validates children
}
```

## Array Validation

```typescript
if (!Array.isArray(orderedIds)) {
  return Response.json({ error: 'orderedIds array required' }, { status: 400 });
}

// Check for duplicates
if (orderedIds.length !== new Set(orderedIds).size) {
  return Response.json({ error: 'orderedIds contains duplicates' }, { status: 400 });
}
```

## Size Constraints

```typescript
if (content.length > config.MAX_FILE_SIZE) {
  throw new Error('Diagram too large');
}
```

## Port Validation

```typescript
function validatePort(): number {
  const port = parseInt(portValue, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${portValue}`);
  }
  return port;
}
```

## Graceful JSON Loading

```typescript
try {
  const data = JSON.parse(content);
  if (!data.projects || !Array.isArray(data.projects)) {
    return { projects: [] };  // Fallback to empty
  }
  return data;
} catch {
  return { projects: [] };  // Graceful degradation
}
```