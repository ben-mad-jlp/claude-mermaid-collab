# Skeleton: Task Dependency Graph

## [APPROVED]

## Dependency Analysis

| Task | Files | Dependencies | Parallel? |
|------|-------|--------------|-----------|
| item-1 | skills/collab/session-mgmt.md | None | Yes |
| item-2 | skills/collab/SKILL.md, work-item-loop.md | item-1 (MCP patterns) | No |
| item-3 | skills/executing-plans/execution.md | None | Yes |
| item-4 | 9 skill files | None | Yes |
| item-5 | ui/src/components/dashboard/Dashboard.tsx | item-6 (list API change) | No |
| item-6 | src/services/document-manager.ts, diagram-manager.ts | None | Yes |
| item-7 | 3 skill files | None | Yes |
| item-8 | plugins/wireframe/package.json | None | Yes |
| item-9 | ui/src/components/ai-ui/inputs/TextArea.tsx | None | Yes |
| item-10 | ui/src/components/ai-ui/display/Markdown.tsx | None | Yes |
| item-11 | ui/src/components/layout/SplitPane.tsx | None | Yes |

## Task Dependency Graph (YAML)

```yaml
tasks:
  # Wave 1: Independent tasks (can run in parallel)
  - id: item-1-mcp-session-discovery
    files: [skills/collab/session-mgmt.md]
    description: Update session discovery to use MCP list_sessions
    parallel: true

  - id: item-3-parallel-dispatch
    files: [skills/executing-plans/execution.md]
    description: Add explicit parallel Task dispatch example
    parallel: true

  - id: item-4-render-ui-default
    files:
      - skills/rough-draft/interface.md
      - skills/rough-draft/pseudocode.md
      - skills/rough-draft/skeleton.md
      - skills/rough-draft/handoff.md
      - skills/executing-plans/SKILL.md
      - skills/ready-to-implement/SKILL.md
      - skills/task-planning/SKILL.md
      - skills/collab-cleanup/SKILL.md
      - skills/finishing-a-development-branch/SKILL.md
    description: Add Browser-Based Questions section to all skills
    parallel: true

  - id: item-6-optimize-list-apis
    files:
      - src/services/document-manager.ts
      - src/services/diagram-manager.ts
    description: Remove content from list responses
    parallel: true

  - id: item-7-diagram-encouragement
    files:
      - skills/brainstorming/SKILL.md
      - skills/rough-draft/interface.md
      - skills/systematic-debugging/SKILL.md
    description: Add Diagram Opportunities section
    parallel: true

  - id: item-8-npm-warnings
    files: [plugins/wireframe/package.json]
    description: Add overrides for deprecated dependencies
    parallel: true

  - id: item-9-textarea-fix
    files: [ui/src/components/ai-ui/inputs/TextArea.tsx]
    description: Make onChange optional with internal state
    parallel: true

  - id: item-10-markdown-padding
    files: [ui/src/components/ai-ui/display/Markdown.tsx]
    description: Add mb-4 bottom margin
    parallel: true

  - id: item-11-splitbar-fix
    files: [ui/src/components/layout/SplitPane.tsx]
    description: Add drag state tracking and pointer-events control
    parallel: true

  # Wave 2: Tasks with dependencies
  - id: item-2-mcp-default-setup
    files:
      - skills/collab/SKILL.md
      - skills/collab/work-item-loop.md
    description: Update collab setup to use MCP by default
    depends-on: [item-1-mcp-session-discovery]

  - id: item-5-refresh-button
    files: [ui/src/components/dashboard/Dashboard.tsx]
    description: Add refresh button to sidebar
    depends-on: [item-6-optimize-list-apis]
```

## Execution Waves

### Wave 1 (9 parallel tasks)
All independent - can run simultaneously:
- item-1-mcp-session-discovery
- item-3-parallel-dispatch
- item-4-render-ui-default
- item-6-optimize-list-apis
- item-7-diagram-encouragement
- item-8-npm-warnings
- item-9-textarea-fix
- item-10-markdown-padding
- item-11-splitbar-fix

### Wave 2 (2 tasks after dependencies)
After Wave 1 completes:
- item-2-mcp-default-setup (depends on item-1)
- item-5-refresh-button (depends on item-6)

## Verification
- [ ] All 11 items have tasks in graph
- [ ] Dependencies correctly identified
- [ ] No circular dependencies
- [ ] Wave 1 tasks marked parallel: true
