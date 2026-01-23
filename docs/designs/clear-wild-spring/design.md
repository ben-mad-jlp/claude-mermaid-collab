# Session: clear-wild-spring

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Force collab-compact before and after brainstorm, rough-draft, systematic-debugging
**Type:** code
**Status:** documented
**Problem/Goal:**
Long-running skills (brainstorming, rough-draft, systematic-debugging) consume significant context. Without automatic compaction, context can grow too large during these skills, potentially losing state.

**Approach:**
Modify the collab skill's Step 4.5 (Route by Type) to invoke `/collab-compact` before invoking brainstorming, rough-draft, or systematic-debugging:

1. Before invoking brainstorming (for code items): Run collab-compact
2. Before invoking brainstorming (for task items): Run collab-compact  
3. Before invoking systematic-debugging (for bugfix items): Run collab-compact
4. Before invoking rough-draft (after brainstorming for code items): Run collab-compact

Add instruction text like:
```
Invoke skill: collab-compact
```
Before each skill invocation in the routing logic.

**Success Criteria:**
- Collab skill Step 4.5 includes collab-compact invocation before each major skill
- Context snapshot is saved before brainstorming, rough-draft, and systematic-debugging
- Skills start with clean, compacted context

**Decisions:**
- Location: Collab skill (centralized), not individual skills
- Timing: Before only (start each skill with clean context)

---

### Item 2: Refresh deselects the current item / screen flash / websocket push issue
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
When a diagram or document is updated via WebSocket, the UI flashes and the current selection is deselected.

**Approach:**
Replace full data refresh with incremental updates for WebSocket messages:
1. When `diagram_updated` or `document_updated` is received, call `updateDiagram(id, updates)` or `updateDocument(id, updates)` instead of `loadSessionItems()`
2. When `diagram_created` or `document_created` is received, call `addDiagram()` or `addDocument()` instead
3. When `diagram_deleted` or `document_deleted` is received, call `removeDiagram()` or `removeDocument()` instead
4. Remove the loading state toggle for WebSocket-triggered updates

**Root Cause:**
In `App.tsx` lines 179-194, the WebSocket message handler calls `loadSessionItems()` for ALL update types. This:
1. Sets `isLoading: true` → triggers loading state
2. Fetches ALL diagrams and documents from API (even though only one changed)
3. Replaces entire arrays via `setDiagrams()`/`setDocuments()`
4. Sets `isLoading: false`

The screen flash is caused by the loading state toggle. The selection loss may occur due to race conditions during full array replacement.

The store already has incremental update methods (`updateDiagram`, `updateDocument`, `addDiagram`, `addDocument`, `removeDiagram`, `removeDocument`) that are NOT being used for WebSocket messages.

**Success Criteria:**
- No screen flash when items are updated via WebSocket
- Selection persists when receiving WebSocket updates for other items
- Selection persists when receiving WebSocket update for the currently selected item
- Loading state only shown for user-initiated refreshes

**Decisions:**

---

### Item 3: Change raw button to view/edit mode with full diagram edit functionality
**Type:** code
**Status:** documented
**Problem/Goal:**
The current "Raw" toggle is confusing and doesn't expose the visual diagram editing functionality from the old GUI. Need to:
1. Rename to "View/Edit" modes with clearer semantics
2. Bring back the visual editing features from `public/diagram.html`

**Approach:**
1. Rename `rawVisible` to `editMode` in uiStore
2. Update Header button from "Raw" to "View/Edit" toggle
3. Port the context menu system from old GUI:
   - **Edge Context Menu**: Edit Label, Change Origin/Dest, Delete Arrow
   - **Node Context Menu**: Edit Description, Change Type, Add Transition, Delete Node
4. For SMACH diagrams, show Properties Pane (right side panel) with action buttons
5. Wire context menus to manipulate Mermaid source via parsing/editing

Key files to reference:
- `/public/diagram.html` - Old GUI with context menus (lines 771-813) and properties pane (lines 737-751)
- `/public/js/editor.js` - Logic for parsing and modifying Mermaid source

**Success Criteria:**
- Header shows View/Edit toggle (not Raw)
- In Edit mode, clicking a node shows context menu with edit options
- In Edit mode, clicking an edge shows context menu with edit options
- For SMACH diagrams, Edit mode shows properties pane with action buttons
- Visual edits correctly modify the Mermaid source code
- View mode shows preview-only (no edit functionality)

**Decisions:**
- Mode names: View / Edit (not Preview/Source or Preview/Raw)
- Port visual editing from old GUI (`public/diagram.html`)

---

### Item 4: Renderer error when switching between diagram and document types
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
When switching from a document to a diagram (or vice versa), an error briefly flashes before the correct content renders.

**Approach:**
Synchronize `localContent` immediately when item type changes, or use `selectedItem.content` directly when types don't match.

