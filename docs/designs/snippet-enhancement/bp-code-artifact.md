# Blueprint: Code Artifact Feature

## Source Artifacts
- code-artifact-design — design document with decisions, data model, MCP tools, UI design

## 1. Structure Summary

### Files

**Backend (new):**
- [ ] `src/utils/path-security.ts` — Path validation utility, binary detection, file size checks
- [ ] `src/mcp/tools/code.ts` — 5 MCP tool handlers and schemas
- [ ] `src/routes/code-api.ts` — REST endpoints for push, sync, diff, file browsing

**Backend (modified):**
- [ ] `src/mcp/setup.ts` — Register 5 new tools in tool list and case handlers
- [ ] `src/server.ts` — Register code-api route handler

**Frontend (new):**
- [ ] `ui/src/components/editors/CodeEditor.tsx` — Editor with push/sync/diff controls
- [ ] `ui/src/components/dialogs/FileBrowserDialog.tsx` — File picker modal

**Frontend (modified):**
- [ ] `ui/src/lib/api.ts` — Add API client methods for code operations
- [ ] `ui/src/components/editors/UnifiedEditor.tsx` — Route linked snippets to CodeEditor
- [ ] `ui/src/components/layout/Sidebar.tsx` — Add "Code Files" collapsible section

### Type Definitions

No new type files needed. The `Snippet` interface in `ui/src/types/snippet.ts` already covers the shape. The JSON envelope fields (`linked`, `diskCode`, `linkCreatedAt`, `lastPushedAt`, `lastSyncedAt`, `dirty`) live inside the `content` string as parsed JSON — not as top-level type properties.

**Implicit types (in code.ts):**
```typescript
interface LinkedCodeEnvelope {
  code: string;
  language: string;
  filePath: string;
  originalCode: string;
  diskCode: string;
  linked: true;
  linkCreatedAt: number;
  lastPushedAt: number | null;
  lastSyncedAt: number;
  dirty: boolean;
}

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
}
```

### Component Interactions

```
User clicks "Link File" → FileBrowserDialog → GET /api/project/files → selects file
  → POST /api/snippet (creates linked snippet with envelope)
  → WebSocket broadcast → Sidebar updates "Code Files" section

User edits in CodeEditor → "Save" → PUT /api/snippet/:id (local save)
User clicks "Push to File" → confirm dialog → POST /api/code/push/:id → writes to disk
User clicks "Sync" → POST /api/code/sync/:id → detects conflicts → updates UI

Claude calls link_code_file → POST /api/snippet → linked snippet created
Claude calls review_code_edits → GET /api/snippet/:id → returns diff or full state
Claude calls push_code_to_file → POST /api/code/push/:id → writes to disk
```

---

## 2. Function Blueprints

### `validatePathUnderRoot(filePath: string, projectRoot: string): string`
**File:** `src/utils/path-security.ts`

**Pseudocode:**
1. Resolve both paths with `path.resolve()`
2. Check if resolvedPath starts with resolvedRoot + path.sep (or equals resolvedRoot)
3. If not, throw Error("Path escapes project root")
4. Call `fs.realpath()` on resolvedPath to resolve symlinks
5. Re-check the realpath against resolvedRoot
6. Return the resolved path

**Error handling:** Throws on traversal, symlink escape, or non-existent path.
**Edge cases:** Path equals root exactly, trailing slashes, `..` segments.

---

### `isBinaryFile(filePath: string): Promise<boolean>`
**File:** `src/utils/path-security.ts`

**Pseudocode:**
1. Open file, read first 8192 bytes into a Buffer
2. Check `buffer.indexOf(0x00) !== -1`
3. Return true if null byte found

**Edge cases:** Empty file (return false), file shorter than 8KB (read what exists).

---

### `handleCodeAPI(req: Request): Promise<Response>`
**File:** `src/routes/code-api.ts`
**Pattern:** Follows `handlePseudoAPI` in `src/routes/pseudo-api.ts`

