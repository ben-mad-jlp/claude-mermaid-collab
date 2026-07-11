# Session: code-editor

## Session Context
**Converted from:** Vibe session
**Out of Scope:** Multi-file grouping, server-side file apply
**Shared Decisions:** Claude handles file writes (no apply_snippet tool), snippets in same artifact list with distinct icon, CodeMirror reused, diff always available

---

## Existing Artifacts

- **snippet-features** (document) - this design doc
- **current-state-item-1** (diagram) - architecture overview

---

## Work Items

### ~~Item 1: Add snippet artifact type~~ (superseded - split into items 2, 3, 4)

---

### Item 2: Snippet backend
**Type:** code
**Status:** documented

#### Section 1: Types + SnippetManager

**src/types.ts** — add three interfaces following the exact pattern of Diagram/DiagramMeta/DiagramListItem:
```typescript
export interface Snippet {
  id: string; name: string; content: string; lastModified: number;
}
export interface SnippetMeta {
  name: string; path: string; lastModified: number;
}
export interface SnippetListItem {
  id: string; name: string; lastModified: number;
}
```

Note: `content` is a JSON string (the full `.snippet.json`). The rich fields (`language`, `code`, `filePath`, etc.) live inside that JSON - the manager stores/retrieves the raw JSON string, and MCP tools parse/serialize it.

**src/services/snippet-manager.ts** — new file, copy DiagramManager exactly, changing:
- Extension: `.snippet.json` instead of `.mmd`
- Class/method names: `SnippetManager`, `listSnippets`, `getSnippet`, `saveSnippet`, `createSnippet`, `deleteSnippet`
- Imports: `Snippet`, `SnippetMeta`, `SnippetListItem`

#### Section 2: Session Lifecycle

**src/services/session-registry.ts** — add `snippets/` directory creation alongside existing artifact dirs:
```typescript
await mkdir(join(sessionPath, 'snippets'), { recursive: true });
```

**src/mcp/tools/collab-state.ts** — include snippets in archive:
- Add `snippetsDir = join(sessionDir, 'snippets')` 
- Add `snippets: string[]` to `archivedFiles` object
- Copy snippet files to archive dir (same pattern as diagrams/documents/spreadsheets)

Both are single-line additions following the existing pattern.

#### Section 3: API Routes + WebSocket

**src/routes/api.ts** — add 5 routes following the diagram/document pattern:

| Route | Method | Handler |
|-------|--------|---------|
| `/api/snippets` | GET | List all snippets via `snippetManager.listSnippets()` |
| `/api/snippet/:id` | GET | Get snippet via `snippetManager.getSnippet(id)` |
| `/api/snippet` | POST | Create snippet via `snippetManager.createSnippet(name, content)` |
| `/api/snippet/:id` | POST | Update snippet via `snippetManager.saveSnippet(id, content)` |
| `/api/snippet/:id` | DELETE | Delete snippet via `snippetManager.deleteSnippet(id)` |

Each write operation broadcasts a WebSocket event after success.

**src/websocket/handler.ts** — add to `WSMessage` union type:
```typescript
| { type: 'snippet_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
| { type: 'snippet_updated'; id: string; content: string; lastModified: number }
| { type: 'snippet_deleted'; id: string; project: string; session: string }
```

**src/routes/api.ts** — add `snippetManager` to `createManagers()` function:
```typescript
const snippetsDir = sessionRegistry.resolvePath(project, session, 'snippets');
const snippetManager = new SnippetManager(snippetsDir);
await snippetManager.initialize();
```

#### Section 4: MCP Tools

**src/mcp/setup.ts** — register 7 tools in `ListToolsRequestSchema` and handle in `CallToolRequestSchema`:

| Tool | Params | Description |
|------|--------|-------------|
| `create_snippet` | `project, session, name, language, code, filePath?, highlightLines?, originalCode?` | Serializes params to JSON, calls API POST |
| `get_snippet` | `project, session, id` | Returns parsed snippet fields |
| `list_snippets` | `project, session` | Returns snippet list |
| `update_snippet` | `project, session, id, language?, code?, filePath?, highlightLines?, originalCode?` | Merges provided fields into existing JSON, calls API POST |
| `delete_snippet` | `project, session, id` | Calls API DELETE |
| `snippet_history` | `project, session, id` | Returns version history from update log |
| `revert_snippet` | `project, session, id, version` | Restores from update log |

Key difference from diagram/document MCP tools: `create_snippet` and `update_snippet` accept structured params (`language`, `code`, `filePath`, etc.) and serialize them to/from the JSON content string. Claude doesn't need to construct JSON manually.

`get_snippet` returns parsed fields so Claude sees `{ id, name, language, code, filePath, ... }` not raw JSON.

**Problem/Goal:**
Add backend support for the snippet artifact type - types, manager, API routes, MCP tools, WebSocket events, session lifecycle.

**Approach:**
Follow the established artifact pattern (DiagramManager, etc). Create SnippetManager for `.snippet.json` files. Register CRUD API routes, MCP tools, and WebSocket broadcast events. Include snippets in session init and archive.

**Success Criteria:**
- Snippet/SnippetMeta/SnippetListItem types defined
- SnippetManager with CRUD operations
- Session registry creates `snippets/` dir
- API routes: list/get/create/update/delete
- MCP tools: create_snippet, get_snippet, list_snippets, update_snippet, delete_snippet, snippet_history, revert_snippet
- WebSocket: snippet_created, snippet_updated, snippet_deleted events
- Archive includes snippets directory

**Decisions:**
- Storage: `.snippet.json` with `{ language, code, filePath?, highlightLines?, originalCode? }`
- MCP create_snippet params: `name, language, code, filePath?, highlightLines?, originalCode?`
- No apply_snippet tool

**Files:**
1. `src/types.ts`
2. `src/services/snippet-manager.ts` (new)
3. `src/services/session-registry.ts`
4. `src/routes/api.ts`
5. `src/mcp/setup.ts`
6. `src/websocket/handler.ts`
7. `src/mcp/tools/collab-state.ts`

---

### Item 3: Snippet UI plumbing
**Type:** code
**Status:** documented

#### Section 1: UI Plumbing (all 5 files)

**ui/src/types/item.ts** — add `'snippet'` to the type union:
```typescript
type: 'diagram' | 'document' | 'design' | 'spreadsheet' | 'snippet';
```

**ui/src/stores/sessionStore.ts** — add snippet state + actions following the design/spreadsheet pattern:
- State: `snippets: Snippet[]`, `selectedSnippetId: string | null`
- Actions: `setSnippets`, `addSnippet`, `updateSnippet`, `removeSnippet`, `selectSnippet`, `getSelectedSnippet`

**ui/src/lib/api.ts** — add 4 methods:
- `getSnippets(project, session)` → GET `/api/snippets`
- `getSnippet(project, session, id)` → GET `/api/snippet/:id`
- `updateSnippet(project, session, id, content)` → POST `/api/snippet/:id`
- `deleteSnippet(project, session, id)` → DELETE `/api/snippet/:id`

**ui/src/hooks/useDataLoader.ts** — add `api.getSnippets()` to the `Promise.all` and `setSnippets()` call.

**ui/src/components/layout/Sidebar.tsx** — add snippet entries to the artifact list:
- Pull `snippets`, `selectedSnippetId`, `removeSnippet` from store
- Map snippets to Item entries with `type: 'snippet'`
- Use a code brackets icon (e.g. `<>` or a `Code` icon from lucide-react)

**WebSocket handler** (in useDataLoader or dedicated hook) — handle `snippet_created`, `snippet_updated`, `snippet_deleted` messages by calling the corresponding store actions.

**Problem/Goal:**
Wire up the frontend to fetch, store, display, and manage snippets - types, store, API client, data loader, sidebar.

**Approach:**
Add 'snippet' to the Item type union. Add snippet state/actions to sessionStore. Add API client methods. Include snippets in data loader. Add snippet entries to sidebar with code icon.