Options:
1. In App.tsx, reset `localContent` synchronously when `selectedItem.id` changes (not via useEffect)
2. In UnifiedEditor, detect type mismatch and use `item.content` instead of `localContent` during transition
3. Add a guard that returns null/loading during the transition frame

Recommended: Option 1 - Update `localContent` synchronously using a ref or by restructuring state.

**Root Cause:**
In `App.tsx` lines 233-238 and 420-423:

1. When user switches from document to diagram:
   - `selectedItem` is recomputed immediately with new item (type: 'diagram')
   - `localContent` still has OLD document content (updated via useEffect, which runs after render)
   - `editorItem` is created: `{ ...selectedItem, content: localContent }` = `{ type: 'diagram', content: <markdown> }`
   - `MermaidPreview` receives markdown and tries to parse it as Mermaid → **ERROR**
   
2. On next render (after useEffect runs):
   - `localContent` is now updated to diagram content
   - Everything renders correctly

The race condition: `selectedItem` updates synchronously, but `localContent` updates asynchronously (useEffect).

**Success Criteria:**
- No error flash when switching between diagram and document
- Preview renders immediately with correct content type
- Auto-save still works correctly after switching items

**Decisions:**

---

### Item 5: Restore diff highlighter for document patches
**Type:** code
**Status:** documented
**Problem/Goal:**
When Claude (or external source) patches a document via WebSocket, the user should see the changes highlighted inline (green for added, red strikethrough for removed) until they dismiss it.

**Approach:**
Port the diff highlighting feature from `public/js/document-editor.js`:

1. Add diff state to sessionStore or a new diffStore:
   - `pendingDiff: { documentId, oldString, newString } | null`
   
2. When WebSocket receives `document_updated` with patch info:
   - Store the patch data
   - Compute client-side diff as fallback if server doesn't send patch

3. Modify `MarkdownPreview` to accept diff prop:
   - When diff exists, highlight the changed text in rendered output
   - Use CSS classes `.diff-added` (green) and `.diff-removed` (red strikethrough)

4. Add "Clear Diff" button in toolbar or inline:
   - Clicking clears the diff state
   - Preview returns to normal rendering

Key files to reference:
- `public/js/document-editor.js`: `renderDiffPreview()`, `computeLocalDiff()`, `showDiffAutomatically()`
- `public/document.html`: CSS for `.diff-added`, `.diff-removed`

**Success Criteria:**
- When document is patched via WebSocket, diff is highlighted automatically
- Added text shows green background
- Removed text shows red background with strikethrough
- "Clear Diff" button dismisses the highlighting
- Local edits do NOT trigger diff highlighting

**Decisions:**
- Trigger: WebSocket changes only (not local edits)

---

### Item 6: Add rotate diagram button next to zoom function
**Type:** code
**Status:** documented
**Problem/Goal:**
The old GUI has a "Toggle Direction" button (⤡) that switches diagram layout between LR (left-right) and TD (top-down). This is missing from the new React UI.

**Approach:**
1. Add a rotate/direction toggle button to `EditorToolbar.tsx` next to zoom controls
2. Port the `toggleDirection()` function from `public/js/editor.js` (lines 3047-3080)
3. The function modifies the Mermaid source to change `graph LR` ↔ `graph TD` or `wireframe ... LR` ↔ `wireframe ... TD`

Implementation:
- Add button with icon (⤡ or rotate icon) between zoom controls and overflow menu
- On click, parse current content, toggle direction keyword, update content
- Only show/enable for diagram items (not documents)

Key reference:
- `public/js/editor.js`: `toggleDirection()` function (lines 3047-3080)

**Success Criteria:**
- Rotate button visible in toolbar for diagram items
- Clicking toggles between LR and TD layout
- Works for standard Mermaid diagrams (`graph LR` ↔ `graph TD`)
- Works for wireframe diagrams (`wireframe mobile LR` ↔ `wireframe mobile TD`)
- Button hidden/disabled for document items

**Decisions:**

---

### Item 7: Add archive option in collab-cleanup to start fresh without new session
**Type:** code
**Status:** documented
**Problem/Goal:**
Currently, collab-cleanup offers: Archive, Delete, or Keep. There's no option to archive completed work AND continue working on new items in the same session. Users have to create a new session to continue.

**Approach:**
Add a 4th option to collab-cleanup: "Archive & Continue"

1. Modify Step 3 in `collab-cleanup/skill.md` to add option:
   ```
   4. Archive & Continue - Archive current artifacts, reset session for new work
   ```

2. When selected:
   - Archive current documents/diagrams to `docs/designs/[session-name]-[timestamp]/`
   - Clear the Work Items section in design.md (keep Session Context)
   - Reset `collab-state.json` to `{ phase: "brainstorming", currentItem: null }`
   - Loop back to `gather-session-goals` skill

3. The session folder stays in place, but artifacts are versioned with timestamp

