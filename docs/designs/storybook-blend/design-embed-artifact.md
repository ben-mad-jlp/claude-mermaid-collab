# Design: Embed Artifact Type

A lightweight, read-only artifact type for embedding external URLs (Storybook stories, dashboards, docs, etc.) as iframes in the collab UI sidebar.

**Scope:** Create, list, delete only. NO history, revert, patch, update, edit, or versioning.

**Layered approach:** A generic Embed base type (phase 1) plus a Storybook subtype with domain-specific features (phase 2). Both share the same Manager, storage, sidebar section, and viewer. The Storybook subtype is just an embed with extra metadata and convenience tools.

---

## 1. Data Model

### Backend Type (`src/types.ts`)

```typescript
export interface Embed {
  id: string;           // nanoid
  name: string;         // Display name (e.g., "LoginScreen Story")
  url: string;          // Full URL to embed
  subtype?: 'storybook' | undefined;  // undefined = generic embed
  width?: string;       // Optional iframe width (e.g., "100%", "411px")
  height?: string;      // Optional iframe height (e.g., "100%", "823px")
  createdAt: string;    // ISO 8601 timestamp
  // Storybook-specific metadata (only when subtype === 'storybook')
  storybook?: {
    storyId: string;    // Storybook story ID (e.g., "features-picking-pickingscreen--default")
    port: number;       // Storybook dev server port (default: 6006)
  };
}
```

### Frontend Type (`ui/src/types/embed.ts`)

```typescript
export interface StorybookMetadata {
  storyId: string;
  port: number;
}

export interface Embed {
  id: string;
  name: string;
  url: string;
  subtype?: 'storybook';
  width?: string;
  height?: string;
  createdAt: string;
  storybook?: StorybookMetadata;
}
```

### Storage

- Path: `{project}/.collab/sessions/{session}/embeds/{id}.json`
- Each embed is a single JSON file containing the `Embed` object
- Index file: `{project}/.collab/sessions/{session}/embeds/index.json` (array of `{ id, name, url, subtype?, createdAt }`)

---

## 2. Backend: Manager Class

### File: `src/services/embed-manager.ts`

Stripped-down manager following the snippet-manager pattern but with only 3 operations.

```typescript
import { Embed } from '../types';
import { nanoid } from 'nanoid';
import fs from 'fs-extra';
import path from 'path';

export class EmbedManager {
  private getEmbedsDir(project: string, session: string): string;
  private getEmbedPath(project: string, session: string, id: string): string;
  private getIndexPath(project: string, session: string): string;

  // Read/write index
  private async readIndex(project: string, session: string): Promise<Embed[]>;
  private async writeIndex(project: string, session: string, embeds: Embed[]): Promise<void>;

  // Public API — only 3 methods
  async create(project: string, session: string, params: {
    name: string;
    url: string;
    subtype?: 'storybook';
    width?: string;
    height?: string;
    storybook?: { storyId: string; port: number };
  }): Promise<Embed>;

  async list(project: string, session: string): Promise<Embed[]>;

  async delete(project: string, session: string, id: string): Promise<void>;
}
```

**Key differences from snippet-manager:**
- No `update()` method
- No `getHistory()` or `revert()` methods
- No version tracking or content diffing
- No `patch()` method
- The JSON file is written once and never modified — only created or deleted

---

## 3. MCP Tools

### File to modify: `src/mcp/setup.ts`

### Phase 1: Generic Embed Tools (3 tools)

Follow exact pattern of existing tools (e.g., `create_snippet`, `list_snippets`, `delete_snippet`).

#### `create_embed`

```typescript
{
  name: 'create_embed',
  description: 'Create a new embed (iframe) artifact for viewing an external URL in the collab UI.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to the project root directory' },
      session: { type: 'string', description: 'Session name' },
      name: { type: 'string', description: 'Display name for the embed' },
      url: { type: 'string', description: 'URL to embed (must be a valid http/https URL)' },
      width: { type: 'string', description: 'Optional iframe width (e.g., "100%", "411px")' },
      height: { type: 'string', description: 'Optional iframe height (e.g., "100%", "823px")' },
    },
    required: ['project', 'name', 'url'],
  },
}
```

Returns: `{ id, name, url, width?, height?, createdAt, previewUrl }`

