# Research: Adding a New Artifact Type to mermaid-collab

## Executive Summary

Adding a new artifact type (e.g., "storybook" or "embed") requires touching **6-7 layers** of the stack. The architecture follows a **consistent but not pluggable** pattern -- each artifact type is implemented via copy-and-adapt from existing types rather than a registry/plugin system. Estimated effort: **15-25 files to create/modify**, roughly **1,500-2,500 lines of code** for full parity.

---

## 1. Data Layer -- File-Based Storage

### How artifacts are stored

Artifacts are stored as **flat files** in session-scoped directories:

```
{project}/.collab/sessions/{session}/
  ├── diagrams/        # .mmd files (Mermaid markup)
  ├── documents/       # .md files (Markdown)
  ├── snippets/        # (code snippet files)
  ├── spreadsheets/    # (spreadsheet data files)
  ├── designs/         # (design JSON files)
  └── state.json       # Session state
```

Each artifact type gets its own subdirectory. There is **no database** for artifact content -- it is all file-system based. (SQLite is only used for Kodex knowledge base metadata.)

### Manager pattern

Each artifact type has a dedicated **Manager class** (singleton per project):

| Manager | File | Storage |
|---------|------|---------|
| `DiagramManager` | `src/services/diagram-manager.ts` | `.mmd` files |
| `DocumentManager` | `src/services/document-manager.ts` | `.md` files |
| `SnippetManager` | (inferred) `src/services/snippet-manager.ts` | code files |
| `SpreadsheetManager` | (inferred) `src/services/spreadsheet-manager.ts` | data files |
| `DesignManager` | (inferred) `src/services/design-manager.ts` | JSON files |

All managers follow the same pattern:
- **In-memory index** (`Map<string, Meta>`) for fast lookups
- `initialize()` -- scan directory, build index
- `list()`, `get(id)`, `create(name, content)`, `update(id, content)`, `delete(id)`
- **Async file I/O** throughout
- History/versioning support (get_*_history, revert_* tools exist)

### What a new type needs

- **1 new Manager class** (~200-400 lines) following `DiagramManager` pattern
- **1 new subdirectory** in session path (e.g., `embeds/`)
- **File extension** choice (e.g., `.embed.json`, `.story.json`)

---

## 2. MCP Tools -- Tool Definitions in setup.ts

### Location

All MCP tools are defined in **`src/mcp/setup.ts`** (~1,354 lines). This is the single largest file to modify.

### Tools per artifact type

By analyzing the MCP tool listing, each artifact type has these tools:

| Tool | Diagram | Document | Snippet | Spreadsheet | Design |
|------|---------|----------|---------|-------------|--------|
| `list_*` | Yes | Yes | Yes | Yes | Yes |
| `get_*` | Yes | Yes | Yes | Yes | Yes |
| `create_*` | Yes | Yes | Yes | Yes | Yes |
| `update_*` | Yes | Yes | Yes | Yes | Yes |
| `delete_*` | Yes (implied) | Yes | Yes | Yes | Yes |
| `patch_*` | Yes | Yes | Yes | Yes | Yes (patch_design_item) |
| `get_*_history` | Yes | Yes | Yes (snippet_history) | Yes | Yes |
| `revert_*` | Yes | Yes | Yes | Yes | Yes |
| `preview_*` | Yes | Yes | -- | -- | -- |
| `export_*` | SVG, PNG | -- | Yes | CSV | SVG, PNG, code |

**Core tool count per artifact type: 6-8 tools** (list, get, create, update, delete, patch, history, revert).

**Additional specialized tools vary:**
- Diagrams: `validate_diagram`, `transpile_diagram`, `diagram_from_code` (+3)
- Documents: `preview_document` (+1)
- Designs: 20+ tools (nodes, groups, alignment, tokens, etc.)
- Snippets: `export_snippet` (+1)
- Spreadsheets: `export_spreadsheet_csv` (+1)

### What a new type needs

- **Minimum 6 MCP tool definitions** in `setup.ts`: create, get, list, update, delete, patch
- **Optional 2-3 more**: history, revert, export/preview
- Each tool definition is ~30-50 lines in setup.ts
- **Total: ~250-400 lines added to setup.ts**

---

## 3. API Routes

### Location

- **`src/routes/api.ts`** -- Core API route handlers
- **`src/routes/kodex-api.ts`** -- Kodex-specific routes

