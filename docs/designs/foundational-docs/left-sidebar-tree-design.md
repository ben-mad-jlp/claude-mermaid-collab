# Left Sidebar Redesign — Unified Artifact Tree

Redesign the collab UI left sidebar so that all artifact sections render inside a single file-viewer-style tree with consistent expand/collapse, iconography, and selection behavior. The **Watching** (subscriptions) panel and the **Vibe Instructions** pinned entry stay outside the tree in their current form.

## 1. Current state

Primary file: `ui/src/components/layout/Sidebar.tsx` (single ~980-line component that owns all left-bar rendering). Mounted from `ui/src/App.tsx:1539` (`<Sidebar className="h-full" />`). Exported via `ui/src/components/layout/index.ts:17`.

### Inventory of current left-bar sections

Rendering order top → bottom in `Sidebar.tsx`:

| # | Section | Source lines | Data source (store) | Rendered via | Notes |
|---|---------|--------------|---------------------|--------------|-------|
| 1 | **Vibe Instructions** (pinned button) | 509–530 | `documents` filtered in `vibeInstructionsDoc` memo at 387–389 (name ends with `vibeinstructions`) | inline `<button>` | **Keep as-is (exception)**. Opens via `handleItemClick` → `selectDocumentWithContent`. |
| 2 | **Watching** (`SubscriptionsPanel`) | 532 | `useSubscriptionStore` + `useSessionStore.sessions` (see `SubscriptionsPanel.tsx:107–166`) | external component `SubscriptionsPanel.tsx` | **Keep as-is (exception)**. |
| 3 | **Tasks** (Task Graph + Task Details) | 534–591 | `taskGraphSelected` + `collabState` (for `isImplementationPhase`) + `taskGraphDoc` (docs with `name === 'task-graph'`, memo 391–393) | inline collapsible section (`tasksCollapsed` state) | Only visible when `isImplementationPhase` (has batches AND blueprints). Entries: "Task Graph" (calls `selectTaskGraph`) and "Task Details" (opens the `task-graph` document). |
| 4 | **Blueprints** | 593–654 | `blueprintItems` memo 395–402 (documents with `.blueprint === true`, not vibeinstructions, not deprecated) | inline collapsible section (`blueprintCollapsed`) | Custom row UI with deprecate-blueprint confirm (clears task graph on deprecate). |
| 5 | **Todos** (`SessionTodosSection`) | 657 | `useSessionStore.sessionTodos` + related setters (see `SessionTodosSection.tsx:150–169`) | external component with internal collapsible + add/edit/drag-reorder + show-completed toggle + Clear Completed dialog | Loaded by `loadSessionItems`-adjacent flow; see fetch note at `sessionStore.ts:265`. |
| 6 | **Embeds** | 660–711 | `embeds`, `selectedEmbedId`, `selectEmbed`, `removeEmbed` from store | inline collapsible (`embedsCollapsed`) | Custom row shows name + storyId/url subtitle. DELETE via fetch at lines 126–129 (not through `api.ts`). |
| 7 | **Images** | 713–757 | `images`, `selectedImageId`, `selectImage`, `removeImage` | inline collapsible (`imagesCollapsed`) rendering `ItemCard` per image | `max-h-80 overflow-y-auto`. Uses full-card `ItemCard` layout. |
| 8 | **Code Files** | 759–841 | `linkedSnippets` memo 351–385 (snippets whose envelope `linked === true`) + action buttons (global search, link new file via `FileBrowserDialog`) | inline collapsible (`codeFilesCollapsed`) | Always visible (even with empty state "No linked code files"). Rows show filename + filepath + dirty dot. |
| 9 | **Items** (catch-all grid: diagrams, documents non-blueprint non-vibeinstructions non-task-graph, designs, spreadsheets, non-linked snippets) | 843–925 | `filteredItems` memo 404–470 (merges 5 artifact arrays, applies pinned-first sort, deprecated filter, search filter) | `ItemCard` grid (`space-y-2`) | Section header has an **Import** button and a **Search** input + `Show deprecated` checkbox. |

Support state/callbacks: `handleItemClick` (294–313) routes by `item.type` to the appropriate `select*WithContent` from `useDataLoader`. `isItemSelected` (472–482) picks the right `selected*Id` per type. Delete/deprecate/pin/download/email/import handlers 111–292.

### Data fetching

All top-level artifact lists (except todos/subscriptions/collabState) are fetched in one Promise.all in `ui/src/hooks/useDataLoader.ts:130–146` (`loadSessionItems`):
```
diagrams, documents, designs, spreadsheets, snippets, embeds, images
```
Embeds use `embedsApi.fetchEmbeds(session, project)`; rest use `api.*`. Session todos are fetched fire-and-forget when currentSession changes (`stores/sessionStore.ts:~265`). Subscriptions use their own `useSubscriptionStore`. `collabState` loaded inside `loadCollabState` (useDataLoader:108–119). Task-graph document is just the `documents` entry with `name === 'task-graph'`.

