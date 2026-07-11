# Image Artifact Feature Research

## 1. Current Artifact Type Anatomy (Documents as Reference)

### Storage Model
- **Location**: `.collab/sessions/{session}/documents/` (per session, per artifact type)
- **File format**: One `.md` file per document (ID is filename without extension)
- **Metadata**: Stored in `.collab/sessions/{session}/metadata.json` (shared across all artifact types)
- **Index**: In-memory `Map<id, Meta>` in `DocumentManager` with `{name, path, lastModified}`
- **History**: Update log stored in `.collab/sessions/{session}/update-log.json` with original + diffs per resource

**Files**: 
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/document-manager.ts` (lines 1-149)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/metadata-manager.ts` (manages pinned/locked/deprecated flags)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/update-log-manager.ts` (versioning, stores diffs not full content per change)

### API Routes
- **List**: `GET /api/documents?project=...&session=...` → returns array with `{id, name, lastModified, deprecated, pinned, locked, blueprint}`
- **Get**: `GET /api/document/:id?project=...&session=...` → returns full document with content
- **Get clean**: `GET /api/document/:id/clean?project=...&session=...` → strips markup
- **Create**: `POST /api/document?project=...&session=...` (body: `{name, content}`)
- **Update**: `POST /api/document/:id?project=...&session=...` (body: `{content}`)
- **Delete**: `DELETE /api/document/:id?project=...&session=...`
- **History**: `GET /api/document/:id/history?project=...&session=...` → original + changes array
- **Revert**: `GET /api/document/:id/version?project=...&session=...&timestamp=...` → content at point in time

**Files**:
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/api.ts` (lines 1291-1540+ for documents)

### MCP Tools Pattern
1. **Tool schemas** defined in `/src/mcp/tools/document.ts` (or shared)
2. **Tool handlers** in same file or separate (e.g., `handleCreateDocument`)
3. **Tool registration** in `/src/mcp/setup.ts`:
   - Add schema import
   - Add tool definition to `ListToolsRequestSchema` handler (line ~830+)
   - Add case statement in `CallToolRequestSchema` handler (line ~2102+)
4. **Naming convention**: `create_document`, `get_document`, `list_documents`, `update_document`, `delete_document`, `get_document_history`, `revert_document`, `patch_document`

**Files**:
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts` (lines 1-200 for imports, ~830 for list_tools, ~2102 for call_tool)

### Frontend/UI
- **Session store** (`/ui/src/stores/sessionStore.ts`): State includes `documents: Document[]`, `selectedDocumentId`, methods like `setDocuments()`, `selectDocument()`, `updateDocument()`, `removeDocument()`
- **Sidebar** (`/ui/src/components/layout/Sidebar.tsx`): Lists all artifact types using `ItemCard` component, handles delete/update via `useDataLoader()` hook
- **ItemCard** (`/ui/src/components/layout/ItemCard.tsx`): Renders individual artifact with drag/drop, delete, rename, pin/lock/deprecate actions
- **Data loader** (`/ui/src/hooks/useDataLoader.ts`): Fetches artifact content on demand
- **Type definition** (`/ui/src/types/index.ts`): `type Item = {type: 'diagram'|'document'|'design'|'spreadsheet'|'snippet'|'embed', id: string, ...}`

**Files**:
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/stores/sessionStore.ts` (lines 40-200+ for session state structure)
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/layout/Sidebar.tsx` (lines 1-150+ shows how artifacts are listed)
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/types/index.ts` (Item type definition)

### WebSocket Broadcasting
- Pattern: After creating/updating/deleting, call `wsHandler.broadcast({type: 'document_created'|'document_updated'|'document_deleted', id, name, project, session, ...})`
- Broadcasting happens in HTTP handlers so WebSocket clients (other users/sessions) see real-time updates
- Handler is injected into routes: `wsHandler.broadcast()`

**Files**:
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/api.ts` (line ~1422 for broadcast example, `wsHandler` is injected)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/ws-handler-manager.ts` (broadcast implementation)

---

## 2. Existing Image Handling in the Codebase

### Images in Designs (Current Implementation)
- **Storage**: Images embedded as base64 in design JSON under `graph.images = [{key: hash, value: base64}]`
- **Hash-based**: SHA256 hash of image bytes used as key to deduplicate identical images
- **Source types**: URL, file path, or base64 data URI
- **Functions**:
  - `loadImageBytes()` (design-ai.ts:1373) — fetches/reads/decodes image to Buffer
  - `addImageToGraph()` (design-ai.ts:1398) — stores base64 in design JSON with hash key
  - `handleAddDesignImage()` (design-ai.ts:1411) — creates FRAME node with IMAGE fill
  - `handleSetNodeImage()` (design-ai.ts:1454) — updates image fill on existing node

