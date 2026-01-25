# Skeleton: Item 1 - Fix subagent-driven-development skill path

## Planned Files

No new files. Modifications only to existing skill files:

- [ ] `skills/executing-plans-execution/SKILL.md`
- [ ] `skills/executing-plans/execution.md`
- [ ] `skills/executing-plans/SKILL.md`
- [ ] `skills/rough-draft/handoff.md`
- [ ] `skills/rough-draft-handoff/SKILL.md`
- [ ] `skills/writing-plans/SKILL.md`
- [ ] `skills/finishing-a-development-branch/SKILL.md`

## Task Dependency Graph

```yaml
tasks:
  - id: fix-skill-paths
    files:
      - skills/executing-plans-execution/SKILL.md
      - skills/executing-plans/execution.md
      - skills/executing-plans/SKILL.md
      - skills/rough-draft/handoff.md
      - skills/rough-draft-handoff/SKILL.md
      - skills/writing-plans/SKILL.md
      - skills/finishing-a-development-branch/SKILL.md
    description: Update all subagent-driven-development references to full namespaced path
    parallel: true
```

## Execution Order

Single wave - all files can be modified in parallel (no dependencies between them).

## Verification

- [ ] All 7 files updated
- [ ] No short-form `subagent-driven-development` references remain
- [ ] Full path `mermaid-collab:subagent-driven-development:implementer-prompt` used everywhere