### Routing / selection

Selection is *per-type* in `sessionStore`: `selectedDiagramId`, `selectedDocumentId`, `selectedDesignId`, `selectedSpreadsheetId`, `selectedSnippetId`, `selectedImageId`, `selectedEmbedId`, plus boolean `taskGraphSelected`. There is no unified "selected artifact" concept — each editor/viewer reads its own slot. The Sidebar's `handleItemClick` dispatches by `item.type`.

## 2. Proposed tree

Two standalone panels remain at the top of the sidebar, in this order:

1. **Vibe Instructions** — unchanged pinned button row.
2. **Watching** — unchanged `SubscriptionsPanel`.

Below them, a single unified **Artifact Tree** component replaces sections 3–9 above. The tree header is a compact strip with three controls (left→right):

- **Search input** (global — see §2b)
- **Upload / Import** button (single control, dispatches by file type — see §2c)
- **Show deprecated** toggle

Top-level tree nodes (only rendered when their section has content, except where noted):

```
Artifacts
│  [Search box] [Upload / Import ▲] [Show deprecated ☐]
├── Pins                         (any artifact with `pinned === true` — visible when non-empty)
│   └── <pinned artifact>        (icon reflects artifact type)
├── Tasks                        (visible when isImplementationPhase)
│   ├── Task Graph               (virtual node → selectTaskGraph)
│   └── Task Details             (→ the `task-graph` document)
├── Blueprints                   (documents.blueprint === true, not deprecated)
│   ├── <blueprint name>
│   └── …
├── Todos                          [+]   (header "+" opens inline add input)
│   ├── [inline add input — visible when "+" clicked or draft is non-empty]
│   ├── <todo row with checkbox, drag handle>
│   └── …
├── Embeds                       (embeds[])
│   └── <embed name>
├── Images                       (images[])
│   └── <image name>
├── Code Files                     [+]   (header "+" opens FileBrowserDialog)
│   └── <filename>
├── Diagrams                     (diagrams[])
│   └── <diagram name>
├── Documents                    (non-blueprint, non-vibeinstructions, non-task-graph docs)
│   └── <document name>
├── Designs                      (designs[])
│   └── <design name>
├── Spreadsheets                 (spreadsheets[])
│   └── <spreadsheet name>
└── Snippets                     (non-linked, non-vibeinstructions snippets; deduped by groupId)
    └── <snippet name>
```

**Pins section ordering.** Placed at the top of the tree, above Tasks, so pinned artifacts are always in reach regardless of type. This replaces the v1 proposal to promote pinned-to-top-of-own-section — see §7 open decisions for the "both-or-only-Pins" question. Recommended default: pinned artifacts show in the Pins section **only** while pinned (they disappear from their native type section); unpinning returns them to their type section. This avoids the awkward "double listing" problem in a dense tree. If the user prefers the duplication model, the selector change is a one-line swap.

Default section order: **Pins → Tasks → Blueprints → Todos → Embeds → Images → Code Files → Diagrams → Documents → Designs → Spreadsheets → Snippets**. Mirrors phase-of-work flow with a quick-access Pins row at the top.

