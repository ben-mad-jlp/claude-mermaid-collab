# Interface: Item 4 - Skill Transition Messages

## File Structure
- `ui/src/components/SkillTransition.tsx` - Transition announcement (NEW)
- Skills updated to call render_ui with transition message

## Type Definitions

```typescript
// ui/src/types/skills.ts
interface SkillTransition {
  fromSkill?: string;
  toSkill: string;
  description: string;
}
```

## Component Interfaces

```typescript
// ui/src/components/SkillTransition.tsx
interface SkillTransitionProps {
  transition: SkillTransition;
}
```

## AI-UI Component Schema

```typescript
// Add to render_ui component types
{
  type: 'SkillTransition',
  props: {
    toSkill: string;      // e.g., "rough-draft"
    description: string;  // e.g., "Refining design through interface, pseudocode, skeleton phases"
  }
}
```

## Usage in Skills

Skills invoke render_ui before starting:
```
Tool: mcp__mermaid__render_ui
Args: {
  "project": "...",
  "session": "...",
  "ui": {
    "type": "SkillTransition",
    "props": {
      "toSkill": "rough-draft",
      "description": "Refining design through interface, pseudocode, skeleton phases"
    }
  },
  "blocking": false
}
```

## Visual Design
- Brief banner/card style
- Shows skill name prominently
- Description in smaller text
- Auto-dismisses or replaced by next content
