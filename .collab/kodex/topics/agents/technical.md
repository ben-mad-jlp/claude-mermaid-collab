## Agent File Format

```yaml
---
name: agent-name
description: "What this agent does"
user-invocable: false
model: haiku|opus
allowed-tools:
  - Read
  - Glob
  - mcp__plugin_mermaid-collab_mermaid__*
---

# Agent Title

[Markdown instructions...]
```

## systematic-debugging

**Purpose:** Find root cause before attempting fixes

**Explicit Prohibition:**
- NO editing source files
- NO writing fix code
- Document only
- Fixes happen later via rough-draft -> executing-plans

**When to Use:**
- Test failures, bugs, unexpected behavior
- Performance problems, build failures
- ESPECIALLY when under time pressure

**Core Law:** NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST

## subagent-driven-development

**Purpose:** Execute plan by dispatching fresh subagent per task

**Process:**
1. Dispatch implementer subagent with task
2. Spec compliance review (does it match requirements?)
3. Code quality review (is it well-written?)
4. Next task or done

**Subagent Prompts:**
- `implementer-prompt.md` - Implements the task
- `spec-reviewer-prompt.md` - Reviews against spec
- `code-quality-reviewer-prompt.md` - Reviews code quality

## verification-before-completion

**Purpose:** Run verification commands before claiming work complete

## using-git-worktrees

**Purpose:** Create isolated git worktrees for feature work without affecting main branch

## verify-phase

**Purpose:** Verify rough-draft phase output aligns with design document