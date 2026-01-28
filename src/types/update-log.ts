/**
 * Type definitions for the document update log system
 * Tracks document changes with timestamps and diffs for history reconstruction
 */

/**
 * A single change entry representing one update to a document
 * Contains the timestamp and the diff applied
 */
export interface ChangeEntry {
  /** ISO timestamp when the change was made */
  timestamp: string;
  /** The diff that was applied */
  diff: {
    /** Original text that was replaced */
    oldString: string;
    /** New text that replaced the original */
    newString: string;
  };
}

/**
 * Log entry for a single document
 * Contains the original content and all subsequent changes
 */
export interface DocumentLogEntry {
  /** Full content of the document on first update */
  original: string;
  /** Array of changes applied after the original was captured */
  changes: ChangeEntry[];
}

/**
 * The complete update log structure
 * Maps document IDs to their change history
 */
export interface UpdateLog {
  /** Map of document ID to its log entry */
  documents: Record<string, DocumentLogEntry>;
}

/**
 * API response for the /history endpoint
 * Returns the change history for a specific document
 */
export interface HistoryResponse {
  /** Document ID that was queried */
  id: string;
  /** Original content of the document */
  original: string;
  /** Array of changes with timestamps and diffs */
  changes: ChangeEntry[];
}

/**
 * API response for the /version endpoint
 * Returns a reconstructed version of a document at a specific point in time
 */
export interface VersionResponse {
  /** Document ID that was queried */
  id: string;
  /** The reconstructed content at the requested version */
  content: string;
  /** ISO timestamp of the version (from the change entry, or original if version 0) */
  timestamp: string;
  /** Version number (0 = original, 1+ = after that many changes) */
  version: number;
}
