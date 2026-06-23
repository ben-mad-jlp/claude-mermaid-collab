# Design: Code File and Snippet Artifact Redesign

**Status**: Decisions Incorporated  
**Date**: 2026-04-22  
**Session**: code-and-snippets

---

## 1. Problem Statement

### The "linked flag in JSON envelope" anti-pattern

The current system encodes both plain Snippets and Code File artifacts as `Snippet` records with `type: 'snippet'` in `ItemType`. The only discriminator is a `linked: true` boolean buried inside a JSON envelope stored as the `content` string of the record.

This causes several structural problems:

**Type unsafety at every layer.** Every handler in `src/routes/code-api.ts` must parse `snippet.content`, check `envelope.linked`, and return a `400` if the flag is absent. The type system cannot prevent a caller from passing a plain snippet ID to a push or sync endpoint. The check `if (!envelope.linked) return jsonError(...)` appears seven times across route handlers alone.

**Runtime routing in the UI.** `UnifiedEditor.tsx` contains this pattern:
```ts
const parsed = JSON.parse(item.content || '');
if (parsed.linked === true) {
  return <CodeEditor snippetId={item.id} />;
}
```
The editor component rendered for an item is determined by parsing its content blob, not by its declared type. Adding a new variant requires adding another content-parse branch.

**Conceptual conflation.** A Snippet and a Code File have fundamentally different identities and lifecycles:
- A Snippet is a knowledge artifact identified by a UUID. It is immutable in reference — you can update its content, but the thing *is* the UUID.
- A Code File artifact is a live mirror of a specific file on disk. Its identity is `filePath`. If two sessions link the same file, they are logically referencing the same entity. The UUID indirection obscures this.

**Coupling that prevents simplification.** Because they share `ItemType = 'snippet'`, the sidebar, the MCP tools, and the REST API all serve both kinds of artifacts through the same surface. Removing "push to file" capability from Snippets requires adding guard clauses everywhere rather than simply removing endpoints for a distinct type.

**Envelope field sprawl.** The linked snippet envelope has grown to ~12 fields (`code`, `language`, `filePath`, `originalCode`, `diskCode`, `linked`, `linkCreatedAt`, `lastPushedAt`, `lastSyncedAt`, `dirty`, `proposedEdit`, `annotations`). Plain snippets also carry several of these fields meaninglessly — `originalCode` is set when created from a `sourcePath`, and `filePath` is stored even though there is no disk binding intended.

---

## 2. Proposed Types

### 2.1 Snippet

A Snippet is a pure code blob: a knowledge artifact, not a file mirror. It has no live disk binding and supports no push, sync, or accept/reject workflow.

**Backend schema** (`src/types.ts`):

```ts
export interface SnippetTag {
  type: 'file' | 'symbol' | 'layer' | 'domain';
  value: string;               // e.g. "src/auth/login.ts", "UserService.login", "utility", "react"
  resolvedPath?: string;       // absolute path, client-cached after on-demand resolution (file tags only)
  lastResolvedAt?: string;     // ISO timestamp of last successful resolution — client-written, server never sets
}

export interface Snippet {
  id: string;                  // UUID — primary key
  name: string;                // display name, typically includes extension
  content: string;             // raw code — NOT a JSON envelope
  language: string;            // explicit language field (no longer parsed from content)
  tags: SnippetTag[];          // 0–N typed tags; loose references only, no live disk binding
  lastModified: number;
}
```

**Key design decisions:**
- `content` is raw code. No JSON envelope. Language is a first-class field alongside content, not embedded in JSON.
- `tags` replaces the old `filePath` informational display. A `{ type: 'file', value: 'src/auth/login.ts' }` tag says "this snippet relates to that file" without creating any disk binding.
- No `filePath`, `originalCode`, `diskCode`, `linked`, `dirty`, `proposedEdit`, `groupId`, `groupName`. Those fields are either removed or moved to the Code File type.
- `groupId`/`groupName` are **removed entirely** — group tabs are not carried forward into the redesign (see §5.4 and §D1).

**Storage**: `.collab/sessions/{name}/snippets/{id}.snippet` — same directory as today. The file format changes from a JSON envelope to a structured JSON record with explicit fields:

