# Session: bold-cool-grove

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: executing-plans not using subagents plugin
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
executing-plans doesn't enforce using subagent-driven-development, so TDD, spec compliance review, and code quality review get skipped.

**Approach:**
Make subagent dispatch mandatory with explicit gates that prevent proceeding without it.

**Root Cause:**
The instruction to use subagent-driven-development is a suggestion, not a gate. Claude can ignore it and implement directly.

**Success Criteria:**
- executing-plans MUST spawn Task agents for implementation (cannot implement inline)
- Each Task agent MUST invoke subagent-driven-development skill
- Spec compliance review MUST pass before task is marked complete
- Code quality review MUST pass before task is marked complete

**Decisions:**

---

### Item 2: Add diff-based edits to collab MCP
**Type:** feature
**Status:** documented
**Problem/Goal:**
Full document updates waste context when only small changes are needed.

**Approach:**
Add a new MCP tool `patch_document` using search-replace pattern (like Edit tool). Claude is already trained on this pattern, it's robust to content shifts, and uses familiar `old_string` → `new_string` API.

**Success Criteria:**
- New MCP tool `patch_document(project, session, id, old_string, new_string)`
- Fails if `old_string` not found or not unique (like Edit tool)
- Returns success with updated content preview
- Existing `update_document` still works for full replacements

**Decisions:**
- Use search-replace format (not line-based or JSON Patch)

---

### Item 3: Add visual diff view in documents
**Type:** feature
**Status:** documented
**Problem/Goal:**
After a patch, users can't easily see what changed in the document.

**Approach:**
When rendering markdown to HTML preview, inject diff highlighting styles. Pass old_string/new_string from patch_document to client via WebSocket. Leverage existing undo/redo history for computing diffs.

**Success Criteria:**
- After MCP patch, rendered preview shows diff highlighting
- Green background on added content in preview
- Red background + strikethrough on removed content in preview
- Toggle button to show clean preview without diff markers
- Raw editor unchanged (no highlighting there)

**Decisions:**
- Highlight in rendered preview only, not raw code editor

---

### Item 4: rough-draft skipped phases and edited files directly
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
rough-draft can skip phases and edit source files, bypassing executing-plans entirely.

**Approach:**
1. Add explicit gates that block phase transitions without completion
2. Forbid Edit/Write tool usage during rough-draft phase (only MCP collab tools allowed)
3. Force transition to executing-plans - never implement inline

**Root Cause:**
1. No gate enforcing phase completion
2. No restriction on file edits during rough-draft
3. When phases seem "unnecessary", Claude skips them

**Success Criteria:**
- rough-draft CANNOT skip phases (must complete interface → pseudocode → skeleton in order)
- rough-draft CANNOT use Edit/Write tools on source files (only MCP collab tools for design docs)
- rough-draft MUST transition to executing-plans for implementation (no inline implementation)
- If phases don't apply (e.g., docker), still must document "N/A" and go through executing-plans

**Decisions:**

---

### Item 5: Simplify gather-session-goals flow
**Type:** feature
**Status:** documented
**Problem/Goal:**
When user provides all work items upfront, the follow-up questions ("any bugs?", "any features?", etc.) are annoying and redundant.

**Approach:**
- Parse initial response for work items
- Infer types from context (fix/bug → bugfix, add/new → feature, etc.)
- Skip type-specific follow-up questions if items already captured
- Only ask "anything else?" once, then confirm

**Success Criteria:**
- If user provides items upfront, skip redundant category questions
- Still classify unknown types
- Still confirm final list before proceeding

**Decisions:**

---

## Interface Definition

### Files to Modify

| Item | File | Change |
|------|------|--------|
| 1 | `skills/executing-plans/SKILL.md` | Add mandatory subagent dispatch gates |
| 2 | `src/mcp/server.ts` | Add `patch_document` tool |
| 3 | `public/js/document-editor.js` | Add diff rendering in preview |
| 3 | `public/document.html` | Add diff toggle button + CSS |
| 4 | `skills/rough-draft/SKILL.md` | Add phase gates + Edit/Write restrictions |
| 5 | `skills/gather-session-goals/SKILL.md` | Simplify flow logic |

### New MCP Tool (Item 2)

```typescript
// src/mcp/server.ts
{
  name: 'patch_document',
  description: 'Apply a search-replace patch to a document.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to project root' },
      session: { type: 'string', description: 'Session name' },
      id: { type: 'string', description: 'Document ID' },
      old_string: { type: 'string', description: 'Text to find' },
      new_string: { type: 'string', description: 'Text to replace with' }
    },
    required: ['project', 'session', 'id', 'old_string', 'new_string']
  }
}
```

### Diff Rendering (Item 3)

```javascript
// public/js/document-editor.js
function renderDiffPreview(oldStr, newStr) { ... }
function toggleDiffView() { ... }
```

