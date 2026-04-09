# Code Artifact Feature

## Overview

A new "Code" artifact type that links to actual source code files on disk, allowing users to view, edit, and push changes back — all within the mermaid-collab UI. Claude can also review edits and push changes via MCP tools.

Code artifacts are **snippets with `linked: true`** in their JSON envelope. No new `ItemType` is added to `ui/src/types/item.ts`. They are stored in the same `.collab/sessions/{name}/snippets/{id}.snippet` location and use the existing version history mechanism from `SnippetManager`.

**Out of Scope:** partial file extraction (no startAt/endAt/anchor for linked code), real-time file watching, git integration, LSP/autocomplete, debugging, multi-file refactoring, mobile layout.

---

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Built on snippets | Reuse existing storage, versioning, CRUD, and UI routing. A linked code artifact is just a snippet whose JSON envelope has `linked: true`. |
| 2 | Full files only | No partial extraction for linked code. The entire file is loaded. Simplifies conflict detection and push-back. |
| 3 | Push confirmation in UI | UI shows a confirm dialog before writing to disk. Prevents accidental overwrites. |
| 4 | Claude can push without confirmation | `push_code_to_file` is a normal MCP tool. Claude is trusted. |
| 5 | No backup files | Trust git for safety. No `.bak` or shadow copies. |
| 6 | File browser in v1 | UI gets a "Link File" button with a project directory tree picker via a new `/api/project/files` endpoint. |
| 7 | 1 MB file size limit | Reject files >1 MB or binary files at link time. Keeps the UI responsive and avoids loading large assets. |

---

## Data Model

### Snippet JSON Envelope (linked code)

A linked code artifact is a snippet whose `.snippet` file contains a JSON envelope with these fields:

```json
{
  "code": "... current edited code ...",
  "language": "typescript",
  "filePath": "/absolute/path/to/source/file.ts",
  "originalCode": "... code when first linked or last synced ...",
  "diskCode": "... code as currently on disk (refreshed on sync) ...",
  "linked": true,
  "linkCreatedAt": 1712000000000,
  "lastPushedAt": null,
  "lastSyncedAt": 1712000000000,
  "dirty": false
}
```

**Field definitions:**

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Current edited code in the UI. This is what gets pushed to disk. |
| `language` | string | Language identifier for syntax highlighting. Auto-detected from file extension using the existing `EXT_TO_LANGUAGE` map in `src/mcp/tools/snippet.ts`. |
| `filePath` | string | Absolute path to the source file on disk. Validated to be under the project root on every operation. |
| `originalCode` | string | Snapshot of the code when first linked or after the last sync/push. Used as the base for diff computation. |
| `diskCode` | string | Snapshot of the on-disk file content at the last sync. Enables detection of external changes (e.g., someone edited the file in VS Code). |
| `linked` | boolean | Always `true` for linked code artifacts. Distinguishes from regular snippets. |
| `linkCreatedAt` | number | Timestamp (ms) when the link was first created. |
| `lastPushedAt` | number \| null | Timestamp (ms) of the last push to disk. `null` if never pushed. |
| `lastSyncedAt` | number | Timestamp (ms) of the last read from disk. |
| `dirty` | boolean | `true` when `code` differs from `originalCode`. Computed on save. |

**Storage path:** `.collab/sessions/{name}/snippets/{id}.snippet` — same as regular snippets. The existing `SnippetManager` handles read/write/versioning with no changes to its core logic. The `id` is derived from the file basename (sanitized), same as `SnippetManager.createSnippet()`.

**Compatibility with existing snippet tools:** `parseSnippetData()` in `SnippetEditor.pseudo` already extracts `code`, `language`, `filePath`, `originalCode` from the JSON envelope. The new fields (`linked`, `diskCode`, `linkCreatedAt`, `lastPushedAt`, `lastSyncedAt`, `dirty`) are additive — existing snippets without them are unaffected.

---

## MCP Tools