**Key insight**: Images are NOT versioned separately; they're stored inline in the design JSON. Full design history captures all images.

**Files**:
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/tools/design-ai.ts` (lines 1373-1490)

### Export/Rendering (PNG/SVG Generation)
- **`export_design_png`**: Browser-side rendering via CanvasKit (lines 1192-1220 in api.ts) — design is sent to browser, browser renders, uploads back to `/api/design-export-result/:requestId`
- **`export_diagram_png` / `export_diagram_svg`**: Server-side rendering using Mermaid/jsdom
- **`export_design_svg`**: Server-side rendering of design scene graph to SVG (design-ai.ts calls Yoga layout + custom SVG builder)

**Key insight**: There's already a pattern for handling binary image data (`arrayBuffer()` at line 1200 in api.ts, `Buffer.from()`).

**Files**:
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/api.ts` (lines 1192-1250 for export endpoints)

### No Existing Image Artifact Type
- There is **no standalone image artifact type**
- Embeds are URL-only (no local files)
- Images only live inside designs (embedded as base64)
- No assets/uploads/blobs directory structure exists

**Conclusion**: We have image loading/hashing utilities but no artifact type wrapper around standalone images.

---

## 3. Gaps for a New `image` Artifact Type

### New Infrastructure Needed

#### 3.1 Storage Model (Decision Point)
**Option A: Separate Files (Recommended)**
- Store images as binary files in `.collab/sessions/{session}/images/{id}` or `.collab/sessions/{session}/images/{id}.{ext}`
- Keep metadata JSON (size, MIME type, upload date, dimensions if calculated)
- Pros: Native file system alignment, easy to serve as downloads, can stream large files
- Cons: Larger disk footprint, no built-in versioning per image

**Option B: Inline (Like Designs)**
- Store images as base64 in a metadata JSON file per session
- Pros: Single file, versioning works out of box
- Cons: Base64 bloats files (1.33x), slow for large images, hard to stream

**Recommendation**: Option A with separate binary storage + lightweight metadata JSON per image.

#### 3.2 Image Manager Service
New file: `/src/services/image-manager.ts`
```
class ImageManager {
  async initialize()
  async create(id, buffer, mimeType, name)
  async get(id) -> {id, name, mimeType, size, uploadedAt}
  async getContent(id) -> Buffer
  async list() -> [{id, name, mimeType, size, uploadedAt}]
  async delete(id)
  async getMetadata(id)  // width/height from image analysis (optional)
}
```

Key methods:
- `loadImageBytes()` can be reused from design-ai.ts
- MIME type validation (png, jpg, gif, webp, svg, bmp, tiff?)
- Size limit checks (suggest 50MB per image, configurable)
- Optional: image dimensions via Sharp or Canvas

#### 3.3 API Routes
New endpoints:
- `POST /api/image?project=...&session=...` — upload binary (multipart/form-data or raw body)
  - Request: `multipart/form-data` with `file` field + `name` field (or auto-name)
  - Response: `{id, name, mimeType, size, uploadedAt}`
- `GET /api/images?project=...&session=...` — list
  - Response: `[{id, name, mimeType, size, uploadedAt, deprecated, pinned, locked}]` (metadata merged)
- `GET /api/image/:id?project=...&session=...` — get metadata
  - Response: `{id, name, mimeType, size, uploadedAt}`
- `GET /api/image/:id/content?project=...&session=...` — stream binary
  - Response: `Content-Type: image/png` (or detected type), raw bytes
- `GET /api/image/:id/download?project=...&session=...` — download (with attachment header)
- `DELETE /api/image/:id?project=...&session=...` — delete
- `PATCH /api/image/:id?project=...&session=...` — update name/metadata only (not content)

**File**: Will be in `/src/routes/api.ts` (new section alongside documents/embeds)

#### 3.4 MCP Tools
New tools file: `/src/mcp/tools/image.ts`
- `create_image` — upload image (args: project, session, name, source)
- `get_image` — get metadata
- `list_images` — list all
- `delete_image` — delete
- `export_image` — stream content (or provide download URL)

Register in `/src/mcp/setup.ts` (around lines 830+ and 2102+).

