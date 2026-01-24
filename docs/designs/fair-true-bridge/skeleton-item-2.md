# Skeleton: Item 2 - Register components in registry

## APPROVED

## Task Dependency Graph

```yaml
tasks:
  - id: registry-update
    files: [ui/src/components/ai-ui/registry.ts]
    description: Add imports and registry entries for 10 new components
    depends-on: [radio-group, toggle, number-input, slider, file-upload, image, spinner, badge, divider, link]
```

## File Modification

```typescript
// FILE: ui/src/components/ai-ui/registry.ts (MODIFY)

// TODO: Add imports after existing imports
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

// TODO: Add registry entries to componentRegistry Map
// See pseudocode-item-2 for exact entries
```

## Verification

After implementation:
- `getRegisteredComponents().length === 32`
- All new components accessible via `getComponent(name)`