Five new tools in `src/mcp/tools/code.ts`, following the same patterns as `src/mcp/tools/snippet.ts`: schemas defined as exported consts, handler functions that call the REST API on localhost, `sessionParamsDesc` reused for project/session/todoId parameters.

### `link_code_file`

Create a linked code artifact from a source file.

**Schema:**
```typescript
{
  project: string,   // required — absolute path to project root
  session: string,   // session name (session or todoId required)
  todoId: number,    // alternative to session
  filePath: string,  // required — absolute path to source file
  name: string,      // optional — display name, defaults to basename
}
```

**Behavior:**
1. Read the full file from disk at `filePath`.
2. Validate:
   - File exists (ENOENT → clear error).
   - `filePath` is under `project` root after `path.resolve()` canonicalization.
   - File size < 1 MB.
   - Not binary: read first 8 KB, reject if null bytes found.
3. Auto-detect `language` from file extension using `EXT_TO_LANGUAGE`.
4. Build the JSON envelope with `linked: true`, `code = originalCode = diskCode = fileContents`, timestamps set to `Date.now()`, `dirty: false`.
5. Call `POST /api/snippets` to create the snippet (reuse existing snippet creation endpoint).
6. Return `{ success: true, id: string }`.

### `push_code_to_file`

Write local edits back to the source file on disk.

**Schema:**
```typescript
{
  project: string,   // required
  session: string,
  todoId: number,
  id: string,        // required — snippet ID
}
```

**Behavior:**
1. Read the snippet via `GET /api/snippets/:id`.
2. Parse the JSON envelope, extract `code` and `filePath`.
3. Validate `filePath` is under `project` root.
4. Write `code` to `filePath` on disk.
5. Update the envelope: `originalCode = diskCode = code`, `dirty = false`, `lastPushedAt = Date.now()`.
6. Save the updated envelope via `PATCH /api/snippets/:id`.
7. Return `{ success: true, filePath: string, bytesWritten: number }`.

### `sync_code_from_disk`

Re-read the on-disk file to detect external changes and conflicts.

**Schema:**
```typescript
{
  project: string,   // required
  session: string,
  todoId: number,
  id: string,        // required — snippet ID
}
```

**Behavior:**
1. Read the snippet envelope.
2. Read the file from disk at `filePath`.
3. If file deleted/moved: return `{ success: true, diskChanged: true, fileDeleted: true, hasLocalEdits, conflict: false }`.
4. Compare disk content to stored `diskCode`:
   - `diskChanged` = disk content !== stored `diskCode`.
5. Compare `code` to `originalCode`:
   - `hasLocalEdits` = `code` !== `originalCode`.
6. `conflict` = both `diskChanged` and `hasLocalEdits` are true.
7. Update `diskCode` to current disk content. Update `lastSyncedAt = Date.now()`.
8. If no local edits and disk changed: also update `originalCode` and `code` to disk content (auto-sync).
9. Save updated envelope.
10. Return `{ success: true, diskChanged, hasLocalEdits, conflict }`.

### `review_code_edits`

Retrieve the current state of a linked code artifact for Claude to review.

**Schema:**
```typescript
{
  project: string,   // required
  session: string,
  todoId: number,
  id: string,        // required — snippet ID
  format: 'full' | 'diff',  // default 'diff'
}
```

**Behavior:**
- If `format === 'diff'`: compute and return a unified diff between `originalCode` and `code`. Use a simple line-based diff algorithm (or the `diff` npm package).
- If `format === 'full'`: return `{ code, originalCode, diskCode, filePath, language, dirty, lastPushedAt }`.

### `list_code_files`

List only linked code artifacts in the current session.

**Schema:**
```typescript
{
  project: string,   // required
  session: string,
  todoId: number,
}
```

**Behavior:**
1. Call `GET /api/snippets` to list all snippets.
2. For each snippet, parse the JSON envelope and filter to those with `linked: true`.
3. Return `{ files: Array<{ id, name, filePath, language, dirty, lastPushedAt }> }`.

