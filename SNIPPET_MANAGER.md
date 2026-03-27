# SnippetManager Implementation

## Overview

The `SnippetManager` is a backend service that handles CRUD operations and version history tracking for code snippets in the mermaid-collab project. It manages snippet persistence in `.collab/sessions/{session}/snippets/` and tracks all changes with timestamp-based version history.

## Architecture

### Storage Structure

```
.collab/sessions/{name}/snippets/
├── {id}.snippet          # Current snippet content (plain text)
├── {id}.snippet          # Another snippet file
└── .history/
    ├── {id}.history      # Version history for snippet (JSON array)
    └── {id}.history      # Version history for another snippet
```

### Design Pattern

- **Index-based caching**: In-memory `Map<string, SnippetMeta>` for O(1) lookups
- **Lazy initialization**: Scans disk on startup, maintains in-memory state
- **Version tracking**: Stores timestamped versions in separate history files
- **Error resilience**: Graceful handling of corrupted files and missing entries

## API

### Initialization

```typescript
const manager = new SnippetManager(basePath);
await manager.initialize();  // Scans directory and builds index
```

### CRUD Operations

#### Create
```typescript
const id = await manager.createSnippet(name: string, content: string): Promise<string>
```
- Sanitizes snippet name to generate ID
- Throws if snippet already exists
- Throws if content exceeds `MAX_FILE_SIZE` (1MB)
- Records initial version in history
- Returns the generated snippet ID

#### Read (Single)
```typescript
const snippet = await manager.getSnippet(id: string): Promise<Snippet | null>
```
- Returns `null` if snippet doesn't exist
- Returns `null` if file is missing (graceful degradation)
- Includes: id, name, content, lastModified

#### Read (List)
```typescript
const snippets = await manager.listSnippets(): Promise<SnippetListItem[]>
```
- Returns all snippets
- Sorted by lastModified (descending)
- Each item includes: id, name, lastModified

#### Update
```typescript
await manager.saveSnippet(id: string, content: string): Promise<void>
```
- Updates existing snippet content only
- Throws if snippet not found
- Throws if content exceeds `MAX_FILE_SIZE`
- Records new version in history
- Updates lastModified timestamp

#### Delete
```typescript
await manager.deleteSnippet(id: string): Promise<void>
```
- Deletes snippet file
- Deletes history file
- Removes from index
- Throws if snippet not found

### Version History

#### Get History
```typescript
const history = await manager.getHistory(id: string): Promise<SnippetVersionEntry[]>
```
- Returns array of version entries with timestamps
- Each entry: `{ timestamp: number, content: string }`
- Ordered chronologically
- Returns empty array if no history exists

#### Get Version at Timestamp
```typescript
const content = await manager.getVersionAtTimestamp(id: string, timestamp: number): Promise<string | null>
```
- Retrieves content as it existed at a specific timestamp
- Returns `null` if no version exists at or before the timestamp
- Useful for time-travel debugging

### Index Management

#### Helper Methods
```typescript
// Check if snippet exists
manager.hasSnippet(id: string): boolean

// Get current index size
manager.getIndexSize(): number

// Update index entry (used by file watchers)
manager.updateIndex(id: string, path: string): void

// Remove from index (without deleting file)
manager.removeFromIndex(id: string): void

// Clear entire index (call initialize() to rebuild)
manager.reset(): void
```

## Integration Points

### Session Registry
- Snippets are registered with `sessionRegistry.registerSnippet()`
- Sessions are auto-created when first snippet is saved
- Snippet paths are resolved via `sessionRegistry.getSnippetsPath()`

### Update Log Manager
- Version history integrates with `UpdateLogManager` for audit trails
- Each snippet update is logged with: old content → new content
- Enables time-travel and change history in API

### WebSocket Broadcasting
- Create/Update/Delete operations broadcast to all connected clients
- Event types: `snippet_created`, `snippet_updated`, `snippet_deleted`
- Includes: id, content (for created/updated), lastModified, project, session

### API Routes (see `/src/routes/api.ts`)
- `GET /api/snippets?project=...&session=...` - List all snippets
- `GET /api/snippet/:id?project=...&session=...` - Get single snippet
- `GET /api/snippet/:id/history?project=...&session=...` - Get version history
- `GET /api/snippet/:id/version?project=...&session=...&timestamp=...` - Get version at timestamp
- `POST /api/snippet?project=...&session=...` - Create snippet
- `POST /api/snippet/:id?project=...&session=...` - Update snippet
- `DELETE /api/snippet/:id?project=...&session=...` - Delete snippet

## Error Handling

### Validation
- Snippet names must be non-empty strings
- Content must be defined/non-null
- Content size limited to 1MB
- Snippet IDs must exist before save/delete

### Graceful Degradation
- Missing snippet files return `null` instead of throwing
- Corrupted history files don't prevent snippet reads
- Failed history recording doesn't fail save operations
- File watcher errors logged but don't crash manager

### Constraints
- Maximum 100 version history entries per snippet (auto-truncates)
- IDs sanitized from names: `[^a-zA-Z0-9-_]` → `-`
- Leading/trailing hyphens removed from IDs
- File extension: `.snippet` (not `.json`)

## Performance Considerations

### Memory
- In-memory index size ≈ 100 bytes per snippet
- History files loaded only on demand
- Version arrays capped at 100 entries

### I/O
- Initialization: O(n) disk scan on startup
- List: O(1) from memory
- Get: O(1) index lookup + file read
- Create/Save: 2 file writes (content + history)
- Delete: 2 file deletes (content + history)

### Optimization Opportunities
- Batch operations for multiple snippets
- Incremental diff storage for history (currently full copies)
- Compression for large history files
- Cache history in memory after first access

## Testing

Comprehensive test suite in `/src/services/__tests__/snippet-manager.test.ts`:

- **Initialization**: Directory creation, indexing
- **CRUD Operations**: Create, read, update, delete
- **Version History**: Recording, retrieval, timestamped lookups
- **Error Handling**: Invalid inputs, missing files, corrupted history
- **Index Management**: Updates, removal, reset, size checks

Run tests:
```bash
npx vitest run src/services/__tests__/snippet-manager.test.ts
```

## Future Enhancements

1. **Batch Operations**: Support creating/deleting multiple snippets at once
2. **Search**: Index content for full-text search
3. **Tags/Folders**: Organize snippets with metadata
4. **Sharing**: Export/import snippets across sessions
5. **Diff Views**: Show changes between versions
6. **Compression**: Compress history files for large snippets
7. **Async Indexing**: Don't block on large directory scans
8. **Concurrent Access**: Handle multiple clients editing simultaneously

## Security Considerations

- Path traversal: IDs are sanitized and validated
- Size limits: Content capped at 1MB to prevent DoS
- File permissions: Created with default umask
- No encryption: Store sensitive data at your own risk
- No authentication: Relies on session-level access control

## Compatibility

- **Node.js/Bun**: Works with both runtime environments
- **Filesystem**: Requires POSIX-compliant fs (macOS, Linux, Windows WSL)
- **Encoding**: UTF-8 only (no binary snippets)
- **Versioning**: Compatible with existing diagram/document managers
