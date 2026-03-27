# Pseudocode Viewer — Full Spec

## What It Is

A dedicated browser route (`/pseudo`) that lets you explore the entire codebase through its `.pseudo` files. Think of it as a lightweight code browser — but instead of raw source, you see plain-English summaries with navigable cross-file links.

Read-only. `.pseudo` files are not editable from this UI.

---

## Route Structure

| URL | State |
|---|---|
| `/pseudo` | File tree visible, no file selected |
| `/pseudo/src/mcp/http-handler` | http-handler.pseudo loaded and shown |
| `/pseudo/ui/src/hooks/useDiagram` | useDiagram.pseudo loaded |

- URL updates on every navigation action (browser `pushState`)
- Browser back/forward works naturally — no custom history stack needed
- Deep-linkable: paste a URL and it opens directly to that file
- React Router: `<Route path="/pseudo" />` and `<Route path="/pseudo/:path*" />`

---

## Layout

Full-page route within existing app chrome.

```
┌─────────────────────────────────────────────────────────────┐
│  [App Header]                                               │
├──────────────┬──────────────────────────────────┬───────────┤
│  [Project ▾] │  ← →  src/mcp/http-handler  [🔍]│ Functions │
│  ─────────── │  ─────────────────────────────── │ ───────── │
│  File Tree   │                                  │  jump     │
│  (280px)     │  Pseudo Viewer                   │  list     │
│              │  (fills remaining width)         │  (220px)  │
│              │                                  │           │
└──────────────┴──────────────────────────────────┴───────────┘
```

Three columns:
- **File Tree sidebar** — 280px fixed, left. Contains project dropdown at top, file tree below.
- **Pseudo Viewer** — fills remaining width
- **Function Jump Panel** — 220px fixed, right

New nav entry: icon button in the left app nav (icon: `{ }` or scroll/book icon) linking to `/pseudo`.

---

## Project Dropdown

Matches the pattern used on all other routes (Diagrams, Documents, Designs).

- Located at the **top of the file tree sidebar**, above the tree itself
- Shows currently selected project name
- Dropdown lists all registered projects (same source as other routes)
- Selecting a new project:
  1. Resets the URL to `/pseudo` (clears any selected file)
  2. Re-fetches the file list for the new project
  3. Resets the file tree (collapsed state resets too)
- If no project is selected: file tree area shows "Select a project to browse its pseudocode."
- Project selection is persisted in the same way as other routes (app-level state / URL param)

---

## File Tree

### Loading
- On project select: `GET /api/pseudo/files?project=<path>` → flat list of path stems
- Build a tree from the flat list (split paths on `/`)
- Render immediately

### Behavior
- Collapsible directories with `▾` / `▸` toggles
- Collapsed state persisted in `localStorage` keyed by project path
- Default: top-level dirs expanded, nested dirs collapsed
- Active file highlighted (matches current URL path)
- Directories show collapsed file count badge: `▸ tools/ (14)`

### Tree Filter
- Text input below the project dropdown, above the tree
- Filters the tree in real time — hides non-matching files, auto-expands matching directories
- Clears with `Esc`

### File Entry
- Single click → navigate to file (pushes URL to browser history)
- Hover → show full path as tooltip

---

## Pseudo Viewer — Rendering

The viewer parses raw `.pseudo` text into structured blocks client-side.

### Parsing Rules

**Header block** — opening `//` comment lines:
```
// MCP Streamable HTTP Handler          ← title (bold)
// Single endpoint for all MCP...       ← subtitle (muted)
```

**Module-level prose** — lines before the first `FUNCTION` that aren't comments or `---`:
```
Sessions expire after 30 minutes of inactivity.
```

**Function block** — `FUNCTION` line through the next `---` or EOF:
- `FUNCTION` line: split on trailing `EXPORT` to get signature + export flag
- `CALLS:` line: parse `functionName (file-stem)` pairs with regex `(\w[\w.]+)\s+\(([^)]+)\)`
- Body: remaining indented lines

