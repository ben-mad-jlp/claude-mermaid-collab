# Interface: Item 7 - Encourage More Diagram Creation

## [APPROVED]

## File Structure
Skills to add "Diagram Opportunities" section:
- `skills/brainstorming/SKILL.md`
- `skills/rough-draft/interface.md`
- `skills/systematic-debugging/SKILL.md` (if exists)

## Changes

### Standard Section to Add

```markdown
## Diagram Opportunities

**Diagrams are cheap. When in doubt, make one.**

Create a diagram when:
- Discussing 3+ components that interact
- Explaining data flow between systems
- Visualizing state transitions
- Showing dependency relationships
- Tracing a bug through the system

**Trigger points in this skill:**
[Skill-specific triggers listed below]

**Example:**
```
Tool: mcp__mermaid__create_diagram
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "name": "component-architecture",
  "content": "graph TD\n  A[Component A] --> B[Component B]\n  B --> C[Component C]"
}
```
```

### Skill-Specific Triggers

**brainstorming/SKILL.md:**
- When user describes multiple interacting components
- When discussing data flow
- Before presenting design options

**rough-draft/interface.md:**
- When defining interfaces for 3+ files
- When showing component interactions

**systematic-debugging/SKILL.md:**
- When tracing bug through multiple components
- When visualizing state that leads to bug

## Verification
- [ ] Diagram Opportunities section in listed skills
- [ ] Skill-specific triggers documented
- [ ] Example create_diagram call included
