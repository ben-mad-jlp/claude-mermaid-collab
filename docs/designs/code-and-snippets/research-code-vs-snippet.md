# Research: Code File vs Snippet — Current Implementation & Redesign Plan

## 1. Current Snippet Type Definition

### Backend (TypeScript schema)

**File**: `/srv/codebase/claude-mermaid-collab/src/types.ts` (lines 61–79)

```ts
export interface Snippet {
  id: string;
  name: string;
  content: string;         // raw string — may be plain code OR a JSON "envelope"
  lastModified: number;
}
```

No `filePath`, no `linked`, no `tags` — all metadata lives **inside the `content` string** as a JSON envelope.

### JSON Envelope format (de facto schema inside `content`)

Snippets are stored as `.snippet` files under `.collab/sessions/{name}/snippets/`. The `content` field is typically a serialised JSON object:

```json
{
  "code": "...",            // actual source code
  "language": "typescript",
  "filePath": "/abs/path",  // optional — present on plain snippets created from a sourcePath
  "originalCode": "...",    // snapshot at creation time
  "groupId": "...",         // optional — groups snippets as tabs in the UI
  "groupName": "...",       // optional — display name for the group
  "annotations": [...]      // optional inline annotations
}
```

For **linked** (code-file) snippets, additional fields are injected:

```json
{
  "code": "...",
  "language": "typescript",
  "filePath": "/abs/path/to/file.ts",
  "originalCode": "...",
  "diskCode": "...",       // last known on-disk content
  "linked": true,          // THE DISCRIMINATOR — this is what makes it a "code file"
  "linkCreatedAt": 1234567890,
  "lastPushedAt": null,
  "lastSyncedAt": 1234567890,
  "dirty": false,
  "proposedEdit": {        // optional — pending AI-proposed change
    "newCode": "...",
    "message": "...",
    "proposedBy": "claude",
    "proposedAt": 1234567890
  }
}
```

### Frontend type

**File**: `/srv/codebase/claude-mermaid-collab/ui/src/types/snippet.ts`

```ts
export interface Snippet {
  id: string;
  name: string;
  content: string;   // same JSON envelope blob
  lastModified: number;
  folder?: string;
  locked?: boolean;
  deprecated?: boolean;
  pinned?: boolean;
}
```

**File**: `/srv/codebase/claude-mermaid-collab/ui/src/types/item.ts` (line 14)

```ts
export type ItemType = 'diagram' | 'document' | 'design' | 'spreadsheet' | 'snippet' | 'embed' | 'image';
```

There is **no separate `code` or `code-file` ItemType** — both plain snippets and linked code files share the `'snippet'` type. The UI uses runtime content-parsing to distinguish them (see §4).

---

## 2. Current "Code File" Concept

There is no separate `code` artifact type in the system today. **Linked snippets are Code Files** — they are regular `Snippet` records with `linked: true` embedded in the JSON envelope.

The "linked" concept was implemented by layering on top of the snippet storage system:

| Feature | Plain Snippet | Linked Snippet (current "Code File") |
|---|---|---|
| Stored as | `.snippet` file | `.snippet` file (same storage) |
| ItemType | `'snippet'` | `'snippet'` |
| `linked` field | absent / false | `true` |
| `filePath` | optional source reference | required, absolute path |
| Disk sync | none | full push/sync/diff cycle |
| UI component | `SnippetEditor` | `CodeEditor` (wraps `SnippetEditor`) |
| Proposed edits | none | `proposedEdit` envelope field |

---

## 3. "Apply to File" / "Push to File" Functionality — Full Inventory

### MCP Tools (`src/mcp/tools/code.ts`)

All tools operate on snippets with `linked: true`.