### Route pattern per artifact type

```
GET    /api/{type}s          -- List all
GET    /api/{type}/:id       -- Get one
POST   /api/{type}           -- Create
POST   /api/{type}/:id       -- Update
DELETE /api/{type}/:id       -- Delete
```

Diagrams also have:
```
GET    /api/render/:id       -- Render as SVG
GET    /api/thumbnail/:id    -- Generate thumbnail
POST   /api/validate         -- Validate syntax
GET    /api/transpile/:id    -- SMACH transpile
```

### What a new type needs

- **5-6 route handlers** in `api.ts` (~100-150 lines)
- Routes follow a mechanical pattern: parse query params, call manager, return JSON, broadcast WebSocket
- All routes require `?project=...&session=...` query parameters

---

## 4. WebSocket Events

### Location

- **`src/websocket/handler.ts`** -- WebSocketHandler class
- **`src/websocket/types.ts`** -- WSMessage union type

### Events per artifact type

Each artifact type has 3 WebSocket message types:
- `{type}_created` -- id, name, content, project, session
- `{type}_updated` -- id, content, optional patch
- `{type}_deleted` -- id

The WebSocketHandler has targeted broadcast methods:
- `broadcastToDiagram(id, message)` -- sends to subscribers of that diagram
- `broadcastToDocument(id, message)` -- sends to subscribers of that document

**Total: 17 WebSocket message types** across the system.

### What a new type needs

- **3 new message types** in `types.ts`
- **1 new broadcast method** in `handler.ts` (e.g., `broadcastToEmbed()`)
- **~30-50 lines** total

---

## 5. UI Components

### Location

Frontend lives in **`ui/src/`** using React 18 + Vite + Tailwind CSS + Zustand.

### Components per artifact type

**Sidebar (`ui/src/components/layout/Sidebar.tsx`):**
- Shows item cards for all artifact types
- Search/filter functionality
- Each type gets a section with icons

**Editors:**
- `ui/src/components/editors/DiagramEditor.tsx` -- CodeMirror + MermaidPreview
- `ui/src/components/editors/DocumentEditor.tsx` -- CodeMirror + MarkdownPreview
- `ui/src/components/editors/UnifiedEditor.tsx` -- Shared editor container

**Specific artifact viewers vary:**
- Diagrams: Mermaid rendering, SVG/PNG export, validation
- Documents: Markdown rendering with diagram embeds
- Designs: Canvas-based visual editor (most complex)

**Stores (Zustand):**
- `ui/src/stores/` -- sessionStore, uiStore, proposalStore, questionStore
- Each artifact type likely has state in sessionStore

### What a new type needs

- **1 new Editor/Viewer component** (~200-400 lines)
- **Sidebar modifications** to list the new type (~20-50 lines)
- **Store updates** for selected item state (~30-50 lines)
- **API service client** functions (~50-80 lines)
- Possibly a **dedicated page/route** if it needs full-screen view

---

## 6. Routing/Navigation

### Architecture

The UI appears to be a **SPA (Single Page Application)** with:
- `src/server.ts` serving static files from React UI build with SPA fallback
- Zustand stores managing which artifact is selected
- No evidence of a formal router (React Router) -- likely state-driven rendering

The `UnifiedEditor.tsx` component determines what to render based on the selected item type (diagram vs document). Adding a new type means adding a branch to this selection logic.

### What a new type needs

- **Editor selection logic** update in UnifiedEditor or equivalent (~10-20 lines)
- **Item type discriminator** in shared types

---

## 7. Type Definitions

### Locations

**Backend:**
- `/src/types.ts` -- Root shared types (includes `Diagram`, `Document` interfaces)
- `/src/types/*.ts` -- Domain-specific types

**Frontend:**
- `/ui/src/types/index.ts` -- Central type exports
- `/ui/src/types/diagram.ts` -- Diagram operation types
- `/ui/src/types/session.ts` -- Session and CollabState types

### Pattern per artifact type

```typescript
export interface Embed {
  id: string;
  name: string;
  content: string;       // or structured data
  lastModified: number;
  folder?: string;
}

export interface EmbedListItem {
  id: string;
  name: string;
  lastModified: number;
}
```

### What a new type needs

- **2-3 TypeScript interfaces** (main type, list item type, create params)
- Added to both backend and frontend type files
- **~30-60 lines** total across files