```json
{
  "id": "abc-123",
  "name": "useAuth.ts",
  "content": "export function useAuth() { ... }",
  "language": "typescript",
  "tags": [
    { "type": "file", "value": "src/hooks/useAuth.ts", "resolvedPath": "/abs/project/src/hooks/useAuth.ts", "lastResolvedAt": "2026-04-22T10:00:00Z" }
  ],
  "lastModified": 1745312400000
}
```

### 2.2 Code File

A Code File artifact represents the entire content of one specific file on disk. It is session-scoped (you link a file within a session) but the `filePath` is its logical primary key — two Code File artifacts in the same session with the same `filePath` would be a conflict.

**Backend schema** (`src/types.ts`):

```ts
export interface ProposedEdit {
  newCode: string;
  message?: string;
  proposedBy: string;
  proposedAt: number;
}

export interface CodeFile {
  id: string;                  // UUID — storage key
  filePath: string;            // absolute path — logical primary key; unique within a session
  name: string;                // display name (defaults to basename)
  content: string;             // full current file content — IS the disk content (synced live)
  language: string;
  contentHash: string;         // sha256 of `content` — used for change detection only
  dirty: boolean;              // true when content has local edits not yet pushed to disk
  linkCreatedAt: number;
  lastPushedAt: number | null;
  lastSyncedAt: number | null;
  proposedEdit?: ProposedEdit; // pending AI-proposed change awaiting user decision
  lastModified: number;
}
```

**Key design decisions:**
- Full file content only. No `startAt`/`endAt` partial extraction. The artifact represents the entire file.
- `filePath` is the logical primary key. The `id` UUID is the storage key for compatibility with existing session infrastructure.
- **`content` IS the disk content** — the artifact is the live mirror of the file. Syncing updates `content` in place; there is no separate `diskContent` field.
- `originalContent` is **dropped** — no baseline tracking needed. `dirty` is set explicitly when the user edits locally without pushing.
- `contentHash` exists solely for cheap change detection; it is not used as a diff baseline.
- No `annotations` at the artifact level. Annotations (if any) live in a separate system.
- `ProposedEdit` is extracted to its own named interface.

**Storage**: `.collab/sessions/{name}/code-files/{id}.codefile` — a new subdirectory, separate from `snippets/`. This makes the type split visible on disk and avoids any ambiguity during migration.

---

## 3. ItemType Enum Change

**File**: `ui/src/types/item.ts`

```ts
// Before
export type ItemType = 'diagram' | 'document' | 'design' | 'spreadsheet' | 'snippet' | 'embed' | 'image';

// After
export type ItemType = 'diagram' | 'document' | 'design' | 'spreadsheet' | 'snippet' | 'code' | 'embed' | 'image';
```