### Tool Registration

Register all 5 tools in `src/mcp/setup.ts` following the existing pattern — add entries to the tools array with schema and handler references. Tool names: `link_code_file`, `push_code_to_file`, `sync_code_from_disk`, `review_code_edits`, `list_code_files`.

---

## REST API Endpoints

New endpoints added to `src/routes/api.ts` (or a new `src/routes/code-api.ts` registered in `src/server.ts`, following the `handlePseudoAPI` pattern from the pseudo-viewer design). All endpoints require `project` and `session` query parameters.

### `GET /api/project/files`

List directory contents for the file browser dialog.

**Query params:** `project` (required), `path` (optional, defaults to project root).

**Response:**
```json
{
  "entries": [
    { "name": "src", "path": "/abs/path/src", "type": "directory" },
    { "name": "index.ts", "path": "/abs/path/index.ts", "type": "file", "size": 1234, "extension": ".ts" }
  ]
}
```

**Behavior:**
- Validate `path` is under `project` root (security).
- Read directory contents with `readdir`.
- Skip entries matching `.gitignore` patterns. At minimum, hard-skip: `node_modules`, `.git`, `.collab`, `.DS_Store`.
- For files: include `size` (from `stat`) and `extension`.
- Sort: directories first, then alphabetical.

### `POST /api/code/push/:id`

Push code to disk file.

**Query params:** `project`, `session`.

**Behavior:** Same as the `push_code_to_file` MCP tool — reads snippet, validates path, writes to disk, updates envelope.

**Response:** `{ success: true, filePath, bytesWritten }` or error.

### `POST /api/code/sync/:id`

Sync from disk.

**Query params:** `project`, `session`.

**Behavior:** Same as `sync_code_from_disk` MCP tool.

**Response:** `{ success: true, diskChanged, hasLocalEdits, conflict }` or error.

### `GET /api/code/diff/:id`

Get unified diffs for a linked code artifact.

**Query params:** `project`, `session`.

**Response:**
```json
{
  "localVsOriginal": "--- original\n+++ local\n@@ ... @@\n ...",
  "localVsDisk": "--- disk\n+++ local\n@@ ... @@\n ..."
}
```

---

## UI Design

### Sidebar — "Code Files" Collapsible Section

**Location:** New collapsible section in `ui/src/components/layout/Sidebar.tsx`, positioned between the existing artifact list and the todo section (follow the existing pattern for how Embeds/Blueprints sections are structured in `filteredItems`).

**Visibility:** Only shown when at least one linked snippet exists in the session.

**Each item shows:**
- Code bracket icon (`</>`) — distinct from the regular snippet icon.
- Display name (file basename or custom name).
- Relative file path in smaller, muted text (relative to project root).
- Orange dot indicator when `dirty === true` (local edits exist).
- Delete button on hover (same pattern as other sidebar items via `handleDeleteItem`).

**"Link File" button:** Shown at the section header. Opens the file browser dialog.

**Filtering:** Linked snippets (`linked: true`) are filtered OUT of the regular snippets list in `filteredItems` to avoid duplication. They appear only in the Code Files section.

### File Browser Dialog

**Component:** `ui/src/components/dialogs/FileBrowserDialog.tsx`

**Trigger:** "Link File" button in the Code Files sidebar section.

**Layout:** Modal dialog with a directory tree. Reuse the same tree-rendering pattern as `PseudoFileTree` (recursive collapsible nodes).

**Data source:** Fetches directory listing from `GET /api/project/files`. Lazy-loads subdirectories on expand (each expand triggers a new API call with the directory path).

**Behavior:**
- Shows files and folders, collapsible directory nodes.
- Respects `.gitignore` (server-side filtering).
- Click a file to select it (highlighted). Click "Link" to confirm and create the linked code artifact.
- Shows file size next to each file entry. Files >1 MB are shown but grayed out with a "Too large" label.
- Binary files are rejected after selection with an error toast (binary check happens server-side during `link_code_file`).

