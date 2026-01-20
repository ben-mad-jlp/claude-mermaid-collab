---
name: collab
description: Use when starting collaborative design work - creates isolated collab sessions with mermaid-collab server
---

# Collab Sessions

Start or resume a collaborative design session. The mermaid-collab server must be running.

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
1. For each session, read `.collab/<name>/collab-state.json` to get phase and template
2. Display list:
   ```
   Existing sessions:

   1. bright-calm-river (feature) - brainstorming
   2. swift-green-meadow (bugfix) - implementation

   Resume which session? (or 'new')
   ```
3. If user selects existing session → Jump to **Step 4: Start**
4. If user selects 'new' → Continue to **Step 3**

**If no sessions exist:** Continue to **Step 3**

---

## Step 3: Create Session

### 3.1 Ensure .gitignore

```bash
git check-ignore -q .collab 2>/dev/null || echo ".collab/" >> .gitignore
```

### 3.2 Ask Template

```
What type of work is this?

1. feature - New functionality
2. bugfix - Fix an issue
3. refactor - Restructure existing code
4. spike - Exploratory/research work
```

### 3.3 Generate Name

Use the MCP tool to generate a memorable name:

```
Tool: mcp__mermaid__generate_session_name
Args: {}
```

Returns: `{ name: "bright-calm-river" }`

### 3.4 Create Folder Structure

```bash
mkdir -p .collab/<name>/diagrams
mkdir -p .collab/<name>/documents
```

### 3.5 Write Initial Files

Write `.collab/<name>/collab-state.json`:
```json
{
  "phase": "brainstorming",
  "template": "<selected-template>",
  "lastActivity": "<ISO-timestamp>"
}
```

Write `.collab/<name>/documents/design.md`:
```markdown
# Design

## Problem / Goal

*To be filled during brainstorming*

## Key Decisions

*Decisions will be documented as they are made*

## Success Criteria

*To be defined*

## Out of Scope

*To be defined*
```

---

## Step 4: Start

### 4.1 Display Session Info

```
Session: <name>
Dashboard: http://localhost:3737
Phase: <phase>

Starting <phase> phase...
```

### 4.2 Read Design Doc (if resuming)

```bash
cat .collab/<name>/documents/design.md
```

### 4.3 Invoke Phase Skill

Based on `phase` in `collab-state.json`:
- `brainstorming` → invoke **brainstorming** skill
- `rough-draft/*` → invoke **rough-draft** skill
- `implementation` → invoke **executing-plans** skill

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
  "template": "feature",
  "lastActivity": "2026-01-19T10:30:00Z",
  "pendingVerificationIssues": []
}
```

**Phase values:**
- `brainstorming` - Initial design exploration
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

## Integration

**Transitions to:**
- **brainstorming** - After creating new session or resuming at brainstorming phase
- **rough-draft** - When resuming at rough-draft phase
- **executing-plans** - When resuming at implementation phase

**Called by:**
- User directly via `/collab` command
- Any workflow starting collaborative design work