#### 3.5 History/Versioning
**Decision**: Images are immutable artifacts. No in-place update, only delete+recreate.
- **Pro**: Simpler (no PATCH for content), aligns with binary semantics
- **Con**: No version history per image (but each version is a separate artifact ID)
- **Alternative**: Store upload history in metadata JSON (list of past uploads for same image name)

**Recommendation**: Immutable (no versioning) for MVP. Can add an `_archive` folder to keep old images if needed.

#### 3.6 Frontend Changes

**Type System** (`/ui/src/types/index.ts`):
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

**Session Store** (`/ui/src/stores/sessionStore.ts`):
- Add `images: Image[]`
- Add `selectedImageId: string | null`
- Add `setImages()`, `addImage()`, `selectImage()`, `updateImage()`, `removeImage()`
- Update `currentSession` selection logic to clear images when switching sessions

**Sidebar** (`/ui/src/components/layout/Sidebar.tsx`):
- Add image folder section in artifact list
- Add delete/rename/pin/lock handlers for images
- Add upload button/drop zone in image section

**Item Viewer** (new file `ImageViewer.tsx`):
- Display `<img src="/api/image/{id}/content" alt="{name}" />`
- Show metadata (size, type, upload date)
- Provide download link
- Optional: full-screen preview modal

**Upload Dialog** (new or extend `FileBrowserDialog.tsx`):
- Drag-and-drop zone for images
- File input with `accept="image/*"`
- Progress bar for upload
- Error handling for size limits / invalid types

**Files to create/modify**:
- `/ui/src/types/index.ts` — add Image interface, update Item type
- `/ui/src/stores/sessionStore.ts` — add image state
- `/ui/src/components/layout/Sidebar.tsx` — add image section
- `/ui/src/components/ImageViewer.tsx` (new) — display image
- `/ui/src/components/dialogs/ImageUploadDialog.tsx` (new) — upload UI

#### 3.7 Document Embedding
**Syntax**: `{{image:id}}` in markdown documents
- Render as: `<img src="/api/image/{id}/content" alt="image-{id}" style="max-width:100%; height:auto;" />`
- Follow existing pattern in `/ui/src/components/editors/MarkdownEditor.tsx` (check how `{{diagram:id}}` is handled)

**Files**:
- `/ui/src/components/editors/MarkdownEditor.tsx` (look for diagram embed rendering)
- `/ui/src/lib/downloadArtifact.ts` or similar (might need image export method)

---

## 4. Drag-and-Drop UI Plan

### Scope Update (2026-04-10)

The drop target lives in the **artifact items list** (the Sidebar), not globally. And rather than shipping drag-and-drop only for images, the same drop zone should accept **multiple file types** and route each to the right artifact:

| Dropped file | Artifact type | MCP / API route |
|---|---|---|
| `image/*` (png, jpg, gif, webp, svg, bmp) | `image` (new) | `POST /api/image` |
| `.md`, `.markdown`, `text/markdown`, `text/plain` | `document` | `POST /api/document` |
| Code files (`.ts`, `.tsx`, `.js`, `.py`, `.go`, `.rs`, `.sql`, `.sh`, etc. — anything with a recognized syntax extension and not markdown/csv) | `snippet` | `POST /api/snippet` |
| `.csv`, `text/csv` | `spreadsheet` | `POST /api/spreadsheet` (or CSV-import variant) |
| `.mmd`, `.mermaid` | `diagram` | `POST /api/diagram` |
| Unknown / unsupported | Reject with inline toast | — |

Routing happens on the client by extension first, then MIME as a fallback. The user gets immediate visual feedback: the sidebar highlights while dragging over it, and each file shows a per-row success/error state after drop.

### Where the Drop Zone Lives

**Decision: the Sidebar artifact list itself is the drop zone.**

