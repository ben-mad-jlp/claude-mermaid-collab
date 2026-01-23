# Session: fresh-brave-bay

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Add "task" type to collab workflow
**Type:** feature
**Status:** documented
**Problem/Goal:** Add a new "task" type for operational tasks (docker containers, library installs, folder organization) that need brainstorming but skip TDD. Simplify types to 3: feature, bugfix, task.

**Approach:**
- Create new "task-planning" skill with phases: Prerequisites → Steps → Verification
- Modify routing: task → brainstorming → task-planning → executing-plans (no TDD)
- Remove refactor and spike types from the system

**Success Criteria:**
- gather-session-goals infers 3 types: code, bugfix, task
- collab skill routes task → brainstorming → task-planning → executing-plans
- New task-planning skill exists with Prerequisites/Steps/Verification phases
- executing-plans skips TDD for task type items
- Old type references (feature, refactor, spike) removed from all skills

**Decisions:**
- Refactors and spikes become "code" type (still need TDD)
- Final types: code, bugfix, task
- Type inference keywords for "task": "setup", "install", "configure", "organize", "clean up", "docker", "deploy"
- Type inference keywords for "code": "add", "new", "create", "implement", "build", "refactor", "clean", "simplify", "restructure", "investigate", "explore", "spike"
- Type inference keywords for "bugfix": "fix", "bug", "broken", "error", "crash", "fail"

---

### Item 2: Fix collab-compact skill not triggering
**Type:** bugfix
**Status:** documented
**Problem/Goal:** The collab-compact skill is not being triggered when it should be.

**Root Cause:** 
- hooks.json has no PreCompact hook configured
- Claude Code provides a PreCompact hook that fires before compaction (manual or auto)
- No automatic mechanism saves collab context before context is compacted

**Approach:**
1. **PreCompact hook** - catches compaction when it happens
   - Add PreCompact hook to hooks.json
   - Create pre-compact.sh script that:
     - Checks if active collab session exists
     - Reads collab-state.json to get current phase
     - Writes context-snapshot.json with activeSkill, currentStep, inProgressItem
     - Sets hasSnapshot: true in collab-state.json

2. **Phase transition snapshots** - proactively save at key points
   - Add "Snapshot Saving" sections to these skills:
     - brainstorming (after each user answer, at phase transitions)
     - rough-draft (after each phase: interface→pseudocode→skeleton)
     - systematic-debugging (after root cause documented)
     - executing-plans (after each task completes)
   - Skills call saveSnapshot() function documented in their SKILL.md
   - Snapshots save: activeSkill, currentStep, pendingQuestion, inProgressItem

3. The existing collab resume flow (Step 5.1) already handles reading snapshots

**Success Criteria:**
- PreCompact hook exists in hooks.json and saves context before compaction
- brainstorming, rough-draft, systematic-debugging, executing-plans save snapshots at transitions
- After auto-compact, running /collab restores context from snapshot
- After manual /compact during a skill, context is preserved

**Decisions:**
- Use PreCompact hook (triggers on both manual /compact and auto-compact)
- Script should be silent on success (exit 0), only show errors

---

### Item 3: Fix session items not showing in left sidebar
**Type:** bugfix
**Status:** documented
**Problem/Goal:** Session items are not appearing in the list on the left side of the document/diagram screen.

**Root Cause:**
- `document.html` creates APIClient but never calls `api.setSession()` with URL params
- diagram.html correctly extracts `project` and `session` from URL and calls `api.setSession()`
- Without session set, `api.getSessionQuery()` returns empty string
- API calls go to `/api/documents` without session params, returning no results

**Approach:**
- Add session extraction and setup code to document.html (matching diagram.html pattern)
- Extract `project` and `session` from URL params
- Call `api.setSession(project, session)` before creating SessionPanel
- Also check localStorage as fallback (like diagram.html does)