#### `list_embeds`

```typescript
{
  name: 'list_embeds',
  description: 'List all embeds in the current session.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to the project root directory' },
      session: { type: 'string', description: 'Session name' },
    },
    required: ['project'],
  },
}
```

Returns: Array of `{ id, name, url, subtype?, createdAt }`

#### `delete_embed`

```typescript
{
  name: 'delete_embed',
  description: 'Delete an embed by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to the project root directory' },
      session: { type: 'string', description: 'Session name' },
      id: { type: 'string', description: 'Embed ID to delete' },
    },
    required: ['project', 'id'],
  },
}
```

Returns: `{ deleted: true }`

### Phase 2: Storybook Subtype Tools (2 additional tools)

#### `create_storybook_embed`

Convenience tool that resolves a Storybook story ID to a full iframe URL, sets subtype to `'storybook'`, and stores the storyId in metadata. Default port 6006.

```typescript
{
  name: 'create_storybook_embed',
  description: 'Create an embed for a Storybook story. Resolves storyId to a full iframe URL and stores Storybook metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to the project root directory' },
      session: { type: 'string', description: 'Session name' },
      name: { type: 'string', description: 'Display name for the embed' },
      storyId: { type: 'string', description: 'Storybook story ID (e.g., "features-picking-pickingscreen--default")' },
      port: { type: 'number', description: 'Storybook dev server port (default: 6006)' },
    },
    required: ['project', 'name', 'storyId'],
  },
}
```

**Handler logic:**
1. Default `port` to `6006` if not provided
2. Construct URL: `http://localhost:{port}/iframe.html?id={storyId}&viewMode=story`
3. Call `embedManager.create()` with:
   - `url`: the constructed URL
   - `subtype`: `'storybook'`
   - `storybook`: `{ storyId, port }`

Returns: `{ id, name, url, subtype: 'storybook', storybook: { storyId, port }, createdAt, previewUrl }`

#### `list_storybook_stories`

Hits Storybook's `index.json` endpoint to list all available stories. Storybook 7+ serves a story index at `http://localhost:<port>/index.json` containing all registered stories with their IDs, titles, and component paths.

```typescript
{
  name: 'list_storybook_stories',
  description: 'List all available stories from a running Storybook dev server by querying its index.json endpoint.',
  inputSchema: {
    type: 'object',
    properties: {
      port: { type: 'number', description: 'Storybook dev server port (default: 6006)' },
    },
    required: [],
  },
}
```

**Handler logic:**
1. Default `port` to `6006` if not provided
2. Fetch `http://localhost:{port}/index.json`
3. Parse the response — Storybook's index.json has shape:
   ```json
   {
     "v": 5,
     "entries": {
       "features-picking-pickingscreen--default": {
         "id": "features-picking-pickingscreen--default",
         "title": "Features/Picking/PickingScreen",
         "name": "Default",
         "type": "story",
         "importPath": "./src/features/picking/__stories__/PickingScreen.stories.tsx"
       }
     }
   }
   ```
4. Filter to entries where `type === 'story'` (exclude `docs` entries)
5. Return array of `{ id, title, name, importPath }`

**Error handling:** If fetch fails (Storybook not running), return a clear error: `"Could not reach Storybook at http://localhost:{port}. Is the dev server running?"`

Returns: Array of `{ id, title, name, importPath }`

---

## 4. API Routes

### File to modify: `src/routes/api.ts`

Add 3 routes following existing patterns:

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/api/sessions/:session/embeds` | `embedManager.create()` | Create embed. Body: `{ name, url, subtype?, width?, height?, storybook? }` |
| `GET` | `/api/sessions/:session/embeds` | `embedManager.list()` | List all embeds |
| `DELETE` | `/api/sessions/:session/embeds/:id` | `embedManager.delete()` | Delete embed by ID |

No PUT/PATCH routes needed.

---

## 5. WebSocket Events

### File to modify: `src/websocket/types.ts`

Add 2 event types (no `updated` event since embeds are immutable):

```typescript
// Add to WebSocket event types
export interface EmbedCreatedEvent {
  type: 'embed_created';
  payload: {
    session: string;
    embed: Embed;
  };
}

