---
name: collab
description: Use when starting collaborative design work - creates isolated collab sessions with mermaid-collab server
user-invocable: false
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep
---

# Collab Sessions

Start or resume a collaborative design session. The mermaid-collab server must be running.

This skill is the orchestrator for the collab workflow. It manages session creation, the work item loop, and coordinates other skills.

---

## Step 1: Check Server

```bash
curl -s http://localhost:3737 > /dev/null 2>&1 && echo "running" || echo "not running"
```

**If not running:**
```
Server not running. From the plugin directory, run:

  bun run bin/mermaid-collab.ts start

Then run /collab again.
```
**STOP here if server is not running.**

---

## Session Management

Session management handles finding existing sessions, creating new sessions, and resuming previous work.

**Key steps:**
- **Step 2: Find Sessions** - List existing sessions with their phases
- **Step 3: Create Session** - Generate name, create files, invoke gather-session-goals
- **Step 5: Resume Session** - Restore from snapshot or route through ready-to-implement

**For detailed session management procedures, see [session-mgmt.md](session-mgmt.md).**

---

## Work Item Loop

The core orchestration loop (Step 4) that processes work items one at a time.

**Key steps:**
- Read design doc and parse work items
- Find first pending item
- Route by type (bugfix → systematic-debugging, task → task-planning, code → rough-draft)
- Mark item documented and continue loop
- When all items done → invoke ready-to-implement

**For detailed work item loop procedures, see [work-item-loop.md](work-item-loop.md).**

---

## Folder Structure

```
.collab/
└── <session-name>/
    ├── diagrams/
    ├── documents/
    │   └── design.md
    └── collab-state.json
```

## State Tracking (collab-state.json)

```json
{
  "phase": "brainstorming",
  "lastActivity": "2026-01-19T10:30:00Z",
  "currentItem": null,
  "pendingVerificationIssues": []
}
```

**Fields:**
- `phase` - Current workflow phase
- `lastActivity` - ISO timestamp of last activity
- `currentItem` - Item number being processed (null when not in loop)
- `pendingVerificationIssues` - Issues from verification phase

**Phase values:**
- `brainstorming` - Work item loop / brainstorming phase
- `rough-draft/interface` - Defining interfaces
- `rough-draft/pseudocode` - Logic flow
- `rough-draft/skeleton` - Stub files
- `implementation` - Executing the plan

---

## MCP Tools Reference

| Action | Tool |
|--------|------|
| Generate session name | `mcp__mermaid__generate_session_name()` |
| Create diagram | `mcp__mermaid__create_diagram({ project, session, name, content })` |
| Create document | `mcp__mermaid__create_document({ project, session, name, content })` |
| Preview diagram | `mcp__mermaid__preview_diagram({ project, session, id })` |
| Preview document | `mcp__mermaid__preview_document({ project, session, id })` |

**Note:** `project` is the current working directory (absolute path). `session` is the session name.

---

## Helper Functions

### parseWorkItems(designDoc)

Parses the design doc and extracts work items.

```
FUNCTION parseWorkItems(doc):
  items = []
  FOR each "### Item N:" section in doc:
    item = {
      number: N,
      title: parse title after "### Item N:",
      type: parse **Type:** field value,
      status: parse **Status:** field value
    }
    ADD item to items
  RETURN items
```

**Example parsing:**
```markdown
### Item 1: Add user authentication
**Type:** feature
**Status:** pending
```
→ `{ number: 1, title: "Add user authentication", type: "feature", status: "pending" }`

---

## Integration

**Transitions to:**
- **gather-session-goals** - After creating new session (collect work items)
- **brainstorming** - From work item loop for code and task items
- **systematic-debugging** - From work item loop for bugfix items
- **task-planning** - From brainstorming for task items
- **rough-draft** - From brainstorming for code items
- **ready-to-implement** - When all items documented or on resume

**Called by:**
- User directly via `/collab` command
- Any workflow starting collaborative design work

**Related skills:**
- **gather-session-goals** - Collects and classifies work items at session start
- **brainstorming** - Explores requirements for code and task items
- **systematic-debugging** - Investigates bugfix items (documentation only)
- **task-planning** - Plans operational tasks (prerequisites → steps → verification)
- **ready-to-implement** - Central checkpoint, validates all items documented
- **rough-draft** - Bridges design to implementation (interface → pseudocode → skeleton)
- **verify-phase** - Checks rough-draft output aligns with design
- **executing-plans** - Implements the plan with parallel task execution

**Collab Workflow Chain:**
```
collab --> gather-session-goals --> work-item-loop --> ready-to-implement --> rough-draft --> executing-plans
                                         |                    ^
                                         |    (all documented)|
                                         v                    |
                                    brainstorming ────────────┤
                                         |                    |
                                    ┌────┴────┐              |
                                    v         v              |
                            task-planning  rough-draft ──────┘
                                    |
                            executing-plans
                                    |
                            systematic-debugging ────────────┘

Resume flow:
collab --> ready-to-implement --> (back to loop if pending) or (rough-draft/task-planning if done)
```