**Success Criteria:**
- document.html extracts session params from URL and sets on API client
- Session panel shows documents and diagrams in the session
- Navigation between items works correctly

**Decisions:**
- Match the pattern used in diagram.html for consistency

---

### Item 4: Redesign session panel with thumbnail cards
**Type:** task
**Status:** documented
**Problem/Goal:** Replace simple list view with thumbnail preview cards like the main dashboard. Remove the header bar and collapse button.

**Approach:**
1. Remove header bar (title + collapse button) from session-panel.js
2. Remove collapse/expand functionality and related CSS
3. Replace list items with card layout:
   - Use `.item-card` style similar to dashboard
   - Include `.item-thumbnail` with diagram preview or document preview
   - Cards scale horizontally to fit panel width (100% width, fixed aspect ratio)
   - Cards stack vertically with small gap
4. For diagrams: render SVG thumbnail (reuse existing thumbnail API)
5. For documents: show text preview (first ~100 chars) like dashboard

**Success Criteria:**
- No header bar or collapse button
- Session items show as thumbnail cards
- Cards scale to panel width
- Diagrams show SVG preview, documents show text preview
- Visual consistency with main dashboard cards

**Decisions:**
- Remove collapse functionality entirely (not needed)
- Match dashboard card styling for consistency

---

## Interface Definition

### File Structure

**Item 1: Add "task" type**
- `skills/gather-session-goals/SKILL.md` - Update type inference keywords
- `skills/collab/SKILL.md` - Update routing logic for task type
- `skills/brainstorming/SKILL.md` - Remove refactor/spike template references
- `skills/executing-plans/SKILL.md` - Add TDD skip logic for task type
- `skills/task-planning/SKILL.md` - **NEW** task planning skill

**Item 2: Fix collab-compact**
- `hooks/hooks.json` - Add PreCompact hook configuration
- `hooks/pre-compact.sh` - **NEW** context snapshot script
- `skills/brainstorming/SKILL.md` - Add Snapshot Saving section
- `skills/systematic-debugging/SKILL.md` - Add Snapshot Saving section
- `skills/executing-plans/SKILL.md` - Add Snapshot Saving section
- (rough-draft already has Snapshot Saving section)

**Item 3: Fix session panel in document.html**
- `public/document.html` - Add session extraction and setup code

**Item 4: Redesign session panel**
- `public/js/session-panel.js` - Remove header, replace list with cards
- `public/css/session-panel.css` - Remove header styles, add card styles

### New Skill: task-planning/SKILL.md

```yaml
---
name: task-planning
description: Plan operational tasks (docker, installs, organization) that skip TDD
user-invocable: false
model: opus
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
---
```

**Phases:**
1. Prerequisites - What must exist before starting
2. Steps - Ordered list of commands/actions
3. Verification - How to confirm success

### New Hook: hooks/pre-compact.sh

```bash
#!/bin/bash
# Input: JSON on stdin with session_id, trigger, etc.
# Output: Write context-snapshot.json if collab session active
# Exit 0 on success (silent), exit 2 to show stderr
```

### Modified: hooks/hooks.json

Add to hooks object:
```json
"PreCompact": [
  {
    "matcher": "",
    "hooks": [
      {
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-compact.sh",
        "timeout": 5
      }
    ]
  }
]
```

### Modified: public/document.html

Add session setup before SessionPanel creation:
```javascript
// Extract session params from URL
const projectParam = urlParams.get('project');
const sessionParam = urlParams.get('session');

// Set session on API client
if (projectParam && sessionParam) {
  api.setSession(projectParam, sessionParam);
} else {
  // Fallback to localStorage
  const stored = localStorage.getItem('mermaid-collab-session');
  if (stored) {
    const { project, session } = JSON.parse(stored);
    api.setSession(project, session);
  }
}
```

### Modified: public/js/session-panel.js

**Remove:**
- `createDOM()` header creation (lines 67-99)
- `collapse()`, `expand()`, `toggle()` methods
- `collapseBtn` references

