# Skeleton: Item 4 - Skill Transition Messages

## File Stubs

### ui/src/types/skills.ts (NEW)
```typescript
export interface SkillTransition {
  fromSkill?: string;
  toSkill: string;
  description: string;
}

export const SKILL_DESCRIPTIONS: Record<string, string> = {
  'brainstorming': 'Exploring requirements and design options',
  'rough-draft': 'Refining design through interface, pseudocode, skeleton phases',
  'rough-draft-interface': 'Defining structural contracts and type signatures',
  'rough-draft-pseudocode': 'Specifying logic flow and algorithms',
  'rough-draft-skeleton': 'Generating stub files and task dependencies',
  'executing-plans': 'Implementing the design with parallel task execution',
  'ready-to-implement': 'Validating all work items are documented',
  'collab-cleanup': 'Closing the collab session'
};
```

### ui/src/components/ai-ui/SkillTransition.tsx (NEW)
```typescript
import React from 'react';
import { SkillTransition as SkillTransitionType } from '../../types/skills';

interface SkillTransitionProps {
  transition: SkillTransitionType;
}

export function SkillTransition({ transition }: SkillTransitionProps) {
  // TODO: Implement skill transition banner
  // - Show arrow/icon
  // - Display skill name prominently
  // - Show description in smaller text
  throw new Error('Not implemented');
}
```

### ui/src/components/ai-ui/ComponentRenderer.tsx (MODIFY)
```typescript
// TODO: Add SkillTransition case to switch statement
// case 'SkillTransition':
//   return <SkillTransition {...ui.props} />;
```

## Task Dependency Graph

```yaml
tasks:
  - id: skill-types
    files: [ui/src/types/skills.ts]
    description: Create skill transition types and description constants
    parallel: true

  - id: skill-transition-component
    files: [ui/src/components/ai-ui/SkillTransition.tsx]
    description: Implement SkillTransition component
    depends-on: [skill-types]

  - id: component-renderer-update
    files: [ui/src/components/ai-ui/ComponentRenderer.tsx]
    description: Add SkillTransition to ComponentRenderer
    depends-on: [skill-transition-component]
```
