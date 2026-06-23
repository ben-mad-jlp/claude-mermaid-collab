# Blueprint: Code File and Snippet Type Split

## Source Artifacts
- `design-code-vs-snippet` — full design doc with schema, API, UI, migration, and decisions

---

## 1. Structure Summary

### Files

#### New files
- [ ] `src/services/artifact-manager.ts` — Generic `ArtifactManager<T>` base class (CRUD + history)
- [ ] `src/services/code-file-manager.ts` — `CodeFileManager` extends `ArtifactManager<CodeFile>`
- [ ] `src/migrations/migrate-linked-snippets.ts` — One-time idempotent migration, runs at startup

#### Modified files
- [ ] `src/types.ts` — Add `SnippetTag`, `ProposedEdit`, `CodeFile`; rewrite `Snippet` (flat fields, no envelope)
- [ ] `src/services/snippet-manager.ts` — Extend `ArtifactManager<Snippet>`; update storage format from JSON envelope to flat fields
- [ ] `src/services/session-registry.ts` — Add `'code-files'` to `resolvePath` type union; `mkdir code-files/` in session init
- [ ] `src/routes/code-api.ts` — All code-file handlers use `CodeFileManager`; add `GET /exists`; delete `envelope.linked` guards; update `handleCodeSearch` to search code-files
- [ ] `src/mcp/tools/code.ts` — Rename `link_code_file` → `create_code`; add `update_code`, `get_code`; update all tools to `CodeFileManager`
- [ ] `src/mcp/tools/snippet.ts` — Remove `sourcePath`, `startAt`, `endAt`, `groupId`, `groupName` from `create_snippet`/`update_snippet`; add `tags` param
- [ ] `src/mcp/setup.ts` — Register `create_code`, `update_code`, `get_code`; deregister `link_code_file`
- [ ] `ui/src/types/item.ts` — Add `'code'` to `ItemType`; add `isCodeFile` guard; update `getItemLabel`, `getItemIconPath`, `getItemColor`, `getItemColorValue`, `isItemType`
- [ ] `ui/src/components/editors/UnifiedEditor.tsx` — Replace content-parse routing with `item.type` switch
- [ ] `ui/src/components/editors/CodeEditor.tsx` — Props: `snippetId` → `codeFileId`; use `useCodeFile` hook; remove `parseLinkedEnvelope`
- [ ] `ui/src/components/editors/SnippetEditor.tsx` — Add tag strip UI; remove `filePath` display; remove `groupId`/`groupName` rendering
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx` — Split into "Code Files" + "Snippets" sections
- [ ] `ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx` — Look up Code File artifacts by `filePath` instead of parsing snippet envelopes
- [ ] `ui/src/lib/promote-code-file.ts` — Update pin action to call `POST /api/code/create` + set artifact type `'code'`

#### Deleted files
- [ ] `ui/src/components/editors/diffReview/HunkActionRow.tsx` — already deleted in working tree
- [ ] `ui/src/components/editors/diffReview/HunkOverlay.tsx` — already deleted in working tree
- [ ] `ui/src/components/editors/diffReview/hunkUtils.ts` — already deleted in working tree
- [ ] `ui/src/components/editors/SnippetGroupView.tsx` _(if extracted)_ or inline group-tab code in `SnippetEditor.tsx`

### Type Definitions

```ts
// src/types.ts additions

export interface SnippetTag {
  type: 'file' | 'symbol' | 'layer' | 'domain';
  value: string;
  resolvedPath?: string;   // client-cached only
  lastResolvedAt?: string; // client-cached only
}

export interface Snippet {
  id: string;
  name: string;
  content: string;         // raw code, NOT a JSON envelope
  language: string;
  tags: SnippetTag[];
  lastModified: number;
}

export interface ProposedEdit {
  newCode: string;
  message?: string;
  proposedBy: string;
  proposedAt: number;
}

export interface CodeFile {
  id: string;
  filePath: string;        // logical primary key — absolute path
  name: string;
  content: string;         // IS the disk content (live mirror)
  language: string;
  contentHash: string;     // sha256 of content, for change detection
  dirty: boolean;
  linkCreatedAt: number;
  lastPushedAt: number | null;
  lastSyncedAt: number | null;
  proposedEdit?: ProposedEdit;
  lastModified: number;
}

