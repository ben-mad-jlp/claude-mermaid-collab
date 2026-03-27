# Session: pseudo-viewer

## Session Context
**Converted from:** Vibe session  
**Goal:** Build a read-only pseudocode browser at `/pseudo` — lets you explore the codebase through its 239 `.pseudo` files with navigable CALLS links, file tree, and search.  
**Out of Scope:** Editing .pseudo files, auto-refresh on file change, diff view, mobile layout

---

## Existing Artifacts

- **pseudo-viewer-spec** (document) — Full spec: route structure, layout, file tree, viewer rendering, CALLS popover, search, function jump panel, backend API, component list
- **pseudo-viewer-flow** (diagram) — Navigation flow: project select → file list → tree → viewer → CALLS links / search / jump
- **pseudo-viewer-wireframe** (design) — UI wireframe showing 3-column layout at 1440×900

---

## Work Items

### Item 1: Backend API endpoints
**Type:** code  
**Status:** documented

**Goal:** Add 3 new read-only API endpoints under `/api/pseudo` prefix:
- `GET /api/pseudo/files?project=<path>` — walk filesystem, return all `.pseudo` stems sorted
- `GET /api/pseudo/file?project=<path>&file=<stem>` — read single `.pseudo` file, return raw content
- `GET /api/pseudo/search?project=<path>&q=<query>` — case-insensitive search, return grouped results

**Approach:** New route file `src/routes/pseudo-api.ts`, registered in `src/server.ts` the same way as `handleKodexAPI` (path prefix `/api/pseudo`). Use `Bun.Glob` to walk the filesystem for `.pseudo` files. No project registration validation — trust the project path, same pattern as kodex-api.

**Decisions:**
- No project validation — trust path, same as kodex-api
- Register in server.ts (not inside api.ts) for clean separation
- Use Bun.Glob for filesystem walk

**Success Criteria:** All 3 endpoints return correct data; 404 for missing files; search prioritizes FUNCTION line matches.

**Design:**

New file `src/routes/pseudo-api.ts` — exports `handlePseudoAPI(req)`. Registered in `src/server.ts` before the `/api/*` catch-all, same pattern as `handleKodexAPI`.

**`/files`** — uses `new Bun.Glob('**/*.pseudo').scan(project)` to walk the filesystem. Strips `.pseudo` extension from each result, sorts alphabetically, returns `{ files: string[] }`.

**`/file`** — constructs the path as `join(project, file + '.pseudo')`, reads with `Bun.file()`. Returns `{ content, path }` or 404 if the file doesn't exist.

**`/search`** — globs all `.pseudo` files, reads each line-by-line. Tracks the current FUNCTION name as it scans. A match is recorded when a line contains the query (case-insensitive). FUNCTION-line matches are flagged with `isFunctionLine: true` and sorted above body matches. Groups results by file, caps at 50 total matches.

All 3 endpoints require `?project=` query param; return 400 if missing. No project registration validation — trust the path (same as kodex-api).

{{diagram:approach-1}}

---

### Item 2: Pseudo parser
**Type:** code  
**Status:** documented

**Goal:** Client-side parser that converts raw `.pseudo` text into structured blocks for rendering.

**Approach:** `ui/src/pages/pseudo/parsePseudo.ts` — pure function, no dependencies. Output: `{ header, moduleProse, functions: [{ name, params, returnType, isExport, calls, body }] }`

**Success Criteria:** Correctly parses all 239 existing .pseudo files; handles edge cases (no functions, module-only files, multi-CALLS lines).

**Design:**

Pure function `parsePseudo(content: string)` in `ui/src/pages/pseudo/parsePseudo.ts`. Single linear pass over lines.

Output shape:
```ts
{ titleLine, subtitleLine, moduleProse, functions: [{
  name, params, returnType, isExport, calls: [{name, fileStem}], body: string[]
}] }
```

Pass logic:
1. Lines starting with `//` before any FUNCTION → header (first = titleLine, second = subtitleLine)
2. Non-`//`, non-`FUNCTION`, non-`---` lines before first FUNCTION → moduleProse
3. `FUNCTION` line: regex splits name, params, return type, EXPORT flag
4. `CALLS:` line: regex `/([\w.]+)\s+\(([^)]+)\)/g` extracts all `{name, fileStem}` pairs
5. `---` → ends current function block, pushes to array, resets accumulator
6. Remaining lines → body array for current function

