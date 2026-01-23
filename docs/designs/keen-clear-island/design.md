# Session: keen-clear-island

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Fix split layout - docs/diagrams panel should be at same level as raw/rendered split
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
The split on the left showing other docs and diagrams is currently at the top level. It should be nested at the same level as the raw/rendered split.

**Approach:**
1. Move `#session-panel-container` inside `.split-pane` in both document.html and diagram.html
2. Change `.session-panel` CSS from `position: fixed` to `position: relative` so it participates in flex layout
3. Remove the body margin adjustments (`.has-session-panel .container` rules) since panel will be part of flex layout
4. Ensure the session panel resizer works correctly within the new flex context

**Root Cause:**
The session panel uses `position: fixed` (session-panel.css:3-14) which positions it relative to the viewport, completely outside the document flow. The `#session-panel-container` in the HTML is placed outside `.split-pane` as a sibling within `.main-content`, rather than inside `.split-pane` as a sibling to editor-pane and preview-pane.

**Success Criteria:**
- Session panel appears as the leftmost pane within the same flex container as editor/preview
- Resizing the session panel works correctly
- The three-pane layout (session panel | editor | preview) is cohesive
- No fixed positioning - panel scrolls with content if applicable

**Decisions:**
- Keep existing resizer functionality but adapt it for flex context

---

### Item 2: Clear stale sessions from dropdown - only show valid sessions
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
The session names dropdown on the main screen shows old sessions that were deleted. These need to be cleared to only show valid sessions.

**Approach:**
1. Modify `SessionRegistry.list()` in `src/services/session-registry.ts` to validate each session's existence before returning
2. For each session in the registry, check if the session directory exists at `{project}/.collab/{session}`
3. Filter out sessions whose directories no longer exist
4. Optionally: auto-remove stale entries from the registry file when detected (self-healing)

**Root Cause:**
Sessions are tracked in a global registry file at `~/.mermaid-collab/sessions.json`. The `list()` method (session-registry.ts:133-138) returns all registered sessions without validating that their directories still exist on disk. When session folders are deleted, the registry is not updated, causing stale entries to appear in the dropdown.

**Success Criteria:**
- Deleted sessions do not appear in the dropdown
- Valid sessions still appear correctly
- No performance regression from existence checks

**Decisions:**
- Validate session existence in `list()` method rather than requiring explicit cleanup calls
- Auto-clean stale entries from registry when detected (self-healing behavior)

---

## Interface Definition

### File Structure

**Item 1 - Split Layout Fix:**
- `public/document.html` - Move session-panel-container inside split-pane
- `public/diagram.html` - Move session-panel-container inside split-pane  
- `public/css/session-panel.css` - Change positioning model from fixed to flex

**Item 2 - Stale Sessions Fix:**
- `src/services/session-registry.ts` - Add existence validation to list()

### HTML Structure Changes

**Current structure (document.html:538-558, diagram.html:693-735):**
```html
<div class="main-content">
  <div id="session-panel-container"></div>  <!-- OUTSIDE split-pane -->
  <div class="split-pane">
    <div class="editor-pane">...</div>
    <div class="resizer">...</div>
    <div class="preview-pane">...</div>
  </div>
</div>
```

**Target structure:**
```html
<div class="main-content">
  <div class="split-pane">
    <div id="session-panel-container"></div>  <!-- INSIDE split-pane -->
    <div class="editor-pane">...</div>
    <div class="resizer">...</div>
    <div class="preview-pane">...</div>
  </div>
</div>
```

### CSS Changes

**session-panel.css - Current (lines 3-15):**
```css
.session-panel {
  position: fixed;
  left: 0;
  top: 0;
  width: 200px;
  height: 100vh;
  ...
}
```

**session-panel.css - Target:**
```css
.session-panel {
  position: relative;
  width: 200px;
  height: 100%;
  flex-shrink: 0;
  ...
}
```

**Remove rules (lines 247-255):**
```css
/* DELETE - no longer needed */
body.has-session-panel .container { ... }
body.has-session-panel.panel-collapsed .container { ... }
```

### TypeScript Interface Changes

**session-registry.ts - list() method:**

```typescript
// Current signature (line 133)
async list(): Promise<Session[]>

// No signature change, but behavior changes:
// - Validate each session directory exists
// - Filter out non-existent sessions
// - Auto-clean registry (remove stale entries)
```

### Component Interactions

- `SessionPanel` class continues to work unchanged (creates DOM inside container)
- `.split-pane` becomes a 3-child flex container instead of 2-child
- Resizer logic works the same (relative to panel width)
- `sessionRegistry.list()` becomes self-healing (cleans on read)

---

## Pseudocode

### Item 1: Split Layout Fix

