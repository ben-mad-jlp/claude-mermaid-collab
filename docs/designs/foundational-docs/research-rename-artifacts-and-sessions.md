# Research: Adding Rename Capability for Artifacts & Sessions

## Executive Summary

The codebase currently has **placeholder UI for rename** (disabled with "Not yet supported" tooltip) but **no backend implementation**. Session rename exists only for terminal sessions (within a collab session). Full implementation requires: (1) extending managers to support atomic rename with ID→name decoupling, (2) adding MCP tools + API routes, (3) wiring UI with modal input + WebSocket propagation, (4) handling name uniqueness validation. Effort estimate: artifact rename (**M**), session rename (**L**, requires FS moves + registry updates), UI wiring (**M**).

---

## 1. Backend Data Model & Persistence

### Artifact Storage Architecture

**File-based with ID-as-filename design:**
- **Diagrams:** `.collab/sessions/<session>/diagrams/<id>.mmd` (id derived from sanitized name)
- **Documents:** `.collab/sessions/<session>/documents/<id>.md` (id = sanitized name)
- **Designs:** `.collab/sessions/<session>/designs/<id>.design.json` 
- **Spreadsheets:** `.collab/sessions/<session>/spreadsheets/<id>.spreadsheet.json`
- **Snippets:** `.collab/sessions/<session>/snippets/<id>.snippet` (JSON envelope with metadata)
- **Images:** `.collab/sessions/<session>/images/<id>.<ext>` (UUID-based id, ext from MIME)
- **Embeds:** `.collab/sessions/<session>/embeds/<id>.embed.json`

**Key insight:** Artifact **name is NOT load-bearing for file identity**. The `id` is a slugified derivative of the original name (e.g., "My Diagram" → "my-diagram"), but after creation, the `id` is stable and independent of the `name` field stored in metadata. This is critical for rename — we only need to update metadata, not move files.

**Metadata Storage:**
- `MetadataManager` (src/services/metadata-manager.ts) stores per-session `metadata.json`:
  ```json
  {
    "folders": ["..folder names.."],
    "items": {
      "diagram-id": {
        "folder": "..folder name or null..",
        "locked": false,
        "deprecated": false,
        "pinned": false,
        "blueprint": false
      }
    }
  }
  ```
- No `name` field in metadata — names are stored only in the manager index (in-memory) or derived from the file system on load.
- **Artifact display names come from the in-memory index**, populated on manager initialization by reading files and setting `index.set(id, { name: id, path, lastModified })`.

### Session Storage Architecture

**Filesystem-based:**
- Sessions are directories: `.collab/sessions/<session_name>/`
- Session registry: `~/.mermaid-collab/sessions.json` tracks registered sessions:
  ```json
  {
    "sessions": [
      { "project": "/absolute/path", "session": "foundational-docs", "lastAccess": "2026-04-20T..." }
    ]
  }
  ```
- **Session name IS load-bearing**: used as directory name, registered in the global registry, and referenced in all artifact paths.

**Critical dependencies if renaming sessions:**
1. Rename the directory `.collab/sessions/<old_name>` → `.collab/sessions/<new_name>`
2. Update registry entry (if present)
3. Invalidate all artifact paths in-memory (managers hold basePath references)
4. Update any websocket subscriptions and channel names

### Name Field Status

**Artifacts:**
- `name` is a **human-readable display field**, not a primary key.
- Stored in manager indices but **not persisted to disk** (re-derived from id on reload).
- **Can be safely updated** without file moves.
- Example: `DiagramManager.index.set(id, { name: newName, path, lastModified })`

**Sessions:**
- Session name is a **directory path component and registry key**, deeply embedded.
- **Cannot be renamed without cascading updates** across the filesystem and in-memory state.

---

## 2. Backend API Surface

### Current State: Almost No Rename Support

**Existing `update_*` MCP tools (from src/mcp/tools/):**
- `updateDiagramSchema`: takes `id` + `content` only — **no name field**
- `updateDocumentSchema`: takes `id` + `content` only — **no name field**
- `updateDesignSchema`: takes `id` + `content` only — **no name field**
- `updateSnippetSchema`: takes `id` + `content` only — **no name field**
- `updateSpreadsheetSchema`: takes `id` + `content` only — **no name field**
- `updateEmbedSchema`: takes `id`, `name`, `url` — **name IS updatable!**

**Exception:** `embed` already supports name in its update schema (src/mcp/tools/embed.ts).

**Terminal sessions only:**
- `terminalRenameSession(project, session, id, name)` exists (src/mcp/tools/terminal-sessions.ts:145)
- Proof-of-concept for rename UX pattern: validate name, find in array, update, persist to `terminal-sessions.json`

### HTTP Routes (src/routes/api.ts)

