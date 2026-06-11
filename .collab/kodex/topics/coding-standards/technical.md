## Import Organization

```typescript
// External dependencies first
import { useState, useCallback } from 'react';

// Type imports with explicit `type` keyword
import type { Diagram } from '../types';

// Internal modules
import { config } from '../config';
```

## Naming Conventions

| Type | Convention | Example |
|------|------------|--------|
| Classes | PascalCase | `DiagramManager`, `APIClient` |
| Interfaces/Types | PascalCase | `TextInputProps`, `UseWebSocketReturn` |
| Functions | camelCase | `validateDiagram`, `useWebSocket` |
| Constants | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |
| Hooks | useXxx | `useWebSocket`, `useSession` |

## React Component Pattern

```typescript
export interface TextInputProps {
  onChange?: (value: string) => void;
  value?: string;
}

export const TextInput: React.FC<TextInputProps> = ({
  onChange,
  value: controlledValue,
}) => {
  const id = useId();
  return ( /* JSX */ );
};

TextInput.displayName = 'TextInput';
```

## Zustand Store Pattern

```typescript
export interface SessionState {
  sessions: Session[];
  setCurrentSession: (session: Session | null) => void;
}

const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  setCurrentSession: (session) => set({ currentSession: session }),
}));
```

## Version Management

Use `npm version patch|minor|major` - never manually edit versions. This automatically syncs to package.json, plugin.json, marketplace.json, and server.ts.