```html
<!-- public/document.html -->
<button id="toggle-diff">Show Diff</button>
<style>
  .diff-added { background: #d4edda; }
  .diff-removed { background: #f8d7da; text-decoration: line-through; }
</style>
```

---

## Pseudocode

### Task 1: executing-plans/SKILL.md

```
BEFORE executing any task:
  1. GATE: "Implementation MUST use Task tool with subagent"
  2. Add red flag: "NEVER implement inline - always dispatch Task agent"
  3. Add checklist before marking complete:
     - [ ] Task agent was spawned (not inline implementation)
     - [ ] subagent-driven-development skill was invoked
     - [ ] Spec compliance review passed
     - [ ] Code quality review passed
```

### Task 2: src/mcp/server.ts - patch_document

```
1. Add tool definition to tools array (after update_document)
2. Add case handler:
   
   case 'patch_document':
     EXTRACT project, session, id, old_string, new_string from args
     VALIDATE all required fields present
     
     READ current document content
     
     COUNT occurrences of old_string in content
     IF count == 0:
       THROW "old_string not found in document"
     IF count > 1:
       THROW "old_string matches multiple locations (N found). Provide more context."
     
     REPLACE old_string with new_string
     WRITE updated content to file
     
     BROADCAST via WebSocket: { type: 'patch', id, old_string, new_string }
     
     RETURN { success: true, message: "Patched", preview: <snippet around change> }
```

### Task 3: document-editor.js + document.html

```
// document-editor.js

STATE:
  diffMode = false
  lastPatch = null  // { old_string, new_string }

ON WebSocket message 'patch':
  STORE lastPatch = { old_string, new_string }
  IF diffMode:
    renderDiffPreview()

FUNCTION renderDiffPreview():
  GET rendered HTML from preview container
  
  IF lastPatch exists:
    FIND new_string location in rendered HTML
    WRAP new_string with <span class="diff-added">
    
    INSERT <span class="diff-removed">{old_string}</span> before added span
  
  UPDATE preview container

FUNCTION toggleDiffView():
  diffMode = !diffMode
  UPDATE button text: "Show Diff" / "Hide Diff"
  IF diffMode:
    renderDiffPreview()
  ELSE:
    renderPreview()  // normal render

// document.html
ADD button: <button id="toggle-diff">Show Diff</button>
ADD CSS for .diff-added (green) and .diff-removed (red + strikethrough)
```

### Task 4: rough-draft/SKILL.md

```
ADD at top of skill:

## RESTRICTIONS
**FORBIDDEN during rough-draft:**
- Edit tool on source files
- Write tool on source files
- Any file modification outside .collab/ folder

**ALLOWED:**
- MCP collab tools (update_document, patch_document, create_diagram, etc.)
- Read tool (for exploration)
- Bash tool (for non-destructive commands)

ADD phase gates:

BEFORE transitioning to pseudocode:
  VERIFY interface section exists and is non-empty
  IF missing: STOP, do not proceed

BEFORE transitioning to skeleton:
  VERIFY pseudocode section exists and is non-empty
  IF phases don't apply: document "N/A - [reason]" explicitly
  IF missing: STOP, do not proceed

BEFORE transitioning to implementation:
  VERIFY skeleton section exists
  MUST invoke executing-plans skill
  NEVER implement inline
```

### Task 5: gather-session-goals/SKILL.md

```
REPLACE Step 2 "Anything Else Loop" with:

### Step 2: Anything Else

After parsing initial response:
  1. Infer types for each item from context
  2. Ask ONCE: "Anything else?"
  3. If user provides more: parse, infer types, repeat step 2
  4. If user says no/done: proceed to Step 3

DELETE the explicit category questions:
  - "Any bugs?"
  - "Any features?"  
  - "Any refactors?"
  - "Any spikes?"
```

---

## Skeleton

**No new files to create.** All changes are edits to existing files.

### Task Dependency Graph

```yaml
tasks:
  - id: executing-plans-gates
    files: [skills/executing-plans/SKILL.md]
    description: Add mandatory subagent dispatch gates
    parallel: true

  - id: patch-document-mcp
    files: [src/mcp/server.ts]
    description: Add patch_document MCP tool
    parallel: true

  - id: diff-view-ui
    files: [public/js/document-editor.js, public/document.html]
    description: Add diff rendering in preview with toggle
    depends-on: [patch-document-mcp]

  - id: rough-draft-gates
    files: [skills/rough-draft/SKILL.md]
    description: Add phase gates and Edit/Write restrictions
    parallel: true

  - id: gather-goals-simplify
    files: [skills/gather-session-goals/SKILL.md]
    description: Simplify flow - skip redundant questions
    parallel: true
```

### Execution Order

| Batch | Tasks |
|-------|-------|
| 1 (parallel) | executing-plans-gates, patch-document-mcp, rough-draft-gates, gather-goals-simplify |
| 2 (sequential) | diff-view-ui (depends on patch-document-mcp) |

---

## Diagrams
(auto-synced)