---

### Item 3: API client
**Type:** code  
**Status:** documented

**Goal:** Frontend API client that wraps the 3 backend endpoints.

**Approach:** `ui/src/lib/pseudo-api.ts` — simple fetch wrappers matching pattern of existing `ui/src/lib/api.ts`.

**Success Criteria:** All 3 functions exported and typed; uses existing project/session context pattern.

**Design:**

```ts
export async function fetchPseudoFiles(project: string): Promise<string[]>
export async function fetchPseudoFile(project: string, file: string): Promise<string>
export async function searchPseudo(project: string, q: string): Promise<SearchResult[]>

type SearchResult = {
  file: string
  matches: Array<{ function: string, line: string, lineNumber: number }>
}
```

All three are simple fetch wrappers — GET with query params, throw on non-2xx. Project value comes from app's selected project state (same source as diagrams/documents).

---

### Item 4: PseudoPage + routing
**Type:** code  
**Status:** documented

**Goal:** Top-level route component and React Router integration.

**Approach:** 
- `ui/src/pages/pseudo/PseudoPage.tsx` — layout shell, owns state (selectedProject, currentPath, fileList, fileCache, search state)
- Add routes to `ui/src/App.tsx`: `/pseudo` and `/pseudo/:path*`
- Add nav icon to left nav sidebar

**Success Criteria:** `/pseudo` renders without error; URL changes on file navigation; browser back/forward works; deep links work.

**Design:**

State: `selectedProject`, `currentPath` (from URL), `fileList`, `fileCache: Map<string,string>`, search state.
Layout: 3-col flex — PseudoFileTree (280px) + PseudoViewer (flex-1) + FunctionJumpPanel (220px).
Routes in App.tsx: `/pseudo` and `/pseudo/:path*`.
Navigation: `navigate('/pseudo/' + stem)` — browser history handles back/forward.
Nav icon: new button in Sidebar.tsx linking to `/pseudo`.
Project change: clear fileList + fileCache, reset URL to `/pseudo`.

---

### Item 5: PseudoFileTree
**Type:** code  
**Status:** documented

**Goal:** Left sidebar with project dropdown, tree filter input, and collapsible directory tree.

**Approach:** `ui/src/pages/pseudo/PseudoFileTree.tsx`
- Project dropdown matches pattern of other routes
- Tree built from flat file list (split paths on `/`)
- Collapse state persisted in localStorage keyed by project
- Filter input hides non-matching files, auto-expands matched dirs

**Success Criteria:** Tree renders all 239 files correctly; collapse/expand works; filter narrows tree in real time; active file highlighted.

**Design:**

Props: `fileList`, `currentPath`, `onNavigate`, `project`, `onProjectChange`.
Tree: split stems on `/` → nested TreeNode structure, rendered recursively (dirs first, files alpha).
Project dropdown: top of sidebar, uses registered projects list, calls `onProjectChange`.
Collapse: `Set<string>` persisted to `localStorage` as `pseudo-tree-collapsed-${project}`.
Filter: case-insensitive substring match on stem; auto-expands parent dirs of matches; Esc clears.
Active: entry with stem === currentPath gets `#ede9fe` bg + purple text.
Badges: collapsed dirs show `(N)` child file count.

---

### Item 6: PseudoViewer + PseudoBlock
**Type:** code  
**Status:** documented

**Goal:** Main content area that renders parsed pseudo blocks with full styling.

**Approach:**
- `ui/src/pages/pseudo/PseudoViewer.tsx` — fetches file on path change, runs parser, renders blocks, nav bar (back/forward/breadcrumb/search)
- `ui/src/pages/pseudo/PseudoBlock.tsx` — renders one FUNCTION block: purple keyword, bold name, sig, EXPORT badge, CALLS row, body

**Styling per spec:** purple `#7c3aed` FUNCTION, green `#dcfce7/#16a34a` EXPORT badge, orange `#ea580c` CALLS links, muted `#a8a29e` module prose.

**Success Criteria:** All block elements render with correct styles; `---` renders as `<hr>`; EXPORT badge right-aligned.

**Design:**

PseudoViewer: on currentPath change → check fileCache → fetch if missing → parsePseudo → render.
Nav bar: ← → (browser history), breadcrumb, copy-path, search bar.
Exposes `scrollToFunction(name)` via useImperativeHandle — called by jump panel + search.