**Folder rename example (metadata only):**
```typescript
// POST /api/metadata/folders?project=...&session=...
if (action === 'rename') {
  await metadataManager.renameFolder(name, newName);  // line 2642
}
```

**No artifact-level rename endpoints exist.**

### Required New Endpoints & MCP Tools

For each artifact type (diagram, document, design, spreadsheet, snippet, image, embed):
1. **MCP tool:** `rename_<artifact>` with schema:
   ```json
   {
     "type": "object",
     "properties": {
       "project": "..string..",
       "session": "..string..",
       "id": "..string..",
       "name": "..string.."
     },
     "required": ["project", "session", "id", "name"]
   }
   ```
2. **Handler logic:**
   - Validate name is non-empty and meets naming rules (alphanumeric + hyphens/underscores)
   - Check uniqueness: no other artifact in session has the same name
   - Update manager index: `manager.index.get(id).name = newName`
   - Update metadata if tracking name display (currently doesn't)
   - Persist metadata changes
   - Broadcast WebSocket `artifact_renamed` event (new message type)

3. **HTTP route (optional, for CLI or direct API calls):**
   ```
   POST /api/artifacts/:type/:id/rename?project=...&session=...&name=...
   ```

### Session Rename (Complex)

**MCP tool:** `rename_session` with schema:
```json
{
  "type": "object",
  "properties": {
    "project": "..string..",
    "session": "..string..",
    "newSession": "..string.."
  },
  "required": ["project", "session", "newSession"]
}
```

**Handler logic (from session-registry.ts pattern):**
1. Validate `newSession` is alphanumeric + hyphens
2. Check uniqueness: no existing session with that name in the registry for this project
3. **Filesystem:** rename `.collab/sessions/<session>` → `.collab/sessions/<newSession>`
4. **Registry:** load sessions.json, find entry, update `session` field
5. **In-memory managers:** update `basePath` (collab-manager creates new managers for the new path)
6. **WebSocket:** broadcast `session_renamed` event so connected clients switch context
7. **Claude session:** if registered, update the `.claude-mermaid-collab/<project>/<session>` binding files

---

## 3. Frontend UX

### Current Placeholder State

**Sidebar context menu (src/components/layout/sidebar-tree/getActionsForNode.ts:60):**
```typescript
{
  id: 'rename',
  label: 'Rename',
  disabled: true,
  tooltip: 'Not yet supported',
}
```

**For artifacts:** present in all artifact type action lists (diagrams, documents, designs, etc., lines 60–84).
**For embeds:** also present (lines 118–130).
**For tab context menu:** (src/components/layout/tabs/TabContextMenu.tsx) likely mirrors sidebar actions.

### UI Integration Points

#### 1. Sidebar Context Menu
**File:** `ui/src/components/layout/sidebar-tree/SidebarNodeContextMenu.tsx`
- Displays actions from `getActionsForNode.ts`
- Calls `onAction(actionId, targetNodes)` on click

**Required changes:**
- Remove `disabled: true` from rename action
- Handler in parent component (likely `SidebarTree.tsx` or main layout) should:
  - Show modal with text input for new name
  - Call `api.renameArtifact(project, session, id, newName)`
  - On success, update `sessionStore` and close modal
  - On error, show toast notification

#### 2. Tab Context Menu
**File:** `ui/src/components/layout/tabs/TabContextMenu.tsx`
- Mirrors sidebar actions for quick access
- Same modal + API flow

#### 3. Batch Action Handler
**File:** `ui/src/components/layout/sidebar-tree/runBatchAction.ts`
- Currently handles: `delete`, `deprecate`, `undeprecate`
- **Must add:** `rename` case — but batch rename is tricky:
  - Could show modal asking for suffix (e.g., " (copy 2)") to append to each name
  - Or disable batch rename and only allow single-item rename in the context menu

#### 4. Stores That Need Updates
**sessionStore (ui/src/stores/sessionStore.ts):**
- Update artifact `name` in the respective list (diagrams, documents, designs, etc.)
- Example action:
  ```typescript
  updateDiagramName: (id: string, newName: string) => {
    set(state => ({
      diagrams: state.diagrams.map(d => d.id === id ? { ...d, name: newName } : d)
    }))
  }
  ```

**tabsStore (ui/src/stores/tabsStore.ts):**
- Update tab title if the renamed artifact is open
- Example logic: if `tabs[i].id === renamedId`, update `tabs[i].name`

**sidebarTreeStore (ui/src/stores/sidebarTreeStore.ts):**
- No direct artifact name storage, but may need to broadcast tree refresh

### WebSocket Propagation

**New message type** (in src/websocket/handler.ts `WSMessage` union):
```typescript
| { type: 'artifact_renamed'; artifactType: string; id: string; oldName: string; newName: string; project: string; session: string }
| { type: 'session_renamed'; project: string; session: string; newSession: string; oldSession: string }
```

**Broadcast on rename:**
```typescript
wsHandler.broadcast({
  type: 'artifact_renamed',
  artifactType: 'diagram',
  id: 'my-diagram',
  oldName: 'My Diagram',
  newName: 'My Updated Diagram',
  project,
  session,
});
```

**UI listener (in main layout or sessionStore effect):**
```typescript
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'artifact_renamed') {
    // Update sessionStore with new name
    sessionStore.updateDiagramName(msg.id, msg.newName);
    // Update tabsStore if open
    tabsStore.updateTabName(msg.id, msg.newName);
  }
});
```

---

## 4. Edge Cases & Gotchas

### Name Uniqueness

**Current state:** Not enforced.
- Two diagrams in the same session can have the same id (file collision on create would be caught, but post-creation name dups are not prevented).

**Solution:**
- Validate on rename: `manager.index.has(newId)` where `newId = sanitize(newName)`
- Error message: "A diagram with that name already exists"

### Pseudo-Prose Files

**Relationship:** Prose files are named after **source file paths**, not artifact names.
- Example: `/my-project/src/app.ts` → pseudo-prose file at `.pseudo/app.md` or similar (schema stored in `pseudo-db` v6)
- **Rename of source code artifacts doesn't affect pseudo**, since the prose identity is tied to the source file path, not an artifact name in collab
- **No action needed** unless renaming pseudo-indexed artifacts (if any), which we don't have

### Blueprint Name Display

**Current state:** Blueprint documents are marked with `blueprint: true` in metadata.
- Display name comes from the **document name** (same as any artifact)
- Tasks section renders task names from task-graph parsing
- Renaming a blueprint document → its name changes in sidebar + task graph references should still work (task-graph uses document id, not name)

### MCP `create_*` Tool Name Inputs

**Schema check:** `createDiagramSchema`, `createDocumentSchema` etc. all require `name` parameter.
- The `name` is used to generate the `id` (sanitized)
- **Post-creation, the `name` can change independently from the `id`** (because we decouple them after creation)
- Update schemas should allow optional `name` parameter for consistency with create schemas

### Session Rename Cascades

**Critical list of updates:**
1. Filesystem: directory rename
2. Registry: sessions.json update
3. All managers' basePath: must point to new directory
4. TabsStore: if session is active, update display name
5. Sidebar: refresh session selector
6. WebSocket channel: clients need to know the session changed
7. Claude session bindings: if registered, update the binding files

---

## 5. Effort Estimate (T-shirt Sizing)

### (a) Artifact Rename
**Size: M (Medium) = ~2–3 days**
- Backend: ~4–6 hours
  - Add `renameArtifact` method to each manager (diagram, document, design, etc.)
  - Update manager indices
  - Add MCP tools for each type (copy/paste pattern from terminal-sessions)
  - Add HTTP routes (optional, for completeness)
  - Add uniqueness validation
  - Add WebSocket broadcast events
- Frontend: ~6–8 hours
  - Enable rename action in getActionsForNode.ts
  - Add modal component for input
  - Wire up handlers in sidebar/tab context menu
  - Update sessionStore + tabsStore actions
  - Test WebSocket propagation
- Testing: ~3–4 hours

### (b) Session Rename
**Size: L (Large) = ~5–7 days**
- Backend: ~12–16 hours
  - Atomic directory rename (handle race conditions, failures)
  - Registry update + fsync safety (SessionRegistry pattern)
  - Manager basePath updates (collab-manager coordination)
  - Claude session binding file updates
  - Validation (name uniqueness, alphanumeric rules)
  - Rollback on partial failure (if dir rename succeeds but registry update fails, undo dir rename)
  - WebSocket broadcast + active client context switch
- Frontend: ~12–16 hours
  - Session switcher UI (find component, e.g., Header or sidebar session dropdown)
  - Modal for input
  - Store updates (sessionStore, tabsStore, sidebarTreeStore)
  - Refresh managers + re-initialize after rename
  - Handle inflight requests to old session name (error handling)
  - Re-login to websocket with new session context
- Testing: ~8–10 hours
  - File system scenarios (permissions, race conditions)
  - Registry corruption recovery
  - Active client behavior during rename
  - Partial failure scenarios

### (c) UI Wiring
**Size: M (Medium) = ~2–3 days**
- Modal component + keyboard handling: ~4 hours
- Store integration: ~4 hours
- WebSocket listeners: ~2 hours
- Batch rename (if supporting multi-select): ~4 hours
- Testing + polish: ~4 hours

**Total effort (full implementation):** **~10–13 days** (artifact + session + UI)
**Phased approach:** Start with artifact rename (M, ~3 days), then extend to session rename (L, ~7 days) with UI wiring (M, ~3 days) done once for both.

---

## 6. Implementation Checklist

### Phase 1: Artifact Rename (Recommended Start)
- [ ] Add `renameArtifact(id: string, newName: string)` to each manager (DiagramManager, DocumentManager, etc.)
- [ ] Update manager indices and persist metadata
- [ ] Add uniqueness validation (check if newId already exists)
- [ ] Create MCP tools: `rename_diagram`, `rename_document`, `rename_design`, etc.
- [ ] Add HTTP routes (optional): `POST /api/artifacts/:type/:id/rename`
- [ ] Add WebSocket message types: `artifact_renamed`
- [ ] Broadcast on rename via wsHandler
- [ ] Update MCP setup.ts to register new tools
- [ ] Frontend: enable rename action in getActionsForNode.ts
- [ ] Add modal component (reusable, with validation)
- [ ] Wire sidebar + tab context menu handlers
- [ ] Update sessionStore with `updateArtifactName(type, id, newName)` action
- [ ] Update tabsStore with tab title update logic
- [ ] Test end-to-end (rename, verify UI, verify other clients see update)

### Phase 2: Session Rename (Advanced)
- [ ] Implement atomic directory rename + rollback in collab-manager
- [ ] Update SessionRegistry to handle renames
- [ ] Update Claude session bindings (if registered)
- [ ] Validate session name uniqueness against registry
- [ ] Create MCP tool: `rename_session`
- [ ] Add WebSocket message type: `session_renamed`
- [ ] Broadcast on session rename
- [ ] Frontend: find session switcher component, add rename option
- [ ] Update sessionStore with `renameSession(oldSession, newSession)` action
- [ ] Handle client context switch (reload managers, reset tabs, reconnect websocket)
- [ ] Test multi-client scenarios (one client renames while another is viewing)

### Phase 3: UI Polish (Parallel or After)
- [ ] Keyboard shortcuts (e.g., F2 to rename selected item)
- [ ] Batch rename (append suffix) or disable for multi-select
- [ ] Undo/redo (optional, if system supports it)
- [ ] Error messaging (name already exists, invalid characters, etc.)
- [ ] Loading state during rename (spinner)
- [ ] Toast notifications on success/failure

---

## 7. References & Key Files

### Backend
- Session registry: `/srv/codebase/claude-mermaid-collab/src/services/session-registry.ts` (atomic rename pattern)
- Managers: `/srv/codebase/claude-mermaid-collab/src/services/{diagram,document,design,spreadsheet,snippet,embed,image}-manager.ts`
- Metadata: `/srv/codebase/claude-mermaid-collab/src/services/metadata-manager.ts`
- Terminal session rename: `/srv/codebase/claude-mermaid-collab/src/mcp/tools/terminal-sessions.ts:145` (proof-of-concept)
- WebSocket types: `/srv/codebase/claude-mermaid-collab/src/websocket/handler.ts:17`
- MCP setup: `/srv/codebase/claude-mermaid-collab/src/mcp/setup.ts`

### Frontend
- Sidebar context menu: `/srv/codebase/claude-mermaid-collab/ui/src/components/layout/sidebar-tree/SidebarNodeContextMenu.tsx`
- Action definitions: `/srv/codebase/claude-mermaid-collab/ui/src/components/layout/sidebar-tree/getActionsForNode.ts`
- Batch action handler: `/srv/codebase/claude-mermaid-collab/ui/src/components/layout/sidebar-tree/runBatchAction.ts`
- Session store: `/srv/codebase/claude-mermaid-collab/ui/src/stores/sessionStore.ts`
- Tabs store: `/srv/codebase/claude-mermaid-collab/ui/src/stores/tabsStore.ts`
- Sidebar tree store: `/srv/codebase/claude-mermaid-collab/ui/src/stores/sidebarTreeStore.ts`

### Types & Config
- Type definitions: `/srv/codebase/claude-mermaid-collab/src/types.ts`
- Terminal types: `/srv/codebase/claude-mermaid-collab/src/types/terminal.ts`

---

## 8. Key Insights

1. **ID ≠ Name:** Artifact IDs are stable slugs; names are display-only and can change freely without file moves.
2. **Session name IS load-bearing:** Embedded in directory paths and registry; rename is expensive.
3. **Embed is the outlier:** Only artifact type with name already updatable (via `updateEmbedSchema`).
4. **Terminal sessions have proof-of-concept:** Rename logic exists for terminal sessions; reuse pattern for artifacts.
5. **Decoupling simplifies rename:** By not using the name as a file path, we avoid cascading filename updates across artifact storage and pseudo-prose indices.
6. **WebSocket is critical:** Multi-client scenario means we must broadcast renames so all connected clients see updates live.
