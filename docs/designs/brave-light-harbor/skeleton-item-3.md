# Skeleton: Item 3 - Document/Diagram Creation Notifications

## File Stubs

### ui/src/types/artifacts.ts (NEW)
```typescript
export interface ArtifactNotification {
  type: 'created' | 'updated';
  artifactType: 'document' | 'diagram';
  id: string;
  name: string;
}
```

### ui/src/components/ArtifactLink.tsx (NEW)
```typescript
import React from 'react';
import { ArtifactNotification } from '../types/artifacts';

interface ArtifactLinkProps {
  notification: ArtifactNotification;
  onClick: (id: string, type: 'document' | 'diagram') => void;
}

export function ArtifactLink({ notification, onClick }: ArtifactLinkProps) {
  // TODO: Implement clickable artifact link
  // - Show icon based on artifact type
  // - Display "Created: name" or "Updated: name"
  // - Handle click to navigate
  throw new Error('Not implemented');
}
```

### ui/src/contexts/ViewerContext.tsx (MODIFY)
```typescript
// TODO: Add navigateToArtifact method
// - Accept id and type parameters
// - Update currentView state
// - Trigger viewer navigation
```

### ui/src/lib/parseArtifactNotification.ts (NEW)
```typescript
export function parseArtifactNotification(mcpResponse: any): ArtifactNotification | null {
  // TODO: Parse MCP response for artifact info
  // - Check for success and id
  // - Determine type from previewUrl
  // - Return notification object or null
  throw new Error('Not implemented');
}
```

## Task Dependency Graph

```yaml
tasks:
  - id: artifact-types
    files: [ui/src/types/artifacts.ts]
    description: Create artifact notification type definitions
    parallel: true

  - id: artifact-link
    files: [ui/src/components/ArtifactLink.tsx]
    description: Implement ArtifactLink component
    depends-on: [artifact-types]

  - id: viewer-context
    files: [ui/src/contexts/ViewerContext.tsx]
    description: Add navigateToArtifact method to ViewerContext
    parallel: true

  - id: parse-notification
    files: [ui/src/lib/parseArtifactNotification.ts]
    description: Create parser for MCP artifact responses
    depends-on: [artifact-types]

  - id: integrate-links
    files: [ui/src/components/MessageArea.tsx]
    description: Integrate ArtifactLink into message rendering
    depends-on: [artifact-link, viewer-context, parse-notification]
```