**Success Criteria:**
- New "Archive & Continue" option appears in collab-cleanup menu
- Selecting it archives current work with timestamp suffix
- Design doc is reset (Work Items cleared, Session Context preserved)
- Session loops back to gather-session-goals for new work items
- User can continue working without creating a new session

**Decisions:**

---

### Item 8: Live diagram update fails
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
When a diagram is updated live (via WebSocket), the rendering fails. Documents may have the same issue.

**Approach:**
Two potential fixes:

1. **Change render ID on each render**: Instead of using stable `uniqueId`, generate a new ID for each render call:
   ```typescript
   const renderId = `mermaid-${uniqueId}-${Date.now()}`;
   const { svg } = await mermaid.render(renderId, content);
   ```

2. **Clear Mermaid cache before re-render**: Call Mermaid's internal API to clear cached diagram before rendering.

Additionally, this is related to Item 2 - the WebSocket handler does a full refresh which causes issues. Once Item 2 is fixed (incremental updates), this issue may also be resolved.

**Root Cause:**
Suspected: Mermaid.js caches rendered diagrams by ID. In `MermaidPreview.tsx` line 209:
```typescript
const { svg } = await mermaid.render(`mermaid-${uniqueId}`, content);
```
The `uniqueId` is stable per component instance (from `useId()`). When content changes but ID stays the same, Mermaid may return cached/stale SVG or throw an error.

Note: This needs verification by testing. The exact error should be captured to confirm root cause.

**Success Criteria:**
- Diagram updates successfully when content changes via WebSocket
- No errors in console during live updates
- Preview shows updated diagram immediately

**Decisions:**

---

### Item 9: Implement Claude Code questions in GUI via json-render library
**Type:** code
**Status:** documented
**Problem/Goal:**
When Claude Code asks a question (via AskUserQuestion tool), the user should be able to answer it in the GUI instead of the terminal. The current implementation has UI components but uses a mock API - it's not wired to actual Claude Code questions.

**Approach:**
Connect the existing question infrastructure to Claude Code's question system:

1. **WebSocket Integration**:
   - Add message handler for `claude_question` events in App.tsx WebSocket subscription
   - Parse the question JSON (which may use json-render format for complex UI)
   - Call `receiveQuestion()` from questionStore

2. **Response Submission**:
   - Replace mock `submitQuestionResponse()` in questionStore with real API call
   - Send response via WebSocket message (`submit_question_response` type)
   - Include questionId, answer, and timestamp

3. **AI-UI Registry Enhancement**:
   - Ensure all json-render component types are registered in `ai-ui/registry.ts`
   - Components needed: Card, Markdown, Button, ButtonGroup, TextInput, Select, Checkbox
   - QuestionRenderer already parses JSON from question.text

4. **Question Format Support**:
   - Simple text questions (current fallback works)
   - Multiple choice questions (json-render with ButtonGroup)
   - Text input questions (json-render with TextInput)
   - Confirmation dialogs (json-render with Button actions)

Key files:
- `ui/src/stores/questionStore.ts` - Replace mock API with WebSocket submission
- `ui/src/App.tsx` - Add claude_question WebSocket handler
- `ui/src/components/ai-ui/registry.ts` - Ensure all needed components registered
- `src/websocket/handlers.ts` - Handle question response on server side

**Success Criteria:**
- Claude Code questions appear in GUI QuestionPanel
- User can answer questions using rendered UI components
- Response is sent back to Claude Code via WebSocket
- Question dismissed after successful submission
- Works for simple text, multiple choice, and free-form input questions
- Fallback to simple text input if UI definition invalid

**Decisions:**

---

## Interface Definition

### File Structure

**Skill Files (Items 1, 7):**
- `skills/collab/SKILL.md` - Modify Step 4.5 for collab-compact invocation
- `skills/collab-cleanup/SKILL.md` - Add "Archive & Continue" option

**UI Source Files (Items 2, 3, 4, 5, 6, 8, 9):**
- `ui/src/App.tsx` - WebSocket handler fixes, localContent sync
- `ui/src/stores/uiStore.ts` - Rename rawVisible → editMode
- `ui/src/stores/sessionStore.ts` - Add diff state
- `ui/src/stores/questionStore.ts` - Replace mock API with WebSocket
- `ui/src/components/layout/Header.tsx` - View/Edit toggle button
- `ui/src/components/layout/EditorToolbar.tsx` - Add rotate button, itemType prop
- `ui/src/components/editors/MermaidPreview.tsx` - Fix render ID caching
- `ui/src/components/editors/MarkdownPreview.tsx` - Add diff highlighting
- `ui/src/lib/diagramUtils.ts` - New: toggleDirection function
- `ui/src/components/diagram/ContextMenu.tsx` - New: context menu for visual editing
- `ui/src/components/diagram/PropertiesPane.tsx` - New: SMACH properties panel

### Type Definitions