Deprecated items: hidden by default; a single **Show deprecated** toggle in the tree header reveals them across all sections (equivalent to today's checkbox).

### 2a. Section-header affordances ("+" add buttons)

The tree introduces consistent per-section inline-add affordances. The general rule:

> **Sections whose items are authored in-place (inline input, or via a dialog that lives in the sidebar today) get a "+" button on their header row. Sections whose items are created elsewhere (via chat, backend, or a main-pane editor flow) do NOT get one.**

| Section | "+" on header? | Behavior on click | Rationale / source of new items |
|---------|----------------|-------------------|---------------------------------|
| Pins | **No** | — | Pinning is an action *on* existing artifacts, not a creation flow. |
| Tasks | **No** | — | Task graph is generated from blueprint execution, never inline. |
| Blueprints | **No** | — | Blueprints are created by the vibe-blueprint flow (agent-authored). |
| **Todos** | **Yes** | Reveals the inline add input and focuses it. Reuses `SessionTodosSection.handleAddTodo` (`newTodoText` state + `api.addSessionTodo`). If the section is collapsed, clicking "+" also expands it. | Already authored inline today. |
| Embeds | **No** | — | Embeds are created via the embed-from-storybook / URL tool flow (not a sidebar dialog). Re-evaluate if an "Add embed" dialog ever lands. |
| Images | **No** | — | Created by paste, drop, or the tree-header **Upload** control (§2c). A per-section "+" would duplicate Upload. |
| **Code Files** | **Yes** | Opens `FileBrowserDialog` (existing `setFileBrowserOpen(true)` path in `Sidebar.tsx:789`). On select → `handleLinkFile` → `api.createSnippet` with `linked: true` → `api.syncCodeFromDisk`. | Already has a link-file dialog in the sidebar today. |
| Diagrams | **No** | — | Created via chat/MCP `create_diagram` or the main-pane new-diagram flow. |
| Documents | **No** | — | Created via chat/MCP `create_document` or Upload. |
| Designs | **No** | — | Created via `create_design` tool or the design editor. |
| Spreadsheets | **No** | — | Created via `create_spreadsheet` tool. |
| Snippets | **No** | — | Created via `create_snippet` tool or Upload (non-code files default to snippet). |

The "+" button is a small icon button on the right side of the section header, appearing before (to the left of) the count badge and chevron. Rendered inside `ArtifactTreeSection`'s `headerActions` slot (see §4a). Hover/focus styles match today's Code-Files action-button styling (`Sidebar.tsx:788–796`). Right-click on the section header does NOT duplicate the "+" action — the context menu is reserved for node-level operations.

**Open to revisit:** if/when in-sidebar dialogs ship for embeds, documents, designs, spreadsheets, or snippets, flip the corresponding row to **Yes** and point its handler at the new dialog. The rule above makes the decision mechanical.

### 2b. Search (global across all sections)

The tree's search input filters the entire tree at once — not per-section. It replaces today's Items-only search (`Sidebar.tsx:864–884`).

- **Scope:** every leaf in every section (Pins, Tasks, Blueprints, Todos, Embeds, Images, Code Files, Diagrams, Documents, Designs, Spreadsheets, Snippets). Section headers themselves are not matched.
- **Match expansion:** any section containing at least one matching descendant is force-expanded while the query is non-empty. When the query is cleared, sections restore to the user's persisted collapsed state.
- **Non-match visibility:** non-matching leaves **hide** by default (clearer at a glance; consistent with today's `filteredItems` behavior). Sections with zero matches collapse to a zero-count empty state; if all sections would be empty, show a single "No matching items" line (mirrors `Sidebar.tsx:905`).
  - Alternative under consideration: **dim** non-matches instead of hiding (keeps spatial context but busier). Flagged in §8.
- **Match fields:**
  - **Names always.** (Covers artifact name, todo text, blueprint name, code-file filename, embed name.)
  - **Content match: default off, feature-flagged on.** Content search crosses artifact-type boundaries (markdown body, snippet code, design JSON node labels, spreadsheet cells). Default v1 scope is **names only** — ship the cross-section behavior first, then add content matching as a follow-up once we decide on:
    1. Whether to hit the server (`mcp__mermaid__pseudo_search` / global-search API) or search in-memory only on currently-loaded content.
    2. How to rate-limit / debounce keystrokes for content search.
  - The feature flag name: `sidebar.tree.searchContent`.
- **Case sensitivity:** case-insensitive, substring match (same as today).
- **State:** `searchQuery` lives in `useSidebarTreeState` (see §4a). NOT persisted across reloads.
- **Keyboard:** `/` inside the sidebar focuses the search input; Escape clears and blurs.

This replaces the paragraph in §2's v1 description — search is now unambiguously global and expansion-preserving.

### 2c. Upload / Import control (tree-top, single-button dispatch)

The existing Import button on the Items section strip (`Sidebar.tsx:854–862`) moves out of that strip and becomes a **single tree-header control** positioned above the Pins section, to the right of the search input.

- One button, labeled **Upload / Import** (icon: up-arrow-to-line). Opens the same hidden `<input type="file">` flow as today (`handleImport` in `Sidebar.tsx:246–268`).
- On file selection, dispatches to the correct create endpoint via `importArtifact(project, session, file)` (`ui/src/lib/importArtifact.ts`), which already contains the type-based dispatch:
  - `.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp/.tif/.tiff` → `POST /api/image` (multipart)
  - `.mmd` → `POST /api/diagram`
  - `.md` → `POST /api/document`
  - `.design.json` → `POST /api/design` (parsed)
  - `.spreadsheet.json` / `.csv` → `POST /api/spreadsheet`
  - everything else (code, text, json, etc.) → `POST /api/snippet`
- The overwrite-confirm UX (`Sidebar.tsx:254–260`) is preserved; move it inside `importArtifact`'s caller so both the tree button and drag-drop share the check.
- **Dispatch logic lives in `ui/src/lib/importArtifact.ts`** (the `detectType` + `importArtifact` pair already encapsulate it). The tree button is a thin wrapper; the DnD handler (§2d) calls the same function.

Rendering: `ArtifactTree` exposes an `onImport` header action; the button is implemented inside `ArtifactTree.tsx` (not inside an individual section), so it's always visible even when every section is empty.

### 2d. Drag-and-drop onto the tree (OS-file import)

Dragging a file from the OS anywhere onto the sidebar tree must import it as an artifact. This extends today's root-level drop handler (`Sidebar.tsx:280–292` + `handleDragOver` at 270–274 + `handleDragLeave` at 276–278).

- **Infrastructure:** continue using native HTML5 drag events (`onDragOver` / `onDragLeave` / `onDrop`). No `react-dropzone` dependency is present in the repo (grep confirmed — only `ui/src/components/ai-ui/inputs/FileUpload.tsx` uses a custom native handler), and introducing it for one panel isn't worth the footprint. Keep native.
- **Targets:**
  - **Root of the tree** (anywhere not hitting a section): dispatch by file extension via `detectType` / `importArtifact`. Same path as the Upload button.
  - **A specific section row** (Images, Documents, Diagrams, Designs, Spreadsheets, Snippets, Code Files): **hint** the target type. The drop hint forces the artifact type regardless of extension, for sections whose type is unambiguous:
    - Drop on **Images** → force `type: 'image'` (reject files whose extension is not in `IMAGE_EXTS`; surface a toast "Can only drop images into the Images section").
    - Drop on **Documents** → force `type: 'document'`; wrap non-`.md` content as markdown.
    - Drop on **Diagrams** → force `type: 'diagram'`.
    - Drop on **Designs** → force `type: 'design'` (reject non-JSON).
    - Drop on **Spreadsheets** → force `type: 'spreadsheet'`.
    - Drop on **Snippets** → force `type: 'snippet'`.
    - Drop on **Code Files** → link as a code-file snippet (`linked: true`) — reuses the `handleLinkFile` envelope path. Only meaningful for local files the backend can resolve by path; for in-browser-only file objects, fall back to regular snippet creation with a toast "File is not linkable; imported as snippet instead."
  - **Drop on section headers that don't accept adds (Tasks, Blueprints, Pins, Embeds, Todos):** fall through to root behavior (type-based detection). No hint.
- **Hover affordance:** while dragging with files, the section under the cursor gets a `ring-2 ring-accent-400` outline and the root gets `ring-2 ring-blue-400 ring-inset` (the existing root style at `Sidebar.tsx:501`). Section-level `onDragOver` must `stopPropagation` so only the innermost target highlights.
- **Implementation sketch:**
  - `ArtifactTree.tsx` owns the root drop (fallback dispatch).
  - `ArtifactTreeSection.tsx` accepts an optional `dropHint?: ArtifactType | 'code-file'` prop; when set, its `onDrop` calls `importArtifact` with `{ forcedType: dropHint }` (new overload on `importArtifact` that bypasses `detectType`).
  - Shared dispatch lives in `ui/src/lib/importArtifact.ts`. Add an optional `forcedType` parameter that short-circuits `detectType`.
- Multi-file drops iterate as today (`Sidebar.tsx:284–291`).

## 3. UX notes

- **Expand/collapse.** Click section row (or chevron) toggles. Shift-click collapses/expands all siblings. Chevron on the left (tree convention), name next, count badge on the right (carries today's `blueprintItems.length`-style count).
- **Persistence of open state.** Persist `Set<sectionId>` collapsed state in `localStorage` under key `collab.sidebar.tree.collapsed.v1`. Also persist `showDeprecated` as `collab.sidebar.tree.showDeprecated.v1`. Tree header search query is NOT persisted.
- **Iconography.** Reuse `getItemIcon` from `ItemCard.tsx:134–237` for per-type leaf icons (diagram, document, design, spreadsheet, snippet, embed, image). Section headers: Pins → pin icon; Tasks → bar-chart; Blueprints → book-pair; Todos → checkbox; Code Files → `</>` monospace; others → folder.
- **Active item highlighting.** Use today's `accent-100/900 bg + accent-700/300 text` on the selected leaf; no ring/border (tree rows are more compact than `ItemCard`).
- **Hover behavior.** Row bg `hover:bg-gray-100 dark:hover:bg-gray-800`. Hover no longer reveals inline action buttons — actions move to the right-click context menu (see §4b). Retain only the "close/delete" affordance on tabs (see §4a).
- **Empty-state behavior.** Hide the section when empty, except Code Files and Todos which always show when a session is active. Pins hides when no pinned artifacts exist.
- **Drag/reorder.** Todos keep intra-section drag-reorder. Artifacts do NOT support reorder today and will not in v1.
- **Keyboard.** Tree row is `role="treeitem"`; section is `role="group"` with `aria-expanded`. Arrow Up/Down navigate, Left collapses, Right expands, Enter selects (= double-click = permanent tab). Space = single-click = preview tab.

## 4. Component-level design

### 4a. Tree components

New components (all under `ui/src/components/layout/sidebar-tree/`):

- **`ArtifactTree.tsx`** — top-level tree container. Owns header (search, Show-deprecated toggle, **Upload / Import button — §2c**), drag-target wrapper for OS file drop (root fallback — §2d), collapsed-state persistence, renders ordered `ArtifactTreeSection`s. Owns the cross-section search filter that drives match-expansion (§2b).
- **`ArtifactTreeSection.tsx`** — one per top-level section. Props: `id`, `label`, `icon`, `count`, `collapsed`, `onToggle`, `headerActions?` (renders the per-section "+" button from §2a), `dropHint?` (optional forced artifact type for OS-file drops — §2d), `children`.
- **`ArtifactTreeNode.tsx`** — generic leaf row. Props: `kind: 'artifact' | 'task-graph' | 'task-details' | 'blueprint' | 'code-file' | 'embed'`, `item`, `isSelected`, `onClick` (preview), `onDoubleClick` (permanent), `onContextMenu`.
- **`TodosTreeSection.tsx`** — refactored wrapper around existing `SessionTodosSection`. Exposes the "+" handler that reveals/focuses the inline add input (§2a).
- **`useSidebarTreeState.ts`** — manages `collapsedSections`, `showDeprecated`, `searchQuery`, `forceExpandedSections` (search-driven, see §2b), persisted via Zustand `persist` middleware (same pattern as `uiStore.ts`). `searchQuery` is NOT persisted.
- **`artifactTreeSelectors.ts`** — pure functions: `selectPinnedNodes`, `selectBlueprintNodes`, `selectLinkedSnippets`, `selectCatchAll*`, plus a `filterTreeBySearch(tree, query)` that returns `{ visibleNodes, sectionsWithMatches }` used to drive match-expansion.

### 4b. Context menus (replaces inline action buttons)

Replace today's inline hover buttons (`ItemCard` action strip at `ItemCard.tsx`; blueprint delete-button at `Sidebar.tsx:635–648`; embed delete at `Sidebar.tsx:697–705`; code-file unlink at `Sidebar.tsx:827–835`) with a single right-click context menu driven by node kind. Reuse the existing `ContextMenu` UX pattern from `ui/src/components/diagram/ContextMenu.tsx` — small floating menu anchored at cursor, auto-closes on outside click / Escape.

New component: **`SidebarNodeContextMenu.tsx`** (in `sidebar-tree/`). Driven by a pure function:

```ts
function getActionsForNode(node: TreeNode, ctx: {showItemDelete: boolean}): MenuAction[]
```

Action matrix (derived from today's inline buttons):

| Node kind | Menu actions |
|-----------|--------------|
| `artifact` type=diagram/document/design/spreadsheet/snippet | Open, Open in New Tab, Pin Artifact / Unpin Artifact, Pin Tab, Rename, Duplicate, Download, Email, Deprecate / Un-deprecate, Delete |
| `artifact` type=image | Open, Open in New Tab, Pin Artifact / Unpin Artifact, Pin Tab, Rename, Download, Delete |
| `blueprint` | Open, Open in New Tab, Pin Tab, Deprecate (with confirm → clears task graph) |
| `embed` | Open, Open in New Tab, Pin Tab, Rename, Delete |
| `code-file` | Open, Open in New Tab, Pin Tab, Reveal in File Browser, Sync from Disk, Push to Disk, Unlink |
| `task-graph` / `task-details` | Open, Open in New Tab, Pin Tab (no destructive actions) |
| `todo` | inline controls retained (checkbox, drag, edit, delete) — right-click menu: Edit, Delete, Mark (in)complete |

"Rename" and "Duplicate" do not currently exist for all types; flag as new surface area. Where an API is missing, the menu item is disabled with tooltip "Not yet supported." Existing modals (`ConfirmDialog` for delete / deprecate-blueprint, `FileBrowserDialog` for link-file) are reused unchanged.

## 5. Data layer

**No new endpoints in v1.** `loadSessionItems` already parallel-fetches all artifact types. The `pinned` boolean already exists on every artifact list response (see `api.setPinned` usage in `Sidebar.tsx:211`), so the Pins section is a pure client-side filter — no schema change, no new endpoint.

Cleanups worth bundling with this redesign:
- Move the embed-delete `fetch()` at `Sidebar.tsx:126–129` into `api.ts` as `api.deleteEmbed`.
- Expose `api.renameArtifact` / `api.duplicateArtifact` if the context menu ships those actions (backend stubs may already exist under different names — audit before adding).
- Add optional `forcedType` parameter to `importArtifact` (§2d) so section-targeted drops can bypass `detectType`.

## 6. Tab System

**Goal:** VSCode-style tabs, per session. Replaces "whatever the last-selected artifact was" with an explicit, multi-tab workspace that survives refresh.

### 6a. Data model

```ts
type TabKind = 'artifact' | 'task-graph' | 'task-details' | 'blueprint' | 'embed' | 'code-file';

interface TabDescriptor {
  id: string;               // stable: `${kind}:${artifactType?}:${artifactId}`
  kind: TabKind;
  artifactType?: 'diagram' | 'document' | 'design' | 'spreadsheet' | 'snippet' | 'image';
  artifactId: string;       // or virtual id for task-graph
  name: string;             // cached for display (re-synced from store on render)
  isPreview: boolean;       // italicized, single slot per session
  isPinned: boolean;        // moves to PinnedTabBar (upper row)
  order: number;            // drag-to-reorder within its row
  openedAt: number;
}

interface SessionTabsState {
  tabs: TabDescriptor[];
  activeTabId: string | null;
}
```

Note: **tab pin ≠ artifact pin.** A pinned *tab* stays in the upper tab-bar row for this session only and has no server-side representation. A pinned *artifact* sets the server-side `pinned` boolean and hoists it into the Pins section for all clients. The context menu has separate entries: **"Pin Artifact"** (server-side) vs **"Pin Tab"** (client-side, current session).

### 6b. State store

New Zustand store: **`ui/src/stores/tabsStore.ts`** using the `persist` middleware (same pattern as `uiStore.ts:83`). Persisted to `localStorage` under key `collab.tabs.v1` as a `Record<sessionKey, SessionTabsState>` where `sessionKey = "${project}::${sessionName}"`. On session switch, the store hydrates the entry for the new session key (or initializes empty) and saves the previous one. When switching back, the full tab set restores — see §7 decision on "fresh vs restore."

API surface:
- `openPreview(tab: Omit<TabDescriptor, 'isPreview'|'isPinned'|'order'>)`: if a preview tab exists, **replace** it in-place; else append with `isPreview=true`. Always sets `activeTabId` to the new tab.
- `promoteToPermanent(id)`: sets `isPreview=false`.
- `openPermanent(tab)`: same as openPreview but `isPreview=false`; if the artifact already has any tab (preview or permanent), promote/activate it instead of adding a duplicate.
- `pinTab(id)` / `unpinTab(id)`: flips `isPinned`, reorders.
- `closeTab(id)`: removes. If it was active, activate the next tab to the right (or left if rightmost).
- `reorderTabs(ids)` within a row.
- `setActive(id)`.

### 6c. UI components

Under `ui/src/components/layout/tabs/`:

- **`PinnedTabBar.tsx`** — top row. Only rendered when `tabs.some(t => t.isPinned)`. Shorter padding, no close button by default (close via context menu only) — see §7.
- **`TabBar.tsx`** — regular row directly below PinnedTabBar. Renders in `order`. Preview tab: italic name. Active tab: `accent-100` bg + bottom-border accent. Close (×) button on hover. Drag-to-reorder within the row (`react-dnd` or native HTML5 drag — check if `dnd-kit` is already in the repo as it's used by SessionTodosSection; reuse it).
- **`Tab.tsx`** — single tab chip. Icon (reuse `getItemIcon`) + name + close button. Right-click → `TabContextMenu` (Close, Close Others, Close to the Right, Pin Tab / Unpin Tab, Reveal in Sidebar).
- **`TabContextMenu.tsx`** — small floating menu (pattern from `ContextMenu.tsx`).

Mounting: tabs render at the top of the main content column — between the top app header and the editor pane. Replaces the current single-editor display.

### 6d. Behaviors

- **Single-click tree node → preview tab.** Calls `tabsStore.openPreview(...)`. Reuses existing preview slot; italic title.
- **Double-click tree node → permanent tab.** Calls `tabsStore.openPermanent(...)`.
- **Edit in preview tab auto-promotes.** Any editor-state change (dirty / content edit / selection change inside the editor) fires `promoteToPermanent(activeTabId)`. **Flag as decision in §8** — standard VSCode behavior, recommend YES.
- **Pin Tab** (right-click or drag up into the pinned row): `pinTab(id)`. Pinned tab moves to `PinnedTabBar`.
- **Close tab:** × on hover, or right-click → Close. Closing the active tab activates the neighbor. **Closing a pinned tab:** decision — silent vs confirm. Recommend silent (VSCode does silent); add confirm later only if users complain.
- **Tree-click on an artifact that already has a permanent tab:** just activates that tab (don't open a second).
- **Opening a different tree node when preview slot is busy:** replace the preview tab (standard VSCode).
- **Switching sessions:** save `{sessionKey → SessionTabsState}` snapshot of outgoing session, hydrate incoming. Refresh (F5) reloads same session's tabs from `localStorage`.

### 6e. Persistence

- Client-side localStorage via Zustand `persist` (key `collab.tabs.v1`).
- Keyed per session so multiple sessions can coexist without interference.
- **Decision needed (see §8):** server-side persistence so tabs follow the user across browsers/devices. Recommend client-only for v1 to ship faster; add a server field to the session schema in v2 if cross-device sync becomes a requirement.

### 6f. Keyboard

Proposed (all flagged as decisions in §8):
- `Ctrl/Cmd + Tab` — cycle tabs (active-row scope).
- `Ctrl/Cmd + Shift + Tab` — reverse cycle.
- `Ctrl/Cmd + W` — close active tab.
- `Ctrl/Cmd + P` — quick-open (fuzzy search across session artifacts, opens as preview tab). Overlaps with existing `Cmd+K` global code search (`globalSearch.ts`) — decision on reuse vs separate.
- `Ctrl/Cmd + 1..9` — jump to tab by position in active row.

## 7. Migration / rollout plan

Two feature flags:
- `sidebar.tree` — enables the new ArtifactTree (Phase A).
- `sidebar.tabs` — enables TabBar + PinnedTabBar and switches tree clicks from legacy per-type `select*` to `tabsStore.openPreview/openPermanent` (Phase B).

Phase A can ship without Phase B (tree + single-editor selection, legacy behavior). Phase B requires Phase A.

### Phase A — Tree

1. Scaffold tree components and `useSidebarTreeState` (no wiring).
2. Migrate sections into the tree, one at a time (all Phase A): Diagrams → Documents → Designs → Spreadsheets → Snippets → Images → Embeds → Code Files → Blueprints → Tasks → Todos → **Pins**.
3. Refactor `SessionTodosSection` to accept external `collapsed`/`onToggle`, and expose an imperative handle to reveal/focus the inline add input (driven by the Todos header "+").
4. **Global search (§2b):** implement `filterTreeBySearch` + match-expansion in `useSidebarTreeState`; wire the tree header input. Ship with `names only` scope; leave `sidebar.tree.searchContent` flag off.
5. **Per-section "+" buttons (§2a):** wire Todos → inline-add and Code Files → `FileBrowserDialog`. All other sections omit the "+".
6. **Upload / Import relocation (§2c):** move the Items-strip Import button to the tree header. Reuse `handleImport` / `importArtifact` verbatim; remove the old button from the (now-deleted) Items section.
7. **OS-file drag-and-drop (§2d):** port today's root `handleDragOver`/`handleDrop` onto `ArtifactTree`; add section-level drop hints via `ArtifactTreeSection.dropHint`; extend `importArtifact` with an optional `forcedType` parameter.
8. Replace inline per-row action buttons with `SidebarNodeContextMenu` driven by `getActionsForNode`.
9. Move embed-delete `fetch()` into `api.deleteEmbed`.
10. Tree keyboard nav + ARIA.
11. Flip `Sidebar.tsx` to render `<VibeInstructionsEntry/> + <SubscriptionsPanel/> + <ArtifactTree/>`, delete dead JSX.

### Phase B — Tabs

12. Create `tabsStore.ts` with `persist` middleware, types, and actions. Unit-test openPreview/promote/pin/close/reorder.
13. Build `PinnedTabBar`, `TabBar`, `Tab`, `TabContextMenu`.
14. Mount tab bars between app header and editor pane.
15. Wire tree single-click → `openPreview`, double-click → `openPermanent`, context-menu "Open in New Tab" → `openPermanent`.
16. Wire editor-edit → `promoteToPermanent(activeTabId)` on first dirty event per tab.
17. Add session-switch save/hydrate logic in `tabsStore` (subscribe to `sessionStore.currentSession`).
18. Drag-to-reorder; drag-up-to-pin; drag-down-to-unpin.
19. Keyboard shortcuts (behind a sub-flag so they can be disabled if they conflict).
20. Tests:
    - Store unit tests (preview slot replacement, promote, pin, close neighbor activation, session switch save/restore).
    - `TabBar.test.tsx` — rendering, active highlight, close-on-click, drag-reorder.
    - Integration: clicking tree opens preview; double-click opens permanent; edit promotes; refresh restores.

### Phase C — cleanup

21. Remove flags once parity is confirmed.
22. Dashboard/mobile audit (`ui/src/components/mobile/PreviewTab.tsx` — NB: name collision with the new "preview tab" concept; rename mobile component if confusing).
23. Revisit §2b `sidebar.tree.searchContent` once the server-side content-search API is picked — flip on under flag, validate debounce/rate-limit, then promote to default.

## 8. Open questions / decisions for the user

Existing (from v1 tree design):

1. **Section ordering.** Above we propose Pins → Tasks → Blueprints → Todos → Embeds → Images → Code Files → Diagrams → Documents → Designs → Spreadsheets → Snippets. Alphabetical, phase-of-work, or type-first?
2. **Empty sections.** Hide vs. show-empty-with-hint when the list is empty? Today: hidden (except Code Files). Recommendation: keep hidden.
3. **Iconography.** Reuse inline Heroicons SVGs vs. migrate to `lucide-react` (already in repo). Recommend reuse now, migrate later.
4. **Default-collapsed sections.** All expanded by default; persisted state overrides.
5. **Unified selection model.** Consolidate 7 `selected*Id` slots into `selectedArtifact: {type, id} | null`? Relevant once tabs land — the active tab *is* the selection. Recommend doing this as part of Phase B so tab ↔ editor routing is one concept.
6. **Search scope — names vs names+content.** v1 default: **names only** across all sections. Content search is flagged (`sidebar.tree.searchContent`) for a follow-up. Decision: ship names-only now and iterate, or hold §2b until content is in?
7. **Non-match presentation.** **Hide** (recommended, clearer) vs **dim** (keeps spatial context). See §2b.
8. **Per-section "+" coverage.** The §2a table proposes "+" on Todos and Code Files only. Confirm, or request "+" on any of: Documents (inline markdown create), Diagrams (empty-diagram stub), Snippets (blank snippet), Designs (blank design), Spreadsheets (blank sheet)? Each would need a new create dialog or blank-artifact flow on the frontend.
9. **Drop-on-empty-tree-area.** When there are zero sections visible (brand-new session), does the tree's empty state still accept drops? Recommendation: yes — full-tree drop zone falls back to type-based detection, same as root.
10. **Drop onto a section whose type doesn't match the file.** Hard reject with a toast (recommended), or silently fall through to type-based dispatch as if it had been dropped on root?

New (tabs + pins + context menus — unchanged from v1):

11. **Pinned artifact placement.** Appear **only in Pins** while pinned (recommended), or in **both** Pins and native type section?
12. **Preview-tab auto-promote on edit.** YES (VSCode behavior, recommended) or NO (preview stays preview forever unless explicitly promoted)?
13. **Closing a pinned tab.** Silent close (recommended, VSCode-style) or require a confirm modal?
14. **Keyboard shortcuts.** Which of the §6f set to ship in v1? `Ctrl+P` overlap with `Cmd+K` global search needs resolving — reuse the same palette with a tab-open action, or two separate palettes?
15. **Tab persistence location.** Client localStorage only (recommended for v1), or also server-side on the session record for cross-device sync?
16. **Max pinned tabs.** Cap (e.g., 10) to prevent the top row from exceeding the viewport, or unlimited with horizontal scroll?
17. **Session switch behavior.** Restore that session's tabs (recommended) or always start fresh?
18. **Preview tab replacement scope.** Does clicking a node that's *already in a permanent tab* still burn the preview slot, or just activate the existing permanent tab (recommended — do nothing to the preview slot)?
19. **Rename / Duplicate context-menu items.** Ship with v1 context menu, or disabled until backend endpoints are audited/added?
20. **Right-click menu vs. hover actions.** Fully replace (recommended — consistent with VSCode/Finder), or keep a minimal inline strip (e.g., × close on hover) for discoverability?
21. **Mobile `PreviewTab.tsx` naming collision.** Rename mobile component to avoid confusion with the new tab-system "preview tab" concept?

---

**Critical files for implementation reference**

- `/srv/codebase/claude-mermaid-collab/ui/src/components/layout/Sidebar.tsx`
- `/srv/codebase/claude-mermaid-collab/ui/src/components/layout/SessionTodosSection.tsx`
- `/srv/codebase/claude-mermaid-collab/ui/src/components/layout/ItemCard.tsx`
- `/srv/codebase/claude-mermaid-collab/ui/src/hooks/useDataLoader.ts`
- `/srv/codebase/claude-mermaid-collab/ui/src/stores/sessionStore.ts`
- `/srv/codebase/claude-mermaid-collab/ui/src/stores/uiStore.ts` (Zustand `persist` pattern for `tabsStore`)
- `/srv/codebase/claude-mermaid-collab/ui/src/components/diagram/ContextMenu.tsx` (context-menu UX pattern to reuse)
- `/srv/codebase/claude-mermaid-collab/ui/src/lib/importArtifact.ts` (dispatch logic for Upload button + DnD; extend with `forcedType`)
- `/srv/codebase/claude-mermaid-collab/ui/src/components/dialogs/FileBrowserDialog.tsx` (reused by Code Files "+" button)