// ui/src/types/item.ts additions
export type ItemType = 'diagram' | 'document' | 'design' | 'spreadsheet' | 'snippet' | 'code' | 'embed' | 'image';
export function isCodeFile(item: Item): item is Item & { type: 'code' } { return item.type === 'code'; }
```

### Component Interactions

```
Claude Agent (MCP)
  ├── create_snippet  → SnippetManager  → .collab/sessions/{s}/snippets/{id}.snippet
  ├── create_code     → CodeFileManager → .collab/sessions/{s}/code-files/{id}.codefile
  ├── push_code_to_file → CodeFileManager + disk write
  └── sync_code_from_disk → disk read + CodeFileManager

REST API (code-api.ts)
  ├── GET  /exists    → stat() check → { exists: boolean }
  ├── POST /create    → CodeFileManager.create()  [new endpoint]
  ├── POST /push/:id  → CodeFileManager.get() + writeFile()
  ├── POST /sync/:id  → readFile() + CodeFileManager.update()
  └── GET  /diff/:id  → CodeFileManager.get() + createPatch()

UI
  ├── ArtifactTree  → "Code Files" section (type:'code') + "Snippets" section (type:'snippet')
  ├── UnifiedEditor → item.type === 'code' → <CodeEditor>
  │                   item.type === 'snippet' → <SnippetEditor>
  ├── CodeEditor    → useCodeFile(id) → push/sync/accept/reject toolbar
  ├── SnippetEditor → useSnippet(id) → tag strip, no file controls
  └── PseudoTreeBody → GET /api/code/files?linked=true → annotate matched paths

Migration (startup)
  → scan snippets/ for envelope.linked === true
  → write code-files/{id}.codefile
  → rewrite snippets/{id}.snippet as flat format
  → write .migrated-code-files sentinel