**document.html / diagram.html changes:**
```
1. Find the <div class="main-content"> element
2. Move <div id="session-panel-container"></div> from being a sibling of split-pane
   to being the FIRST child inside split-pane
3. Result: split-pane now has 4 children:
   - session-panel-container (new first child)
   - editor-pane
   - resizer  
   - preview-pane
```

**session-panel.css changes:**
```
1. In .session-panel rule:
   - Remove: position: fixed
   - Remove: left: 0
   - Remove: top: 0
   - Change: height: 100vh → height: 100%
   - Add: flex-shrink: 0

2. Delete entire rule blocks:
   - body.has-session-panel .container
   - body.has-session-panel.panel-collapsed .container
   (These margin adjustments are no longer needed)

3. In .session-panel-resizer:
   - Change: position: absolute → position: relative (or remove)
   - The resizer becomes part of the panel's flex box
```

**session-panel.js changes (if needed):**
```
1. In resize() method:
   - Remove direct container margin manipulation (lines 462-466)
   - Panel width change will naturally affect flex siblings

2. In createDOM():
   - Remove: document.body.classList.add('has-session-panel')
   
3. In destroy():
   - Remove: document.body.classList.remove('has-session-panel')
   - Remove: container margin reset code
```

### Item 2: Stale Sessions Fix

**session-registry.ts list() method:**
```
1. Load registry from disk (existing code)

2. For each session in registry.sessions:
   a. Build session path: join(session.project, '.collab', session.session)
   b. Check if directory exists: existsSync(sessionPath)
   c. If exists: include in result
   d. If NOT exists: mark for removal

3. If any sessions were marked for removal:
   a. Filter them out of registry.sessions
   b. Save updated registry to disk (self-healing)
   c. Log which sessions were cleaned

4. Sort remaining sessions by lastAccess (existing code)

5. Return filtered sessions
```

**Error Handling:**
- If existsSync throws (permission issues): treat session as invalid, remove it
- If save fails after cleanup: log warning but still return filtered results
- Don't let cleanup failures prevent returning valid sessions

**Edge Cases:**
- All sessions are stale: return empty array (valid result)
- Registry file doesn't exist: return empty array (existing behavior)
- Project path no longer accessible: session is stale, remove it

---

## Skeleton

### Planned File Changes

**Note:** These are edits to existing files. Changes documented but NOT applied yet - will be made during implementation phase by executing-plans.

#### 1. public/document.html
- [ ] Move `<div id="session-panel-container"></div>` inside `.split-pane` (first child)
- **Status:** Will be modified during implementation

#### 2. public/diagram.html  
- [ ] Move `<div id="session-panel-container"></div>` inside `.split-pane` (first child)
- **Status:** Will be modified during implementation

#### 3. public/css/session-panel.css
- [ ] Change `.session-panel` positioning from fixed to relative flex
- [ ] Remove `body.has-session-panel .container` rules
- [ ] Adjust `.session-panel-resizer` positioning
- **Status:** Will be modified during implementation

#### 4. public/js/session-panel.js
- [ ] Remove container margin manipulation in `resize()` method
- [ ] Remove body class additions in `createDOM()` and `destroy()`
- **Status:** Will be modified during implementation

#### 5. src/services/session-registry.ts
- [ ] Add existence validation in `list()` method
- [ ] Add auto-cleanup of stale sessions
- **Status:** Will be modified during implementation

### Task Dependency Graph

```yaml
tasks:
  - id: session-registry-fix
    files: [src/services/session-registry.ts]
    tests: [src/services/session-registry.test.ts, src/services/__tests__/session-registry.test.ts]
    description: Add existence validation and auto-cleanup to list() method
    parallel: true

  - id: session-panel-css
    files: [public/css/session-panel.css]
    tests: []
    description: Change session panel from fixed to flex positioning
    parallel: true

  - id: session-panel-js
    files: [public/js/session-panel.js]
    tests: []
    description: Remove container margin manipulation and body class handling
    depends-on: [session-panel-css]

  - id: document-html
    files: [public/document.html]
    tests: []
    description: Move session-panel-container inside split-pane
    depends-on: [session-panel-css, session-panel-js]

  - id: diagram-html
    files: [public/diagram.html]
    tests: []
    description: Move session-panel-container inside split-pane
    depends-on: [session-panel-css, session-panel-js]
```

### Execution Order

**Parallel Batch 1 (no dependencies):**
- session-registry-fix (Item 2)
- session-panel-css (Item 1 - CSS first)

**Batch 2 (depends on CSS):**
- session-panel-js (Item 1 - JS needs CSS ready)

**Batch 3 (depends on CSS + JS):**
- document-html (Item 1 - HTML uses both)
- diagram-html (Item 1 - HTML uses both)

---

## Diagrams
(auto-synced)