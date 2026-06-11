## SKILL.md Format

```yaml
---
name: skill-name
description: "User-facing description"
user-invocable: true/false
model: opus/haiku (optional)
allowed-tools:
  - Read
  - Glob
  - mcp__plugin_mermaid-collab_mermaid__*
---

# Skill Title

[Markdown instructions...]
```

### Frontmatter Fields

- **name**: Kebab-case identifier
- **description**: Shown in `/skill` help
- **user-invocable**: Can users call directly with `/skill`?
- **model**: Force specific model (opus for complex, haiku for fast)
- **allowed-tools**: Security boundary for tool access

## Workflow Hierarchy

```
using-superpowers (meta)
    ↓
collab (orchestrator)
    ├→ gather-session-goals
    ├→ brainstorming (5-phase)
    │   ├→ brainstorming-exploring
    │   ├→ brainstorming-clarifying
    │   ├→ brainstorming-designing
    │   ├→ brainstorming-validating
    │   └→ brainstorming-transition
    ├→ rough-draft (4-phase)
    │   ├→ rough-draft-interface
    │   ├→ rough-draft-pseudocode
    │   ├→ rough-draft-skeleton
    │   └→ rough-draft-handoff
    └→ executing-plans
        ├→ executing-plans-execution
        └→ executing-plans-review
```

## State Machines

**Brainstorming** (5 phases):
1. EXPLORING - Gather context
2. CLARIFYING - Discuss items one-by-one
3. DESIGNING - Present design sections
4. VALIDATING - Completeness gate
5. TRANSITION - Bridge to rough-draft

**Rough-Draft** (4 phases):
1. INTERFACE - File paths, signatures, types
2. PSEUDOCODE - Logic flow, error handling
3. SKELETON - Stub files, task graph
4. HANDOFF - Pass to executing-plans

## Session State

Stored in `.collab/<session>/collab-state.json`:
```json
{
  "phase": "brainstorming|rough-draft/interface|...",
  "lastActivity": "ISO-8601",
  "currentItem": 1,
  "pendingVerificationIssues": []
}
```

## Tool Access Control

Skills declare allowed tools in frontmatter:
- **Read, Glob, Grep**: Code exploration
- **mcp__plugin_mermaid-collab_mermaid__***: Session/doc operations
- **Bash**: Git, non-destructive commands
- **Task**: Work item tracking
- **Skill**: Invoke other skills