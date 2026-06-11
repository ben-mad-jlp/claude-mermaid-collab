# Claude Code Skills

Skills are structured workflows that guide Claude through complex tasks. They enforce methodology (TDD, brainstorming discipline, verification gates) and provide predictable, repeatable processes.

## Core Principle

> **"If a skill exists, use it. STOP any rationalization about being too simple or not needing it."**

## Skill Categories

1. **Collaboration Framework** (8) - Session orchestration, work items, cleanup
2. **Brainstorming & Design** (6) - 5-phase design state machine
3. **Rough-Draft Phase** (5) - 4-phase refinement (interface → pseudocode → skeleton → handoff)
4. **Implementation** (3) - Plan execution with checkpoints
5. **Kodex Knowledge** (7) - Knowledge base management
6. **Supporting Skills** (12) - TDD, code review, planning, etc.

## Key Skills

- `/collab` - Main orchestrator for collaborative sessions
- `/brainstorming` - 5-phase design exploration
- `/rough-draft` - Refine design into implementable specs
- `/executing-plans` - Batch task execution
- `/kodex-fix` - Maintain knowledge base