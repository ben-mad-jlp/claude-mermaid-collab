# Blueprint: Phase 1 — Foundation Features

Three independent UI features for the Code Artifact feature set. No backend schema changes. Can be built and shipped in parallel.

## Source Artifacts
- `migration-plan` — Phase 1 specification
- `feature-brainstorm` — original feature ideas and UX decisions

## 1. Structure Summary

### Files

**New files:**
- [ ] `ui/src/components/editors/DiffAgainstDiskModal.tsx` — modal showing unified diff (local vs disk, local vs original)
- [ ] `ui/src/components/editors/CodeArtifactKebabMenu.tsx` — dropdown menu with artifact actions
- [ ] `ui/src/components/editors/PseudoSideBySideView.tsx` — layout wrapper rendering CodeEditor + PseudoViewer via SplitPane

**Modified files:**
- [ ] `ui/src/components/editors/CodeEditor.tsx` — add toolbar buttons: Diff Preview, Kebab Menu, Show Pseudo; integrate PseudoSideBySideView; replace `window.confirm` with diff-preview-then-push flow
- [ ] `ui/src/components/editors/UnifiedEditor.tsx` — optional: route to PseudoSideBySideView when pseudo mode is active (or keep it local to CodeEditor)

### Dependencies

All required libraries are already installed:
- `react-diff-viewer-continued` (in `ui/package.json`)
- `SplitPane` component (in `ui/src/components/layout/SplitPane.tsx`)
- `PseudoViewer` component (in `ui/src/pages/pseudo/PseudoViewer.tsx`)
- `api.getCodeDiff` already exists in `ui/src/lib/api.ts`
- `api.setDeprecated` already exists
- `api.deleteSnippet` already exists
- Backend `handleGetDiff` already implemented in `src/routes/code-api.ts`

**No new npm installs needed. No backend changes needed.**

### Component Interactions

```
CodeEditor
├─ Toolbar (via onToolbarControls → EditorToolbar)
│  ├─ Existing: Push, Sync, Clean, Comment, TypeScript, Diff, Copy
│  ├─ NEW: Diff Preview button → opens DiffAgainstDiskModal
│  ├─ NEW: Show Pseudo toggle → switches to PseudoSideBySideView
│  └─ NEW: Kebab Menu button → opens CodeArtifactKebabMenu
│
├─ Conditionally wraps editor in PseudoSideBySideView when toggle is on
│  └─ PseudoSideBySideView
│     ├─ SplitPane (horizontal)
│     ├─ Left: SnippetEditor (the existing editor)
│     └─ Right: PseudoViewer(path=..., project=...)
│
├─ DiffAgainstDiskModal (conditional)
│  └─ Calls api.getCodeDiff() → renders ReactDiffViewer for localVsDisk
│
└─ CodeArtifactKebabMenu (conditional popup)
   ├─ Deprecate → api.setDeprecated(snippetId, true)
   ├─ Copy Import Path → navigator.clipboard.writeText(filePath)
   ├─ Show Impact → opens impact analysis popover (via pseudo_impact_analysis)
   └─ Unlink → api.deleteSnippet(snippetId)
```

---

## 2. Function Blueprints

### `DiffAgainstDiskModal` React Component
**File:** `ui/src/components/editors/DiffAgainstDiskModal.tsx`

**Props:**
```typescript
interface DiffAgainstDiskModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm?: () => void;   // Optional: used when shown as pre-push confirmation
  confirmLabel?: string;     // Default "Push to File" when onConfirm is provided
  snippetId: string;
  filePath: string;
  projectPath: string;
  sessionName: string;
}
```

**Pseudocode:**
1. Use `useEffect` to fetch diff when `open` becomes true:
   - Call `api.getCodeDiff(projectPath, sessionName, snippetId)`
   - Returns `{ localVsOriginal, localVsDisk }` (unified diff strings from backend)
   - We don't use the unified diff strings directly — instead we re-fetch the snippet to get `code`, `originalCode`, `diskCode` for the ReactDiffViewer component which needs raw strings
   - Actually simpler: call `api.getSnippet(...)`, parse envelope, extract the three code fields, pass raw strings to ReactDiffViewer
2. Render a modal overlay with:
   - Header: "Review changes to `{basename(filePath)}`"
   - Tab/toggle: "vs. Disk" (default) | "vs. Last Pushed"
   - Body: `<ReactDiffViewer oldValue={diskCode} newValue={code} splitView={true} useDarkTheme={isDarkMode} />`
   - Footer buttons:
     - Cancel (always)
     - Confirm button (only if `onConfirm` prop provided): labeled `confirmLabel` or "Push to File"
3. Escape key and backdrop click close the modal
4. When confirm is clicked, call `onConfirm()` then `onClose()`

