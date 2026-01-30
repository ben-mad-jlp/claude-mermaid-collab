/**
 * UpdateLogManager - Document Update History Logging and Replay
 *
 * Manages the logging of document updates with timestamps and diffs,
 * allowing for history retrieval and content reconstruction at any point in time.
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import type { ChangeEntry, DocumentLogEntry, UpdateLog, ResourceType } from '../types/update-log';

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
   * Log a resource update. Captures original content on first update.
   * @param resourceType - The type of resource ('documents', 'diagrams', 'wireframes')
   * @param resourceId - The resource ID being updated
   * @param oldContent - Content before the update
   * @param newContent - Content after the update
   * @param diff - Optional patch diff if available (from patch operations)
   */
  async logUpdate(
    resourceType: ResourceType,
    resourceId: string,
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

    // Create entry if this is first update for resource
    if (!log[resourceType][resourceId]) {
      log[resourceType][resourceId] = {
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
    log[resourceType][resourceId].changes.push(changeEntry);

    // Save atomically
    await this.saveLog(log);
  }

  /**
   * Get the change history for a resource
   * @param resourceType - The type of resource ('documents', 'diagrams', 'wireframes')
   * @param resourceId - The resource ID to get history for
   * @returns Log entry with original content and changes, or null if no history
   */
  async getHistory(resourceType: ResourceType, resourceId: string): Promise<DocumentLogEntry | null> {
    const log = await this.loadLog();
    return log[resourceType][resourceId] ?? null;
  }

  /**
   * Replay changes to reconstruct resource content at a specific timestamp
   * @param resourceType - The type of resource ('documents', 'diagrams', 'wireframes')
   * @param resourceId - The resource ID to replay
   * @param timestamp - ISO timestamp to replay to
   * @returns Content at that point in time
   * @throws Error if resource has no history or timestamp is invalid
   */
  async replayToTimestamp(resourceType: ResourceType, resourceId: string, timestamp: string): Promise<string> {
    const history = await this.getHistory(resourceType, resourceId);

    if (!history) {
      throw new Error(`No history found for ${resourceType.slice(0, -1)} ${resourceId}`);
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
        return { documents: {}, diagrams: {}, wireframes: {} };
      }

      const content = readFileSync(this.logFilePath, 'utf-8');
      const log = JSON.parse(content) as UpdateLog;
      // Ensure all resource type keys exist (for backwards compatibility)
      if (!log.diagrams) log.diagrams = {};
      if (!log.wireframes) log.wireframes = {};
      if (!log.documents) log.documents = {};
      return log;
    } catch (error) {
      // File read or JSON parse error - return empty log
      console.warn('Failed to load update log, returning empty log:', error);
      return { documents: {}, diagrams: {}, wireframes: {} };
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
