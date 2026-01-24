# Skeleton: Item 6 - Replace RadioGroup with Dropdown

## File Stubs

### ui/src/components/ai-ui/Dropdown.tsx (NEW)
```typescript
import React, { useState } from 'react';

interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DropdownProps {
  name: string;
  label?: string;
  options: DropdownOption[];
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  onChange?: (value: string) => void;
}

export function Dropdown({ 
  name, 
  label, 
  options, 
  placeholder, 
  required, 
  defaultValue, 
  onChange 
}: DropdownProps) {
  // TODO: Implement dropdown component
  // - Render label if provided
  // - Render select element with options
  // - Handle onChange events
  throw new Error('Not implemented');
}
```

### ui/src/components/ai-ui/index.ts (MODIFY)
```typescript
// TODO: Export Dropdown component
// export { Dropdown } from './Dropdown';
```

### ui/src/components/ai-ui/ComponentRenderer.tsx (MODIFY)
```typescript
// TODO: Add Dropdown case to switch statement
// case 'Dropdown':
//   return <Dropdown {...ui.props} onChange={(v) => onFormChange(ui.props.name, v)} />;
```

## Styling

### ui/src/components/ai-ui/Dropdown.css (NEW)
```css
/* TODO: Add dropdown styles */
.dropdown-field { }
.dropdown-select { }
.dropdown-select:focus { }
```

## Task Dependency Graph

```yaml
tasks:
  - id: dropdown-component
    files: [ui/src/components/ai-ui/Dropdown.tsx, ui/src/components/ai-ui/Dropdown.css]
    description: Create Dropdown component with styling
    parallel: true

  - id: dropdown-export
    files: [ui/src/components/ai-ui/index.ts]
    description: Export Dropdown from ai-ui index
    depends-on: [dropdown-component]

  - id: dropdown-renderer
    files: [ui/src/components/ai-ui/ComponentRenderer.tsx]
    description: Add Dropdown to ComponentRenderer switch
    depends-on: [dropdown-component]
```