**Error handling:**
- If `getSnippet` fails: show error toast, close modal
- If envelope doesn't have `diskCode`: show "No disk snapshot available — sync first" and disable confirm
- If code equals diskCode exactly: show "No changes" and disable confirm

**Edge cases:**
- Empty files: render the diff viewer anyway (shows nothing useful but doesn't crash)
- Very large files (thousands of lines): React Diff Viewer handles this; no pagination needed for v1
- Dark mode: detect via existing theme context and pass `useDarkTheme` prop

---

### `CodeArtifactKebabMenu` React Component
**File:** `ui/src/components/editors/CodeArtifactKebabMenu.tsx`

**Props:**
```typescript
interface CodeArtifactKebabMenuProps {
  snippetId: string;
  filePath: string;
  projectPath: string;
  sessionName: string;
  onDeprecate: () => Promise<void>;
  onDelete: () => Promise<void>;
}
```

**Pseudocode:**
1. Local state: `isOpen: boolean`
2. Render a kebab button (three vertical dots SVG) in the inline toolbar
3. On click, toggle `isOpen`
4. When open, render a dropdown panel positioned below the button (absolute positioning, right-aligned):
   - **Copy Import Path** — calls `navigator.clipboard.writeText(filePath)`, shows brief flash "Copied", closes menu
   - **Show Impact** — click handler below; closes menu
   - **Deprecate** — calls `onDeprecate()`, closes menu
   - Divider
   - **Unlink** — `window.confirm("Unlink {filePath}? This removes it from the session but does not delete the file on disk.")` → if yes, call `onDelete()`, closes menu
5. Close menu on:
   - Click outside (use a ref + click-outside hook)
   - Escape key
   - After any action completes

**Show Impact handler:**
1. Extract file stem from `filePath` (basename without extension)
2. Prompt user for function name (simple `window.prompt` for v1) — or default to "impact for entire file"
3. Fetch impact data from a new client method or existing `/api/pseudo/impact?function=...&file=...&project=...`
4. Display results in an in-menu sub-view or a small popover with the call list
5. For v1: if pseudo index is missing for the file, show "No pseudo index for this file" message

**Note:** Show Impact is a stretch goal for this blueprint. If it requires significant work, ship the other three menu items first and add Impact in a follow-up.

**Error handling:**
- `onDeprecate` / `onDelete` errors caught and flash as toast
- Clipboard write errors caught silently

**Edge cases:**
- Menu near viewport edge: position-aware rendering (flip upward if too close to bottom)
- Multiple rapid clicks: disable the menu while an action is in flight

---

### `PseudoSideBySideView` React Component
**File:** `ui/src/components/editors/PseudoSideBySideView.tsx`

**Props:**
```typescript
interface PseudoSideBySideViewProps {
  snippetId: string;
  sourceFilePath: string;  // e.g., /abs/path/src/utils/foo.ts
  projectPath: string;
  children: React.ReactNode;  // The CodeEditor content (rendered on the left)
}
```

**Pseudocode:**
1. Compute `pseudoPath` by replacing the source file's extension with `.pseudo`:
   - `sourceFilePath.replace(/\.[^.]+$/, '.pseudo')`
2. Local state: `pseudoExists: boolean | null` (null = checking, false = no pseudo, true = ready)
3. `useEffect` on mount / `pseudoPath` change:
   - Call `fetchPseudoFile(projectPath, pseudoPath)` from `ui/src/lib/pseudo-api.ts`
   - On success → `setPseudoExists(true)`
   - On 404 / error → `setPseudoExists(false)`
4. Render:
   - If `pseudoExists === null`: show loading spinner in the right pane
   - If `pseudoExists === false`: show empty state in the right pane with message "No pseudo file found at `<pseudoPath>`" and a "Create pseudo" button that tells the user to run `/pseudocode` skill (no inline invocation — just instructions)
   - If `pseudoExists === true`: render `PseudoViewer` component
5. Use `SplitPane` for the layout:
   ```tsx
   <SplitPane
     direction="horizontal"
     defaultPrimarySize={60}
     primaryContent={children}  // CodeEditor
     secondaryContent={pseudoContent}  // PseudoViewer or empty state
   />
   ```

**Error handling:**
- `fetchPseudoFile` errors → treat as "not found" and show empty state
- PseudoViewer internal errors → let it bubble up (PseudoViewer has its own error boundary)

**Edge cases:**
- Source file has no extension: `replace` returns the same string; we append `.pseudo` in that case
- Pseudo file in a different directory: for v1 we assume pseudo lives alongside source. Future: search by stem via `/api/pseudo/files`.
- User toggles off while PseudoViewer is loading: component unmounts cleanly (no leaked fetches)

---

### `CodeEditor` (modifications)
**File:** `ui/src/components/editors/CodeEditor.tsx`

**New state:**
```typescript
const [diffModalOpen, setDiffModalOpen] = useState(false);
const [showPseudo, setShowPseudo] = useState(false);
// Kebab menu state lives inside CodeArtifactKebabMenu
```

**Pseudocode for integration:**

1. **Diff Preview button in mergedControls:**
   - Add a new button between Push and Sync labeled "Preview" (or an icon)
   - On click, `setDiffModalOpen(true)`
   - Always enabled (can preview diff even when clean — just shows "no changes")

2. **Modified Push flow:**
   - Change `handlePush` to first open the DiffAgainstDiskModal with `onConfirm` set to the actual push action
   - Remove the current `window.confirm` call
   - Flow: user clicks Push → DiffAgainstDiskModal opens showing diff → user clicks "Push to File" button in modal → actual push happens
   - Keep a direct path for Claude/MCP-driven pushes that don't need UI confirmation (already handled server-side)

3. **Show Pseudo toggle in mergedControls:**
   - Add a toggle button labeled "Pseudo" (or icon)
   - On click, `setShowPseudo(s => !s)`
   - Visual state reflects current toggle

4. **Kebab Menu in mergedControls:**
   - Add at the end of mergedControls (right-most)
   - Pass `snippetId`, `filePath`, `projectPath`, `sessionName`
   - Wire `onDeprecate` to call `api.setDeprecated(..., snippetId, true)` + update store
   - Wire `onDelete` to call `api.deleteSnippet(...)` + remove from store

5. **Conditional side-by-side rendering:**
   - Wrap the `<SnippetEditor>` children in `PseudoSideBySideView` when `showPseudo === true`
   - Otherwise render the existing layout unchanged
   - Structure:
     ```tsx
     {showPseudo ? (
       <PseudoSideBySideView
         snippetId={snippetId}
         sourceFilePath={filePath}
         projectPath={currentSession.project}
       >
         <SnippetEditor ... />
       </PseudoSideBySideView>
     ) : (
       <SnippetEditor ... />
     )}
     ```

6. **DiffAgainstDiskModal rendering (outside the editor pane):**
   ```tsx
   <DiffAgainstDiskModal
     open={diffModalOpen}
     onClose={() => setDiffModalOpen(false)}
     onConfirm={dirty ? actualPushToFile : undefined}
     confirmLabel="Push to File"
     snippetId={snippetId}
     filePath={filePath}
     projectPath={currentSession.project}
     sessionName={currentSession.name}
   />
   ```

**Error handling:**
- All modal/menu state transitions are local; failures in actions are handled by child components
- Ensure that disabling Push while the modal is open prevents double-submit

**Test strategy:**
- Edit a linked file, click Push → see diff preview → confirm → file written and modal closes
- Click Diff Preview when clean → modal shows "No changes"
- Toggle Show Pseudo on a file with a pseudo index → right pane populates
- Toggle Show Pseudo on a file without pseudo index → right pane shows empty state
- Click kebab → Copy Import Path copies the path to clipboard
- Click kebab → Deprecate → snippet marked deprecated and disappears from sidebar (if not showing deprecated)
- Click kebab → Unlink → confirm dialog → snippet removed from session

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: diff-modal
    files: [ui/src/components/editors/DiffAgainstDiskModal.tsx]
    tests: []
    description: "DiffAgainstDiskModal component — fetches snippet, renders ReactDiffViewer with disk vs local, supports optional confirm flow"
    parallel: true
    depends-on: []

  - id: kebab-menu
    files: [ui/src/components/editors/CodeArtifactKebabMenu.tsx]
    tests: []
    description: "CodeArtifactKebabMenu component — dropdown with Copy Path, Show Impact, Deprecate, Unlink actions"
    parallel: true
    depends-on: []

  - id: pseudo-side-by-side
    files: [ui/src/components/editors/PseudoSideBySideView.tsx]
    tests: []
    description: "PseudoSideBySideView component — SplitPane wrapper that shows PseudoViewer next to code editor with pseudo-exists check"
    parallel: true
    depends-on: []

  - id: code-editor-integration
    files: [ui/src/components/editors/CodeEditor.tsx]
    tests: []
    description: "Integrate the three new components into CodeEditor: Diff Preview button, Show Pseudo toggle, Kebab Menu; replace window.confirm in Push with diff-preview flow"
    parallel: false
    depends-on: [diff-modal, kebab-menu, pseudo-side-by-side]
```

### Execution Waves

**Wave 1 (parallel):**
- diff-modal
- kebab-menu
- pseudo-side-by-side

**Wave 2 (depends on Wave 1):**
- code-editor-integration

### Summary
- Total tasks: 4
- Total waves: 2
- Max parallelism: 3 (Wave 1)
- Estimated scope: three new components + one integration file; no backend work, no schema changes, no new npm packages
- Risk: Low — all dependencies already exist, well-known patterns