| Tool | Schema | Handler | Description |
|---|---|---|---|
| `link_code_file` | `linkCodeFileSchema` (line 55) | `handleLinkCodeFile` (line 124) | Reads file from disk, creates a snippet envelope with `linked: true` |
| `push_code_to_file` | `pushCodeToFileSchema` (line 65) | `handlePushCodeToFile` (line 173) | Writes `envelope.code` to `envelope.filePath` on disk |
| `sync_code_from_disk` | `syncCodeFromDiskSchema` (line 74) | `handleSyncCodeFromDisk` (line 190) | Reads file from disk, updates `diskCode` and optionally `code` |
| `review_code_edits` | `reviewCodeEditsSchema` (line 83) | `handleReviewCodeEdits` (line 207) | Returns diff between `originalCode` and `code` |
| `propose_code_edit` | `proposeCodeEditSchema` (line 101) | `handleProposeCodeEdit` (line 249) | Sets `proposedEdit` envelope field |
| `wait_for_edit_decision` | `waitForEditDecisionSchema` (line 112) | `handleWaitForEditDecision` (line 270) | Blocks until user accepts/rejects in UI |
| `list_code_files` | `listCodeFilesSchema` (line 93) | `handleListCodeFiles` (line 288) | Lists all snippets with `linked: true` |

MCP tool registrations: `/srv/codebase/claude-mermaid-collab/src/mcp/setup.ts`, lines 2395–2428.

### REST API Routes (`src/routes/code-api.ts`)

| Route | Lines | Description |
|---|---|---|
| `POST /api/code/push/:id` | lines 64–69, handler 499–554 | Push snippet code → disk file |
| `POST /api/code/sync/:id` | lines 73–78, handler 814–902 | Sync disk → snippet |
| `GET /api/code/diff/:id` | lines 128–134, handler 904–943 | Compute unified diff |
| `POST /api/code/proposed-edit/:id` | lines 117–125, handler 556–619 | Create/replace proposed edit |
| `POST /api/code/proposed-edit/:id/accept` | lines 82–89, handler 621–691 | Accept proposed edit |
| `POST /api/code/proposed-edit/:id/reject` | lines 92–99, handler 693–763 | Reject proposed edit |
| `POST /api/code/record-edit-decision` | lines 102–108, handler 792–812 | Record hunk-level decision |

### UI Components

| Component | File | Role |
|---|---|---|
| `CodeEditor` | `ui/src/components/editors/CodeEditor.tsx` | Wraps `SnippetEditor`; adds Push, Sync, Accept/Reject buttons; handles proposed-edit diff view |
| `UnifiedEditor` | `ui/src/components/editors/UnifiedEditor.tsx` lines 394–404 | Routes `item.type === 'snippet'` to `CodeEditor` if `parsed.linked === true`, otherwise `SnippetGroupView` |
| `DiffAgainstDiskModal` | `ui/src/components/editors/DiffAgainstDiskModal.tsx` | Modal for previewing changes before push |
| `MonacoDiffEditor` | `ui/src/components/editors/diffReview/MonacoDiffEditor.tsx` | Diff view for accept/reject flow |

### API helper functions

**File**: `/srv/codebase/claude-mermaid-collab/ui/src/lib/api.ts`
- `api.pushCodeToFile(project, session, id)` — calls `POST /api/code/push/:id`
- `api.syncCodeFromDisk(project, session, id)` — calls `POST /api/code/sync/:id`
- `api.acceptProposedEdit(project, session, id)` — calls `POST /api/code/proposed-edit/:id/accept`
- `api.rejectProposedEdit(project, session, id)` — calls `POST /api/code/proposed-edit/:id/reject`

### `promoteCodeFile` utility

**File**: `/srv/codebase/claude-mermaid-collab/ui/src/lib/promote-code-file.ts`

When a user opens a raw project file in the "code" browser tab and pins it, this function calls `linkFile()` to create a linked snippet from that path — converting a `code-file` tab into a tracked `snippet` artifact with `linked: true`.

---

## 4. Code Viewer Component

### `CodeFileView` — browsing project files directly

**File**: `/srv/codebase/claude-mermaid-collab/ui/src/components/editors/CodeFileView.tsx`