**Add:**
- Card-based `renderItems()` with thumbnails
- Thumbnail fetching for diagrams
- Text preview for documents

**New method signature:**
```javascript
renderItems() {
  // Create card elements with .session-panel-card class
  // Include .session-panel-card-thumbnail for preview
  // Include .session-panel-card-name for title
}
```

### Modified: public/css/session-panel.css

**Remove:**
- `.session-panel-header` styles
- `.session-panel-header-title` styles
- `.session-panel-collapse-btn` styles
- `.session-panel.collapsed` styles

**Add:**
```css
.session-panel-card {
  width: 100%;
  background: var(--card-bg);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.session-panel-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px var(--shadow-color);
}

.session-panel-card-thumbnail {
  width: 100%;
  aspect-ratio: 16/9;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.session-panel-card-name {
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

---

## Pseudocode

### Item 1: gather-session-goals type inference

```
FUNCTION inferType(itemDescription):
  text = lowercase(itemDescription)
  
  # Check for task keywords first (most specific)
  IF text contains any of ["setup", "install", "configure", "organize", 
                           "clean up", "docker", "deploy"]:
    RETURN "task"
  
  # Check for bugfix keywords
  IF text contains any of ["fix", "bug", "broken", "error", "crash", "fail"]:
    RETURN "bugfix"
  
  # Check for code keywords (includes former refactor/spike)
  IF text contains any of ["add", "new", "create", "implement", "build",
                           "refactor", "clean", "simplify", "restructure",
                           "investigate", "explore", "spike"]:
    RETURN "code"
  
  RETURN "unknown"  # Will prompt user to classify
```

### Item 1: collab routing logic

```
FUNCTION routeWorkItem(item):
  IF item.type == "bugfix":
    INVOKE systematic-debugging skill
  ELSE IF item.type == "task":
    INVOKE brainstorming skill
    # After brainstorming completes:
    INVOKE task-planning skill  # NEW - instead of rough-draft
  ELSE:  # "code" type
    INVOKE brainstorming skill
    # After brainstorming completes:
    INVOKE rough-draft skill  # Existing flow with TDD
```

### Item 1: task-planning skill flow

```
## Prerequisites Phase
1. Read design doc for current work item
2. Ask: "What needs to exist before starting this task?"
3. For each prerequisite:
   - Document: name, how to check if it exists
4. Ask: "Anything else needed?"
5. When done: proceed to Steps phase

## Steps Phase
1. Ask: "What are the steps to complete this task?"
2. For each step:
   - Document: command or action
   - Document: expected outcome
3. Order steps by dependency
4. Ask: "Anything else?"
5. When done: proceed to Verification phase

## Verification Phase
1. Ask: "How will you verify this task succeeded?"
2. Document verification commands/checks
3. Update design doc with all phases
4. Return to collab skill (item documented)
```

### Item 1: executing-plans TDD skip

```
FUNCTION executeTask(task, itemType):
  IF itemType == "task":
    # Skip TDD for operational tasks
    EXECUTE task commands directly
    RUN verification checks
  ELSE:
    # Normal TDD flow for code/bugfix
    INVOKE test-driven-development skill
    WRITE failing test
    IMPLEMENT code
    VERIFY test passes
```

### Item 2: pre-compact.sh script

```bash
#!/bin/bash

# Read input JSON from stdin (Claude Code provides this)
INPUT=$(cat)

