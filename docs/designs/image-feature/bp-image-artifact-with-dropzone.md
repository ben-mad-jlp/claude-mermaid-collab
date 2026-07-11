# Blueprint: Image Artifact + Sidebar Drag-and-Drop

## Source Artifacts
- `research-image-artifact` — end-to-end codebase research + scoping punch list

## 1. Structure Summary

### Design Decisions

- **Image artifacts are immutable binaries** stored as separate files in `.collab/sessions/{session}/images/{id}.{ext}`. No versioning. Replace = delete + create.
- **One new backend endpoint is enough for drag-drop**: `POST /api/image` (multipart). All other dropped types (`.md`, `.mmd`, `.csv`, code files) already route through the existing `importArtifact()` → `/api/{type}` pipeline.
- **Drop zone lives on the Sidebar artifact list** — not a global overlay, not per-type subsections. A single drop target on the scrollable artifact list.
- **Extend `importArtifact.ts`** rather than create a parallel helper. Add `'image'` to the type union, add image detection in `detectType()`, and branch inside `importArtifact()` for binary uploads.
- **MetadataManager reuse** — images get pinned/locked/deprecated flags for free.
- **WebSocket**: broadcast `image_created` / `image_deleted` just like documents/embeds so other clients stay in sync.

### Files to Create

**Backend**
- [ ] `src/services/image-manager.ts` — `ImageManager` class (CRUD over binary files + metadata JSON)
- [ ] `src/mcp/tools/image.ts` — MCP tool handlers + Zod schemas

**Frontend**
- [ ] `ui/src/types/image.ts` — `Image`, `ImageMeta`, `ImageListItem` interfaces
- [ ] `ui/src/components/ImageViewer.tsx` — render `<img>` + metadata/download

### Files to Modify

