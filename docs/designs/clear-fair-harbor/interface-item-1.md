# Interface Definition - Item 1: Kodex Fix Skills

## File Structure

```
skills/
├── kodex-fix/
│   └── SKILL.md           # Parent skill (user-invocable)
├── kodex-fix-outdated/
│   └── SKILL.md           # Sub-skill for outdated flags
├── kodex-fix-incorrect/
│   └── SKILL.md           # Sub-skill for incorrect flags
├── kodex-fix-incomplete/
│   └── SKILL.md           # Sub-skill for incomplete flags
└── kodex-fix-missing/
    └── SKILL.md           # Sub-skill for missing flags
```

Additionally, one TypeScript modification:
- `src/services/kodex-manager.ts` - Add auto-resolve flag logic to `approveDraft()`

---

## Skill YAML Frontmatter Contracts

### kodex-fix (Parent)

```yaml
---
name: kodex-fix
description: Fix flagged Kodex topics by generating updated content
user-invocable: true
allowed-tools:
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_flags
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---
```

### kodex-fix-outdated (Sub-skill)

```yaml
---
name: kodex-fix-outdated
description: Update outdated Kodex topic content by analyzing current codebase
user-invocable: false
allowed-tools:
  - Glob
  - Grep
  - Read
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_update_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---
```

### kodex-fix-incorrect (Sub-skill)

```yaml
---
name: kodex-fix-incorrect
description: Correct factually incorrect Kodex topic content
user-invocable: false
allowed-tools:
  - Glob
  - Grep
  - Read
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_update_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---
```

### kodex-fix-incomplete (Sub-skill)

```yaml
---
name: kodex-fix-incomplete
description: Fill in missing sections of incomplete Kodex topics
user-invocable: false
allowed-tools:
  - Glob
  - Grep
  - Read
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_update_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---
```

### kodex-fix-missing (Sub-skill)

```yaml
---
name: kodex-fix-missing
description: Create new Kodex topics for missing documentation
user-invocable: false
allowed-tools:
  - Glob
  - Grep
  - Read
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_create_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---
```

---

## TypeScript Interface: kodex-manager.ts Modification

### Current Signature

```typescript
async approveDraft(topicName: string): Promise<Topic>
```

### Modified Behavior (No Signature Change)

The function signature stays the same. Internal modification:
1. After moving draft to live content
2. Query `flags` table for open flags with matching `topic_name`
3. Update those flags to `status: 'resolved'`

```typescript
// Inside approveDraft(), after line 385:
// Resolve open flags for this topic
const openFlags = db.query(
  "SELECT id FROM flags WHERE topic_name = ? AND status = 'open'"
).all(topicName) as { id: number }[];

for (const flag of openFlags) {
  this.updateFlagStatus(flag.id, 'resolved');
}
```

---

## Component Interactions

```
User runs /kodex-fix
        │
        ▼
┌───────────────────┐
│   kodex-fix       │ Lists flags, user selects
│   (parent)        │
└─────────┬─────────┘
          │ Invokes sub-skill via Skill tool
          ▼
┌─────────────────────────────────────────────────────┐
│ kodex-fix-{outdated|incorrect|incomplete|missing}   │
│ 1. Query existing topic (except missing)            │
│ 2. Analyze codebase with Glob/Grep/Read             │
│ 3. Generate content for 4 sections                  │
│ 4. Validate with user                               │
│ 5. Call kodex_update_topic or kodex_create_topic    │
└─────────────────────────────────────────────────────┘
          │
          ▼
┌───────────────────┐
│ Draft created     │ Flag stays open
└─────────┬─────────┘
          │
          ▼ (Later, in Kodex UI)
┌───────────────────┐
│ Human approves    │ approveDraft() auto-resolves flag
└───────────────────┘
```

---

## Verification Checklist

- [x] All files from design are listed (5 skill files + 1 TS modification)
- [x] All YAML frontmatter defined with allowed-tools
- [x] Parent skill is user-invocable: true
- [x] Sub-skills are user-invocable: false
- [x] TypeScript modification documented (no signature change)
- [x] Component interactions documented
