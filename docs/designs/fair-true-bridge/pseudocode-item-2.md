# Pseudocode: Item 2 - Register components in registry

## APPROVED

## Registry Update Process

```
FILE: ui/src/components/ai-ui/registry.ts

1. ADD IMPORTS at top of file (after existing imports):
   import { RadioGroup } from './inputs/RadioGroup'
   import { Toggle } from './inputs/Toggle'
   import { NumberInput } from './inputs/NumberInput'
   import { Slider } from './inputs/Slider'
   import { FileUpload } from './inputs/FileUpload'
   import { Image } from './display/Image'
   import { Spinner } from './display/Spinner'
   import { Badge } from './display/Badge'
   import { Divider } from './layout/Divider'
   import { Link } from './interactive/Link'

2. ADD REGISTRY ENTRIES to componentRegistry Map:
   FOR each new component:
     componentRegistry.set(componentName, {
       name: componentName,
       category: category,
       description: description,
       component: componentReference
     })

3. VERIFY registration:
   getRegisteredComponents().length should be 32
   getComponentsByCategory('inputs') should include new input components
   getComponentsByCategory('display') should include new display components
   getComponentsByCategory('layout') should include Divider
   getComponentsByCategory('interactive') should include Link
```

## Validation

```
FUNCTION validateRegistry():
  expected = 32
  actual = componentRegistry.size
  IF actual !== expected:
    THROW Error("Registry count mismatch")
  
  FOR each componentName in ['RadioGroup', 'Toggle', 'NumberInput', ...]:
    IF not componentRegistry.has(componentName):
      THROW Error("Missing component: " + componentName)
```