**Separator** — `---` becomes a `<hr>`, not rendered as text

### Visual Styling

| Element | Style |
|---|---|
| `// Title` | 16px bold, `#1c1917` |
| `// subtitle` | 14px italic, `#78716c` |
| Module prose | 13px italic, `#a8a29e`, margin-bottom |
| `FUNCTION` keyword | bold, `#7c3aed` (purple) |
| Function name | bold, `#1c1917` |
| `(params) -> type` | normal, `#44403c` |
| `EXPORT` badge | right-aligned, `#dcfce7` bg, `#16a34a` text, 11px |
| `CALLS:` label | 13px, `#78716c` |
| CALLS link | 13px, `#ea580c` (orange), underline on hover, cursor pointer |
| Body text | 13px, `#44403c`, `padding-left: 20px` |
| `IF` / `ELSE` keywords | slightly bold |
| `---` | 1px `#e7e5e4` horizontal rule, margin 12px 0 |

### Navigation Bar
Fixed at top of viewer:
- `←` `→` buttons (browser `history.back()` / `history.forward()`)
- Breadcrumb: `src / mcp / http-handler` (each segment clickable — clicking a dir filters the tree to that dir)
- Copy path button (clipboard icon, copies stem path)
- Search bar on the right

---

## CALLS Hover Popover

Triggered by hovering a CALLS link for **400ms** (debounced to avoid flicker).

### Popover Content
```
┌─────────────────────────────────────┐
│ src/mcp/setup                       │
│ ─────────────────────────────────── │
│ MCP Server Setup                    │
│ Shared MCP server configuration...  │
│ ─────────────────────────────────── │
│ EXPORTS:                            │
│   setupMCPServer() → Server         │
└─────────────────────────────────────┘
```

- **File path stem** (small monospace, muted)
- **Title** — first `// Title` comment line
- **Description** — second `//` comment line
- **Exports** — list of all `FUNCTION` lines with `EXPORT` (name + return type only)
- Width: 320px
- Position: above the link if space allows, below otherwise; arrow points to the hovered link

### Popover Behavior
- Dismiss: mouse leaves both link AND popover (300ms grace period to move cursor into popover)
- Popover itself is hoverable (user can read it without it vanishing)
- Click anywhere in popover → navigate to that file
- If target file not yet cached, fetch it; show a loading skeleton while waiting

---

## Search

### Trigger
- Search bar in the viewer nav bar (right side)
- `Cmd+K` or `Cmd+F` focuses it from anywhere on the `/pseudo` route
- Placeholder: "Search functions, files..."

### Behavior
- 200ms debounce after keypress
- Calls `GET /api/pseudo/search?project=<path>&q=<query>`
- Results appear in a floating dropdown below the search bar
- `Esc` closes and clears

### Results Format
Grouped by file, max 8 files shown, max 3 results per file:
```
src/mcp/setup
  setupMCPServer() → Server
  generateSessionName() → string

ui/src/hooks/useSession
  useSession()
```

- File path as group header (muted, small)
- Matching function signature as entry
- Keyboard: `↑` `↓` to navigate results, `Enter` to open, `Esc` to close

### Scroll-to-Function
When navigating from search results (or CALLS links targeting a specific function), the viewer scrolls to that function block and briefly flashes it yellow for 1.5s.

---

## Function Jump Panel

Right-side panel, 220px fixed width.

- Title: "Functions" (12px, muted)
- Lists all `FUNCTION` names in order of appearance
- Functions marked `EXPORT` get a small green dot
- Active function (currently scrolled into view) is highlighted (intersection observer tracks scroll position)
- Click → smooth scroll to that function block
- Panel scrolls independently for files with many functions (e.g. `setup.pseudo` has 40+)

---

## State

All local React state (no server persistence):