**Pseudocode:**
1. Parse URL, extract path after `/api/code`
2. Extract `project`, `session` from query params
3. Route by path + method:
   - `GET /files` → `handleListProjectFiles(project, path)`
   - `POST /push/:id` → `handlePushToFile(project, session, id)`
   - `POST /sync/:id` → `handleSyncFromDisk(project, session, id)`
   - `GET /diff/:id` → `handleGetDiff(project, session, id)`
4. Return 404 for unmatched routes

---

### `handleListProjectFiles(project: string, dirPath?: string): Promise<Response>`
**File:** `src/routes/code-api.ts`

**Pseudocode:**
1. Default dirPath to project root if not provided
2. Validate dirPath under project root
3. Read directory with `readdir({ withFileTypes: true })`
4. Filter out: `node_modules`, `.git`, `.collab`, `.DS_Store`, `.env`
5. For each entry:
   - If directory: `{ name, path: absolute, type: 'directory' }`
   - If file: `{ name, path: absolute, type: 'file', size: stat.size, extension }`
6. Sort: directories first, then alphabetical by name
7. Return `{ entries }`

**Error handling:** EACCES → skip entry silently. ENOENT → 404.
**Edge cases:** Empty directory, deeply nested paths, permission-denied subdirectories.

---

### `handlePushToFile(project: string, session: string, id: string): Promise<Response>`
**File:** `src/routes/code-api.ts`

**Pseudocode:**
1. Create managers via `createManagers(project, session)`
2. Get snippet via `snippetManager.getSnippet(id)`
3. Parse JSON envelope from `snippet.content`
4. Validate `envelope.linked === true` (reject if not linked)
5. Validate `envelope.filePath` under project root
6. Write `envelope.code` to `envelope.filePath` with `writeFile`
7. Update envelope: `originalCode = diskCode = code`, `dirty = false`, `lastPushedAt = Date.now()`
8. Serialize and save via `snippetManager.saveSnippet(id, JSON.stringify(envelope))`
9. Broadcast `snippet_updated` via WebSocket
10. Return `{ success: true, filePath, bytesWritten }`

**Error handling:** EACCES → 403. ENOENT parent dir → 400. Not linked → 400.
**Test strategy:** Create linked snippet, push, verify file on disk matches code.

---

### `handleSyncFromDisk(project: string, session: string, id: string): Promise<Response>`
**File:** `src/routes/code-api.ts`

**Pseudocode:**
1. Get snippet, parse envelope, validate linked
2. Try reading file from `envelope.filePath`
3. If ENOENT: return `{ diskChanged: true, fileDeleted: true, hasLocalEdits: code !== originalCode, conflict: false }`
4. Compare disk content to `envelope.diskCode` → `diskChanged`
5. Compare `envelope.code` to `envelope.originalCode` → `hasLocalEdits`
6. `conflict = diskChanged && hasLocalEdits`
7. Update `envelope.diskCode` to disk content, `lastSyncedAt = Date.now()`
8. If `!hasLocalEdits && diskChanged`: also set `originalCode = code = diskContent` (auto-sync)
9. Save updated envelope
10. Broadcast `snippet_updated`
11. Return `{ success: true, diskChanged, hasLocalEdits, conflict }`

**Edge cases:** File permissions changed, file became binary after link, file truncated to 0 bytes.

---

### `handleGetDiff(project: string, session: string, id: string): Promise<Response>`
**File:** `src/routes/code-api.ts`

**Pseudocode:**
1. Get snippet, parse envelope
2. Compute `localVsOriginal` diff: unified diff of `originalCode` vs `code`
3. Compute `localVsDisk` diff: unified diff of `diskCode` vs `code`
4. Return `{ localVsOriginal, localVsDisk }`

**Note:** Use a simple line-based diff. Can use the `diff` npm package or implement a basic unified diff generator.

---

### `handleLinkCodeFile(project, session, filePath, name?)`
**File:** `src/mcp/tools/code.ts`