```typescript
// ui/src/stores/uiStore.ts - Item 3 changes
interface UIState {
  // Renamed from rawVisible
  editMode: boolean;
  setEditMode: (mode: boolean) => void;
  toggleEditMode: () => void;
  // ... rest unchanged
}

// ui/src/stores/sessionStore.ts - Item 5 additions  
interface DiffState {
  documentId: string;
  oldContent: string;
  newContent: string;
  timestamp: number;
}

interface SessionState {
  // ... existing fields
  pendingDiff: DiffState | null;
  setPendingDiff: (diff: DiffState | null) => void;
  clearPendingDiff: () => void;
}

// ui/src/lib/diagramUtils.ts - Item 6
type DiagramDirection = 'LR' | 'TD' | 'RL' | 'BT';

interface ToggleDirectionResult {
  content: string;
  oldDirection: DiagramDirection;
  newDirection: DiagramDirection;
}

// ui/src/components/diagram/ContextMenu.tsx - Item 3
interface ContextMenuProps {
  x: number;
  y: number;
  type: 'node' | 'edge';
  targetId: string;
  onClose: () => void;
  onEditLabel: (id: string) => void;
  onChangeType: (id: string) => void;
  onDelete: (id: string) => void;
  onChangeOrigin?: (id: string) => void;  // edge only
  onChangeDest?: (id: string) => void;    // edge only
  onAddTransition?: (id: string) => void; // node only
}

// ui/src/components/editors/MarkdownPreview.tsx - Item 5
interface MarkdownPreviewProps {
  content: string;
  className?: string;
  diff?: {
    oldContent: string;
    newContent: string;
  } | null;
  onClearDiff?: () => void;
}
```

### Function Signatures

```typescript
// ui/src/lib/diagramUtils.ts - Item 6
export function toggleDirection(content: string): ToggleDirectionResult;
export function detectDirection(content: string): DiagramDirection | null;

// ui/src/App.tsx - Item 2, 4, 9 WebSocket handler changes
// Inside useEffect for WebSocket subscription:
function handleWebSocketMessage(message: WebSocketMessage): void {
  switch (message.type) {
    case 'diagram_updated':
      // Item 2: Use incremental update instead of full refresh
      updateDiagram(message.id, { content: message.content });
      break;
    case 'document_updated':
      // Item 2 + Item 5: Incremental update + diff state
      const oldDoc = documents.find(d => d.id === message.id);
      if (message.patchInfo) {
        setPendingDiff({
          documentId: message.id,
          oldContent: message.patchInfo.oldString,
          newContent: message.patchInfo.newString,
          timestamp: Date.now()
        });
      }
      updateDocument(message.id, { content: message.content });
      break;
    case 'claude_question':
      // Item 9: Handle incoming questions
      receiveQuestion(message.question);
      break;
    // ... other cases
  }
}

// ui/src/stores/questionStore.ts - Item 9
async function submitQuestionResponse(response: QuestionResponse): Promise<void> {
  // Replace mock with WebSocket call
  const client = getWebSocketClient();
  client.send({
    type: 'submit_question_response',
    questionId: response.questionId,
    answer: response.answer,
    timestamp: response.timestamp
  });
}

// ui/src/components/layout/EditorToolbar.tsx - Item 6 additions
interface EditorToolbarProps {
  // ... existing props
  onRotate?: () => void;        // New: toggle diagram direction
  canRotate?: boolean;          // New: enabled for diagrams only
}
```

### Component Interactions

**Item 2 (WebSocket incremental updates):**
- `App.tsx` WebSocket handler → `sessionStore.updateDiagram/updateDocument`
- No loading state toggle for WebSocket events
- Selection preserved via existing store logic

**Item 3 (View/Edit mode):**
- `Header.tsx` toggle → `uiStore.editMode`
- `MermaidPreview.tsx` reads `editMode` → shows/hides click handlers
- Click on node/edge → `ContextMenu.tsx` opens
- `ContextMenu` action → parses Mermaid source → updates content

**Item 4 (Type switch fix):**
- `App.tsx` computes `selectedItem` 
- Use `useMemo` to sync `localContent` when `selectedItem.id` changes
- Avoid stale content during type transitions

**Item 5 (Diff highlighting):**
- WebSocket `document_updated` → `sessionStore.setPendingDiff`
- `MarkdownPreview.tsx` reads `pendingDiff` → renders with highlights
- "Clear Diff" button → `sessionStore.clearPendingDiff`

**Item 6 (Rotate button):**
- `EditorToolbar.tsx` rotate button → calls `onRotate` prop
- `App.tsx` passes `handleRotate` callback
- `handleRotate` → `toggleDirection(content)` → `setLocalContent(newContent)`

**Item 8 (Mermaid render fix):**
- `MermaidPreview.tsx` generates unique render ID per render
- `mermaid.render(renderId, content)` with timestamp suffix