**Backend**
- [ ] `src/types.ts` — add Image domain types (or re-export from `src/types/image.ts` if that's the pattern — check first)
- [ ] `src/config.ts` — `MAX_IMAGE_SIZE`, `ALLOWED_IMAGE_MIME_TYPES`
- [ ] `src/routes/api.ts` — add `imageManager` to `createManagers()` (line ~123); add `/api/image`, `/api/images`, `/api/image/:id`, `/api/image/:id/content`, `/api/image/:id` DELETE routes
- [ ] `src/services/session-registry.ts:419` — add `'images'` to the `resolvePath()` type union
- [ ] `src/mcp/setup.ts` — import tool handlers/schemas; add tool definitions to `ListToolsRequestSchema` handler (~line 830); add case statements to `CallToolRequestSchema` handler (~line 2102)

**Frontend**
- [ ] `ui/src/types/index.ts` — export from new `./image` module
- [ ] `ui/src/types/item.ts` (or wherever `Item` union lives) — add `'image'` to the type literal union
- [ ] `ui/src/stores/sessionStore.ts` — add `images: Image[]`, `selectedImageId`, `setImages`, `addImage`, `selectImage`, `updateImage`, `removeImage`
- [ ] `ui/src/lib/api.ts` — add `createImage(project, session, file)`, `listImages(project, session)`, `deleteImage(project, session, id)`
- [ ] `ui/src/lib/importArtifact.ts` — extend `ArtifactType` union with `'image'`; add image extension detection in `detectType()` (BEFORE the snippet fallback); branch inside `importArtifact()` to use `FormData` multipart when `type === 'image'`
- [ ] `ui/src/components/layout/Sidebar.tsx` — render an Images section with `ItemCard`s + wire up `onDragOver` / `onDragLeave` / `onDrop` handlers on the artifact list container; loop `dataTransfer.files` and call `importArtifact()` for each

### Key Type Definitions

**Backend (`src/types/image.ts` or inline in `src/types.ts`):**
```typescript
export interface Image {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string; // ISO
  ext: string;        // file extension without dot
}

export interface ImageMeta {
  name: string;
  path: string;       // absolute path to binary file
  mimeType: string;
  size: number;
  uploadedAt: string;
  ext: string;
}

export interface ImageListItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}
```

**Frontend (`ui/src/types/image.ts`):**
```typescript
export interface Image {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  deprecated?: boolean;
  pinned?: boolean;
  locked?: boolean;
}
```

**Config (`src/config.ts`):**
```typescript
export const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/svg+xml', 'image/bmp', 'image/tiff',
]);
```

### Component Interactions

```
User drops files on Sidebar list
  ↓
Sidebar onDrop → for each file: importArtifact()
  ↓
detectType() → { type: 'image' | 'document' | ... }
  ↓ (if type === 'image')
FormData multipart POST /api/image
  ↓
api.ts route → imageManager.create(buffer, mimeType, name)
  ↓
ImageManager writes binary to .collab/sessions/{session}/images/{id}.{ext}
ImageManager updates in-memory index
  ↓
wsHandler.broadcast({ type: 'image_created', ... })
  ↓
All connected clients: WebSocket listener → sessionStore.addImage()
  ↓
Sidebar re-renders with new image in Images section
  ↓ (on click)
ImageViewer renders <img src="/api/image/{id}/content" />
```

---

## 2. Function Blueprints

### `ImageManager.initialize(): Promise<void>`

**Pseudocode:**
1. `mkdir` the images directory recursively
2. Read the directory (if it exists)
3. For each binary file (skip dotfiles): read sibling `{id}.meta.json` to populate the in-memory index
4. If a binary exists without a meta sidecar, synthesize a minimal meta from `stat()` + inferred MIME type from extension

**Error handling:** Skip corrupted meta files silently (matches `EmbedManager` pattern). Log a warning in dev.

**Edge cases:**
- Empty directory
- Orphan meta file (no matching binary): delete the meta
- Orphan binary (no matching meta): synthesize meta

**Test strategy:** Unit test with a temp directory containing mixed states (binary+meta, orphan binary, orphan meta, corrupted meta JSON).

---

### `ImageManager.create(name, buffer, mimeType): Promise<Image>`

**Signature:**
```typescript
async create(params: { name: string; buffer: Buffer; mimeType: string }): Promise<Image>
```

**Pseudocode:**
1. Validate `mimeType` against `ALLOWED_IMAGE_MIME_TYPES`; throw `Error('Unsupported image type: ...')` if not in set
2. Validate `buffer.length <= MAX_IMAGE_SIZE`; throw `Error('Image too large')` if exceeded
3. Derive `ext` from mime (png, jpg, gif, webp, svg, bmp, tiff)
4. Sanitize `name` → `id` (same regex as `EmbedManager`: `/[^a-zA-Z0-9-_]/g → '-'`, lowercase, strip leading/trailing dashes)
5. If `id` collides, append `-1`, `-2`, ... until unique
6. Write binary to `{basePath}/{id}.{ext}`
7. Write meta JSON to `{basePath}/{id}.meta.json` with `{name, mimeType, size, uploadedAt, ext}`
8. Update in-memory index
9. Return the `Image` object

**Error handling:** Wrap fs writes — on failure, attempt to delete any partial files before rethrowing.

**Edge cases:**
- Concurrent uploads of the same name: index collision check is the guard
- Disk full: fs write throws, caller gets the error

**Test strategy:** Unit tests for mime validation, size validation, id collision, successful write round-trip.

---

### `ImageManager.list(): Promise<ImageListItem[]>`

**Pseudocode:** Iterate the in-memory index, project each meta to `ImageListItem`, sort by `uploadedAt` descending.

**Test strategy:** Populate index, verify sort order.

---

### `ImageManager.get(id): Promise<Image | null>`

Return the meta merged with the `id`, or `null` if not in the index.

---

### `ImageManager.getContent(id): Promise<{ buffer: Buffer; mimeType: string } | null>`

**Pseudocode:**
1. Look up meta by id
2. If missing, return null
3. `readFile(meta.path)` as Buffer
4. Return `{ buffer, mimeType: meta.mimeType }`

**Error handling:** If the binary file is missing but the meta is present, remove the stale index entry and return null.

---

### `ImageManager.delete(id): Promise<void>`

**Pseudocode:**
1. Look up meta; throw if missing
2. Unlink the binary file and the meta sidecar (tolerate ENOENT on the sidecar)
3. Delete from in-memory index

---

### `detectType(filename)` — extended

**New branches (inserted BEFORE the snippet fallback):**
```typescript
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','bmp','tif','tiff']);

// ... existing design/spreadsheet/mmd/md checks ...

const ext = filename.split('.').pop()?.toLowerCase() ?? '';
if (IMAGE_EXTS.has(ext)) {
  return { type: 'image', name: filename }; // keep filename so ImageViewer shows the extension
}

// fall through to snippet
```

Also widen the exported `ArtifactType` union: `'diagram' | 'document' | 'design' | 'snippet' | 'spreadsheet' | 'image'`.

**Test strategy:** Table-driven unit test covering every known extension plus a few edge cases (no extension, multiple dots, uppercase).

---

### `importArtifact(project, session, file)` — extended

**Pseudocode:**
1. `const { type, name } = detectType(file.name)`
2. **New branch** — if `type === 'image'`:
   - Build `FormData`, append `file` and `name`
   - `POST /api/image?project=...&session=...` with the FormData body (no `Content-Type` header — browser sets it with boundary)
   - Parse response → `{ id }`
3. Otherwise: existing path (`file.text()` → JSON POST)
4. Return `{ type, id }`

**Error handling:** Existing error propagation is fine. For images, include MIME type in the error toast so users understand rejections.

**Test strategy:** Mock `fetch`, drop a PNG File, assert multipart request; drop a `.md`, assert JSON request still used.

---

### `Sidebar.tsx` drop handler

**Signature:** Inline within the component; wraps the artifact list container with drop handlers.

**Pseudocode:**
```typescript
const [dragOver, setDragOver] = useState(false);

const onDragOver = (e: React.DragEvent) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  setDragOver(true);
};

const onDragLeave = () => setDragOver(false);

const onDrop = async (e: React.DragEvent) => {
  e.preventDefault();
  setDragOver(false);
  if (!currentSession) return;
  const files = Array.from(e.dataTransfer.files);
  for (const file of files) {
    try {
      const { type } = await importArtifact(currentSession.project, currentSession.name, file);
      // no manual store update: WebSocket `*_created` broadcast feeds the store
    } catch (err) {
      console.error(`Import failed for ${file.name}:`, err);
      // TODO: surface as toast once we wire one up
    }
  }
};
```

Render: add `onDragOver`, `onDragLeave`, `onDrop` to the artifact list's root `<div>`. Add a `data-drag-over` attribute (or conditional class) for CSS highlight.

**Error handling:** One file's failure must not block siblings. Collect errors and log; optional toast per error.

**Edge cases:**
- Drag entering a child element triggers dragleave on parent — use `dataTransfer.types.includes('Files')` check and/or drag counter pattern to prevent flicker
- Dragging selected items within the app (e.g., ItemCard reorder) should not trigger upload — check that `dataTransfer.files.length > 0`

**Test strategy:** Component test using `@testing-library/react` — construct a DragEvent with a fake `dataTransfer`, assert `importArtifact` is called per file.

---

### `ImageViewer.tsx`

**Pseudocode:**
1. Receive `image: Image` prop (or pull from store by `selectedImageId`)
2. Render:
   - `<img src={/api/image/{id}/content?project=...&session=...} alt={image.name} style="max-width: 100%; max-height: 80vh; object-fit: contain;" />`
   - Metadata row: filename, MIME type, formatted size (reuse `formatSize` helper if it exists), upload date
   - Download button: `<a download href={contentUrl}>`
3. Handle loading error: show placeholder if the `<img>` fails to load

**Edge cases:** SVGs may contain scripts — set `sandbox` attributes on iframe if we ever switch to iframe embedding, but for `<img>` tags the browser treats SVG as static image.

**Test strategy:** Snapshot test with a mock image; verify download link href format.

---

### `/api/image` POST route handler

**Pseudocode:**
```typescript
if (path === '/api/image' && req.method === 'POST') {
  const params = getSessionParams(url);
  if (!params) return Response.json({ error: 'project and session required' }, { status: 400 });

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'file field required' }, { status: 400 });
    const name = (form.get('name') as string) || file.name;
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';

    const { imageManager } = await createManagers(params.project, params.session);
    const image = await imageManager.create({ name, buffer, mimeType });

    wsHandler.broadcast({
      type: 'image_created',
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      size: image.size,
      uploadedAt: image.uploadedAt,
      project: params.project,
      session: params.session,
    });

    return Response.json({ id: image.id, ...image, success: true });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
```

Mirror `/api/images` GET (list), `/api/image/:id` GET (metadata), `/api/image/:id/content` GET (stream binary with correct `Content-Type` header), `/api/image/:id` DELETE. Follow the exact patterns used by the embed routes in `src/routes/api.ts:2019-2107`.

**Key detail for streaming `/content`**: respond with `new Response(buffer, { headers: { 'Content-Type': meta.mimeType, 'Content-Length': String(meta.size), 'Cache-Control': 'private, max-age=3600' } })`.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: backend-types-config
    files:
      - src/types.ts
      - src/config.ts
    tests: []
    description: "Add Image/ImageMeta/ImageListItem types and MAX_IMAGE_SIZE, ALLOWED_IMAGE_MIME_TYPES config constants."
    parallel: true
    depends-on: []

  - id: frontend-types
    files:
      - ui/src/types/image.ts
      - ui/src/types/index.ts
      - ui/src/types/item.ts
    tests: []
    description: "Add Image interface and add 'image' to the Item type union; re-export from the types barrel."
    parallel: true
    depends-on: []

  - id: session-registry
    files:
      - src/services/session-registry.ts
    tests: []
    description: "Add 'images' to the resolvePath() artifact kind union so imageManager can resolve its directory."
    parallel: true
    depends-on: []

  - id: backend-image-manager
    files:
      - src/services/image-manager.ts
    tests:
      - src/services/image-manager.test.ts
    description: "New ImageManager service: initialize/create/list/get/getContent/delete over binary files + meta sidecars. Reuses the EmbedManager pattern."
    parallel: false
    depends-on: [backend-types-config, session-registry]

  - id: frontend-store
    files:
      - ui/src/stores/sessionStore.ts
    tests: []
    description: "Add images state slice + actions (setImages, addImage, selectImage, updateImage, removeImage) to the session store."
    parallel: true
    depends-on: [frontend-types]

  - id: frontend-api-client
    files:
      - ui/src/lib/api.ts
    tests: []
    description: "Add createImage (multipart), listImages, deleteImage methods to the api client."
    parallel: true
    depends-on: [frontend-types]

  - id: frontend-import-artifact
    files:
      - ui/src/lib/importArtifact.ts
    tests:
      - ui/src/lib/importArtifact.test.ts
    description: "Extend ArtifactType union with 'image'; detect image extensions in detectType; branch inside importArtifact to POST multipart for images while keeping the JSON path for text types."
    parallel: true
    depends-on: [frontend-types]

  - id: backend-api-routes
    files:
      - src/routes/api.ts
    tests: []
    description: "Wire imageManager into createManagers(); add POST /api/image (multipart), GET /api/images, GET /api/image/:id, GET /api/image/:id/content (binary stream with Content-Type), DELETE /api/image/:id. Broadcast image_created / image_deleted."
    parallel: false
    depends-on: [backend-image-manager]

  - id: backend-mcp-tools
    files:
      - src/mcp/tools/image.ts
      - src/mcp/setup.ts
    tests: []
    description: "MCP tool handlers + schemas for create_image, list_images, get_image, delete_image. Reuses loadImageBytes() from design-ai.ts for source-agnostic loading. Register in setup.ts ListTools + CallTool handlers."
    parallel: true
    depends-on: [backend-image-manager]

  - id: frontend-image-viewer
    files:
      - ui/src/components/ImageViewer.tsx
    tests: []
    description: "New ImageViewer component: render <img> bound to /api/image/:id/content, show metadata and download link."
    parallel: true
    depends-on: [frontend-store]

  - id: frontend-sidebar-integration
    files:
      - ui/src/components/layout/Sidebar.tsx
    tests: []
    description: "Render an Images section in the sidebar using ItemCard; wire onDragOver/onDragLeave/onDrop handlers on the artifact list container to call importArtifact() per file. Highlight the list while dragging. Rely on WebSocket broadcasts to update the store after upload."
    parallel: false
    depends-on: [frontend-store, frontend-import-artifact, frontend-image-viewer]

  - id: websocket-image-events
    files:
      - ui/src/lib/websocket.ts
    tests: []
    description: "Handle image_created and image_deleted WebSocket messages: update the session store (addImage / removeImage) so all clients see uploads in real time."
    parallel: true
    depends-on: [frontend-store]

  - id: tests-e2e
    files: []
    tests:
      - src/routes/__tests__/image-upload.test.ts
    description: "Integration test: start test server, POST multipart to /api/image, assert file lands on disk with correct meta, GET /api/image/:id/content returns bytes with correct MIME, DELETE removes both files."
    parallel: false
    depends-on: [backend-api-routes, backend-mcp-tools, frontend-sidebar-integration, websocket-image-events]
```

### Execution Waves

**Wave 1 (parallel — pure additions, no cross-deps):**
- `backend-types-config`
- `frontend-types`
- `session-registry`

**Wave 2 (parallel — depends on Wave 1):**
- `backend-image-manager` (needs types + session-registry)
- `frontend-store` (needs frontend-types)
- `frontend-api-client` (needs frontend-types)
- `frontend-import-artifact` (needs frontend-types)

**Wave 3 (parallel — depends on Wave 2):**
- `backend-api-routes` (needs image-manager)
- `backend-mcp-tools` (needs image-manager)
- `frontend-image-viewer` (needs store)
- `websocket-image-events` (needs store)

**Wave 4 (serial — single file, combines several dependencies):**
- `frontend-sidebar-integration` (needs store + import-artifact + viewer)

**Wave 5 (depends on everything):**
- `tests-e2e`

### Summary
- **Total tasks:** 13
- **Total waves:** 5
- **Max parallelism:** 4 (Waves 2 and 3)
- **Critical path:** `frontend-types → frontend-store → frontend-sidebar-integration → tests-e2e` (5 hops)
- **Smallest path to something user-visible:** Waves 1–4 frontend lane + Wave 3 `backend-api-routes`. MCP tools and E2E tests can land after the UI is usable.