**Pseudocode:**
1. Validate filePath under project root via `validatePathUnderRoot`
2. Stat the file, check `size < 1MB`
3. Check `isBinaryFile(filePath)`, reject if true
4. Read full file content as utf-8
5. Detect language from extension via `EXT_TO_LANGUAGE`
6. Build envelope: `{ code, language, filePath: resolved, originalCode: code, diskCode: code, linked: true, linkCreatedAt: Date.now(), lastPushedAt: null, lastSyncedAt: Date.now(), dirty: false }`
7. POST to `/api/snippet` with `name` (default: basename) and `content: JSON.stringify(envelope)`
8. Return `{ success: true, id }`

**Error handling:** File not found, too large, binary, path escape — all return descriptive errors.

---

### `handlePushCodeToFile(project, session, id)`
**File:** `src/mcp/tools/code.ts`

**Pseudocode:**
1. Fetch snippet via `GET /api/snippet/:id`
2. Parse envelope, validate linked
3. POST to `/api/code/push/:id`
4. Return result

---

### `handleSyncCodeFromDisk(project, session, id)`
**File:** `src/mcp/tools/code.ts`

**Pseudocode:**
1. POST to `/api/code/sync/:id`
2. Return result

---

### `handleReviewCodeEdits(project, session, id, format)`
**File:** `src/mcp/tools/code.ts`

**Pseudocode:**
1. Fetch snippet via `GET /api/snippet/:id`
2. Parse envelope
3. If format === 'diff': compute unified diff of `originalCode` vs `code`, return as string
4. If format === 'full': return `{ code, originalCode, diskCode, filePath, language, dirty, lastPushedAt }`

---

### `handleListCodeFiles(project, session)`
**File:** `src/mcp/tools/code.ts`

**Pseudocode:**
1. Fetch all snippets via `GET /api/snippets`
2. For each, try parsing content as JSON
3. Filter to those with `linked === true`
4. Return `{ files: [{ id, name, filePath, language, dirty, lastPushedAt }] }`

---

### `CodeEditor` React Component
**File:** `ui/src/components/editors/CodeEditor.tsx`