**Item 9 (Claude questions):**
- WebSocket `claude_question` → `questionStore.receiveQuestion`
- `QuestionPanel.tsx` renders question UI
- User action → `questionStore.submitResponse` → WebSocket `submit_question_response`

---

## Pseudocode

### Item 1 & 7: Skill File Changes
N/A - These are markdown documentation changes, not code. The changes involve adding text to skill files to invoke collab-compact and add the "Archive & Continue" option.

---

### Item 2: WebSocket Incremental Updates

#### handleWebSocketMessage(message)
```
1. Switch on message.type:

   CASE 'diagram_updated':
     a. Extract id and content from message
     b. Call sessionStore.updateDiagram(id, { content, lastModified: now })
     c. DO NOT set loading state
     d. Return (selection preserved automatically by store)

   CASE 'document_updated':
     a. Extract id, content, and optional patchInfo from message
     b. If patchInfo exists:
        - Call sessionStore.setPendingDiff({
            documentId: id,
            oldContent: patchInfo.oldString,
            newContent: patchInfo.newString,
            timestamp: now
          })
     c. Call sessionStore.updateDocument(id, { content, lastModified: now })
     d. DO NOT set loading state
     e. Return

   CASE 'diagram_created':
     a. Extract diagram data from message
     b. Call sessionStore.addDiagram(diagram)
     c. Return

   CASE 'document_created':
     a. Extract document data from message
     b. Call sessionStore.addDocument(document)
     c. Return

   CASE 'diagram_deleted':
     a. Extract id from message
     b. Call sessionStore.removeDiagram(id)
     c. Return

   CASE 'document_deleted':
     a. Extract id from message
     b. Call sessionStore.removeDocument(id)
     c. Return

   CASE 'claude_question':
     a. Extract question from message
     b. Call questionStore.receiveQuestion(question)
     c. Return

   DEFAULT:
     a. Log unknown message type
     b. Return
```

**Error Handling:**
- If message is malformed (missing id/content), log warning and ignore
- If store operation fails, log error but don't crash

**Edge Cases:**
- Message for non-existent item: Store methods handle gracefully (no-op)
- Rapid succession of updates: Each applies independently, last one wins

---

### Item 3: View/Edit Mode Context Menus

#### handleDiagramClick(event, editMode)
```
1. If editMode is false:
   - Return (no action in view mode)

2. Get click target element from event
3. Walk up DOM tree to find SVG element with data-id attribute

4. If no data-id found:
   - Close any open context menu
   - Return

5. Determine element type:
   - If element has class 'node' or parent has class 'node': type = 'node'
   - If element has class 'edgePath' or parent has class 'edgePath': type = 'edge'
   - Otherwise: Return (clicked on background)

6. Extract targetId from data-id attribute

7. Open context menu:
   - Set contextMenu state: { x: event.clientX, y: event.clientY, type, targetId }
```

#### handleContextMenuAction(action, targetId)
```
1. Switch on action:

   CASE 'editLabel':
     a. Show prompt dialog for new label
     b. If user cancels, return
     c. Parse current Mermaid content to find element by targetId
     d. Replace label in parsed structure
     e. Regenerate Mermaid source
     f. Call onContentChange(newContent)

   CASE 'delete':
     a. Show confirmation dialog
     b. If user cancels, return
     c. Parse current Mermaid content
     d. Remove element with targetId
     e. Regenerate Mermaid source
     f. Call onContentChange(newContent)

   CASE 'changeOrigin' (edge only):
     a. Get list of existing nodes
     b. Show selection dialog
     c. If user cancels, return
     d. Parse content, update edge origin
     e. Regenerate and update

   CASE 'changeDest' (edge only):
     a. Similar to changeOrigin but for destination

   CASE 'addTransition' (node only):
     a. Get list of existing nodes
     b. Show dialog for target node selection
     c. Parse content, add new edge from targetId to selected node
     d. Regenerate and update

2. Close context menu
```

**Error Handling:**
- If parsing fails, show error toast, don't modify content
- If regeneration produces invalid Mermaid, revert to original

**Edge Cases:**
- Click on text inside node: Walk up to find node container
- Multiple nodes overlapping: Use topmost (last in SVG)

---

### Item 4: Type Switch Content Sync

#### useSyncedLocalContent(selectedItem)
```
1. Create ref for previous item ID: prevItemIdRef

2. In render (useMemo):
   a. If selectedItem is null:
      - Return empty string
   
   b. If selectedItem.id !== prevItemIdRef.current:
      - This is a NEW item selection
      - Update prevItemIdRef.current = selectedItem.id
      - Return selectedItem.content (fresh content, not stale)
   
   c. If selectedItem.id === prevItemIdRef.current:
      - Same item, use existing localContent state
      - Return current localContent

3. This ensures:
   - Type switches get fresh content immediately
   - Same-item edits preserve local state
   - No async useEffect race condition
```

