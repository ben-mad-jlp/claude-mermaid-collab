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

**Storage path:** `.collab/sessions/{name}/snippets/{id}.snippet` — same as regular snippets.

**Compatibility:** `parseSnippetData()` already extracts `code`, `language`, `filePath`, `originalCode` from the JSON envelope. The new fields (`linked`, `diskCode`, `linkCreatedAt`, `lastPushedAt`, `lastSyncedAt`, `dirty`) are additive — existing snippets without them are unaffected.

---

## MCP Tools

Five new tools in `src/mcp/tools/code.ts`.

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
2. Validate: file exists, is under project root, < 1 MB, not binary (null bytes in first 8 KB).
3. Auto-detect `language` from file extension.
4. Build JSON envelope with `linked: true`, all code fields = file contents, timestamps = now, `dirty: false`.
5. Create snippet via existing endpoint.
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
1. Read snippet envelope, extract `code` and `filePath`.
2. Validate `filePath` is under project root.
3. Write `code` to `filePath` on disk.
4. Update envelope: `originalCode = diskCode = code`, `dirty = false`, `lastPushedAt = now`.
5. Return `{ success: true, filePath, bytesWritten }`.

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
1. Read snippet envelope. Read file from disk.
2. If file deleted: return `{ diskChanged: true, fileDeleted: true, hasLocalEdits, conflict: false }`.
3. `diskChanged` = disk content !== stored `diskCode`.
4. `hasLocalEdits` = `code` !== `originalCode`.
5. `conflict` = both true.
6. Update `diskCode`. If no local edits and disk changed: auto-sync `originalCode` and `code` too.
7. Return `{ success: true, diskChanged, hasLocalEdits, conflict }`.

### `review_code_edits`

Claude retrieves the current state for review.

**Schema:**
```typescript
{
  project: string,   // required
  session: string,
  todoId: number,
  id: string,        // required
  format: 'full' | 'diff',  // default 'diff'
}
```

**Behavior:**
- `'diff'`: unified diff between `originalCode` and `code`.
- `'full'`: return all fields — `code`, `originalCode`, `diskCode`, `filePath`, `language`, `dirty`, `lastPushedAt`.

### `list_code_files`

List only linked code artifacts.

**Schema:**
```typescript
{
  project: string,   // required
  session: string,
  todoId: number,
}
```

**Returns:** `{ files: Array<{ id, name, filePath, language, dirty, lastPushedAt }> }`

---

## REST API Endpoints

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

- Validates path under project root.
- Skips: `node_modules`, `.git`, `.collab`, `.DS_Store`.
- Sorts: directories first, then alphabetical.

### `POST /api/code/push/:id`

Push code to disk file. Same logic as `push_code_to_file` MCP tool.

### `POST /api/code/sync/:id`

Sync from disk. Same logic as `sync_code_from_disk` MCP tool.

### `GET /api/code/diff/:id`

Returns:
```json
{
  "localVsOriginal": "--- original\n+++ local\n@@ ... @@\n ...",
  "localVsDisk": "--- disk\n+++ local\n@@ ... @@\n ..."
}
```

---

## UI Design

### Sidebar — "Code Files" Collapsible Section

- Only shown when linked snippets exist
- Each item: code bracket icon, display name, relative path (muted), orange dirty dot, delete on hover
- "Link File" button at section header opens file browser
- Linked snippets filtered OUT of regular snippets list

### File Browser Dialog

- Modal with recursive directory tree (lazy-loaded per directory)
- Server-side .gitignore filtering
- Click file to select, "Link" to confirm
- Files >1 MB shown grayed out with "Too large"

### Code Editor Panel

**Toolbar:**

| Button | Action |
|--------|--------|
| Save | Persist to session (local save) |
| Push to File | Write to disk (confirm dialog first) |
| Sync | Re-read from disk, detect conflicts |
| Diff | Toggle edit mode vs diff view |
| File path | Display relative path (non-interactive) |

**Status bar:**

| Indicator | Display |
|-----------|---------|
| Dirty/Clean | Green "Clean" or orange "Modified" |
| Conflict | Red "Conflict" badge |
| Last pushed | Relative timestamp or "Never pushed" |
| Last synced | Relative timestamp |

**Conflict resolution:**
- Warning banner: "File modified on disk while you have local edits"
- Keep Mine / Take Disk Version / View Side-by-Side

---

## Security

**Path validation on every operation.** Utility: `validatePathUnderRoot(filePath, projectRoot)`.

```
resolvedPath = path.resolve(filePath)
resolvedRoot = path.resolve(projectRoot)
IF !resolvedPath.startsWith(resolvedRoot + path.sep) AND resolvedPath !== resolvedRoot:
  throw SecurityError("Path escapes project root")
```

- Reject `..` segments before resolution (defense in depth)
- Don't follow symlinks that escape project root
- All validation server-side

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| File > 1 MB | Reject at link time |
| Binary file | Check first 8 KB for null bytes, reject |
| File outside project root | Security error |
| Permission denied | Clear EACCES error message |
| Concurrent edit (VS Code) | Manual sync detects, shows conflict if local edits |
| File deleted/moved | Sync returns fileDeleted, Push disabled, warning shown |
| Many code artifacts (50+) | Metadata-only listing, content on demand |
| Empty file | Allowed |
| No extension | Language defaults to "text" |

---

## Implementation Order

### Phase 1 — Backend
1. `src/utils/path-security.ts` — path validation, binary detection
2. `src/mcp/tools/code.ts` — 5 MCP tool handlers
3. `src/mcp/setup.ts` — register tools
4. `src/routes/code-api.ts` — REST endpoints

### Phase 2 — Frontend
5. `ui/src/lib/api.ts` — API client methods
6. `ui/src/components/editors/CodeEditor.tsx` — editor with push/sync/diff
7. `ui/src/components/editors/UnifiedEditor.tsx` — route linked snippets to CodeEditor
8. `ui/src/components/layout/Sidebar.tsx` — Code Files section
9. `ui/src/components/dialogs/FileBrowserDialog.tsx` — file picker

### Phase 3 — Polish
10. Conflict resolution UI
11. Binary file detection
12. Tests