```

---

## 2. Function Blueprints

### `ArtifactManager<T>.initialize(): Promise<void>`
**Pseudocode:**
1. `mkdir(basePath, { recursive: true })`
2. `mkdir(historyPath, { recursive: true })`
3. `readdir(basePath)` → filter by file extension (`.snippet` or `.codefile`)
4. For each file: `stat()` → push `{ id, name, path, lastModified }` into `this.index`

**Error handling:** Log + skip files that fail to stat.
**Edge cases:** Empty directory is valid.

---

### `CodeFileManager.create(filePath, name?, session): Promise<{ id, existed }>`
**Pseudocode:**
1. Check `this.index` for any entry where `storedRecord.filePath === filePath`
2. If found: return `{ id: existing.id, filePath, existed: true }`
3. Generate `id = crypto.randomUUID()`
4. `content = await readFile(filePath, 'utf-8')`
5. Build `CodeFile` record: `{ id, filePath, name: name ?? basename(filePath), content, language: detectLang(filePath), contentHash: sha256(content), dirty: false, linkCreatedAt: Date.now(), lastPushedAt: null, lastSyncedAt: null, lastModified: Date.now() }`
6. Write `{id}.codefile` to disk as JSON
7. Update `this.index`
8. Return `{ id, filePath, existed: false }`

**Error handling:** If `readFile` throws ENOENT → surface as `400 File not found on disk`.
**Edge cases:** Two concurrent calls for same `filePath` — second finds it in index after first write.

---

### `migrateLinkedSnippets(project, session): Promise<void>`
**Pseudocode:**
1. Check for `.migrated-code-files` sentinel → return early if present (idempotent)
2. `mkdir(backupDir, { recursive: true })`
3. For each `.snippet` file in `snippets/`:
   a. Parse content as JSON
   b. If `envelope.linked === true`:
      - Copy original file to `backupDir`
      - Build `CodeFile` from mapped fields (drop `originalCode`, `diskCode`)
      - Write `code-files/{id}.codefile`
      - Delete `snippets/{id}.snippet`
   c. Else if `envelope.filePath`:
      - Convert `filePath` to a `{ type:'file', value: relative(project, filePath) }` tag
      - Rewrite as flat snippet format
   d. Else:
      - Rewrite as flat snippet format (`envelope.code` → `content`, `envelope.language` → `language`, `tags: []`)
4. Write sentinel `.migrated-code-files`

**Error handling:** Any per-file error logs + continues (don't abort full migration).
**Edge cases:** Sentinel prevents double-run. Backup ensures rollback path.

---

### `handlePushToFile(project, session, id)` (code-api.ts, updated)
**Pseudocode:**
1. `codeFileManager = new CodeFileManager(resolvePath(project, session, 'code-files'))`
2. `codeFile = await codeFileManager.get(id)` → 404 if not found
3. `validatePathUnderRoot(codeFile.filePath, project)`
4. `await writeFile(codeFile.filePath, codeFile.content, 'utf-8')`
5. Update record: `dirty = false`, `lastPushedAt = Date.now()`, recalculate `contentHash`
6. `await codeFileManager.save(id, updated)`
7. Broadcast `code_file_updated` via WebSocket
8. Return `{ success: true, filePath, bytesWritten }`

**Key change:** No `JSON.parse(snippet.content)` or `envelope.linked` check.

---

### `handleSyncFromDisk(project, session, id)` (code-api.ts, updated)
**Pseudocode:**
1. Get `CodeFile` from `CodeFileManager`
2. `diskContent = await readFile(filePath)` → handle ENOENT → return `{ fileDeleted: true }`
3. `diskChanged = sha256(diskContent) !== codeFile.contentHash`
4. `hasLocalEdits = codeFile.dirty`
5. `conflict = diskChanged && hasLocalEdits`
6. Update `lastSyncedAt = Date.now()`
7. If `diskChanged && !hasLocalEdits`: update `content = diskContent`, `contentHash = sha256(diskContent)`, `dirty = false`
8. Save, broadcast `code_file_updated`
9. Return `{ diskChanged, hasLocalEdits, conflict }`

**Key change:** Uses `contentHash` for change detection instead of `diskCode` string comparison.

---

### `GET /api/code/exists` (new route)
**Pseudocode:**
1. `path = searchParams.get('path')` — relative or absolute
2. Resolve against `project` if relative
3. `validatePathUnderRoot(resolved, project)`
4. `stat(resolved)` → `{ exists: true }` / catch ENOENT → `{ exists: false }`

**Purpose:** Client-side tag resolution UI calls this to show green/amber indicator on file tags.

---

### `UnifiedEditor` routing update
**Before:**
```ts
if (item.type === 'snippet') {
  const parsed = JSON.parse(item.content || '');
  if (parsed.linked === true) return <CodeEditor snippetId={item.id} />;
  return <SnippetGroupView item={item} />;
}
```
**After:**
```ts
if (item.type === 'code') return <CodeEditor codeFileId={item.id} />;
if (item.type === 'snippet') return <SnippetEditor item={item} />;
```

---

### `SnippetEditor` tag strip (new UI)
**Pseudocode:**
1. Read `item.tags` (array of `SnippetTag`)
2. Render pill row below toolbar: for each tag render `<TagPill type value resolvedPath />`
3. For `file` tags: on mount call `GET /api/code/exists?project=...&path={value}` → set indicator state
4. `+` button opens `<TagComposer>` modal: type select + value input → calls `PATCH /api/snippets/{id}` with updated `tags`
5. Tag pill `×` removes from array → PATCH

---

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: types-backend
    files: [src/types.ts]
    tests: []
    description: "Add SnippetTag, ProposedEdit, CodeFile interfaces; rewrite Snippet to flat fields (no envelope)"
    parallel: true
    depends-on: []

  - id: types-ui
    files: [ui/src/types/item.ts]
    tests: []
    description: "Add 'code' to ItemType union; add isCodeFile guard; update label/icon/color maps"
    parallel: true
    depends-on: []

  - id: artifact-manager-base
    files: [src/services/artifact-manager.ts]
    tests: []
    description: "New generic ArtifactManager<T> base class with CRUD + history used by both SnippetManager and CodeFileManager"
    parallel: false
    depends-on: [types-backend]

  - id: code-file-manager
    files: [src/services/code-file-manager.ts]
    tests: []
    description: "New CodeFileManager extending ArtifactManager<CodeFile>; handles .codefile storage, idempotent create by filePath"
    parallel: false
    depends-on: [artifact-manager-base]

  - id: snippet-manager-v2
    files: [src/services/snippet-manager.ts]
    tests: [src/mcp/tools/__tests__/snippet.test.ts]
    description: "Extend ArtifactManager<Snippet>; update storage format from JSON envelope to flat fields (content, language, tags)"
    parallel: false
    depends-on: [artifact-manager-base]

  - id: session-registry-v2
    files: [src/services/session-registry.ts]
    tests: []
    description: "Add 'code-files' to resolvePath type union; mkdir code-files/ in session init"
    parallel: false
    depends-on: [code-file-manager]

  - id: migration-script
    files: [src/migrations/migrate-linked-snippets.ts]
    tests: []
    description: "Idempotent migration: linked snippets → .codefile records; plain snippets → flat format; backup + sentinel"
    parallel: false
    depends-on: [code-file-manager, snippet-manager-v2]

  - id: backend-code-routes
    files: [src/routes/code-api.ts]
    tests: []
    description: "All push/sync/diff/proposed-edit handlers use CodeFileManager; add GET /exists; remove envelope.linked guards; update code search"
    parallel: false
    depends-on: [code-file-manager, session-registry-v2]

  - id: mcp-code-tools-v2
    files: [src/mcp/tools/code.ts]
    tests: []
    description: "Rename link_code_file → create_code; add update_code and get_code; update all tools to use CodeFileManager; emit code_file_updated events"
    parallel: false
    depends-on: [code-file-manager, session-registry-v2]

  - id: mcp-snippet-tools-v2
    files: [src/mcp/tools/snippet.ts]
    tests: [src/mcp/tools/__tests__/snippet.test.ts, src/mcp/tools/__tests__/snippet-anchors.test.ts]
    description: "Remove sourcePath/startAt/endAt/groupId/groupName from create_snippet; add tags param to create_snippet and update_snippet"
    parallel: false
    depends-on: [snippet-manager-v2]

  - id: mcp-setup-v2
    files: [src/mcp/setup.ts]
    tests: [src/mcp/setup.test.ts]
    description: "Register create_code, update_code, get_code; deregister link_code_file; update snippet tool registrations"
    parallel: false
    depends-on: [mcp-code-tools-v2, mcp-snippet-tools-v2]

  - id: unified-editor-routing
    files: [ui/src/components/editors/UnifiedEditor.tsx]
    tests: [ui/src/components/editors/__tests__/UnifiedEditor.test.tsx]
    description: "Replace JSON.parse content-routing with item.type switch: 'code' → CodeEditor, 'snippet' → SnippetEditor"
    parallel: false
    depends-on: [types-ui]

  - id: code-editor-v2
    files: [ui/src/components/editors/CodeEditor.tsx]
    tests: []
    description: "Props: snippetId → codeFileId; use useCodeFile hook; remove parseLinkedEnvelope; update toolbar to code_file_updated WS events"
    parallel: false
    depends-on: [types-ui]

  - id: snippet-editor-tags
    files: [ui/src/components/editors/SnippetEditor.tsx]
    tests: []
    description: "Add tag strip UI with on-demand /exists resolution; remove filePath display; remove groupId/groupName rendering"
    parallel: false
    depends-on: [types-ui]

  - id: artifact-tree-split
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.test.tsx]
    description: "Split sidebar into 'Code Files' (type:code) and 'Snippets' (type:snippet) sections, each independently collapsible"
    parallel: false
    depends-on: [types-ui]

  - id: pseudo-tree-v2
    files: [ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx]
    tests: []
    description: "Annotate file nodes using Code File artifacts by filePath instead of parsing snippet envelope.linked"
    parallel: false
    depends-on: [artifact-tree-split]

  - id: pin-to-artifact
    files: [ui/src/lib/promote-code-file.ts]
    tests: []
    description: "Update pin action: call POST /api/code/create → receive code artifact id → set item.type='code' in tab state; add Pin button to ephemeral code browser tab"
    parallel: false
    depends-on: [code-editor-v2]

  - id: cleanup-deletions
    files: []
    tests: []
    description: "Delete SnippetGroupView; confirm HunkActionRow/HunkOverlay/hunkUtils already removed; remove parseLinkedEnvelope helper"
    parallel: false
    depends-on: [unified-editor-routing, snippet-editor-tags]
```

### Execution Waves

**Wave 1 (parallel — no dependencies):**
- `types-backend`, `types-ui`

**Wave 2 (depends on Wave 1 backend):**
- `artifact-manager-base`

**Wave 3 (depends on Wave 2):**
- `code-file-manager`, `snippet-manager-v2`

**Wave 4 (depends on Wave 3 + Wave 1 UI — parallel within wave):**
- `session-registry-v2`, `migration-script`, `backend-code-routes`, `mcp-code-tools-v2`, `mcp-snippet-tools-v2`
- `unified-editor-routing`, `code-editor-v2`, `snippet-editor-tags`, `artifact-tree-split`

**Wave 5 (depends on Wave 4):**
- `mcp-setup-v2`, `pseudo-tree-v2`, `pin-to-artifact`

**Wave 6 (final — depends on Wave 5):**
- `cleanup-deletions`

### Summary
- Total tasks: 18
- Total waves: 6
- Max parallelism: 9 (Wave 4)