### Code Editor Panel

**Component:** `ui/src/components/editors/CodeEditor.tsx`

**Routing:** When a linked snippet is selected, `UnifiedEditor.tsx` renders `CodeEditor` instead of `SnippetEditor`. Detection: parse the snippet's JSON envelope, check for `linked: true`.

**CodeEditor wraps/extends SnippetEditor** with additional toolbar controls and a status bar. It reuses the same `CodeMirrorWrapper` for the actual editing surface.

**Toolbar (above editor):**

| Button | Icon | Action |
|--------|------|--------|
| Save | Floppy disk | Persists to session snippet file (local save). Same as existing snippet save. |
| Push to File | Upload arrow | Writes `code` to disk at `filePath`. Shows a confirm dialog first: "Push changes to `{relativePath}`?" with OK/Cancel. Calls `POST /api/code/push/:id`. |
| Sync | Refresh | Re-reads from disk. Calls `POST /api/code/sync/:id`. If conflict detected, shows conflict banner. |
| Diff | Split-screen toggle | Switches between edit mode and diff view (local edits vs. `originalCode`). Uses the existing diff toggle pattern from `SnippetEditor.handleDiffToggle()`. |
| File path | Text display | Shows the relative file path (relative to project root). Non-interactive, muted text. |

**Status bar (below editor):**

| Indicator | Display |
|-----------|---------|
| Dirty/Clean | Green "Clean" or orange "Modified" badge. |
| Conflict | Red "Conflict" badge when sync detects both local and disk changes. |
| Last pushed | "Pushed 2m ago" or "Never pushed" — relative timestamp. |
| Last synced | "Synced 30s ago" — relative timestamp. |

**Conflict state:**
- When `POST /api/code/sync/:id` returns `conflict: true`, show a warning banner at the top of the editor: "This file has been modified on disk while you have local edits."
- Banner offers three actions:
  - **Keep Mine** — discard `diskCode` changes, keep current `code`. Updates `originalCode = diskCode` (acknowledges disk state without adopting it).
  - **Take Disk Version** — replace `code` and `originalCode` with `diskCode`. Loses local edits.
  - **View Side-by-Side** — opens a side-by-side diff view using the existing `react-diff-viewer-continued` dependency. Left = disk version, right = local version.

---

## Security

**Critical: Path validation on every operation.**

All file path operations must validate that the resolved path is under the project root. This applies to:
- `link_code_file` — validate `filePath` starts with `project` after `path.resolve()`.
- `push_code_to_file` — validate `filePath` starts with `project`.
- `GET /api/project/files` — validate `path` starts with `project`.
- `POST /api/code/push/:id` — validate `filePath` from envelope starts with `project`.
- `POST /api/code/sync/:id` — validate `filePath` from envelope starts with `project`.

**Implementation:** Create a utility function `validatePathUnderRoot(filePath: string, projectRoot: string): string` in a shared location (e.g., `src/utils/path-security.ts`).

```
resolvedPath = path.resolve(filePath)
resolvedRoot = path.resolve(projectRoot)
IF !resolvedPath.startsWith(resolvedRoot + path.sep) AND resolvedPath !== resolvedRoot:
  throw SecurityError("Path escapes project root")
return resolvedPath
```