Props: `{ path: string; project: string; editMode: boolean; tabId: string }`

- Calls `fetchCodeFile(project, path)` from `/api/code/file?project=...&path=...`
- Renders the file in `MonacoWrapper` (read-only by default)
- **Does NOT bind to a snippet** — it reads the file directly from disk via the REST API
- Opened via the "code" browser tab (`kind: 'code-file'`), NOT via the snippets system
- Supports code/prose toggle for pseudo-indexed files

### `CodeEditor` — editing linked snippet (current "Code File" artifact)

**File**: `/srv/codebase/claude-mermaid-collab/ui/src/components/editors/CodeEditor.tsx`

Props: `{ snippetId: string; onSave?; onToolbarControls? }`

- Uses `useSnippet(snippetId)` to load from session store
- Calls `parseLinkedEnvelope(content)` (line 59) to extract `filePath`, `dirty`, `proposedEdit`, etc.
- Renders `SnippetEditor` as the editing surface
- Injects Push / Sync / Accept / Reject controls into `EditorToolbar` via `onToolbarControls` callback

### How the router works (UnifiedEditor, lines 394–404)

```ts
if (item.type === 'snippet') {
  try {
    const parsed = JSON.parse(item.content || '');
    if (parsed.linked === true) {
      return <CodeEditor snippetId={item.id} ... />;
    }
  } catch {}
  return <SnippetGroupView item={item} ... />;
}
```

The routing is **runtime content inspection** — there is no ItemType distinction.

---

## 5. How Snippets Are Rendered in the UI

### Sidebar

- All snippets appear in the **"Snippets" section** of the ArtifactTree (`ArtifactTree.tsx`, line 1216)
- No visual distinction between plain snippets and linked code files in the section label
- Individual nodes may show file-path info if the `ArtifactTreeNode` parses the content

### Editor rendering path

1. User clicks a snippet in sidebar → tab opens with `kind: 'artifact'`, `artifactType: 'snippet'`
2. `UnifiedEditor` checks `item.type === 'snippet'`
3. If content has `linked: true` → renders `CodeEditor` (file-backed)
4. Otherwise → renders `SnippetGroupView`, which renders `SnippetEditor`

### `SnippetEditor` (`ui/src/components/editors/SnippetEditor.tsx`)

- Full Monaco editor with toolbar (language dropdown, diff toggle, copy)
- Parses the JSON envelope for `language`, `code`, `filePath`, `annotations`
- Shows `filePath` display if present (line 450-452) — even on plain snippets that were created from a `sourcePath`
- **Does NOT have push/sync/apply-to-file controls** — those live exclusively in `CodeEditor`

---

## 6. MCP Snippet Tools — Parameters Summary

### `create_snippet`

```
project, session (optional), name, content?, sourcePath?, startAt?, endAt?, maxLines?, groupId?, groupName?
```

- `name`: required; include extension for syntax highlighting (e.g. `"auth.ts"`)
- `content`: raw code or JSON envelope
- `sourcePath`: absolute disk path — reads file, auto-detects language, sets `originalCode`
- `startAt`/`endAt`: anchor strings for partial extraction from `sourcePath`
- `groupId`/`groupName`: tabs grouping in the UI

### `update_snippet`

```
project, session (optional), id, content
```

- Preserves existing envelope fields (`groupId`, `filePath`, etc.) via merge

### `get_snippet` → returns `id, name, content, language?, filePath?, lastModified`

### `list_snippets` → returns `snippets: [{id, name, lastModified}]`

### `delete_snippet` / `export_snippet` / `snippet_history` / `revert_snippet` / `patch_snippet` (deprecated)

---

## 7. Grok's Design Considerations

*(from `mcp__mermaid__consult_grok`, model: grok-4.20-reasoning)*

### Core trade-offs