export interface EmbedDeletedEvent {
  type: 'embed_deleted';
  payload: {
    session: string;
    id: string;
  };
}
```

### File to modify: `src/websocket/handler.ts`

- Emit `embed_created` after `embedManager.create()` succeeds
- Emit `embed_deleted` after `embedManager.delete()` succeeds

---

## 6. Frontend: Zustand Store

### Option A: Dedicated store (if embeds stay isolated)

**File to create:** `ui/src/stores/embed-store.ts`

```typescript
import { create } from 'zustand';
import { Embed } from '../types/embed';

interface EmbedStore {
  embeds: Embed[];
  selectedEmbedId: string | null;

  // Actions
  setEmbeds: (embeds: Embed[]) => void;
  addEmbed: (embed: Embed) => void;
  removeEmbed: (id: string) => void;
  selectEmbed: (id: string | null) => void;
  clearEmbed: () => void;
}

export const useEmbedStore = create<EmbedStore>((set) => ({
  embeds: [],
  selectedEmbedId: null,

  setEmbeds: (embeds) => set({ embeds }),
  addEmbed: (embed) => set((state) => ({
    embeds: [...state.embeds, embed],
  })),
  removeEmbed: (id) => set((state) => ({
    embeds: state.embeds.filter((e) => e.id !== id),
    selectedEmbedId: state.selectedEmbedId === id ? null : state.selectedEmbedId,
  })),
  selectEmbed: (id) => set({ selectedEmbedId: id }),
  clearEmbed: () => set({ selectedEmbedId: null }),
}));
```

### Option B: Add to existing sessionStore (preferred — matches sidebar selection patterns)

**File to modify:** `ui/src/stores/sessionStore.ts`

Add to the existing store state and actions:

```typescript
// State
selectedEmbedId: string | null;
embeds: Embed[];

