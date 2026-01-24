# Skeleton: Item 8 - Move Clear Button, Remove Top Chat Bar

## File Stubs

### ui/src/components/ChatBar.tsx (DELETE)
```typescript
// This file will be deleted
```

### ui/src/components/InputControls.tsx (MODIFY)
```typescript
import React, { useState } from 'react';

interface InputControlsProps {
  onSend: (message: string) => void;
  onClear: () => void;  // NEW prop
  disabled?: boolean;
}

export function InputControls({ onSend, onClear, disabled }: InputControlsProps) {
  // TODO: Update layout
  // - Add clear button on left
  // - Keep input in middle
  // - Keep send button on right
  throw new Error('Not implemented');
}
```

### ui/src/components/WorkspacePanel.tsx (MODIFY)
```typescript
// TODO: Remove ChatBar usage
// - Delete ChatBar import
// - Remove ChatBar from render
// - Pass onClear to InputControls
```

## Task Dependency Graph

```yaml
tasks:
  - id: delete-chatbar
    files: [ui/src/components/ChatBar.tsx]
    description: Delete ChatBar component file
    parallel: true

  - id: update-input-controls
    files: [ui/src/components/InputControls.tsx]
    description: Add clear button to InputControls
    parallel: true

  - id: update-workspace
    files: [ui/src/components/WorkspacePanel.tsx]
    description: Remove ChatBar and wire up clear functionality
    depends-on: [delete-chatbar, update-input-controls]
```
