/**
 * UpdateLogManager - Document Update History Logging and Replay
 *
 * Manages the logging of document updates with timestamps and diffs,
 * allowing for history retrieval and content reconstruction at any point in time.
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import type { ChangeEntry, DocumentLogEntry, UpdateLog } from '../types/update-log';

/**
 * Manages document update history logging and replay
 */
export class UpdateLogManager {
  private basePath: string;
  private logFilePath: string;

  /**
   * Initialize with the session base path
   * @param basePath - Path to the session folder (e.g., .collab/sessions/light-wide-harbor)
   */
  constructor(basePath: string) {
    this.basePath = basePath;
    this.logFilePath = join(basePath, 'update-log.json');
  }

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
  ): Promise<void> {
    // Skip if content is unchanged
    if (oldContent === newContent) {
      return;
    }

    // Load existing log
    const log = await this.loadLog();

    // Create entry if this is first update for document
    if (!log.documents[documentId]) {
      log.documents[documentId] = {
        original: oldContent,
        changes: [],
      };
    }

    // Compute diff if not provided
    const effectiveDiff = diff ?? { oldString: oldContent, newString: newContent };

    // Create change entry with timestamp
    const changeEntry: ChangeEntry = {
      timestamp: new Date().toISOString(),
      diff: effectiveDiff,
    };

    // Append change
    log.documents[documentId].changes.push(changeEntry);

    // Save atomically
    await this.saveLog(log);
  }

  /**
   * Get the change history for a document
   * @param documentId - The document ID to get history for
   * @returns Document log entry with original content and changes, or null if no history
   */
  async getHistory(documentId: string): Promise<DocumentLogEntry | null> {
    const log = await this.loadLog();
    return log.documents[documentId] ?? null;
  }

  /**
   * Replay changes to reconstruct document at a specific timestamp
   * @param documentId - The document ID to replay
   * @param timestamp - ISO timestamp to replay to
   * @returns Content at that point in time
   * @throws Error if document has no history or timestamp is invalid
   */
  async replayToTimestamp(documentId: string, timestamp: string): Promise<string> {
    const history = await this.getHistory(documentId);

    if (!history) {
      throw new Error(`No history found for document ${documentId}`);
    }

    // Parse target timestamp
    const targetTime = new Date(timestamp).getTime();

    // Start with original content
    let content = history.original;

    // Apply changes up to and including the target timestamp
    for (const change of history.changes) {
      const changeTime = new Date(change.timestamp).getTime();

      if (changeTime <= targetTime) {
        // Apply the change: replace oldString with newString
        content = content.replace(change.diff.oldString, change.diff.newString);
      } else {
        // Stop iterating - changes are in chronological order
        break;
      }
    }

    return content;
  }

  /**
   * Load the update log from disk (creates empty log if doesn't exist)
   * @private
   */
  private async loadLog(): Promise<UpdateLog> {
    try {
      if (!existsSync(this.logFilePath)) {
        return { documents: {} };
      }

      const content = readFileSync(this.logFilePath, 'utf-8');
      return JSON.parse(content) as UpdateLog;
    } catch (error) {
      // File read or JSON parse error - return empty log
      console.warn('Failed to load update log, returning empty log:', error);
      return { documents: {} };
    }
  }

  /**
   * Save the update log to disk atomically
   * @private
   */
  private async saveLog(log: UpdateLog): Promise<void> {
    const tempPath = `${this.logFilePath}.tmp`;

    try {
      // Serialize with formatting
      const content = JSON.stringify(log, null, 2);

      // Write to temp file
      writeFileSync(tempPath, content, 'utf-8');

      // Rename atomically
      try {
        renameSync(tempPath, this.logFilePath);
      } catch (renameError) {
        // Clean up temp file on rename failure
        try {
          unlinkSync(tempPath);
        } catch {
          // Ignore cleanup error
        }
        throw renameError;
      }
    } catch (error) {
      throw new Error(`Failed to save update log: ${error}`);
    }
  }
}