All switch/map exhaustiveness checks over `ItemType` must be updated:
- `getItemLabel` → add `code: 'Code File'`
- `getItemIconPath` → add icon path for `code` (suggest: a file with a `</>` symbol — different from the snippet doc icon)
- `getItemColor` → add `code: 'teal'` (distinct from snippet's orange)
- `getItemColorValue` → add `code: '#14b8a6'`
- `isItemType` type guard → add `value === 'code'`
- New type guard: `isCodeFile(item): item is Item & { type: 'code' }`

The backend `ItemType` equivalent is currently implicit in how `ArtifactTree` and `UnifiedEditor` switch on type strings. Both need a `'code'` case added.

---

## 4. Migration

### 4.1 What gets migrated

Every existing `.snippet` file where `JSON.parse(content).linked === true` is a Code File in disguise and must be migrated to a `.codefile` record.

### 4.2 Migration strategy

A one-time migration script runs at server startup (or on first access to a session) and is idempotent:

1. **Detect**: For each `{id}.snippet` file in `.collab/sessions/{name}/snippets/`:
   - Parse the content as JSON.
   - If `envelope.linked === true` → this is a candidate for migration.
   - If `envelope.linked !== true` but `envelope.filePath` is present → flag as a plain snippet with a stale `filePath` reference (no migration needed, but `filePath` should be converted to a `{ type: 'file' }` tag).

2. **Migrate linked snippets → Code Files**:
   - Create `.collab/sessions/{name}/code-files/{id}.codefile` with fields mapped as:
     - `id` → `id`
     - `name` → `name`
     - `envelope.code` → `content`
     - `envelope.language` → `language`
     - `sha256(content)` → `contentHash`
     - `envelope.dirty` → `dirty`
     - (`originalCode` and `diskCode` are **discarded** — these fields no longer exist on `CodeFile`)
     - `envelope.linkCreatedAt` → `linkCreatedAt`
     - `envelope.lastPushedAt` → `lastPushedAt`
     - `envelope.lastSyncedAt` → `lastSyncedAt`
     - `envelope.proposedEdit` → `proposedEdit` (if present)
     - `lastModified` → `lastModified`
   - Delete the original `.snippet` file.
   - Write a `.collab/sessions/{name}/.migrated-code-files` sentinel after all snippets in the session have been processed, to prevent re-migration.

3. **Migrate plain snippets with `filePath`**:
   - Convert `envelope.filePath` → `tags: [{ type: 'file', value: relative(project, filePath) }]`
   - Remove `filePath`, `originalCode` from the envelope.
   - Rewrite the file with the new flat format (raw code in `content`, explicit `language`, `tags` array).

4. **Migrate clean plain snippets** (no `filePath`, no `linked`):
   - Extract `envelope.code` as the new `content`.
   - Extract `envelope.language` as the new `language`.
   - Write flat format.

### 4.3 Rollback

The migration script creates a backup: `.collab/sessions/{name}/snippets-backup-{timestamp}/` containing copies of all original `.snippet` files before transformation. Rollback restores from backup and removes the sentinel file.

### 4.4 Session metadata

The `ArtifactTree` currently reads snippet counts and IDs from session state. After migration, it must also read from `code-files/`. The session registry's `resolvePath` helper needs a `'code-files'` directory type added.

---

## 5. What Gets Removed from Snippet

### 5.1 MCP tool parameters removed from `create_snippet`

| Parameter | Current behavior | After redesign |
|-----------|-----------------|----------------|
| `sourcePath` | Reads file from disk, sets `filePath`, `originalCode`, `language` | **Removed**. Use `create_code` to link a file. If the user wants a snippet seeded from a file's content, they copy-paste or the agent reads the file and passes `content` directly. |
| `startAt` / `endAt` | Partial extraction anchors | **Removed** (depended on `sourcePath`). |

`create_snippet` after redesign: `project, session?, name, content, language, tags?`

### 5.2 MCP tools that move to Code File only

These tools currently operate on snippets via `envelope.linked === true`. After redesign they operate on `code` type artifacts only and are removed from any snippet surface:

| Tool | Disposition |
|------|-------------|
| `link_code_file` | Renamed to `create_code` — creates a `CodeFile` artifact |
| `push_code_to_file` | Stays — operates on `code` artifacts only |
| `sync_code_from_disk` | Stays — operates on `code` artifacts only |
| `review_code_edits` | Stays — operates on `code` artifacts only |
| `propose_code_edit` | Stays — operates on `code` artifacts only |
| `wait_for_edit_decision` | Stays — operates on `code` artifacts only |
| `list_code_files` | Stays — lists `code` artifacts |

### 5.3 REST routes that become Code File only

All routes under `/api/code/push`, `/api/code/sync`, `/api/code/diff`, `/api/code/proposed-edit/**`, and `/api/code/record-edit-decision` already guard on `envelope.linked`. After the migration these routes switch to reading from the `code-files/` directory instead of `snippets/`. The `if (!envelope.linked) return jsonError(...)` guard clauses are deleted.

### 5.4 UI controls removed from Snippet surface

| Control / Component | Location | Disposition |
|---------------------|----------|-------------|
| Push to file button | `CodeEditor.tsx` toolbar | Moved to `CodeEditor` (Code File editor) only; not shown in `SnippetEditor` |
| Sync from disk button | `CodeEditor.tsx` toolbar | Same — Code File only |
| Accept / Reject proposed edit | `CodeEditor.tsx` + `MonacoDiffEditor` | Code File only |
| Diff against disk modal | `DiffAgainstDiskModal.tsx` | Code File only |
| `filePath` display in `SnippetEditor` | Lines 450–452 `SnippetEditor.tsx` | **Removed from SnippetEditor**. Snippets no longer have a `filePath` field. File references appear as tags in the tag UI instead. |
| `groupId`/`groupName` tab grouping | `SnippetEditor` / `SnippetGroupView` | **Removed entirely.** `SnippetGroupView` is deleted. Grouped snippets become independent items on migration. |

### 5.5 `UnifiedEditor` routing change

The current pattern:
```ts
if (item.type === 'snippet') {
  const parsed = JSON.parse(item.content || '');
  if (parsed.linked === true) return <CodeEditor />;
  return <SnippetGroupView />;
}
```

Becomes:
```ts
if (item.type === 'code') return <CodeEditor item={item} />;
if (item.type === 'snippet') return <SnippetEditor item={item} />;
```

No content parsing required in the router.

---

## 6. MCP API Changes

### 6.1 `create_snippet` (updated)

```ts
{
  project: string;
  session?: string;
  name: string;               // include extension for syntax highlighting, e.g. "auth.ts"
  content: string;            // raw code — no JSON envelope
  language?: string;          // auto-detected from name extension if omitted
  tags?: Array<{
    type: 'file' | 'symbol' | 'layer' | 'domain';
    value: string;
  }>;
}
// Returns: { id: string }
```

Removed: `sourcePath`, `startAt`, `endAt`, `groupId`, `groupName`.

### 6.2 `update_snippet` (updated)

```ts
{
  project: string;
  session?: string;
  id: string;
  content?: string;
  language?: string;
  tags?: SnippetTag[];        // replaces entire tags array if provided
}
// Returns: { id: string }
```

Removed: envelope-merge behavior (no longer needed — fields are explicit).

### 6.3 `create_code` (new — replaces `link_code_file`)

```ts
{
  project: string;
  session: string;
  filePath: string;           // absolute path to the file to link
  name?: string;              // display name (defaults to basename)
}
// Returns: { id: string; filePath: string; existed?: true }
// Idempotent: if filePath is already linked in the session, returns the existing artifact's id
// with existed: true — no error, no duplicate created.
```

### 6.4 `update_code` (new)

```ts
{
  project: string;
  session: string;
  id: string;
  content: string;            // full new file content
}
// Updates content, recalculates contentHash, sets dirty = true (local edit not yet pushed)
// Returns: { id: string; dirty: boolean; contentHash: string }
```

### 6.5 `push_code_to_file` (unchanged surface, updated internals)

```ts
{
  project: string;
  session: string;
  id: string;                 // Code File artifact ID
}
// Returns: { success: boolean; filePath: string; bytesWritten: number }
```

Internally: reads from `code-files/` directory, no `envelope.linked` check needed.

### 6.6 `sync_code_from_disk` (unchanged surface)

```ts
{
  project: string;
  session: string;
  id: string;
}
// Returns: { success: boolean; diskChanged: boolean; hasLocalEdits: boolean; conflict: boolean }
```

### 6.7 `review_code_edits` (unchanged surface, renamed field)

```ts
{
  project: string;
  session: string;
  id: string;
  format?: 'diff' | 'full';
}
// format='diff' returns: { id, filePath, language, diff }
// format='full' returns: { id, filePath, language, content, contentHash, dirty, lastPushedAt, lastSyncedAt }
```

Field renames from legacy envelope: `code` → `content`. `originalCode` and `diskCode` are dropped (no longer stored).

### 6.8 `propose_code_edit` (unchanged surface)

```ts
{
  project: string;
  session: string;
  id: string;
  newCode: string;
  message?: string;
}
```

### 6.9 `wait_for_edit_decision` (unchanged surface)

```ts
{
  project: string;
  session: string;
  id: string;
  timeoutMs?: number;
}
```

### 6.10 `list_code_files` (unchanged surface, updated internals)

```ts
{
  project: string;
  session: string;
}
// Returns: { files: Array<{ id, name, filePath, language, dirty, lastPushedAt }> }
```

Reads from `code-files/` directory. No JSON content parsing of snippets.

### 6.11 `get_snippet` (updated response shape)

Returns: `{ id, name, content, language, tags, lastModified }` — no longer returns `filePath` at top level.

### 6.12 `get_code` (new — analogous to `get_snippet` for Code Files)

```ts
{
  project: string;
  session: string;
  id: string;
}
// Returns: { id, name, filePath, language, content, contentHash, dirty, lastPushedAt, lastSyncedAt, proposedEdit? }
```

---

## 7. UI Changes

### 7.1 ArtifactTree sidebar split

**File**: `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx`

Currently all snippets appear under a single "Snippets" section. After redesign:

- **"Code Files" section** — shows all `type: 'code'` artifacts. Each node displays the file basename as primary label and the relative path (from project root) as a secondary line or tooltip. A "dirty" indicator (dot or asterisk) appears when `dirty === true`. A "pending edit" indicator appears when `proposedEdit` is set.
- **"Snippets" section** — shows all `type: 'snippet'` artifacts. Displays name and tag chips (up to 2–3 visible, rest in tooltip).

The two sections are independently collapsible and independently sorted (Code Files alphabetically by path; Snippets by `lastModified` descending by default).

### 7.2 PseudoTreeBody

**File**: `ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx`

The pseudo-file tree currently annotates files that have a linked snippet (i.e., `envelope.linked === true`). After redesign, it should annotate files that have a Code File artifact with the matching `filePath`. The lookup changes from iterating snippet content to iterating the `code-files/` index.

### 7.3 SnippetEditor — pure editor, no file controls

**File**: `ui/src/components/editors/SnippetEditor.tsx`

Changes:
- Remove `filePath` display block (current lines 450–452).
- Add **tag display and editing UI**: a tag strip below the editor toolbar showing current tags as pills. Each pill shows type icon + value. A "+" button opens a tag composer. File tags attempt path resolution and show a warning icon if the path no longer exists.
- Remove `groupId`/`groupName` rendering — group tabs are removed entirely (see §D1).
- Language dropdown stays — `language` is now an explicit field, not parsed from envelope.

### 7.4 CodeEditor — dedicated Code File editor

**File**: `ui/src/components/editors/CodeEditor.tsx`

Currently wraps `SnippetEditor` and injects toolbar controls. After redesign:

- Props change from `{ snippetId: string }` to `{ codeFileId: string }` (or `{ item: Item & { type: 'code' } }`).
- Uses a new `useCodeFile(id)` hook (analogous to `useSnippet`) that reads from the `code-files/` store.
- Toolbar controls (Push, Sync, Accept/Reject, diff view) stay — they are correct for Code Files.
- The internal `parseLinkedEnvelope` call is removed — fields are now directly on the artifact object.
- `MonacoDiffEditor` / `DiffAgainstDiskModal` remain attached to this component only.

### 7.5 UnifiedEditor routing

See §5.5 above. The content-parsing branch is replaced by a simple type switch.

### 7.6 Code File creation — pin-to-artifact flow

**The only way to create a Code File artifact from the UI is by pinning a file from the code tree browser.**

Flow:
1. User opens the code tree browser (the `kind: 'code-file'` tab / file explorer panel).
2. Clicking a file opens it as an **ephemeral view** — a read-only preview tab. No artifact is created. No session state is written.
3. The ephemeral tab shows a **Pin** button (or pin icon in the tab header). Pressing Pin calls `create_code` with the file's absolute path, creating a `code` type artifact in the current session.
4. The tab becomes permanent (pinned), the file appears in the "Code Files" sidebar section, and the full editor toolbar (Push, Sync, Propose Edit) becomes active.
5. Closing an unpinned ephemeral tab discards it with no side effects.

**Consequences:**
- No "New Code File" button in the sidebar. The entry point is always the file browser, which ensures `filePath` is always a real file that existed at link time.
- `promoteCodeFile` (in `ui/src/lib/promote-code-file.ts`) is the implementation point for the pin action — it calls `create_code` and updates the tab state from ephemeral to pinned.
- MCP tool `create_code` remains the agent-initiated path (bypasses the browser entirely).

### 7.7 Tag UI specification

Tags are displayed as compact pills in the Snippet editor header area:

- `file` tags: file icon + truncated path value. On hover shows full path + resolution status.
- `symbol` tags: `#` prefix + symbol name.
- `layer` tags: `>` prefix + layer name.
- `domain` tags: `~` prefix + domain name.

Tag resolution for `file` type tags (on-demand, client-side):
- Tags store only the raw `value` reference. No server-side resolution occurs at save time.
- When the tag UI renders, it calls `GET /api/code/exists?project=...&path={value}` to check whether the path currently exists on disk (cheap stat-only check, returns `{ exists: boolean }`, no file content).
- If resolved, show green dot. If not found, show amber warning. If the check hasn't run yet, show grey dot.
- `resolvedPath` and `lastResolvedAt` on `SnippetTag` are optional client-cached hints. After a successful existence check the client may persist them back via `update_snippet` so subsequent loads can display last-known state without waiting for the round-trip. The server never writes these fields itself.

---

## 8. Decisions

All questions from the draft are resolved. Decisions are recorded here for implementation reference.

### D1 — Group tabs: Remove entirely

`groupId`/`groupName` are stripped from the Snippet schema and all related UI. `SnippetGroupView` is deleted. Existing grouped snippets become independent items during migration. No deferral.

### D2 — `create_code` duplicate `filePath`: Idempotent return

If `filePath` is already linked in the session, `create_code` returns `{ id, filePath, existed: true }` for the existing artifact. No error. This is friendlier for agent workflows where the agent may not track prior calls.

### D3 — Tag path resolution: On-demand, client-side

Tags store the raw `value` reference only. No server-side resolution at save time. The UI resolves on demand via `GET /api/code/exists?project=...&path=...` (new endpoint, stat-only, returns `{ exists: boolean }`). `resolvedPath`/`lastResolvedAt` on `SnippetTag` are optional client-cached hints that the client may write back via `update_snippet` — the server never populates them.

### D4 — Content storage: Single copy, artifact IS the disk mirror

`originalContent` and `diskContent` are dropped. The artifact's `content` field IS the disk content — the artifact is the live mirror. `contentHash` is kept for cheap change detection only. `dirty` is set explicitly when the user makes local edits not yet pushed. This eliminates the 3x storage overhead and all baseline-tracking complexity.

### D5 — Storage manager: Separate `CodeFileManager` with shared base

Create a `CodeFileManager` class. Extract shared CRUD/history/ID logic into an `ArtifactManager<T>` generic base. Both `SnippetManager` and `CodeFileManager` extend it. Full type safety, no code duplication, easy to diverge independently.

### D6 — WebSocket events: Separate event types

Snippet mutations → `snippet_updated` (unchanged). Code File mutations → `code_file_updated` (new). Separate event types are cleaner than a combined `artifact_updated` — clients that only care about one type don't need to branch on `artifactType`. The client-side migration cost (updating listeners in `CodeEditor`) is small and contained.

### D7 — Code File creation UI: Pin-to-artifact flow only

Opening a file from the code tree browser creates an ephemeral view only. Pressing **Pin** on the ephemeral tab calls `create_code` and promotes the view to a permanent Code File artifact. There is no "New Code File" button in the sidebar. This ensures `filePath` always refers to a real file at link time and keeps the creation surface minimal. See §7.6 for full flow.

---

## 9. Implementation Sequence

The changes are large enough to require phased delivery. Suggested order:

1. **Phase 1 — Types and storage** (`src/types.ts`, `CodeFileManager` with `ArtifactManager<T>` base, storage migration script). No UI changes yet. Existing linked snippets continue to work through the migration shim.
2. **Phase 2 — Backend split** (`code-api.ts` reads from `code-files/`, MCP tools updated, new `create_code`/`update_code`/`get_code` tools registered, `GET /api/code/exists` added). REST routes simplified; `envelope.linked` guard clauses deleted.
3. **Phase 3 — ItemType and UnifiedEditor** (`item.ts` adds `'code'`, `UnifiedEditor` routing updated, `CodeEditor` props updated). The sidebar still shows Code Files under Snippets.
4. **Phase 4 — ArtifactTree split** (separate sidebar sections, PseudoTreeBody update).
5. **Phase 5 — Snippet tag UI** (tag display in `SnippetEditor`, tag composer, on-demand path resolution via `exists` endpoint).
6. **Phase 6 — Pin-to-artifact flow** (`promoteCodeFile` updated to call `create_code`, ephemeral tab state added to code browser, Pin button wired up).
7. **Phase 7 — Cleanup** (remove `parseLinkedEnvelope`, remove `sourcePath`/`startAt`/`endAt` from `create_snippet`, delete `SnippetGroupView`, delete `HunkActionRow.tsx` / `HunkOverlay.tsx` / `hunkUtils.ts` if already replaced by MonacoDiffEditor work).