```
// URL-driven (React Router)
currentPath: string | null          — decoded from URL params

// Component state
selectedProject: string | null      — absolute project path
fileList: string[]                  — loaded on project select
fileCache: Map<string, string>      — stem → raw content, loaded on demand
treeCollapsed: Set<string>          — persisted to localStorage per project
treeFilter: string                  — tree filter input
searchQuery: string
searchResults: SearchResult[]
searchOpen: boolean
activeFunction: string | null       — function name currently in viewport
popoverTarget: { stem, anchorEl }   — hovered CALLS link
popoverContent: PopoverData | null  — fetched preview for popover
```

---

## Backend — New API Endpoints

Added to the existing Express API, under the `/api/pseudo` prefix.

### `GET /api/pseudo/files`
Query params: `project` (absolute path)

Walks the project root, finds all `*.pseudo` files, returns stems sorted alphabetically.

```json
{
  "files": [
    "src/mcp/http-handler",
    "src/mcp/http-transport",
    "src/mcp/server",
    "src/mcp/setup",
    "..."
  ]
}
```

### `GET /api/pseudo/file`
Query params: `project`, `file` (stem, e.g. `src/mcp/setup`)

Reads `<project>/<file>.pseudo` from disk and returns raw content.

```json
{
  "content": "// MCP Server Setup\n...",
  "path": "src/mcp/setup"
}
```

Returns `404` if file not found.

### `GET /api/pseudo/search`
Query params: `project`, `q`

Case-insensitive substring search across all `.pseudo` files. Prioritizes `FUNCTION` line matches over body matches. Returns top 50 matches grouped by file.

```json
{
  "results": [
    {
      "file": "src/mcp/setup",
      "matches": [
        {
          "function": "setupMCPServer",
          "line": "FUNCTION setupMCPServer() -> Server                                      EXPORT",
          "lineNumber": 9
        }
      ]
    }
  ]
}
```

---

## New Frontend Files

| File | Purpose |
|---|---|
| `ui/src/pages/pseudo/PseudoPage.tsx` | Route component, top-level layout |
| `ui/src/pages/pseudo/PseudoFileTree.tsx` | Left sidebar: project dropdown + tree |
| `ui/src/pages/pseudo/PseudoViewer.tsx` | Main content area + nav bar |
| `ui/src/pages/pseudo/PseudoBlock.tsx` | Renders one FUNCTION block |
| `ui/src/pages/pseudo/CallsLink.tsx` | Orange CALLS link + triggers popover |
| `ui/src/pages/pseudo/CallsPopover.tsx` | Hover preview popover |
| `ui/src/pages/pseudo/PseudoSearch.tsx` | Search bar + results dropdown |
| `ui/src/pages/pseudo/FunctionJumpPanel.tsx` | Right panel jump list |
| `ui/src/pages/pseudo/parsePseudo.ts` | Parser: raw text → structured blocks |
| `ui/src/lib/pseudo-api.ts` | API client for /api/pseudo/* |

---

## Integration Points

### React Router (`ui/src/App.tsx`)
```tsx
<Route path="/pseudo" element={<PseudoPage />} />
<Route path="/pseudo/:path*" element={<PseudoPage />} />
```

### Left Nav
New icon button alongside Diagrams / Documents / Designs / etc., links to `/pseudo`.

### Backend (`src/routes/pseudo-api.ts`)
New route file, registered in `src/routes/api.ts` (or `src/server.ts`).

---

## Empty States

| State | Message |
|---|---|
| No project selected | "Select a project to browse its pseudocode." |
| No .pseudo files found | "No pseudocode files found. Run /pseudocode all to generate them." |
| File not found | "File not found: src/mcp/xyz — it may have been deleted or renamed." |
| Empty search results | "No results for 'query'" |

---

## Not In Scope (v1)

- Editing `.pseudo` files (read-only, always)
- Auto-refresh when files change on disk
- Diff view (before/after pseudo changes)
- Cross-project navigation within a single view
- Mobile layout
- Dark mode (inherits app theme)