- One drop target wraps the whole artifact list section of `Sidebar.tsx` (not per-type subsections — less fiddly, and the file type decides where the new item lands).
- No global/page-level drop overlay (avoids conflict with the design editor's canvas drag interactions).
- No per-document inline drop in MVP. Can be added later for inline embeds if useful.

### Existing File Upload UI
- **`FileUpload.tsx`** (`ui/src/components/ai-ui/inputs/FileUpload.tsx`) — already has working drag-drop, file validation, file size limits
  - Has `onDrop`, `onDragOver`, `onDragLeave`, click-to-browse
  - Validates file size, shows errors
  - **Reusable** as the primitive, but the sidebar drop behavior likely wants its own wrapper because it needs to highlight a large existing area rather than render its own box.

### Implementation Sketch

#### Client: file-type router
New helper `ui/src/lib/artifactFromFile.ts`:

```ts
type ArtifactKind = 'image' | 'document' | 'snippet' | 'spreadsheet' | 'diagram';

const CODE_EXTS = new Set(['ts','tsx','js','jsx','py','go','rs','java','rb','php','sql','sh','bash','zsh','json','yaml','yml','toml','xml','html','css','scss','c','cpp','h','hpp','swift','kt','cs','vue','svelte']);

export function classifyDroppedFile(file: File): ArtifactKind | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (file.type.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg','bmp'].includes(ext)) return 'image';
  if (ext === 'mmd' || ext === 'mermaid') return 'diagram';
  if (ext === 'csv' || file.type === 'text/csv') return 'spreadsheet';
  if (ext === 'md' || ext === 'markdown' || file.type === 'text/markdown') return 'document';
  if (CODE_EXTS.has(ext)) return 'snippet';
  return null; // reject
}
```

#### Client: sidebar drop handler
In `Sidebar.tsx` (or a thin wrapper around the list container):

```tsx
const onDrop = async (e: DragEvent) => {
  e.preventDefault();
  setDragOver(false);
  const files = Array.from(e.dataTransfer?.files ?? []);
  for (const file of files) {
    const kind = classifyDroppedFile(file);
    if (!kind) { toast.error(`Unsupported: ${file.name}`); continue; }
    await uploadAs(kind, file, project, session);
  }
};
```

`uploadAs()` is a small dispatch table that picks the right API call. Images use multipart (`FormData`); text-based artifacts read `file.text()` and POST JSON to the existing text endpoints — so only the image route is new backend work for the drop zone itself.

#### Backend: the only new endpoint drag-drop needs

The drop-zone work only requires **one** new backend route — the multipart image upload from Section 3.3. All other dropped types (`.md`, `.csv`, `.mmd`, code files) can post plain text to the existing `create_document` / `create_spreadsheet` / `create_diagram` / `create_snippet` endpoints.

```typescript
if (path === '/api/image' && req.method === 'POST') {
  const formData = await req.formData();
  const file = formData.get('file') as File;
  const name = (formData.get('name') as string) || file.name;

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type;

  if (buffer.length > MAX_IMAGE_SIZE) throw new Error('File too large');

  const id = sanitize(name);
  const image = await imageManager.create(id, buffer, mimeType, name);

  wsHandler.broadcast({ type: 'image_created', id, name, project, session });
  return Response.json(image);
}
```

#### Paste-from-Clipboard (deferred)
Same routing logic could apply to clipboard paste events in the sidebar/global context. Defer until the drop-zone itself is validated.

---

## 5. Scoping Recommendation (Punch List)

### Phase 1: Foundation (Week 1)
1. Create `ImageManager` service (`/src/services/image-manager.ts`)
   - Init, list, get metadata, get content, create, delete, size validation
   - Decide on MIME types (whitelist: png, jpg, gif, webp, svg+xml, bmp, tiff, webp)
   - Add to managers factory in api.ts (line ~123)

2. Add API routes (`/src/routes/api.ts`)
   - `POST /api/image` — multipart upload
   - `GET /api/images` — list
   - `GET /api/image/:id` — metadata
   - `GET /api/image/:id/content` — stream binary
   - `DELETE /api/image/:id` — delete
   - Add WebSocket broadcasts for each operation

3. Add MCP tools (`/src/mcp/tools/image.ts` + register in setup.ts)
   - `create_image`, `list_images`, `get_image`, `delete_image`
   - Use existing `loadImageBytes()` from design-ai.ts

4. Update session registry type signature (line 419)
   - Add `'images'` to the resolvePath() type union

### Phase 2: Frontend (Week 1-2)
1. Add Image type to session store & UI types
   - `Image` interface in `/ui/src/types/index.ts`
   - Add state to `sessionStore.ts` (images array, selected ID, CRUD methods)

2. Add Images section to Sidebar
   - List images using `ItemCard` (or variant)
   - Delete/rename/pin/lock handlers (use existing metadata manager)
   - Show image thumbnail in card (optional, can be just icon)

3. **Multi-type drop zone on the Sidebar items list**
   - New helper `ui/src/lib/artifactFromFile.ts` with `classifyDroppedFile()` + `uploadAs()` dispatch
   - Wrap the artifact list section of `Sidebar.tsx` with a drop target (highlight on `dragover`)
   - Routes: `image/*` → `/api/image`, `.md` → documents, `.csv` → spreadsheets, `.mmd` → diagrams, code files → snippets
   - Reject unsupported file types with a toast
   - Per-file upload progress + error handling (one failure doesn't block siblings)
   - Listen for WebSocket `*_created` events so the list reflects new artifacts immediately

4. Create `ImageViewer.tsx` component
   - Display image with metadata
   - Download button
   - Modal preview
   - Update router to show image when selected from sidebar

### Phase 3: Integration & Polish (Week 2)
1. Add image embedding to Markdown
   - Parse `{{image:id}}` syntax
   - Render in markdown viewer
   - Test in documents

2. Optional: Clipboard paste support
   - Global paste listener
   - Auto-upload + insert into editor

3. Metadata enhancements (optional)
   - Calculate image dimensions on upload (use Canvas or stub)
   - Show dimensions in viewer
   - Aspect ratio preview in sidebar cards

4. Testing
   - Unit tests for ImageManager
   - Integration tests for API routes
   - E2E tests for upload flow

### Big Unknowns/Decisions

1. **MIME type whitelist**: How strict? Allow all `image/*` or specific types only?
   - **Recommendation**: Start with common types (png, jpg, gif, webp, svg+xml, bmp), reject others with clear error.

2. **File size limit**: 50MB? 100MB? Unlimited with warning?
   - **Recommendation**: 50MB per image (configurable via config.ts).

3. **Image dimensions**: Calculate on upload or lazy-load?
   - **Recommendation**: Skip for MVP (can calculate later with Canvas/Sharp library).

4. **Immutable vs. versioned**: Can users replace an image, or only delete + create?
   - **Recommendation**: Immutable (delete + recreate new ID) for MVP.

5. **Paste support**: Include or defer?
   - **Recommendation**: Defer to Phase 2 / after MVP validation.

6. **Thumbnail generation**: Show preview in sidebar, or just icon?
   - **Recommendation**: Just icon for MVP, thumbnails post-MVP.

7. **Download vs. view**: Should `/api/image/:id/content` have attachment header?
   - **Recommendation**: Two endpoints: `/content` for viewing inline, `/download` with attachment header for saving.

---

## 6. Key File/Line References

### Backend - Storage & Managers
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/document-manager.ts` — template for Manager class
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/embed-manager.ts` — simpler example (no history)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/metadata-manager.ts` — pinned/locked/deprecated flags
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/update-log-manager.ts` — versioning pattern (won't be used for images initially)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/session-registry.ts:419` — resolvePath() method signature

### Backend - API Routes
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/api.ts:123` — manager factory
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/api.ts:1291-1540` — document endpoints (template)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/api.ts:2020-2107` — embed endpoints (simpler, no history)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/api.ts:1192-1250` — export/binary handling pattern

### Backend - MCP Tools
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/tools/design-ai.ts:1373-1490` — loadImageBytes(), addImageToGraph() (reusable utilities)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/tools/embed.ts` — simple example tool file
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts:1-200` — imports
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts:830-1000` — ListToolsRequestSchema (add tool definitions)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts:2102+` — CallToolRequestSchema (add case statements)

### Backend - Types
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/types.ts` — artifact type interfaces (add Image, ImageMeta, ImageListItem)

### Frontend - State Management
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/stores/sessionStore.ts` — session state (add images array, CRUD methods)
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/types/index.ts` — Item type, artifact interfaces

### Frontend - UI Components
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/ai-ui/inputs/FileUpload.tsx` — reusable upload component with drag-drop
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/layout/Sidebar.tsx:1-200` — artifact list structure
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/layout/ItemCard.tsx` — individual artifact card
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/EmbedViewer.tsx` — reference for media viewer pattern

### Frontend - API Integration
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/lib/api.ts` — API client methods (add createImage, listImages, deleteImage)

### Configuration
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/config.ts` — add MAX_IMAGE_SIZE, ALLOWED_IMAGE_TYPES

---

## Summary

**Reusable components**:
- `loadImageBytes()` (from design-ai.ts) for source-agnostic loading
- `FileUpload` React component with built-in validation
- `MetadataManager` for pinned/locked/deprecated flags
- WebSocket broadcast pattern for real-time sync
- Session store pattern for state management

**Unique challenges for images**:
- Binary file handling (multipart upload, streaming responses)
- MIME type validation (whitelist management)
- Size limits (no built-in FileManager size check)
- No existing history/versioning model (immutable for MVP)
- Image dimensions (optional, requires Canvas or Sharp library)

**Simplest path to MVP**: 
- Immutable artifact type (no PATCH for content)
- Store as separate binary files + lightweight metadata JSON
- Reuse existing metadata manager for flags
- Skip dimensions/thumbnails for now
