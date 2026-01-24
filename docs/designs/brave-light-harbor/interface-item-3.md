# Interface: Item 3 - Document/Diagram Creation Notifications

## File Structure
- `ui/src/components/ArtifactLink.tsx` - Clickable artifact link (NEW)
- `ui/src/components/MessageArea.tsx` - Extend to support artifact links
- `ui/src/contexts/ViewerContext.tsx` - Add navigation method

## Type Definitions

```typescript
// ui/src/types/artifacts.ts
interface ArtifactNotification {
  type: 'created' | 'updated';
  artifactType: 'document' | 'diagram';
  id: string;
  name: string;
}
```

## Component Interfaces

```typescript
// ui/src/components/ArtifactLink.tsx
interface ArtifactLinkProps {
  notification: ArtifactNotification;
  onClick: (id: string, type: 'document' | 'diagram') => void;
}
```

## Context Extensions

```typescript
// ui/src/contexts/ViewerContext.tsx
interface ViewerContextValue {
  // existing...
  navigateToArtifact: (id: string, type: 'document' | 'diagram') => void;
}
```

## Message Format

When MCP returns from create/update operations, message includes:
```typescript
// Rendered in MessageArea
<ArtifactLink 
  notification={{ 
    type: 'created', 
    artifactType: 'document', 
    id: 'design', 
    name: 'design.md' 
  }}
  onClick={viewerContext.navigateToArtifact}
/>
```

## Component Interactions
- MCP responses parsed for artifact creation/update info
- `ArtifactLink` rendered inline in message content
- Click triggers `navigateToArtifact` which updates viewer pane
- Viewer pane loads the specified document/diagram
