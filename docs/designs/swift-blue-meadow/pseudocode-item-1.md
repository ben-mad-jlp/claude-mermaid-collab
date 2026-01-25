# Pseudocode: Item 1 - Fix subagent-driven-development skill path

## Process

```
FOR each file in affected_files:
  1. Read file content
  2. Find all occurrences of incorrect patterns:
     - "subagent-driven-development" (without namespace)
     - "superpowers:subagent-driven-development" (wrong namespace)
  3. Replace with correct path:
     - "mermaid-collab:subagent-driven-development:implementer-prompt"
  4. Write updated content back to file
  5. Verify no incorrect patterns remain
```

## Affected Files

1. `skills/executing-plans-execution/SKILL.md`
2. `skills/executing-plans/execution.md`
3. `skills/executing-plans/SKILL.md`
4. `skills/rough-draft/handoff.md`
5. `skills/rough-draft-handoff/SKILL.md`
6. `skills/writing-plans/SKILL.md`
7. `skills/finishing-a-development-branch/SKILL.md`

## Edge Cases

- Context matters: Only replace when referring to the Task tool's subagent_type
- Don't replace in comments explaining the change
- Preserve surrounding text/formatting
