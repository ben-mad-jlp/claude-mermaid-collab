# Custom Agents

Agents are specialized subprocesses for complex, multi-step tasks. Unlike skills (which guide Claude), agents spawn fresh subagent processes with focused contexts and specific tool access.

## Available Agents

1. **systematic-debugging** - Root cause investigation without implementing fixes
2. **subagent-driven-development** - Execute plans with fresh subagent per task
3. **verification-before-completion** - Run verification commands before claiming done
4. **using-git-worktrees** - Isolated git worktrees for feature work
5. **verify-phase** - Verify rough-draft phase output against design doc

## Core Principles

- **Fresh Context**: Each subagent starts clean, no accumulated context pollution
- **Tool Restrictions**: Agents declare allowed tools in frontmatter
- **No Side Effects**: Many agents (like debugging) are prohibited from modifying code