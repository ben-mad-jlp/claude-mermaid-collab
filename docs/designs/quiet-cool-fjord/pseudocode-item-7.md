# Pseudocode: Item 7 - Encourage More Diagram Creation

## [APPROVED]

## Standard Section to Add to Skills

### Diagram Opportunities Section

```markdown
## Diagram Opportunities

**Diagrams are cheap. When in doubt, make one.**

### When to Create a Diagram

CHECK these triggers as you work:

| Trigger | Diagram Type |
|---------|--------------|
| Discussing 3+ interacting components | Architecture diagram |
| Explaining data flow | Sequence or flowchart |
| Describing state transitions | State diagram |
| Showing dependencies | Dependency graph |
| Tracing execution path | Sequence diagram |
| Debugging complex flow | Flowchart with decision points |

### How to Create

```
cwd = getCurrentWorkingDirectory()
session = getCurrentSession()

mcp__mermaid__create_diagram({
  project: cwd,
  session: session,
  name: "<descriptive-name>",
  content: "<mermaid-syntax>"
})
```

### Example Triggers for This Skill

[Skill-specific triggers here]
```

## File: skills/brainstorming/SKILL.md

### Trigger Points

```
DURING EXPLORING phase:
  IF user mentions 3+ components:
    CREATE architecture diagram showing relationships
  
  IF user describes data flow:
    CREATE sequence diagram showing flow

DURING DESIGNING phase:
  BEFORE presenting design options:
    CREATE diagram showing proposed architecture
  
  IF design involves state changes:
    CREATE state diagram

AFTER user approves design section:
  IF section involves multiple files:
    CREATE dependency diagram
```

## File: skills/rough-draft/interface.md

### Trigger Points

```
WHEN defining interfaces for 3+ files:
  CREATE class diagram showing relationships

WHEN documenting component interactions:
  CREATE sequence diagram showing calls

WHEN defining complex types:
  CREATE entity-relationship diagram
```

## File: skills/systematic-debugging/SKILL.md

### Trigger Points

```
WHEN tracing bug through multiple components:
  CREATE sequence diagram showing bug propagation

WHEN analyzing state that leads to bug:
  CREATE state diagram showing transitions

WHEN documenting root cause:
  CREATE flowchart showing decision path to bug
```

## Implementation in Skill Flow

```
FUNCTION checkDiagramOpportunity(context):
  componentCount = countMentionedComponents(context)
  hasDataFlow = mentionsDataFlow(context)
  hasStateChanges = mentionsStateChanges(context)
  
  IF componentCount >= 3:
    suggestDiagram("architecture", "Show component relationships")
  
  IF hasDataFlow:
    suggestDiagram("sequence", "Show data flow")
  
  IF hasStateChanges:
    suggestDiagram("state", "Show state transitions")

FUNCTION suggestDiagram(type, reason):
  # Proactively create diagram
  PRINT "Creating {type} diagram: {reason}"
  
  content = generateDiagramContent(type, context)
  
  result = mcp__mermaid__create_diagram({
    project: cwd,
    session: session,
    name: "{type}-{timestamp}",
    content: content
  })
  
  PRINT "Diagram: {result.previewUrl}"
```

## Verification
- [ ] Diagram Opportunities section in brainstorming skill
- [ ] Diagram Opportunities section in rough-draft/interface
- [ ] Diagram Opportunities section in systematic-debugging
- [ ] Trigger points are explicit and actionable
- [ ] Example create_diagram call included