**Success Criteria:**
- Item type includes 'snippet'
- Session store has snippet state + CRUD actions
- API client has snippet fetch/update/delete methods
- Data loader fetches snippets on session load
- Sidebar shows snippets with a code icon
- WebSocket handlers update store on snippet events

**Files:**
1. `ui/src/types/item.ts`
2. `ui/src/stores/sessionStore.ts`
3. `ui/src/lib/api.ts`
4. `ui/src/hooks/useDataLoader.ts`
5. `ui/src/components/layout/Sidebar.tsx`

---

### Item 4: SnippetEditor component
**Type:** code
**Status:** documented

#### Section 1: Component Structure

**ui/src/components/editors/SnippetEditor.tsx** — new component:

```
Props: { snippetId: string }
```

**State management:**
- Reads snippet from `sessionStore` by ID
- Parses `content` (JSON string) into `{ language, code, filePath, highlightLines, originalCode }`
- On user edits: updates `code` field, serializes back to JSON, calls store `updateSnippet` → API

**Layout (top to bottom, full width):**
1. **Toolbar bar** — single row:
   - Language dropdown (left) — select element with common languages, auto-selected from filePath extension
   - File path badge (left) — read-only display of `filePath` if present, subtle gray text
   - Diff toggle button (right) — switches between "Code" and "Diff" modes
   - Copy button (right) — copies `code` to clipboard

2. **Editor area** — fills remaining height:
   - **Code mode (default):** CodeMirrorWrapper with language-aware highlighting, line numbers, editable. Highlighted lines get a subtle `bg-yellow-50/bg-yellow-900` background via CodeMirror decoration.
   - **Diff mode:** Reuses existing `DiffView` component from `ai-ui/display/DiffView`. Shows `originalCode` (before) vs `code` (after). Read-only.
   - If no `originalCode` exists, diff toggle is disabled/hidden.

**Language auto-detect:** Map file extensions to CodeMirror language modes — `.ts`→typescript, `.py`→python, `.go`→go, `.rs`→rust, `.js`→javascript, `.json`→json, `.css`→css, `.html`→html, etc.

#### Section 2: UnifiedEditor Integration

**ui/src/components/editors/UnifiedEditor.tsx** — add snippet routing alongside design/spreadsheet:

```typescript
// After the spreadsheet block (~line 257)
if (item.type === 'snippet') {
  return (
    <div className="flex-1 flex flex-col h-full">
      <SnippetEditor key={item.id} snippetId={item.id} />
    </div>
  );
}
```

Same full-width pattern as SpreadsheetEditor — no split pane, no CodeMirror wrapper from UnifiedEditor (SnippetEditor manages its own CodeMirror internally).

Import added: `import { SnippetEditor } from '@/components/editors/SnippetEditor';`

**Problem/Goal:**
Build the SnippetEditor UI component - full-width CodeMirror with language selector, diff toggle, line highlighting, copy to clipboard.

**Approach:**
Create SnippetEditor.tsx with full-width CodeMirror. Toolbar has: language dropdown (auto-detect from filePath, manual override), diff toggle button, copy button. Diff mode shows unified diff using originalCode vs current code. Line highlighting via subtle background color on specified lines. Register in UnifiedEditor.tsx.

**Success Criteria:**
- Full-width CodeMirror with syntax highlighting
- Language dropdown with auto-detect from filePath extension
- Toolbar toggle between code view and diff view
- Diff view shows originalCode vs current code
- Highlighted lines have subtle colored background
- Copy to clipboard button
- Registered in UnifiedEditor routing

**Decisions:**
- Full-width layout (no split pane)
- Toolbar toggle for code/diff (not side-by-side)
- Auto-detect language from filePath + manual dropdown override
- Background highlight for highlightLines (like GitHub)

**Files:**
1. `ui/src/components/editors/SnippetEditor.tsx` (new)
2. `ui/src/components/editors/UnifiedEditor.tsx`

---

## Diagrams
(auto-synced)