// Actions
selectEmbed: (id: string) => void;   // Sets selectedEmbedId, clears other selections
clearEmbed: () => void;              // Sets selectedEmbedId to null
setEmbeds: (embeds: Embed[]) => void;
addEmbed: (embed: Embed) => void;
removeEmbed: (id: string) => void;
```

The `selectEmbed()` action should clear other selections (selectedDocumentId, selectedDiagramId, taskGraphSelected, etc.) — same mutual-exclusion pattern used by `selectDocumentWithContent()` and `selectTaskGraph()`.

---

## 7. Frontend: UI Components

### 7a. Sidebar Section — Collapsible "Embeds"

**File to modify:** `ui/src/components/layout/Sidebar.tsx`

The sidebar does NOT use `CollapsibleSection` or `CollapsibleDetails` components. Those are for the markdown editor. Instead, the sidebar uses an **inline pattern** with local `useState` booleans — the same pattern used by the Tasks section (lines 436-492) and Blueprints section (lines 494-537).

#### State

Add to existing `useState` declarations (around line 93-94):

```tsx
const [embedsCollapsed, setEmbedsCollapsed] = useState(false);
```

#### Compute embed items

Embed items must be filtered OUT of the main `filteredItems` list to avoid duplication (same pattern as blueprints being filtered out of regular items):

```tsx
const embedItems = useMemo(() => {
  return embeds; // From store — embeds are their own type, not filtered documents
}, [embeds]);
```

#### JSX — insert after Blueprints section, before the main Items list (around line 537)

Follow the exact inline pattern used by Tasks and Blueprints:

```tsx
{embedItems.length > 0 && !isDisabled && (
  <div className="border-b border-gray-200 dark:border-gray-700">
    {/* Header button — toggles collapsed state */}
    <button
      onClick={() => setEmbedsCollapsed((c) => !c)}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      <span>Embeds</span>
      <span className="ml-1 text-gray-400">{embedItems.length}</span>
      <svg
        className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${embedsCollapsed ? '-rotate-90' : ''}`}
        viewBox="0 0 20 20" fill="currentColor"
      >
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    </button>
    {/* Content — conditionally rendered (no animation, just toggle) */}
    {!embedsCollapsed && (
      <div className="space-y-1 px-2 pb-2">
        {embedItems.map((embed) => (
          <button
            key={embed.id}
            onClick={() => selectEmbed(embed.id)}
            className={`w-full text-left px-2 py-1.5 rounded text-sm truncate ${
              selectedEmbedId === embed.id
                ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <div className="truncate">{embed.name}</div>
            <div className="text-xs text-gray-400 truncate">
              {embed.subtype === 'storybook'
                ? embed.storybook?.storyId
                : embed.url}
            </div>
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

#### Key design details (matching existing sidebar patterns)

- **Chevron rotation:** Down arrow (default) rotates to `-rotate-90` (pointing right) when collapsed
- **No animation on content:** Content toggled via conditional render (`{!embedsCollapsed && ...}`), not animated height
- **Section header styling:** `text-xs font-semibold` — smaller than item text
- **Border:** Section wrapped in `border-b` div for visual separation
- **Item count badge:** Shows `embedItems.length` in gray, same as Blueprints section
- **Selection highlight:** Uses same accent classes as all sidebar items: `bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300`
- **Subtitle:** Storybook embeds show `storybook.storyId`, generic embeds show truncated URL

#### Section rendering order in sidebar

1. Todo controls (when `todosSelected`)
2. Vibe Instructions (pinned document)
3. **Tasks** (collapsible, when `isImplementationPhase`)
4. **Blueprints** (collapsible, when blueprint docs exist)
5. **Embeds** (collapsible, when embeds exist) -- NEW
6. **Items** (scrollable list with search)

### 7b. Embed Viewer (Main Content Area)

**File to create:** `ui/src/components/EmbedViewer.tsx`

Renders when an embed is selected. The viewer checks `embed.subtype` and shows extra controls for Storybook embeds.

#### Generic Embed Viewer

```
+------------------------------------------+
| [Embed Icon] Embed Name        [Delete]  |  <- Title bar
+------------------------------------------+
|                                          |
|              <iframe>                    |  <- Full remaining height
|              loading...                  |
|                                          |
+------------------------------------------+
```

#### Storybook Embed Viewer (subtype === 'storybook')

```
+--------------------------------------------------+
| [SB Icon] Embed Name   [Phone] [Refresh] [Delete]|  <- Title bar with extra controls
+--------------------------------------------------+
|                                                  |
|         +-------------------+                    |
|         |   +-----------+   |                    |  <- Phone frame (when toggled on)
|         |   |           |   |                    |
|         |   |  <iframe> |   |                    |
|         |   |           |   |                    |
|         |   +-----------+   |                    |
|         +-------------------+                    |
|                                                  |
+--------------------------------------------------+
```

Component structure:

```typescript
const EmbedViewer: React.FC<{ embed: Embed }> = ({ embed }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [phoneFrame, setPhoneFrame] = useState(embed.subtype === 'storybook');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isStorybook = embed.subtype === 'storybook';

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src; // Force reload
      setLoading(true);
      setError(false);
    }
  };

  return (
    <div className="embed-viewer">
      {/* Title bar */}
      <div className="embed-viewer-header">
        <span className="embed-viewer-title">{embed.name}</span>
        <div className="embed-viewer-actions">
          {isStorybook && (
            <>
              <button
                onClick={() => setPhoneFrame(!phoneFrame)}
                className={`embed-viewer-phone-toggle ${phoneFrame ? 'active' : ''}`}
                title="Toggle phone frame"
              >
                Phone
              </button>
              <button onClick={handleRefresh} title="Refresh iframe">
                Refresh
              </button>
            </>
          )}
          <button onClick={handleDelete} className="embed-viewer-delete">Delete</button>
        </div>
      </div>

      {/* Content area */}
      <div className={`embed-viewer-content ${phoneFrame ? 'phone-frame' : ''}`}>
        {loading && <LoadingSpinner />}
        {error && <ErrorState url={embed.url} onRetry={handleRefresh} />}
        {phoneFrame ? (
          <PhoneFrameWrapper>
            <iframe ref={iframeRef} ... />
          </PhoneFrameWrapper>
        ) : (
          <iframe ref={iframeRef} ... />
        )}
      </div>
    </div>
  );
};
```

#### Phone Frame Wrapper

Mirrors the QBS Storybook preview decorator. Default dimensions: 411x823px (Pixel 3).

```typescript
const PhoneFrameWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    backgroundColor: '#1f2937',
    padding: '20px',
  }}>
    <div style={{
      width: '411px',
      height: '823px',
      border: '8px solid #374151',
      borderRadius: '32px',
      overflow: 'hidden',
      backgroundColor: '#fff',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    }}>
      {children}
    </div>
  </div>
);
```

These dimensions and styles come directly from the QBS Storybook preview config at `qbs_scanner_react/.storybook/preview.ts`, which uses a `phoneFrame` decorator with Pixel 3 as the default viewport.

### 7c. Main Content Area Routing

**File to modify:** The main content/editor component that decides what to render based on the selected artifact.

The main content area checks `selectedEmbedId` from the store. If set, it renders the `EmbedViewer` instead of the document/diagram editor. This follows the same priority pattern as `taskGraphSelected`:

```typescript
// In the main content routing logic — add BEFORE document/diagram checks
const { selectedEmbedId, embeds } = useEmbedStore(); // or from sessionStore

if (selectedEmbedId) {
  const embed = embeds.find(e => e.id === selectedEmbedId);
  if (embed) return <EmbedViewer embed={embed} />;
}

// ... existing document/diagram/design routing below
```

**Click behavior chain:** Clicking an embed in the sidebar calls `selectEmbed(id)` which:
1. Sets `selectedEmbedId` in the store
2. Clears other selections (`selectedDocumentId`, `selectedDiagramId`, `taskGraphSelected`, etc.)
3. Main content area re-renders, hits the `selectedEmbedId` check, shows `<EmbedViewer />`

For **Storybook subtypes**: the viewer shows phone frame toggle + refresh button in the toolbar.
For **generic embeds**: simple iframe with title bar and delete button.

### 7d. WebSocket Integration

**File to modify:** The WebSocket event handler in the UI (wherever other artifact WS events are handled).

```typescript
case 'embed_created':
  useEmbedStore.getState().addEmbed(event.payload.embed);
  break;
case 'embed_deleted':
  useEmbedStore.getState().removeEmbed(event.payload.id);
  break;
```

### 7e. API Client

**File to create:** `ui/src/api/embeds.ts`

```typescript
export async function fetchEmbeds(session: string): Promise<Embed[]>;
export async function deleteEmbed(session: string, id: string): Promise<void>;
```

Note: `createEmbed` is not needed in the API client since embeds are created via MCP tools, not the UI. Only list (for initial load) and delete (for the UI delete button) are needed.

---

## 8. Complete File Manifest

### Files to CREATE (6 files)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/services/embed-manager.ts` | Backend manager (create, list, delete) |
| 2 | `ui/src/types/embed.ts` | Frontend TypeScript interface (includes StorybookMetadata) |
| 3 | `ui/src/components/EmbedViewer.tsx` | Main content iframe viewer (with phone frame + refresh for Storybook) |
| 4 | `ui/src/api/embeds.ts` | API client (fetchEmbeds, deleteEmbed) |
| 5 | `src/services/__tests__/embed-manager.test.ts` | Unit tests for manager |
| 6 | `ui/src/components/__tests__/EmbedViewer.test.tsx` | Component tests |

Note: No separate `EmbedSection.tsx` or `embed-store.ts` — the sidebar section is inline JSX in `Sidebar.tsx` (matching Tasks/Blueprints pattern), and embed state lives in the existing `sessionStore.ts`.

### Files to MODIFY (8 files)

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add `Embed` interface with `subtype` and `storybook` fields |
| 2 | `src/mcp/setup.ts` | Add 5 MCP tool definitions + handlers (3 generic + 2 Storybook) |
| 3 | `src/routes/api.ts` | Add 3 API routes (POST, GET, DELETE) |
| 4 | `src/websocket/types.ts` | Add `EmbedCreatedEvent`, `EmbedDeletedEvent` |
| 5 | `src/websocket/handler.ts` | Emit embed events on create/delete |
| 6 | `ui/src/components/layout/Sidebar.tsx` | Add `embedsCollapsed` state, embed section JSX (inline, between Blueprints and Items), filter embeds from items |
| 7 | `ui/src/stores/sessionStore.ts` | Add `selectedEmbedId`, `embeds[]`, `selectEmbed()`, `clearEmbed()`, `setEmbeds()`, `addEmbed()`, `removeEmbed()` actions |
| 8 | Main content/editor component | Add embed viewer rendering branch (check `selectedEmbedId` before document/diagram routing) |
| 9 | UI WebSocket handler | Handle `embed_created` / `embed_deleted` events |

---

## 9. Implementation Order (Vertical Slice)

Build in this order so each step produces a testable increment:

### Phase 1: Generic Embed — Backend Core (can test via MCP tools immediately)
1. Add `Embed` interface to `src/types.ts` (with subtype + storybook fields from the start)
2. Create `src/services/embed-manager.ts` with create/list/delete
3. Add 3 generic MCP tools to `src/mcp/setup.ts` (`create_embed`, `list_embeds`, `delete_embed`)
4. **Test:** Use MCP tools to create, list, delete embeds. Verify JSON files on disk.

### Phase 2: Generic Embed — API + WebSocket
5. Add 3 API routes to `src/routes/api.ts`
6. Add WebSocket event types to `src/websocket/types.ts`
7. Wire WebSocket emissions in `src/websocket/handler.ts`
8. **Test:** Hit API routes with curl. Verify WS events fire.

### Phase 3: Generic Embed — Frontend
9. Create `ui/src/types/embed.ts`
10. Create `ui/src/stores/embed-store.ts`
11. Create `ui/src/api/embeds.ts`
12. Create `ui/src/components/EmbedSection.tsx` (sidebar)
13. Create `ui/src/components/EmbedViewer.tsx` (iframe viewer, generic mode only)
14. Wire into sidebar parent and main content router
15. Wire WebSocket event handlers
16. **Test:** Create embed via MCP, see it appear in sidebar, click to view iframe.

### Phase 4: Storybook Subtype
17. Add `create_storybook_embed` MCP tool (constructs URL from storyId + port)
18. Add `list_storybook_stories` MCP tool (fetches index.json from running Storybook)
19. Add phone frame toggle to EmbedViewer (when `subtype === 'storybook'`)
20. Add refresh button to EmbedViewer (when `subtype === 'storybook'`)
21. Show storyId subtitle in sidebar for Storybook embeds
22. **Test:** Start Storybook, use `list_storybook_stories` to discover stories, create a Storybook embed, view it with phone frame toggle.

### Phase 5: Polish
23. Add loading spinner and error state to EmbedViewer
24. Add delete confirmation dialog
25. Add unit tests for embed-manager
26. Add component tests for EmbedViewer

---

## 10. Design Decisions

**Why a layered approach?** Generic embeds (phase 1) work for any URL — dashboards, docs, deployed apps. Storybook subtype (phase 2) adds convenience tools and UI features that only make sense for Storybook. Both share the same storage, manager, sidebar, and viewer. This avoids premature abstraction while keeping the door open for other subtypes (e.g., `'figma'`, `'grafana'`) later.

**Why no update?** Embeds are URL bookmarks. If the URL is wrong, delete and recreate. This eliminates history/versioning complexity entirely.

**Why `sandbox` attribute on iframe?** Security. `allow-scripts allow-same-origin allow-popups` is the minimum needed for Storybook and most web apps to function.

**Why no `createEmbed` in the UI API client?** Embeds are created by Claude via MCP tools, not by users clicking a button. The UI only needs to fetch the list and delete.

**Why an index file?** Consistent with the existing pattern. Avoids reading every JSON file in the directory for list operations.

**Width/height changed from number to string?** Allows both percentage values (`"100%"`) and pixel values (`"411px"`). More flexible than a raw number that assumes pixels.

**Why index.json for story discovery?** Storybook 7+ serves a story index at `http://localhost:<port>/index.json` containing all registered stories. This is the standard, stable API for programmatic story discovery — no scraping or file system analysis needed. The QBS project already uses `@storybook/addon-mcp` which may also leverage this endpoint.

**Phone frame dimensions?** 411x823px (Pixel 3) matches the QBS project's default Storybook viewport defined in `qbs_scanner_react/.storybook/preview.ts`. The phone frame wrapper mirrors the `phoneFrame` decorator styling (dark background, rounded border, box shadow) so the embedded view looks identical to what developers see in Storybook directly.

**Why a refresh button?** During development, Claude edits story source files and the developer wants to see the result immediately. The refresh button forces the iframe to reload without needing to delete and recreate the embed.
