import type Database from 'better-sqlite3';

/**
 * Status of a flag
 */
export type FlagStatus = 'open' | 'addressed' | 'resolved' | 'dismissed';

/**
 * Database record for a flag
 */
export interface FlagRecord {
  id: number;
  topic_id: number;
  comment: string;
  status: FlagStatus;
  created_at: string;
  addressed_at: string | null;
  resolved_at: string | null;
  dismiss_reason: string | null;
}

/**
 * Service for managing flags on topics.
 * Flags indicate issues or concerns that need attention.
 */
export class FlagService {
  private db: Database.Database;
  private statements: {
    create: Database.Statement;
    getById: Database.Statement;
    getByTopic: Database.Statement;
    getOpenCount: Database.Statement;
    resolve: Database.Statement;
    dismiss: Database.Statement;
    address: Database.Statement;
    reopen: Database.Statement;
    delete: Database.Statement;
  };

  constructor(db: Database.Database) {
    this.db = db;

    // Prepare all statements for performance
    this.statements = {
      create: db.prepare(`
        INSERT INTO flags (topic_id, comment, status, created_at)
        VALUES (?, ?, 'open', datetime('now'))
      `),

      getById: db.prepare(`
        SELECT id, topic_id, comment, status, created_at, addressed_at, resolved_at, dismiss_reason
        FROM flags
        WHERE id = ?
      `),

      getByTopic: db.prepare(`
        SELECT id, topic_id, comment, status, created_at, addressed_at, resolved_at, dismiss_reason
        FROM flags
        WHERE topic_id = ?
        ORDER BY created_at DESC
      `),

      getOpenCount: db.prepare(`
        SELECT COUNT(*) as count
        FROM flags
        WHERE topic_id = ? AND status = 'open'
      `),

      resolve: db.prepare(`
        UPDATE flags
        SET status = 'resolved', resolved_at = datetime('now')
        WHERE id = ?
      `),

      dismiss: db.prepare(`
        UPDATE flags
        SET status = 'dismissed', dismiss_reason = ?
        WHERE id = ?
      `),

      address: db.prepare(`
        UPDATE flags
        SET status = 'addressed', addressed_at = datetime('now')
        WHERE id = ?
      `),

      reopen: db.prepare(`
        UPDATE flags
        SET status = 'open', addressed_at = NULL, resolved_at = NULL, dismiss_reason = NULL
        WHERE id = ?
      `),

      delete: db.prepare(`
        DELETE FROM flags
        WHERE id = ?
      `),
    };
  }

  /**
   * Create a new flag on a topic.
   * Returns the created flag record.
   */
  create(topicId: number, comment: string): FlagRecord {
    const result = this.statements.create.run(topicId, comment);
    const flagId = result.lastInsertRowid as number;

    const flag = this.statements.getById.get(flagId) as FlagRecord | undefined;
    if (!flag) {
      throw new Error(`Failed to create flag for topic ${topicId}`);
    }

    return flag;
  }

  /**
   * Resolve a flag (mark as fixed/completed).
   */
  resolve(flagId: number): void {
    const result = this.statements.resolve.run(flagId);
    if (result.changes === 0) {
      throw new Error(`Flag not found: ${flagId}`);
    }
  }

  /**
   * Dismiss a flag (mark as not actionable).
   * Optionally provide a reason for dismissal.
   */
  dismiss(flagId: number, reason?: string): void {
    const result = this.statements.dismiss.run(reason || null, flagId);
    if (result.changes === 0) {
      throw new Error(`Flag not found: ${flagId}`);
    }
  }

  /**
   * Mark a flag as addressed (work in progress).
   */
  address(flagId: number): void {
    const result = this.statements.address.run(flagId);
    if (result.changes === 0) {
      throw new Error(`Flag not found: ${flagId}`);
    }
  }

  /**
   * Reopen a previously resolved/dismissed flag.
   * Clears addressed_at, resolved_at, and dismiss_reason.
   */
  reopen(flagId: number): void {
    const result = this.statements.reopen.run(flagId);
    if (result.changes === 0) {
      throw new Error(`Flag not found: ${flagId}`);
    }
  }

  /**
   * Get all flags for a topic, ordered by creation date (newest first).
   */
  getByTopic(topicId: number): FlagRecord[] {
    return this.statements.getByTopic.all(topicId) as FlagRecord[];
  }

  /**
   * Get the count of open flags for a topic.
   */
  getOpenCount(topicId: number): number {
    const result = this.statements.getOpenCount.get(topicId) as { count: number };
    return result.count;
  }

  /**
   * Get a flag by its ID.
   * Returns null if not found.
   */
  getById(flagId: number): FlagRecord | null {
    const flag = this.statements.getById.get(flagId) as FlagRecord | undefined;
    return flag || null;
  }

  /**
   * Delete a flag by ID.
   * Returns true if deleted, false if not found.
   */
  delete(flagId: number): boolean {
    const result = this.statements.delete.run(flagId);
    return result.changes > 0;
  }
}
