---
name: collab
description: Use when starting collaborative design work - creates isolated collab sessions with mermaid-collab server
user_invocable: true
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

## Step 2: Find Sessions

```bash
ls -d .collab/*/ 2>/dev/null | xargs -I{} basename {}
```

**If sessions exist:**
1. For each session, read `.collab/<name>/collab-state.json` to get phase
2. Display list with numbered options:
   ```
   Existing sessions:

   1. bright-calm-river - brainstorming
   2. swift-green-meadow - implementation
   3. Create new session

   Select option (1-3):
   ```
3. If user selects existing session number → Jump to **Step 5: Resume Session**
4. If user selects 'new' option → Continue to **Step 3**

**If no sessions exist:** Continue to **Step 3**

---

## Step 3: Create Session

### 3.1 Ensure .gitignore

```bash
if [ -f .gitignore ]; then
  git check-ignore -q .collab 2>/dev/null || echo ".collab/" >> .gitignore
fi
```

**Note:** Only modifies `.gitignore` if it already exists. Does not create a new `.gitignore` file.

### 3.2 Generate Name

Use the MCP tool to generate a memorable name:

```
Tool: mcp__mermaid__generate_session_name
Args: {}
```

Returns: `{ name: "bright-calm-river" }`

### 3.3 Create Initial Files

1. Create design.md via MCP (this auto-creates folder structure):

   Tool: mcp__mermaid__create_document
   Args: {
     "project": "<absolute-path-to-cwd>",
     "session": "<session-name>",
     "name": "design",
     "content": "# Session: <session-name>\n\n## Session Context\n**Out of Scope:** (session-wide boundaries)\n**Shared Decisions:** (cross-cutting choices)\n\n---\n\n## Work Items\n\n*To be filled by gather-session-goals*\n\n---\n\n## Diagrams\n(auto-synced)"
   }

2. Write collab-state.json (folder now exists from step 1):

   Write .collab/<name>/collab-state.json:
   {
     "phase": "brainstorming",
     "lastActivity": "<ISO-timestamp>",
     "currentItem": null
   }

### 3.4 Set Environment Variable

Set the session path environment variable for hooks:

```bash
export COLLAB_SESSION_PATH="$(pwd)/.collab/<name>"
```

### 3.5 Invoke gather-session-goals

```
Invoke skill: gather-session-goals
```

This skill will:
- Ask user what they want to accomplish
- Classify each item as feature/bugfix/refactor/spike
- Write Work Items section to design doc
- All items start with `Status: pending`

After gather-session-goals returns → Jump to **Step 4: Work Item Loop**

---

## Step 4: Work Item Loop

This is the core orchestration loop that processes work items one at a time.

### 4.1 Read Design Doc

```bash
cat .collab/<name>/documents/design.md
```

### 4.2 Parse Work Items

Use `parseWorkItems()` helper to extract items from design doc:
- Find all `### Item N:` sections
- Extract Title, Type, and Status fields
- Return list of work items

### 4.3 Find First Pending Item

```
pending_item = items.find(i => i.status == "pending")
```

**If no pending items:**
```
All work items documented. Proceeding to validation...
```
→ Invoke **ready-to-implement** skill
→ **END** (ready-to-implement takes over)

**If pending item found:** Continue to 4.4

### 4.4 Update State

Update `.collab/<name>/collab-state.json`:
```json
{
  "currentItem": <item-number>,
  "lastActivity": "<ISO-timestamp>"
}
```

### 4.5 Route by Type

**If type is `bugfix`:**
```
Processing bugfix: <item-title>
Invoking systematic-debugging for investigation...
```
→ Invoke **systematic-debugging** skill

**If type is `feature`, `refactor`, or `spike`:**
```
Processing <type>: <item-title>
Invoking brainstorming...
```
→ Invoke **brainstorming** skill

### 4.6 Mark Item Documented

After the invoked skill returns, update the work item in design doc:
- Change `**Status:** pending` to `**Status:** documented`

### 4.7 Clear Current Item

Update `.collab/<name>/collab-state.json`:
```json
{
  "currentItem": null,
  "lastActivity": "<ISO-timestamp>"
}
```

### 4.8 Continue Loop

→ Go back to **Step 4.1** (continue processing next pending item)

---

## Step 5: Resume Session

When user selects an existing session from Step 2.

### 5.1 Set Environment Variable

```bash
export COLLAB_SESSION_PATH="$(pwd)/.collab/<name>"
```

### 5.2 Read State

```bash
cat .collab/<name>/collab-state.json
```

### 5.3 Display Session Info

```
Session Resumed: <name>
Phase: <phase>
Dashboard: http://localhost:3737

Checking work item status...
```

### 5.4 Invoke ready-to-implement

**Always** route through ready-to-implement for resume:

```
Invoke skill: ready-to-implement
```

ready-to-implement will:
- If pending items exist → return with `action: "return_to_loop"` → Go to **Step 4: Work Item Loop**
- If all documented → proceed to rough-draft (on user confirmation)

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
- **brainstorming** - From work item loop for feature/refactor/spike items
- **systematic-debugging** - From work item loop for bugfix items
- **ready-to-implement** - When all items documented or on resume

**Called by:**
- User directly via `/collab` command
- Any workflow starting collaborative design work

**Related skills:**
- **gather-session-goals** - Collects and classifies work items at session start
- **brainstorming** - Explores requirements for feature/refactor/spike items
- **systematic-debugging** - Investigates bugfix items (documentation only)
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
                                    or                        |
                                    systematic-debugging ─────┘

Resume flow:
collab --> ready-to-implement --> (back to loop if pending) or (rough-draft if done)
```