# Find active collab session in current directory
SESSION_DIR=""
for dir in .collab/*/; do
  if [ -f "${dir}collab-state.json" ]; then
    SESSION_DIR="$dir"
    break
  fi
done

# Exit silently if no session
[ -z "$SESSION_DIR" ] && exit 0

# Read current state
STATE=$(cat "${SESSION_DIR}collab-state.json")
PHASE=$(echo "$STATE" | jq -r '.phase')
CURRENT_ITEM=$(echo "$STATE" | jq -r '.currentItem // empty')

# Determine active skill from phase
case "$PHASE" in
  brainstorming*) SKILL="brainstorming" ;;
  rough-draft*) SKILL="rough-draft" ;;
  implementation*) SKILL="executing-plans" ;;
  *) SKILL="collab" ;;
esac

# Write context snapshot
cat > "${SESSION_DIR}context-snapshot.json" << EOF
{
  "version": 1,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "activeSkill": "$SKILL",
  "currentStep": "$PHASE",
  "pendingQuestion": null,
  "inProgressItem": $( [ -n "$CURRENT_ITEM" ] && echo "$CURRENT_ITEM" || echo "null" ),
  "recentContext": []
}
EOF

# Update state to mark snapshot exists
jq '.hasSnapshot = true' "${SESSION_DIR}collab-state.json" > tmp.$ && \
  mv tmp.$ "${SESSION_DIR}collab-state.json"

exit 0
```

### Item 3: document.html session setup

```javascript
// After: const api = new APIClient();
// After: const urlParams = new URLSearchParams(window.location.search);
// After: const documentId = urlParams.get('id');

// ADD THIS BLOCK:
const projectParam = urlParams.get('project');
const sessionParam = urlParams.get('session');

if (projectParam && sessionParam) {
  api.setSession(projectParam, sessionParam);
} else {
  const stored = localStorage.getItem('mermaid-collab-session');
  if (stored) {
    try {
      const { project, session } = JSON.parse(stored);
      api.setSession(project, session);
    } catch (e) {
      console.error('Failed to parse stored session:', e);
    }
  }
}

// THEN: if (documentId && api.hasSession()) { ... SessionPanel ... }
```

### Item 4: session-panel.js card rendering

```javascript
renderItems() {
  this.itemsContainer.innerHTML = '';
  
  if (this.items.length === 0) {
    // Show empty state
    return;
  }
  
  for (const item of this.items) {
    // Create card container
    const card = createElement('div', 'session-panel-card');
    card.dataset.id = item.id;
    
    // Mark active item
    if (item.id === this.currentItemId) {
      card.classList.add('active');
    }
    
    // Create thumbnail
    const thumbnail = createElement('div', 'session-panel-card-thumbnail');
    
    if (item.type === 'diagram') {
      // Fetch SVG thumbnail
      const img = createElement('img');
      img.src = this.api.getThumbnailURL(item.id);
      img.alt = item.name;
      thumbnail.appendChild(img);
    } else {
      // Document text preview
      const preview = createElement('div', 'session-panel-card-preview');
      preview.textContent = item.content?.substring(0, 100) || 'Document';
      thumbnail.appendChild(preview);
    }
    
    // Create name label
    const name = createElement('div', 'session-panel-card-name');
    name.textContent = item.name;
    name.title = item.name;
    
    // Assemble card
    card.appendChild(thumbnail);
    card.appendChild(name);
    
    // Click handler
    card.addEventListener('click', () => {
      if (item.id !== this.currentItemId) {
        this.onNavigate(item.id, item.type);
      }
    });
    
    this.itemsContainer.appendChild(card);
  }
}
```

**Error Handling:**
- API errors: Show "Failed to load" in thumbnail area
- Missing thumbnails: Show placeholder icon

**Edge Cases:**
- Empty session: Show "No items in session"
- Very long names: Truncate with ellipsis
- Slow thumbnail load: Show loading spinner

---

## Skeleton

### Planned Files

**Item 1: Add "task" type**
- [ ] `skills/gather-session-goals/SKILL.md` - Update type inference section
- [ ] `skills/collab/SKILL.md` - Update Step 4.5 routing logic
- [ ] `skills/brainstorming/SKILL.md` - Remove refactor/spike template references
- [ ] `skills/executing-plans/SKILL.md` - Add TDD skip logic for task type
- [ ] `skills/task-planning/SKILL.md` - **NEW** task planning skill

**Item 2: Fix collab-compact**
- [ ] `hooks/hooks.json` - Add PreCompact hook
- [ ] `hooks/pre-compact.sh` - **NEW** context snapshot script
- [ ] `skills/brainstorming/SKILL.md` - Verify Snapshot Saving section
- [ ] `skills/systematic-debugging/SKILL.md` - Add Snapshot Saving section
- [ ] `skills/executing-plans/SKILL.md` - Add Snapshot Saving section

**Item 3: Fix session panel**
- [ ] `public/document.html` - Add session extraction code

**Item 4: Redesign session panel**
- [ ] `public/js/session-panel.js` - Remove header, add card rendering
- [ ] `public/css/session-panel.css` - Remove header styles, add card styles

**Note:** These files are documented but NOT created yet. They will be created/modified during the implementation phase by executing-plans.

---

### Task Dependency Graph

```yaml
tasks:
  # Item 1: Add "task" type
  - id: task-planning-skill
    files: [skills/task-planning/SKILL.md]
    tests: []
    description: Create new task-planning skill for operational tasks
    parallel: true

  - id: gather-goals-types
    files: [skills/gather-session-goals/SKILL.md]
    tests: []
    description: Update type inference to code/bugfix/task
    parallel: true

  - id: collab-routing
    files: [skills/collab/SKILL.md]
    tests: []
    description: Update routing for task type → task-planning
    depends-on: [task-planning-skill]

  - id: brainstorming-cleanup
    files: [skills/brainstorming/SKILL.md]
    tests: []
    description: Remove refactor/spike template references
    parallel: true

  - id: executing-plans-tdd-skip
    files: [skills/executing-plans/SKILL.md]
    tests: []
    description: Add TDD skip logic for task type items
    depends-on: [task-planning-skill]

  # Item 2: Fix collab-compact
  - id: pre-compact-script
    files: [hooks/pre-compact.sh]
    tests: []
    description: Create PreCompact hook script
    parallel: true

  - id: hooks-json-update
    files: [hooks/hooks.json]
    tests: []
    description: Add PreCompact hook configuration
    depends-on: [pre-compact-script]

  - id: brainstorming-snapshots
    files: [skills/brainstorming/SKILL.md]
    tests: []
    description: Verify Snapshot Saving section exists
    parallel: true

  - id: debugging-snapshots
    files: [skills/systematic-debugging/SKILL.md]
    tests: []
    description: Add Snapshot Saving section
    parallel: true

  - id: executing-snapshots
    files: [skills/executing-plans/SKILL.md]
    tests: []
    description: Add Snapshot Saving section
    depends-on: [executing-plans-tdd-skip]

  # Item 3: Fix session panel in document.html
  - id: document-html-session
    files: [public/document.html]
    tests: []
    description: Add session extraction and API setup
    parallel: true

  # Item 4: Redesign session panel
  - id: session-panel-css
    files: [public/css/session-panel.css]
    tests: []
    description: Remove header styles, add card styles
    parallel: true

  - id: session-panel-js
    files: [public/js/session-panel.js]
    tests: []
    description: Remove header, replace list with card rendering
    depends-on: [session-panel-css]
```

---

### Execution Order

**Parallel Batch 1** (no dependencies - can run simultaneously):
- task-planning-skill
- gather-goals-types
- brainstorming-cleanup
- pre-compact-script
- brainstorming-snapshots
- debugging-snapshots
- document-html-session
- session-panel-css

**Batch 2** (depends on Batch 1):
- collab-routing (depends on task-planning-skill)
- executing-plans-tdd-skip (depends on task-planning-skill)
- hooks-json-update (depends on pre-compact-script)
- session-panel-js (depends on session-panel-css)

**Batch 3** (depends on Batch 2):
- executing-snapshots (depends on executing-plans-tdd-skip)

---

## Diagrams
(auto-synced)