---

## Coupling Assessment

### Architecture style: **Copy-and-adapt, NOT pluggable**

There is no artifact type registry, no plugin system for artifact types, and no generic "artifact" base class. Each type is independently implemented across all layers. Evidence:

1. **setup.ts** has individually defined tools for each type (no loop/registry)
2. **api.ts** has individual route handlers per type
3. **WebSocket types** are a hand-written union, not generated
4. **Managers** are independent classes with no shared base class
5. **Sidebar** has hardcoded sections per type

However, the patterns are **extremely consistent**, which makes copy-and-adapt straightforward.

---

## Estimate: Files to Create/Modify

### New files to create (~8-10):

| File | Lines | Purpose |
|------|-------|---------|
| `src/services/embed-manager.ts` | 200-400 | Backend CRUD manager |
| `src/services/__tests__/embed-manager.test.ts` | 150-300 | Manager tests |
| `ui/src/components/editors/EmbedEditor.tsx` | 200-400 | Frontend editor/viewer |
| `ui/src/types/embed.ts` | 30-60 | Frontend types |

### Existing files to modify (~8-12):

| File | Changes | Lines |
|------|---------|-------|
| `src/mcp/setup.ts` | Add 6-8 tool definitions | 250-400 |
| `src/routes/api.ts` | Add 5-6 route handlers | 100-150 |
| `src/websocket/types.ts` | Add 3 message types | 20-30 |
| `src/websocket/handler.ts` | Add broadcast method | 15-20 |
| `src/types.ts` | Add Embed interface | 15-25 |
| `src/server.ts` | Initialize EmbedManager | 5-10 |
| `ui/src/components/layout/Sidebar.tsx` | Add embed section | 20-50 |
| `ui/src/components/editors/UnifiedEditor.tsx` | Add embed branch | 10-20 |
| `ui/src/stores/` (sessionStore or similar) | Add embed state | 30-50 |
| `ui/src/services/` (API client) | Add embed API calls | 50-80 |
| `ui/src/types/index.ts` | Re-export embed types | 2-5 |

### Total estimate:

- **16-22 files** touched
- **~1,500-2,500 lines** of code
- **Effort: 1-2 days** for an experienced contributor familiar with the codebase

---

## Minimal Viable Version

A minimal version that gets a new type appearing in the sidebar with basic CRUD:

1. `embed-manager.ts` -- Manager class (copy from document-manager, adapt)
2. `setup.ts` -- 4 tools: create, get, list, update
3. `api.ts` -- 4 routes: list, get, create, update
4. `types.ts` -- Embed interface
5. `Sidebar.tsx` -- Add embed section
6. WebSocket -- 2 events: created, updated

**Minimal estimate: ~6 files, ~600-800 lines, half a day.**

---

## Shortcut: Piggyback on Document Type?

**Possible but limited.** Documents are Markdown files. You could:

1. Use the document system with a naming convention (e.g., prefix with `embed--`)
2. Store embed metadata as Markdown frontmatter
3. Render differently in the UI based on the prefix

**Pros:** Zero backend changes needed. Works today.
**Cons:** No type safety, confusing UX mixing embeds with docs in the sidebar, no specialized editor, no embed-specific MCP tools.

**Verdict:** Good for a prototype/proof-of-concept. Not suitable for a real feature.

---

## Shortcut: Piggyback on Snippet Type?

Snippets store code with syntax highlighting. An "embed" or "storybook" artifact could be stored as a snippet with a specific language/type marker.

**Better fit than documents** if the embed content is code-like (e.g., a Storybook story is JSX/TSX code). The snippet system already handles:
- Language-aware storage
- Export functionality
- History/revert

**Cons:** Same sidebar mixing issue. No iframe/preview rendering.

---

## Recommendation

For a "storybook embed" artifact type specifically:

1. **Phase 1 (prototype):** Store as snippets with a `storybook` language tag. Add a custom preview renderer in the UI that renders an iframe pointing to a Storybook URL. ~2-3 files changed.

2. **Phase 2 (proper type):** Implement as a full artifact type following the document-manager pattern. This gives clean separation, dedicated MCP tools (`create_embed`, `list_embeds`, etc.), and a proper sidebar section.

3. **Phase 3 (rich features):** Add specialized tools like `preview_embed` (open in browser), `validate_embed` (check URL reachability), component picker UI.
