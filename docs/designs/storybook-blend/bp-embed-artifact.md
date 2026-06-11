# Blueprint: Embed Artifact Type

## Source Artifacts
- design-embed-artifact — Lightweight embed artifact design doc (layered generic + Storybook)

## 1. Structure Summary

### Files to Create

- [ ] `src/services/embed-manager.ts` — Backend manager (create, list, delete, initialize)
- [ ] `src/mcp/tools/embed.ts` — MCP tool schemas + handler functions
- [ ] `ui/src/types/embed.ts` — Frontend TypeScript interfaces
- [ ] `ui/src/components/EmbedViewer.tsx` — Iframe viewer with phone frame + refresh for Storybook
- [ ] `ui/src/api/embeds.ts` — API client (fetchEmbeds, deleteEmbed)
- [ ] `src/services/__tests__/embed-manager.test.ts` — Unit tests for manager

### Files to Modify

- [ ] `src/types.ts` — Add `Embed`, `EmbedMeta`, `EmbedListItem` interfaces
- [ ] `src/mcp/setup.ts` — Register 5 tools in tools array + case statements in switch
- [ ] `src/routes/api.ts` — Add 3 routes (POST, GET, DELETE), add to `createManagers()`
- [ ] `src/websocket/handler.ts` — Add `embed_created`, `embed_deleted` to WSMessage union, emit events
- [ ] `ui/src/stores/sessionStore.ts` — Add `embeds[]`, `selectedEmbedId`, `selectEmbed()`, CRUD actions with mutual-exclusion
- [ ] `ui/src/components/layout/Sidebar.tsx` — Add collapsible Embeds section (inline pattern)
- [ ] `ui/src/App.tsx` — Add `selectedEmbedId` to `selectedItem` resolution + render branch

### Type Definitions

```typescript
// Backend (src/types.ts)
export interface Embed {
  id: string;
  name: string;
  url: string;
  subtype?: 'storybook';
  width?: string;
  height?: string;
  createdAt: string;
  storybook?: { storyId: string; port: number };
}
export interface EmbedMeta { name: string; path: string; createdAt: string; }
export interface EmbedListItem { id: string; name: string; url: string; subtype?: 'storybook'; createdAt: string; }

// Frontend (ui/src/types/embed.ts)
export interface StorybookMetadata { storyId: string; port: number; }
export interface Embed {
  id: string; name: string; url: string; subtype?: 'storybook';
  width?: string; height?: string; createdAt: string;
  storybook?: StorybookMetadata;
}
```

### Component Interactions

```
MCP tool call (create_embed / create_storybook_embed)
  → handler in src/mcp/tools/embed.ts
    → fetch(POST /api/sessions/:session/embeds)
      → api.ts route → EmbedManager.create()
        → writes JSON to .collab/sessions/{session}/embeds/{id}.json
        → wsHandler.broadcast({ type: 'embed_created', ... })
          → UI sessionStore.addEmbed()
            → Sidebar re-renders with new embed in collapsible section

User clicks embed in sidebar
  → sessionStore.selectEmbed(id) — clears all other selections
    → App.tsx selectedItem resolves to embed
      → EmbedViewer renders iframe
```

---

## 2. Function Blueprints

### `EmbedManager` (`src/services/embed-manager.ts`)

#### `constructor(basePath: string)`
```
1. Set this.basePath = basePath
2. Set this.index = new Map<string, EmbedMeta>()
```