**Alternative approach (simpler):**
```
1. Compute content synchronously:
   const content = useMemo(() => {
     return selectedItem?.content ?? '';
   }, [selectedItem?.id, selectedItem?.content]);

2. Track edits separately:
   const [localEdits, setLocalEdits] = useState<string | null>(null);

3. Effective content:
   const effectiveContent = localEdits ?? content;

4. On item change (selectedItem.id changes):
   - Reset localEdits to null
   - This happens synchronously in useMemo
```

---

### Item 5: Diff Highlighting

#### computeDiff(oldContent, newContent)
```
1. Split oldContent into lines: oldLines
2. Split newContent into lines: newLines

3. Use diff algorithm (e.g., Myers diff or simple LCS):
   a. Find longest common subsequence
   b. Mark lines as: unchanged, added, removed

4. Return array of diff segments:
   [
     { type: 'unchanged', content: '...' },
     { type: 'removed', content: '...' },
     { type: 'added', content: '...' },
     ...
   ]
```

#### renderDiffHighlights(content, diff)
```
1. If diff is null:
   - Render content normally with markdown
   - Return

2. Parse diff segments

3. For each segment:
   CASE 'unchanged':
     - Render as normal markdown

   CASE 'added':
     - Wrap in <span class="diff-added">
     - Green background (#d4edda)

   CASE 'removed':
     - Wrap in <span class="diff-removed">
     - Red background (#f8d7da), strikethrough

4. Render "Clear Diff" button at top:
   - On click: call onClearDiff()
```