- **Snippet**: Knowledge-centric, loosely coupled. Best for patterns, examples, cross-cutting concerns, tribal knowledge. Value is in *not* being tied to filesystem structure.
- **Code File**: Source of truth, tightly coupled. Canonical state of a file on disk. Used for file-level insights, ownership, structural analysis, and bulk operations.

### Key architectural guidance

- **Identity**: Snippets use UUIDs. Code Files should use normalised file path (relative to repo root) as primary key.
- **Never allow a Snippet to "become" a Code File** — force users to copy content instead.
- **Data model divergence**: Do not inherit from a common base. Use composition.
- **Referencing direction**: Snippets reference Code Files (via tags). Code Files should maintain a reverse index of referencing snippets.
- **Sync semantics**: Code Files need reliable reconciliation (hash + timestamp + optional git SHA).

### Tagging for Snippets

Grok recommends **typed structured tags** stored as objects:

```ts
{ type: "file", value: "src/auth/login.ts", resolvedPath: "...", lastResolvedAt: "..." }
```

Tag types:
- `@file:src/auth/login.ts` — loose file reference (resilient to renames via fuzzy matching)
- `#UserService.login` — symbol reference
- `>component` / `>utility` — architectural layer tags
- `~react` / `~auth` — technology/domain tags

Support 1–N tags per snippet (typical 2–5), manual and AI-suggested.

### Code File Metadata

**Required**: `path` (primary key), `contentHash`, `lastSyncedAt`, `language`, `size`, `gitLastCommit`, `symbolIndex`

**Recommended**: `summary` (LLM-generated), `owners`, `referencingSnippets[]`, `attachedAnnotations`, `lastAnalyzedAt`, `dependencies`/`dependents`

**Avoid**: storing full file content (read on demand), line-level comments (separate entity).

---

## 8. What Needs to Change for the Redesign

### Changes to remove "apply to file" from snippets

1. **`src/types.ts`**: No change needed (Snippet type already has no `linked` field)
2. **`src/mcp/tools/snippet.ts`**: Remove `sourcePath`-based `filePath` / `originalCode` from plain snippet envelopes — or at minimum, strip the `linked: true` discriminator
3. **`src/mcp/tools/code.ts`**: Keep as-is for Code File tools; they already require `linked: true`
4. **`src/routes/code-api.ts`**: All push/sync/diff/proposed-edit handlers check `envelope.linked` — they naturally reject unlinked snippets
5. **UI — `UnifiedEditor.tsx`**: The routing already correctly gates `CodeEditor` on `parsed.linked === true`
6. **UI — `SnippetEditor.tsx`**: Remove the `filePath` display (lines 450–452) for snippets that have `filePath` but NOT `linked: true` — or keep it as informational-only

### Changes for the new split

1. **Add `'code'` to `ItemType`** in `ui/src/types/item.ts` — gives Code Files a first-class type distinct from snippets
2. **Add `tags[]` field** to the Snippet envelope schema (and `createSnippetSchema`, `updateSnippetSchema`)
3. **Rename/separate sidebar sections**: "Snippets" vs "Code Files" in `ArtifactTree.tsx`
4. **Remove `link_code_file` from snippet workflow**: currently it creates a snippet with `linked: true`; with the new split it should create a `code` type artifact directly
5. **Storage layer decision**: Currently both live in the same `snippets/` directory. A `code-file` type could get its own `code-files/` subdirectory, or share storage with a type discriminator in the JSON
6. **SnippetManager vs. CodeFileManager**: Either extend `SnippetManager` to handle both, or create a separate `CodeFileManager`

### What can stay the same

- Storage format (JSON envelope inside `.snippet` files) — just with `type: 'snippet' | 'code-file'` instead of `linked: true`
- `SnippetManager` CRUD logic — trivially reusable for both artifact types
- `MonacoWrapper`, `SnippetEditor` as editing surfaces
- All the push/sync/diff/proposed-edit REST routes and MCP tools — just pointed at the new type
- Version history system (`.history/` directory)
- Group tabs (`groupId`/`groupName`) — relevant to snippets only going forward
