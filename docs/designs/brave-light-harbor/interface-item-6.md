# Interface: Item 6 - Replace RadioGroup with Dropdown

## File Structure
- `ui/src/components/ai-ui/Dropdown.tsx` - New dropdown component (NEW)
- `ui/src/components/ai-ui/index.ts` - Export new component
- `ui/src/components/ai-ui/ComponentRenderer.tsx` - Add Dropdown handling

## Type Definitions

```typescript
// ui/src/components/ai-ui/Dropdown.tsx
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
```

## AI-UI Component Schema

```typescript
// Component definition for render_ui
{
  type: 'Dropdown',
  props: {
    name: string;
    label?: string;
    options: Array<{ value: string; label: string }>;
    placeholder?: string;
  }
}
```

## Usage Pattern

```typescript
// Skills use Dropdown instead of RadioGroup
{
  "type": "Dropdown",
  "props": {
    "name": "choice",
    "label": "Select an option",
    "options": [
      { "value": "1", "label": "Option 1" },
      { "value": "2", "label": "Option 2" },
      { "value": "3", "label": "Option 3" }
    ],
    "placeholder": "Choose..."
  }
}
```

## Migration
- RadioGroup component remains available (no breaking change)
- Skills should prefer Dropdown for single selection
- Checkbox component for multi-select remains unchanged