**Error Handling:**
- If diff computation fails, render content without highlights
- If diff is stale (documentId doesn't match), ignore

**Edge Cases:**
- Empty old content (new document): All lines marked as added
- Empty new content (deleted): All lines marked as removed
- Very large diffs: Truncate to first 1000 lines

---

### Item 6: Toggle Diagram Direction

#### toggleDirection(content)
```
1. Define direction pairs:
   - 'LR' <-> 'TD'
   - 'RL' <-> 'BT'

2. Detect current direction using regex:
   a. Match: /^(graph|flowchart|wireframe\s+\w+)\s+(LR|TD|RL|BT)/m
   b. If no match, default to 'TD'

3. Determine new direction:
   - 'LR' -> 'TD'
   - 'TD' -> 'LR'
   - 'RL' -> 'BT'
   - 'BT' -> 'RL'

4. Replace in content:
   a. Use regex to find and replace direction keyword
   b. Handle both 'graph X' and 'flowchart X' formats
   c. Handle 'wireframe mobile X' format

5. Return:
   {
     content: newContent,
     oldDirection: detected,
     newDirection: toggled
   }
```

#### detectDirection(content)
```
1. Match regex: /^(graph|flowchart|wireframe\s+\w+)\s+(LR|TD|RL|BT)/m
2. If match: return match[2] as DiagramDirection
3. If no match: return null
```

**Error Handling:**
- If content doesn't have direction keyword, return unchanged
- If regex fails, return original content

**Edge Cases:**
- Multiple graph declarations: Only modify first one
- Subgraphs: Don't modify subgraph directions
- Case sensitivity: Handle both 'LR' and 'lr'

---

### Item 8: Mermaid Render ID Fix

#### renderDiagram(content, baseId)
```
1. Generate unique render ID:
   renderId = `mermaid-${baseId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

2. Before rendering, clean up any previous render with same baseId:
   a. Find existing SVG elements with id starting with `mermaid-${baseId}`
   b. Remove them from DOM (prevents ID conflicts)

3. Call mermaid.render(renderId, content):
   a. If successful: return { svg, bindFunctions }
   b. If error: throw error

4. Insert SVG into container:
   a. Clear container innerHTML
   b. Set container innerHTML = svg
```

**Error Handling:**
- If mermaid.render throws, catch and set error state
- Display user-friendly error message
- Preserve previous valid render if possible

**Edge Cases:**
- Empty content: Show placeholder, don't call render
- Very large diagrams: May need timeout handling
- Rapid content changes: Debounce render calls

---

### Item 9: Claude Question Handling

#### receiveQuestion(question)
```
1. Validate question object:
   - Must have: id, text
   - Optional: context, options, metadata

2. If question.text starts with '{':
   a. Try to parse as JSON UI definition
   b. If parse fails, treat as plain text

3. Add to question history:
   questionHistory = [question, ...questionHistory]

4. Set as current question:
   currentQuestion = question

5. UI will automatically show QuestionPanel
```

#### submitQuestionResponse(response)
```
1. Validate response:
   - Must have: questionId matching currentQuestion.id
   - Must have: answer (string)

2. Set loading state: submitState.loading = true

3. Get WebSocket client

4. Send message:
   client.send({
     type: 'submit_question_response',
     questionId: response.questionId,
     answer: response.answer,
     timestamp: Date.now()
   })

5. Wait for acknowledgment (optional):
   - If WebSocket confirms receipt: success
   - If timeout or error: set submitState.error

6. On success:
   a. submitState.loading = false
   b. submitState.success = true
   c. currentQuestion = null (dismiss panel)

7. On error:
   a. submitState.loading = false
   b. submitState.error = error message
   c. Keep panel open for retry
```

**Error Handling:**
- WebSocket not connected: Queue message or show error
- Invalid question format: Show plain text fallback
- Response timeout: Allow retry

**Edge Cases:**
- Multiple questions in quick succession: Queue or replace?
  Decision: Replace - only one question active at a time
- User dismisses without answering: Log as dismissed, no response sent
- Network reconnect: Don't resend old responses

---

## Skeleton

### Planned Files

**Skill Files (documentation changes):**
- [ ] `skills/collab/SKILL.md` - Add collab-compact invocations to Step 4.5
- [ ] `skills/collab-cleanup/SKILL.md` - Add "Archive & Continue" option

**UI Source Files (code changes):**
- [ ] `ui/src/stores/uiStore.ts` - Rename rawVisible → editMode
- [ ] `ui/src/stores/sessionStore.ts` - Add diff state
- [ ] `ui/src/stores/questionStore.ts` - Replace mock API with WebSocket
- [ ] `ui/src/lib/diagramUtils.ts` - NEW: toggleDirection function
- [ ] `ui/src/components/layout/Header.tsx` - View/Edit toggle button
- [ ] `ui/src/components/layout/EditorToolbar.tsx` - Add rotate button
- [ ] `ui/src/components/editors/MermaidPreview.tsx` - Fix render ID, add click handlers
- [ ] `ui/src/components/editors/MarkdownPreview.tsx` - Add diff highlighting
- [ ] `ui/src/components/diagram/ContextMenu.tsx` - NEW: context menu component
- [ ] `ui/src/components/diagram/PropertiesPane.tsx` - NEW: SMACH properties panel
- [ ] `ui/src/App.tsx` - WebSocket handler, content sync fix

**Note:** Files are documented but NOT created yet. They will be modified/created during implementation by executing-plans.

---

### File Contents

#### ui/src/lib/diagramUtils.ts (NEW)

```typescript
/**
 * Diagram utility functions for Mermaid manipulation
 */

export type DiagramDirection = 'LR' | 'TD' | 'RL' | 'BT';

export interface ToggleDirectionResult {
  content: string;
  oldDirection: DiagramDirection | null;
  newDirection: DiagramDirection;
}

/**
 * Detect the current direction of a Mermaid diagram
 */
export function detectDirection(content: string): DiagramDirection | null {
  // TODO: Implement regex detection
  // Match: /^(graph|flowchart|wireframe\s+\w+)\s+(LR|TD|RL|BT)/m
  throw new Error('Not implemented');
}

/**
 * Toggle diagram direction between LR/TD or RL/BT
 */
export function toggleDirection(content: string): ToggleDirectionResult {
  // TODO: Implement direction toggle
  // - Detect current direction
  // - Swap LR<->TD or RL<->BT
  // - Replace in content
  throw new Error('Not implemented');
}
```

**Status:** [ ] Will be created during implementation

---

#### ui/src/components/diagram/ContextMenu.tsx (NEW)

```typescript
/**
 * Context menu for visual diagram editing
 */

import React from 'react';

export interface ContextMenuProps {
  x: number;
  y: number;
  type: 'node' | 'edge';
  targetId: string;
  onClose: () => void;
  onEditLabel: (id: string) => void;
  onChangeType: (id: string) => void;
  onDelete: (id: string) => void;
  onChangeOrigin?: (id: string) => void;
  onChangeDest?: (id: string) => void;
  onAddTransition?: (id: string) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  type,
  targetId,
  onClose,
  onEditLabel,
  onChangeType,
  onDelete,
  onChangeOrigin,
  onChangeDest,
  onAddTransition,
}) => {
  // TODO: Implement context menu rendering
  // - Position at x, y
  // - Show different options based on type (node vs edge)
  // - Handle click outside to close
  throw new Error('Not implemented');
};

export default ContextMenu;
```

**Status:** [ ] Will be created during implementation

---

#### ui/src/components/diagram/PropertiesPane.tsx (NEW)

```typescript
/**
 * Properties pane for SMACH diagram editing
 */

import React from 'react';

export interface PropertiesPaneProps {
  selectedNodeId: string | null;
  onAddState: () => void;
  onAddTransition: (fromId: string) => void;
  onEditProperties: (nodeId: string, props: Record<string, unknown>) => void;
}

export const PropertiesPane: React.FC<PropertiesPaneProps> = ({
  selectedNodeId,
  onAddState,
  onAddTransition,
  onEditProperties,
}) => {
  // TODO: Implement properties pane
  // - Show "Add State" button
  // - Show "Add Transition" button when node selected
  // - Show property editor for selected node
  throw new Error('Not implemented');
};

export default PropertiesPane;
```

**Status:** [ ] Will be created during implementation

---

### Task Dependency Graph

```yaml
tasks:
  # Skill documentation tasks (parallel, no code dependencies)
  - id: skill-collab-compact
    files: [skills/collab/SKILL.md]
    tests: []
    description: Add collab-compact invocations before major skills
    parallel: true

  - id: skill-archive-continue
    files: [skills/collab-cleanup/SKILL.md]
    tests: []
    description: Add "Archive & Continue" option
    parallel: true

  # Store foundation tasks (parallel)
  - id: store-ui-editmode
    files: [ui/src/stores/uiStore.ts]
    tests: [ui/src/stores/uiStore.test.ts, ui/src/stores/__tests__/uiStore.test.ts]
    description: Rename rawVisible to editMode
    parallel: true

  - id: store-session-diff
    files: [ui/src/stores/sessionStore.ts]
    tests: [ui/src/stores/sessionStore.test.ts, ui/src/stores/__tests__/sessionStore.test.ts]
    description: Add pendingDiff state for document patches
    parallel: true

  - id: store-question-websocket
    files: [ui/src/stores/questionStore.ts]
    tests: [ui/src/stores/questionStore.test.ts, ui/src/stores/__tests__/questionStore.test.ts]
    description: Replace mock API with WebSocket submission
    parallel: true

  # Utility functions (parallel)
  - id: lib-diagram-utils
    files: [ui/src/lib/diagramUtils.ts]
    tests: [ui/src/lib/diagramUtils.test.ts, ui/src/lib/__tests__/diagramUtils.test.ts]
    description: Create toggleDirection and detectDirection functions
    parallel: true

  # Component updates (depend on stores)
  - id: component-header
    files: [ui/src/components/layout/Header.tsx]
    tests: [ui/src/components/layout/Header.test.tsx, ui/src/components/layout/__tests__/Header.test.tsx]
    description: Update Raw button to View/Edit toggle
    depends-on: [store-ui-editmode]

  - id: component-toolbar
    files: [ui/src/components/layout/EditorToolbar.tsx]
    tests: [ui/src/components/layout/EditorToolbar.test.tsx, ui/src/components/layout/__tests__/EditorToolbar.test.tsx]
    description: Add rotate button for diagram direction toggle
    depends-on: [lib-diagram-utils]

  - id: component-mermaid-preview
    files: [ui/src/components/editors/MermaidPreview.tsx]
    tests: [ui/src/components/editors/MermaidPreview.test.tsx, ui/src/components/editors/__tests__/MermaidPreview.test.tsx]
    description: Fix render ID caching, add click handlers for edit mode
    depends-on: [store-ui-editmode]

  - id: component-markdown-preview
    files: [ui/src/components/editors/MarkdownPreview.tsx]
    tests: [ui/src/components/editors/MarkdownPreview.test.tsx, ui/src/components/editors/__tests__/MarkdownPreview.test.tsx]
    description: Add diff highlighting support
    depends-on: [store-session-diff]

  # New components (depend on MermaidPreview)
  - id: component-context-menu
    files: [ui/src/components/diagram/ContextMenu.tsx]
    tests: [ui/src/components/diagram/ContextMenu.test.tsx, ui/src/components/diagram/__tests__/ContextMenu.test.tsx]
    description: Create context menu for visual diagram editing
    depends-on: [component-mermaid-preview]

  - id: component-properties-pane
    files: [ui/src/components/diagram/PropertiesPane.tsx]
    tests: [ui/src/components/diagram/PropertiesPane.test.tsx, ui/src/components/diagram/__tests__/PropertiesPane.test.tsx]
    description: Create properties pane for SMACH diagrams
    depends-on: [component-mermaid-preview]

  # App.tsx integration (depends on multiple components)
  - id: app-integration
    files: [ui/src/App.tsx]
    tests: [ui/src/App.test.tsx, ui/src/__tests__/App.test.tsx]
    description: WebSocket handler updates, content sync fix, integrate new components
    depends-on: [store-session-diff, store-question-websocket, component-context-menu, component-markdown-preview]
```

---

### Execution Order

**Parallel Batch 1** (no dependencies):
- skill-collab-compact
- skill-archive-continue
- store-ui-editmode
- store-session-diff
- store-question-websocket
- lib-diagram-utils

**Batch 2** (depends on Batch 1):
- component-header (depends on store-ui-editmode)
- component-toolbar (depends on lib-diagram-utils)
- component-mermaid-preview (depends on store-ui-editmode)
- component-markdown-preview (depends on store-session-diff)

**Batch 3** (depends on Batch 2):
- component-context-menu (depends on component-mermaid-preview)
- component-properties-pane (depends on component-mermaid-preview)

**Batch 4** (depends on Batch 3):
- app-integration (depends on store-session-diff, store-question-websocket, component-context-menu, component-markdown-preview)

---

## Diagrams
(auto-synced)