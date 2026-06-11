## Type Location

**Backend (`/src/`)**
- Root-level: `/src/types.ts`
- Domain types: `/src/types/*.ts`
- MCP tool types: inline in `/src/mcp/tools/*.ts`

**Frontend (`/ui/src/`)**
- Core types: `/ui/src/types/*.ts` with `index.ts` re-export
- Hook returns: defined in hook files
- Store types: defined in store files
- Component props: inline or exported from component files

## Examples

```typescript
// Interface for domain models
export interface Diagram {
  id: string;
  name: string;
  content: string;
  lastModified: number;
  folder?: string;
}

// Type for unions
export type Theme = 'light' | 'dark';

// Type for callbacks
export type MessageHandler = (message: WebSocketMessage) => void;

// Props pattern
export interface TextInputProps {
  onChange?: (value: string) => void;
  value?: string;
  name?: string;
  label?: string;
}

// Hook return pattern
export interface UseDiagramReturn {
  diagrams: Diagram[];
  selectedDiagram: Diagram | null;
  selectDiagram: (id: string) => void;
}
```

## Documentation

Use JSDoc comments on interfaces:
```typescript
/**
 * Question object representing a question from Claude
 */
export interface Question {
  /** Unique identifier */
  id: string;
  /** JSON UI definition */
  ui: UINode;
}
```