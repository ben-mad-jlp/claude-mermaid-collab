# Bug Review - Image Feature Implementation

## Critical Bugs

### 1. Race Condition in Image ID Collision Detection
**Severity**: Critical  
**File**: src/routes/api.ts, lines 2174 (image POST route)  
**Description**: Each request to POST /api/image calls `createManagers()`, which creates a new `ImageManager` instance with an empty index Map. If two concurrent requests upload images with the same name, both will:
1. See an empty index on their newly-created ImageManager
2. Generate the same ID (e.g., both produce `filename-1`)
3. Both write to the same file path, causing data loss

The index is not shared across requests — it's only in-memory per ImageManager instance.

**Specific Fix**: Managers must be created once at server startup and reused across requests, or a global/per-session lock must protect ID generation. The current per-request instantiation pattern is fundamentally incompatible with collision detection that relies on in-memory state.

---

### 2. Missing Image Type in Sidebar isItemSelected Function
**Severity**: Critical  
**File**: ui/src/components/layout/Sidebar.tsx, line 471  
**Description**: The `isItemSelected` callback (lines 463-472) doesn't handle `item.type === 'image'`. It only checks for diagram, design, spreadsheet, snippet, and defaults to document. When an image is passed in, it will incorrectly return whether it matches `selectedDocumentId` instead of `selectedImageId`.

**Specific Fix**: Add case for image type:
```typescript
const isItemSelected = useCallback(
  (item: Item) => {
    if (item.type === 'diagram') return item.id === selectedDiagramId;
    if (item.type === 'design') return item.id === selectedDesignId;
    if (item.type === 'spreadsheet') return item.id === selectedSpreadsheetId;
    if (item.type === 'snippet') return item.id === selectedSnippetId;
    if (item.type === 'image') return item.id === selectedImageId;
    return item.id === selectedDocumentId;
  },
  [selectedDiagramId, selectedDocumentId, selectedDesignId, selectedSpreadsheetId, selectedSnippetId, selectedImageId]
);
```

---

### 3. Missing Dependencies in WebSocket useCallback
**Severity**: Critical  
**File**: ui/src/App.tsx, line 839  
**Description**: The WebSocket message handler useEffect has a dependency array that includes `addEmbed` and `removeEmbed`, but is missing `addImage` and `removeImage`. The handler has code that calls `addImage()` and `removeImage()` in the `image_created` and `image_deleted` cases (lines 656 and 662). Missing these dependencies means:
1. Stale closure captures of the old `addImage`/`removeImage` functions
2. Images received via WebSocket won't properly update the store
3. The effect won't re-run when these functions change

**Specific Fix**: Add `addImage` and `removeImage` to the dependency array:
```typescript
}, [isConnected, currentSession, updateDiagram, updateDocument, updateDesign, updateSpreadsheet, addDiagram, addDocument, addDesign, addSpreadsheet, removeDiagram, removeDocument, removeDesign, removeSpreadsheet, addSnippet, updateSnippet, removeSnippet, addEmbed, removeEmbed, addImage, removeImage, setPendingDiff, setCollabState, receiveQuestion, restoreUIState]);
```

---

## Important Bugs

### 4. Image Type Missing Required Item Interface Fields
**Severity**: Important  
**File**: ui/src/types/image.ts (line 1-10)  
**Description**: The `Image` type has fields: `id`, `name`, `mimeType`, `size`, `uploadedAt`, `deprecated?`, `pinned?`, `locked?`. However, the `Item` interface (ui/src/types/item.ts lines 20-41) requires:
- `content: string` (Image doesn't have this)
- `lastModified: number` (Image has `uploadedAt: string` instead)

The Sidebar casts Image to Item using `as unknown as Item` (line 721), which hides the type mismatch. ItemCard tries to access `item.lastModified` (line 253), which will be undefined for images, breaking the relative time display.

**Specific Fix**: Update the Image interface to match Item requirements:
```typescript
export interface Image {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  content?: string;  // Add for Item compatibility
  lastModified?: number;  // Add for Item compatibility
  deprecated?: boolean;
  pinned?: boolean;
  locked?: boolean;
}
```

Or better: Create a separate render format that includes the required fields before casting to Item.

---

### 5. Missing Image Case in Sidebar handleImport
**Severity**: Important  
**File**: ui/src/components/layout/Sidebar.tsx, line 247  
**Description**: The `handleImport` callback builds a list of existing items to check for duplicates: `allItems = [...diagrams, ...documents, ...designs, ...spreadsheets, ...snippets]`. It doesn't include `images`. This means a duplicate image filename won't be detected, and users won't see the "already exists" confirmation dialog.

**Specific Fix**: Include images in the duplicate check:
```typescript
const allItems = [...diagrams, ...documents, ...designs, ...spreadsheets, ...snippets, ...images];
```

---

### 6. Missing Image Case in Content-Type Check in POST /api/image
**Severity**: Minor  
**File**: src/routes/api.ts, line 2165  
**Description**: The check `if (contentType.startsWith('multipart/form-data'))` uses `startsWith`, which is correct for handling boundary parameters like `multipart/form-data; boundary=...`. However, it's worth noting that if a client sends `multipart/mixed` or other multipart subtypes, they'll fall through to the JSON branch and fail. This is likely intentional but should be documented or tested.

**Note**: This is not necessarily a bug if the intended behavior is to only accept `multipart/form-data`, but be aware of the implications.

---

## Summary

**Total Bugs Found: 6**
- **Critical**: 3 (race condition, missing image type handling, missing dependencies)
- **Important**: 2 (type field mismatch, missing image in duplicate detection)
- **Minor**: 1 (content-type handling note)

The three critical bugs must be fixed before the feature is production-ready. The race condition in particular could cause data loss or filename collisions under concurrent upload scenarios.