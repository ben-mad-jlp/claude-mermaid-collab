# Interface Definition: Item 2 - Register components in registry

## APPROVED

## File Structure

- `ui/src/components/ai-ui/registry.ts` (modify existing)

---

## Type Definitions

No new types - uses existing `ComponentMetadata` interface.

---

## Changes Required

```typescript
// ui/src/components/ai-ui/registry.ts

// Add imports for new components
import { RadioGroup } from './inputs/RadioGroup';
import { Toggle } from './inputs/Toggle';
import { NumberInput } from './inputs/NumberInput';
import { Slider } from './inputs/Slider';
import { FileUpload } from './inputs/FileUpload';
import { Image } from './display/Image';
import { Spinner } from './display/Spinner';
import { Badge } from './display/Badge';
import { Divider } from './layout/Divider';
import { Link } from './interactive/Link';

// Add registry entries (10 new entries)
['RadioGroup', { name: 'RadioGroup', category: 'inputs', description: 'Radio button group for single selection', component: RadioGroup }],
['Toggle', { name: 'Toggle', category: 'inputs', description: 'Toggle switch for boolean values', component: Toggle }],
['NumberInput', { name: 'NumberInput', category: 'inputs', description: 'Number input with increment/decrement', component: NumberInput }],
['Slider', { name: 'Slider', category: 'inputs', description: 'Range slider for numeric values', component: Slider }],
['FileUpload', { name: 'FileUpload', category: 'inputs', description: 'File upload with drag and drop', component: FileUpload }],
['Image', { name: 'Image', category: 'display', description: 'Image display with caption', component: Image }],
['Spinner', { name: 'Spinner', category: 'display', description: 'Loading spinner indicator', component: Spinner }],
['Badge', { name: 'Badge', category: 'display', description: 'Status badge/tag component', component: Badge }],
['Divider', { name: 'Divider', category: 'layout', description: 'Visual separator with optional label', component: Divider }],
['Link', { name: 'Link', category: 'interactive', description: 'Clickable link/button component', component: Link }],
```

---

## Component Interactions

- Registry provides `getComponent(name)` to renderer
- New components accessible via same lookup mechanism
- Category stats automatically updated (22 → 32 components)