**Additional protections:**
- Reject paths containing `..` segments before resolution (defense in depth).
- Do NOT follow symlinks that escape the project root. Use `fs.realpath()` and re-validate.
- All path validation happens server-side. The UI sends paths but the server is the trust boundary.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| File > 1 MB | Reject at link time with clear error: "File exceeds 1 MB limit ({actualSize})". |
| Binary file | Check first 8 KB for null bytes (`Buffer.indexOf(0x00)`). Reject if found: "Binary files cannot be linked." |
| File outside project root | Reject with security error: "Path is outside the project directory." |
| Permission denied on read | Catch `EACCES`, return: "Permission denied: cannot read {path}." |
| Permission denied on write | Catch `EACCES`, return: "Permission denied: cannot write to {path}." |
| Concurrent edit (user edits in VS Code) | Manual sync via Sync button detects it. If local edits exist, shows conflict. If no local edits, auto-updates. |
| File deleted/moved on disk | Sync returns `fileDeleted: true`. UI disables Push button, shows warning: "Source file no longer exists on disk." Editor remains usable for viewing/copying content. |
| File renamed on disk | Same as deleted — the artifact retains its content. Push is disabled. User can delete the artifact and re-link the renamed file. |
| Session archived | Linked artifacts preserved in session data. No special cleanup needed. Push would fail if the source file no longer exists, but that's expected. |
| Many code artifacts (50+) | `list_code_files` returns metadata only (no file content). Content is loaded on demand when the user selects an artifact. |
| Snippet ID collision | If a file basename collides with an existing snippet ID, `SnippetManager.createSnippet()` already throws "already exists". The user can provide a custom `name` to avoid this. |
| Empty file | Allowed. Links successfully with `code = ""`. |
| File with no extension | Language defaults to `"text"`. |

---

## What This Is NOT

- Not a full IDE — no autocomplete, no LSP, no IntelliSense.
- No debugging, no run/execute, no terminal integration.
- No git integration — "Push to File" writes bytes, does not commit.
- No real-time file watching — sync is manual (user clicks Sync or Claude calls `sync_code_from_disk`).
- No multi-file refactoring.
- Not trying to replace VS Code.

---

## Implementation Order

### Phase 1 — Backend

| # | File | Description |
|---|------|-------------|
| 1 | `src/utils/path-security.ts` | Path validation utility: `validatePathUnderRoot()`, binary detection helper, file size check. |
| 2 | `src/mcp/tools/code.ts` | 5 new MCP tool handlers (`link_code_file`, `push_code_to_file`, `sync_code_from_disk`, `review_code_edits`, `list_code_files`) with schemas. Follow `src/mcp/tools/snippet.ts` patterns. |
| 3 | `src/mcp/setup.ts` | Register the 5 new tools. |
| 4 | `src/routes/api.ts` | Add `/api/project/files`, `/api/code/push/:id`, `/api/code/sync/:id`, `/api/code/diff/:id` endpoints. Alternatively, create `src/routes/code-api.ts` and register in `src/server.ts` (following the `handlePseudoAPI` pattern). |

### Phase 2 — Frontend

| # | File | Description |
|---|------|-------------|
| 5 | `ui/src/lib/api.ts` | Add API client methods: `linkCodeFile()`, `pushCodeToFile()`, `syncCodeFromDisk()`, `getCodeDiff()`, `listProjectFiles()`. |
| 6 | `ui/src/components/editors/CodeEditor.tsx` | Editor wrapping SnippetEditor with push/sync/diff toolbar and status bar. |
| 7 | `ui/src/components/editors/UnifiedEditor.tsx` | Route linked snippets (detect `linked: true` in envelope) to CodeEditor instead of SnippetEditor. |
| 8 | `ui/src/components/layout/Sidebar.tsx` | Add "Code Files" collapsible section. Filter linked snippets out of the regular list. |
| 9 | `ui/src/components/dialogs/FileBrowserDialog.tsx` | File picker modal with lazy-loaded directory tree. |

### Phase 3 — Polish

| # | Area | Description |
|---|------|-------------|
| 10 | Conflict resolution UI | Warning banner, Keep Mine / Take Disk / Side-by-Side actions in CodeEditor. |
| 11 | Binary file detection | Server-side null-byte check in first 8 KB during link. |
| 12 | Tests | Unit tests for path validation, binary detection, envelope parsing. Integration tests for link → edit → push → sync flow. |