#### `async initialize(): Promise<void>`
```
1. mkdir(this.basePath, { recursive: true })
2. readdir(this.basePath) → filter *.json files (exclude index.json)
3. For each JSON file:
   a. stat(file) → get mtime
   b. Parse basename without extension → id
   c. Read file → parse JSON → get name
   d. index.set(id, { name, path: filePath, createdAt })
```
**Error handling:** If readdir fails (dir doesn't exist), initialize empty index.

#### `async create(params: { name, url, subtype?, width?, height?, storybook? }): Promise<Embed>`
```
1. Generate id: name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
2. Check this.index.has(id) — if true, append suffix (-1, -2, etc.)
3. Build Embed object: { id, name, url, subtype, width, height, createdAt: new Date().toISOString(), storybook }
4. writeFile(join(basePath, `${id}.json`), JSON.stringify(embed, null, 2))
5. index.set(id, { name, path, createdAt })
6. Return embed
```
**Error handling:** Validate url starts with http:// or https://. Throw on invalid.

#### `async list(): Promise<Embed[]>`
```
1. Iterate this.index entries
2. For each: readFile → JSON.parse
3. Sort by createdAt descending
4. Return array
```

#### `async delete(id: string): Promise<void>`
```
1. Check this.index.has(id) — if false, throw 'Embed not found'
2. unlink(join(basePath, `${id}.json`))
3. this.index.delete(id)
```

#### `async get(id: string): Promise<Embed | null>`
```
1. Check this.index.has(id) — if false, return null
2. readFile → JSON.parse → return
```

---

### MCP Tool Handlers (`src/mcp/tools/embed.ts`)

#### `handleCreateEmbed(project, session, name, url, width?, height?): Promise<CreateEmbedResult>`
```
1. Validate project, session, name, url are present
2. Validate url starts with http:// or https://
3. POST to /api/sessions/{session}/embeds?project={project}
   body: { name, url, width, height }
4. Return { success: true, id, name, url, createdAt, previewUrl }
```

#### `handleCreateStorybookEmbed(project, session, name, storyId, port?): Promise<CreateEmbedResult>`
```
1. Default port to 6006
2. Construct url: `http://localhost:${port}/iframe.html?id=${storyId}&viewMode=story`
3. POST to /api/sessions/{session}/embeds?project={project}
   body: { name, url, subtype: 'storybook', storybook: { storyId, port } }
4. Return { success: true, id, name, url, subtype: 'storybook', storybook: { storyId, port }, createdAt }
```

#### `handleListStorybookStories(port?): Promise<StorybookStory[]>`
```
1. Default port to 6006
2. fetch(`http://localhost:${port}/index.json`)
3. If fetch fails: return error "Could not reach Storybook at http://localhost:{port}"
4. Parse response JSON
5. Filter entries where type === 'story' (exclude 'docs')
6. Map to { id, title, name, importPath }
7. Return array
```

#### `handleListEmbeds(project, session): Promise<EmbedListItem[]>`
```
1. GET /api/sessions/{session}/embeds?project={project}
2. Return array
```

#### `handleDeleteEmbed(project, session, id): Promise<DeleteResult>`
```
1. DELETE /api/sessions/{session}/embeds/{id}?project={project}
2. Return { deleted: true }
```

---

### API Routes (`src/routes/api.ts`)

#### `POST /api/sessions/:session/embeds`
```
1. Extract project from query params
2. Get/create managers via createManagers(project, session)
3. Call embedManager.create(req.body)
4. wsHandler.broadcast({ type: 'embed_created', id, ...embed, project, session })
5. Return 201 with embed JSON
```

#### `GET /api/sessions/:session/embeds`
```
1. Extract project from query params
2. Get/create managers
3. Call embedManager.list()
4. Return 200 with array
```

#### `DELETE /api/sessions/:session/embeds/:id`
```
1. Extract project from query params
2. Get/create managers
3. Call embedManager.delete(id)
4. wsHandler.broadcast({ type: 'embed_deleted', id, project, session })
5. Return 200 with { deleted: true }
```

---

### Sidebar Embeds Section (`ui/src/components/layout/Sidebar.tsx`)

```
1. Add state: const [embedsCollapsed, setEmbedsCollapsed] = useState(false)
2. Get embeds from store: const { embeds, selectedEmbedId, selectEmbed } = useSessionStore()
3. Render section after Blueprints, before Items (only when embeds.length > 0 && !isDisabled && !todosSelected):
   a. Collapsible header button with "Embeds" label, count badge, rotating chevron
   b. When not collapsed: map embeds to clickable buttons
   c. Each button shows embed.name + subtitle (storyId or truncated url)
   d. Click calls selectEmbed(embed.id)
   e. Selected state uses same accent classes as other sidebar items
```

---

### Session Store (`ui/src/stores/sessionStore.ts`)

#### `selectEmbed(id: string | null)`
```
1. If id is null or embeds.find(e => e.id === id):
   set({
     selectedEmbedId: id,
     selectedDiagramId: null,
     selectedDocumentId: null,
     selectedDesignId: null,
     selectedSpreadsheetId: null,
     selectedSnippetId: null,
     taskGraphSelected: false,
   })
```

#### `addEmbed(embed: Embed)`
```
set(state => ({ embeds: [...state.embeds, embed] }))
```

#### `removeEmbed(id: string)`
```
set(state => ({
  embeds: state.embeds.filter(e => e.id !== id),
  selectedEmbedId: state.selectedEmbedId === id ? null : state.selectedEmbedId,
}))
```

---

### EmbedViewer (`ui/src/components/EmbedViewer.tsx`)

#### Component Props
```typescript
interface EmbedViewerProps { embed: Embed; onDelete: (id: string) => void; }
```

#### State
```
loading: boolean (true initially, false on iframe onLoad)
error: boolean (false initially, true on iframe onError)
phoneFrame: boolean (default true if subtype === 'storybook', false otherwise)
iframeRef: React.RefObject<HTMLIFrameElement>
```

#### `handleRefresh()`
```
1. Set loading = true, error = false
2. iframeRef.current.src = iframeRef.current.src (force reload)
```

#### `handleDelete()`
```
1. Call onDelete(embed.id)
```

#### Render
```
1. Title bar: embed icon, embed.name, action buttons
   - If storybook: [Phone toggle] [Refresh] [Delete]
   - If generic: [Delete]
2. Content area:
   - If loading: spinner overlay
   - If error: error state with retry button
   - If phoneFrame: PhoneFrameWrapper (411x823px, dark bg, rounded border) > iframe
   - Else: full-size iframe
3. iframe props:
   - src: embed.url
   - sandbox: "allow-scripts allow-same-origin allow-popups"
   - onLoad: () => setLoading(false)
   - onError: () => { setLoading(false); setError(true) }
   - width/height: embed.width || '100%', embed.height || '100%'
```

---

### App.tsx Main Content Routing

#### Add to `selectedItem` useMemo
```
After existing checks (diagram, document, design, spreadsheet, snippet):
if (selectedEmbedId) {
  const embed = embeds.find(e => e.id === selectedEmbedId);
  if (embed) return { id: embed.id, name: embed.name, type: 'embed' as const };
}
```

#### Add to `renderMainContent`
```
After taskGraphSelected check, before UnifiedEditor fallback:
if (selectedEmbedId) {
  const embed = embeds.find(e => e.id === selectedEmbedId);
  if (embed) return <EmbedViewer embed={embed} onDelete={handleDeleteEmbed} />;
}
```

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: backend-types
    files: [src/types.ts]
    tests: []
    description: "Add Embed, EmbedMeta, EmbedListItem interfaces to backend types"
    parallel: true
    depends-on: []

  - id: embed-manager
    files: [src/services/embed-manager.ts, src/services/__tests__/embed-manager.test.ts]
    tests: [src/services/__tests__/embed-manager.test.ts]
    description: "Create EmbedManager class with create, list, get, delete, initialize methods"
    parallel: false
    depends-on: [backend-types]

  - id: websocket-events
    files: [src/websocket/handler.ts]
    tests: []
    description: "Add embed_created and embed_deleted to WSMessage union type"
    parallel: true
    depends-on: [backend-types]

  - id: api-routes
    files: [src/routes/api.ts]
    tests: []
    description: "Add 3 REST routes (POST create, GET list, DELETE remove) with WS broadcast"
    parallel: false
    depends-on: [embed-manager, websocket-events]

  - id: mcp-tools-generic
    files: [src/mcp/tools/embed.ts, src/mcp/setup.ts]
    tests: []
    description: "Add create_embed, list_embeds, delete_embed MCP tool schemas and handlers"
    parallel: false
    depends-on: [api-routes]

  - id: mcp-tools-storybook
    files: [src/mcp/tools/embed.ts, src/mcp/setup.ts]
    tests: []
    description: "Add create_storybook_embed and list_storybook_stories MCP tools"
    parallel: false
    depends-on: [mcp-tools-generic]

  - id: frontend-types
    files: [ui/src/types/embed.ts]
    tests: []
    description: "Create frontend Embed and StorybookMetadata TypeScript interfaces"
    parallel: true
    depends-on: []

  - id: frontend-store
    files: [ui/src/stores/sessionStore.ts]
    tests: []
    description: "Add embeds[], selectedEmbedId, selectEmbed(), addEmbed(), removeEmbed() with mutual-exclusion"
    parallel: false
    depends-on: [frontend-types]

  - id: frontend-api
    files: [ui/src/api/embeds.ts]
    tests: []
    description: "Create API client with fetchEmbeds() and deleteEmbed() functions"
    parallel: true
    depends-on: [frontend-types]

  - id: embed-viewer
    files: [ui/src/components/EmbedViewer.tsx]
    tests: []
    description: "Create iframe viewer with loading/error states, phone frame toggle, refresh button for Storybook"
    parallel: false
    depends-on: [frontend-types, frontend-store]

  - id: sidebar-section
    files: [ui/src/components/layout/Sidebar.tsx]
    tests: []
    description: "Add collapsible Embeds section following Blueprints inline pattern"
    parallel: false
    depends-on: [frontend-store]

  - id: app-routing
    files: [ui/src/App.tsx]
    tests: []
    description: "Add selectedEmbedId to selectedItem resolution and EmbedViewer render branch"
    parallel: false
    depends-on: [embed-viewer, frontend-store]

  - id: websocket-ui
    files: [ui/src/stores/sessionStore.ts]
    tests: []
    description: "Handle embed_created and embed_deleted WebSocket events in frontend store"
    parallel: false
    depends-on: [frontend-store, websocket-events]
```

### Execution Waves

**Wave 1 (parallel):**
- `backend-types` — Add Embed interfaces to src/types.ts
- `frontend-types` — Create ui/src/types/embed.ts
- `frontend-api` — Create ui/src/api/embeds.ts

**Wave 2 (parallel):**
- `embed-manager` — Create EmbedManager class (depends: backend-types)
- `websocket-events` — Add WS event types (depends: backend-types)
- `frontend-store` — Add embed state to sessionStore (depends: frontend-types)

**Wave 3 (parallel):**
- `api-routes` — Add REST routes (depends: embed-manager, websocket-events)
- `embed-viewer` — Create EmbedViewer component (depends: frontend-types, frontend-store)
- `sidebar-section` — Add collapsible section (depends: frontend-store)
- `websocket-ui` — Handle WS events in frontend (depends: frontend-store, websocket-events)

**Wave 4 (parallel):**
- `mcp-tools-generic` — Add 3 generic MCP tools (depends: api-routes)
- `app-routing` — Wire EmbedViewer into App.tsx (depends: embed-viewer, frontend-store)

**Wave 5:**
- `mcp-tools-storybook` — Add 2 Storybook MCP tools (depends: mcp-tools-generic)

### Summary
- Total tasks: 13
- Total waves: 5
- Max parallelism: 4 (Wave 3)