**Pseudocode:**
1. Wraps `SnippetEditor` — passes through snippetId, onSave
2. Parses snippet JSON envelope to extract linked metadata
3. Renders additional toolbar above SnippetEditor:
   - Save button (calls existing snippet save)
   - Push to File button (calls `api.pushCodeToFile`, with `window.confirm` first)
   - Sync button (calls `api.syncCodeFromDisk`, updates state on conflict)
   - Diff toggle (uses SnippetEditor's existing diff mode)
   - File path display (relative to project root)
4. Renders status bar below editor:
   - Dirty/Clean badge (compare code to originalCode)
   - Conflict badge (red, shown when sync detected conflict)
   - Last pushed / last synced timestamps (relative)
5. Conflict banner at top when `conflict === true`:
   - "Keep Mine" → update originalCode = diskCode, keep code
   - "Take Disk Version" → set code = originalCode = diskCode
   - "View Side-by-Side" → show react-diff-viewer with diskCode vs code

**Edge cases:** Snippet not yet loaded, push fails mid-write, sync while editing.

---

### `FileBrowserDialog` React Component
**File:** `ui/src/components/dialogs/FileBrowserDialog.tsx`

**Pseudocode:**
1. Props: `open`, `onClose`, `onSelect(filePath: string)`
2. State: `currentPath` (starts at project root), `entries[]`, `selectedFile`, `loading`
3. On open / path change: fetch `GET /api/code/files?project=...&path=currentPath`
4. Render modal with:
   - Breadcrumb path bar at top
   - Entry list: directories (clickable to navigate), files (clickable to select)
   - Files >1MB shown grayed with "Too large" label
   - Selected file highlighted
   - "Link" button (disabled until file selected, calls onSelect)
   - "Cancel" button
5. Directories expand inline or navigate (lazy-load children)

---

### Sidebar "Code Files" Section
**File:** `ui/src/components/layout/Sidebar.tsx`

**Pseudocode:**
1. Add `codeFilesCollapsed` state (default false)
2. In the snippets useMemo, split into two lists:
   - `linkedSnippets`: those where `JSON.parse(content).linked === true`
   - `regularSnippets`: everything else (existing filter logic)
3. Render Code Files section (same pattern as Embeds section):
   - Only shown when `linkedSnippets.length > 0`
   - Header: "Code Files" + count badge + "Link File" button + collapse chevron
   - Each item: code icon, name, relative filePath (muted), orange dot if dirty, delete on hover
   - Click → `selectSnippet(item.id)`
4. Filter linked snippets OUT of the regular items list

---

### UnifiedEditor routing change
**File:** `ui/src/components/editors/UnifiedEditor.tsx`

**Pseudocode:**
1. In the `isSnippet(item)` branch, before rendering SnippetGroupView:
2. Parse `item.content` as JSON
3. If `parsed.linked === true`: render `<CodeEditor snippetId={item.id} />` instead
4. Otherwise: render existing `<SnippetGroupView />`

---

### API Client additions
**File:** `ui/src/lib/api.ts`

**New methods:**
```typescript
listProjectFiles(project: string, dirPath?: string): Promise<{ entries: FileEntry[] }>
pushCodeToFile(project: string, session: string, id: string): Promise<{ success, filePath, bytesWritten }>
syncCodeFromDisk(project: string, session: string, id: string): Promise<{ success, diskChanged, hasLocalEdits, conflict }>
getCodeDiff(project: string, session: string, id: string): Promise<{ localVsOriginal, localVsDisk }>
```

**Pattern:** Same as existing — fetch with encodeURIComponent params, return response.json().

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: path-security
    files: [src/utils/path-security.ts]
    tests: []
    description: "Path validation utility — validatePathUnderRoot, isBinaryFile, file size check"
    parallel: true
    depends-on: []

  - id: code-api
    files: [src/routes/code-api.ts]
    tests: []
    description: "REST endpoints — /api/code/files, /api/code/push/:id, /api/code/sync/:id, /api/code/diff/:id"
    parallel: false
    depends-on: [path-security]

  - id: mcp-tools
    files: [src/mcp/tools/code.ts]
    tests: []
    description: "5 MCP tool handlers — link_code_file, push_code_to_file, sync_code_from_disk, review_code_edits, list_code_files"
    parallel: false
    depends-on: [code-api]

  - id: mcp-setup
    files: [src/mcp/setup.ts]
    tests: []
    description: "Register 5 new tools in setup.ts tool list and case handlers"
    parallel: false
    depends-on: [mcp-tools]

  - id: server-register
    files: [src/server.ts]
    tests: []
    description: "Register handleCodeAPI route handler in server.ts"
    parallel: true
    depends-on: [code-api]

  - id: api-client
    files: [ui/src/lib/api.ts]
    tests: []
    description: "Add listProjectFiles, pushCodeToFile, syncCodeFromDisk, getCodeDiff methods"
    parallel: true
    depends-on: [code-api]

  - id: code-editor
    files: [ui/src/components/editors/CodeEditor.tsx]
    tests: []
    description: "CodeEditor component wrapping SnippetEditor with push/sync/diff toolbar and status bar"
    parallel: false
    depends-on: [api-client]

  - id: file-browser
    files: [ui/src/components/dialogs/FileBrowserDialog.tsx]
    tests: []
    description: "File picker modal with lazy-loaded directory tree"
    parallel: false
    depends-on: [api-client]

  - id: unified-editor
    files: [ui/src/components/editors/UnifiedEditor.tsx]
    tests: []
    description: "Route linked snippets (linked: true) to CodeEditor instead of SnippetGroupView"
    parallel: false
    depends-on: [code-editor]

  - id: sidebar
    files: [ui/src/components/layout/Sidebar.tsx]
    tests: []
    description: "Add collapsible Code Files section, filter linked snippets from regular list, Link File button"
    parallel: false
    depends-on: [file-browser]
```

### Execution Waves

**Wave 1 (parallel):**
- path-security

**Wave 2 (parallel):**
- code-api

**Wave 3 (parallel):**
- mcp-tools, server-register, api-client

**Wave 4 (parallel):**
- mcp-setup, code-editor, file-browser

**Wave 5 (parallel):**
- unified-editor, sidebar

### Summary
- Total tasks: 10
- Total waves: 5
- Max parallelism: 3 (Wave 3)