PseudoBlock styling:
- `FUNCTION` keyword: bold, `#7c3aed`
- Function name: bold, `#1c1917`
- Params/return: `#44403c`
- EXPORT badge: right-aligned, `bg:#dcfce7 text:#16a34a rounded-sm`
- CALLS label: `#78716c`; links → CallsLink
- Body: `#44403c, pl-5`; IF/ELSE slightly bold
- Separator: `<hr border-color:#e7e5e4>`

Scroll-to-function: `data-function={name}` on each block → `querySelector` + `scrollIntoView` + 1.5s yellow flash via CSS class.

---

### Item 7: CallsLink + CallsPopover
**Type:** code  
**Status:** documented

**Goal:** Orange clickable CALLS links that navigate on click and show a preview popover on hover.

**Approach:**
- `ui/src/pages/pseudo/CallsLink.tsx` — renders single `functionName (file-stem)` as orange link; triggers popover after 400ms hover
- `ui/src/pages/pseudo/CallsPopover.tsx` — 320px popover showing path, title, description, exports; hoverable with 300ms grace period; click navigates

**Success Criteria:** Click navigates to correct file; popover appears after 400ms; popover stays open when cursor moves into it; popover click navigates.

**Design:**

CallsLink: orange `#ea580c`, underline on hover. Click → `onNavigate(fileStem)`. Hover 400ms → fetch target file → show popover.

CallsPopover (320px portal card): path stem (mono muted) + divider + titleLine (bold) + subtitleLine (muted) + divider + EXPORTS list (green, from `functions.filter(f => f.isExport)`).

Dismiss: leave link → 300ms grace; entering popover cancels grace; leave popover → close. Click anywhere in popover → navigate.

Positioning: `getBoundingClientRect()` of anchor + portal on `document.body`. Above link if space allows, below otherwise.

---

### Item 8: PseudoSearch
**Type:** code  
**Status:** documented

**Goal:** Cmd+K search across all .pseudo files with grouped results dropdown.

**Approach:** `ui/src/pages/pseudo/PseudoSearch.tsx`
- Focused by Cmd+K / Cmd+F from anywhere on `/pseudo`
- 200ms debounce → calls `/api/pseudo/search`
- Results grouped by file, max 8 files × 3 results
- Keyboard: ↑↓ navigate, Enter open, Esc close
- Navigate from result → scroll to + yellow flash the matched function

**Success Criteria:** Cmd+K focuses search; results appear within debounce; keyboard nav works; selecting result scrolls to correct function.

**Design:**

Trigger: Cmd+K / Cmd+F global keydown on PseudoPage focuses input.
200ms debounce → `searchPseudo(project, q)`.
Dropdown: absolute, below search bar, z-index top, max-h 400px scrollable.
Groups: file path header (muted) + up to 3 entries (FUNCTION signature, truncated 60 chars). Max 8 files.
Keyboard: ↑↓ highlight, Enter → navigate + scrollToFunction (after tick), Esc → close + clear.
Close: Esc or click outside (global mousedown).
Empty state: "No results for 'query'".

---

### Item 9: FunctionJumpPanel
**Type:** code  
**Status:** documented

**Goal:** Right panel listing all functions in the current file, with scroll tracking and click-to-jump.

**Approach:** `ui/src/pages/pseudo/FunctionJumpPanel.tsx`
- Lists all FUNCTION names from parsed file
- IntersectionObserver tracks which function is in viewport → highlights active
- EXPORT functions get green dot
- Click → smooth scroll to function block

**Success Criteria:** Active function updates on scroll; click scrolls smoothly; EXPORT dots shown correctly; panel scrolls independently for large files.

**Design:**

Props: `functions: ParsedFunction[]`, `viewerRef: RefObject<PseudoViewerHandle>`.
List: "FUNCTIONS" header (11px muted uppercase) + one entry per function.
EXPORT functions: 6px green dot (`#16a34a`) to the right of name.
Active: `bg:#ede9fe text:#6d28d9 font-weight:600`. Panel scrolls independently (`overflow-y:auto`).
Active tracking: IntersectionObserver on `[data-function]` blocks (threshold 0.3) → sets activeFunction. Cleaned up on unmount/file change.
Click: `viewerRef.current.scrollToFunction(name)`.
Empty state: panel hidden when `functions.length === 0`.

---

## Diagrams
(auto-synced)
