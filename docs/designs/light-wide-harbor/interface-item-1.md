# Interface Definition - Item 1

## Log document updates from update and patch operations

### File Structure

- `src/types/update-log.ts` - Type definitions for update log
- `src/services/update-log-manager.ts` - UpdateLogManager service
- `src/routes/api.ts` - New history endpoints (modification)

### Type Definitions

```typescript
// src/types/update-log.ts

/**
 * A single change entry recording a document modification
 */
export interface ChangeEntry {
  /** ISO timestamp when the change occurred */
  timestamp: string;
  /** Diff details showing what was changed */
  diff: {
    /** Text that was replaced */
    oldString: string;
    /** Text that replaced it */
    newString: string;
  };
}

/**
 * Log entry for a single document tracking its history
 */
export interface DocumentLogEntry {
  /** Original content captured on first update */
  original: string;
  /** Array of changes in chronological order */
  changes: ChangeEntry[];
}

/**
 * Root structure of the update-log.json file
 */
export interface UpdateLog {
  /** Map of document IDs to their log entries */
  documents: Record<string, DocumentLogEntry>;
}

/**
 * Response shape for GET /api/document/:id/history
 */
export interface HistoryResponse {
  /** Original document content */
  original: string;
  /** Array of change entries */
  changes: ChangeEntry[];
}

/**
 * Response shape for GET /api/document/:id/version
 */
export interface VersionResponse {
  /** Document content at the requested timestamp */
  content: string;
  /** The timestamp that was requested */
  timestamp: string;
}
```

### Function Signatures

```typescript
// src/services/update-log-manager.ts

import type { ChangeEntry, DocumentLogEntry, UpdateLog } from '../types/update-log';

/**
 * Manages document update history logging and replay
 */
export class UpdateLogManager {
  /**
   * Initialize with the session base path
   * @param basePath - Path to the session folder (e.g., .collab/sessions/light-wide-harbor)
   */
  constructor(basePath: string);

  /**
   * Log a document update. Captures original content on first update.
   * @param documentId - The document ID being updated
   * @param oldContent - Content before the update
   * @param newContent - Content after the update  
   * @param diff - Optional patch diff if available (from patch operations)
   */
  async logUpdate(
    documentId: string,
    oldContent: string,
    newContent: string,
    diff?: { oldString: string; newString: string }
  ): Promise<void>;

  /**
   * Get the change history for a document
   * @param documentId - The document ID to get history for
   * @returns Document log entry with original content and changes, or null if no history
   */
  async getHistory(documentId: string): Promise<DocumentLogEntry | null>;

  /**
   * Replay changes to reconstruct document at a specific timestamp
   * @param documentId - The document ID to replay
   * @param timestamp - ISO timestamp to replay to
   * @returns Content at that point in time
   * @throws Error if document has no history or timestamp is invalid
   */
  async replayToTimestamp(documentId: string, timestamp: string): Promise<string>;

  /**
   * Load the update log from disk (creates empty log if doesn't exist)
   * @private
   */
  private async loadLog(): Promise<UpdateLog>;

  /**
   * Save the update log to disk
   * @private
   */
  private async saveLog(log: UpdateLog): Promise<void>;
}
```

### API Endpoints

```typescript
// src/routes/api.ts - additions

// GET /api/document/:id/history?project=...&session=...
// Returns change history for a document
// Response: HistoryResponse { original: string, changes: ChangeEntry[] }
// Status: 200 OK, 404 if document has no history

// GET /api/document/:id/version?project=...&session=...&timestamp=...
// Returns document content at a specific timestamp
// Query params: timestamp (ISO string)
// Response: VersionResponse { content: string, timestamp: string }
// Status: 200 OK, 400 if missing timestamp, 404 if no history
```

### WebSocket Messages

```typescript
// New WebSocket message type for history updates
interface DocumentHistoryUpdatedMessage {
  type: 'document_history_updated';
  id: string;  // document ID
  project: string;
  session: string;
  changeCount: number;  // total number of changes
}
```

### Component Interactions

1. **POST /api/document/:id (update)** in `api.ts`:
   - After `documentManager.saveDocument()` succeeds
   - If patch info provided in request body, call `updateLogManager.logUpdate()` with diff
   - If no patch info, compute diff by comparing old vs new content
   - Broadcast `document_history_updated` via WebSocket

2. **UpdateLogManager → File System**:
   - Reads/writes `update-log.json` in session folder
   - Uses atomic write pattern (write to temp file, then rename)

3. **History endpoints → UpdateLogManager**:
   - `/history` calls `updateLogManager.getHistory()`
   - `/version` calls `updateLogManager.replayToTimestamp()`
