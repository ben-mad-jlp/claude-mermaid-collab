# Skeleton: Item 4 - Create AI-UI usage skill

## APPROVED

## Task Dependency Graph

```yaml
tasks:
  - id: using-ai-ui-skill
    files: [skills/using-ai-ui/SKILL.md]
    description: Create new skill for AI-UI component usage
    depends-on: [mcp-docs-update]
```

## File to Create

```markdown
// FILE: skills/using-ai-ui/SKILL.md (NEW)

# Using AI-UI Components

## Overview
// TODO: Add overview section

## Component Selection Guide
// TODO: Add decision tree

## Component Reference
// TODO: Add all 32 components with props and examples

## Best Practices
// TODO: Add best practices

## Examples
// TODO: Add 5 example patterns
```

## Directory Structure

```
skills/
└── using-ai-ui/
    └── SKILL.md
```

## Verification

After implementation:
- Skill file exists at `skills/using-ai-ui/SKILL.md`
- Contains all 32 component references
- Includes usage examples
