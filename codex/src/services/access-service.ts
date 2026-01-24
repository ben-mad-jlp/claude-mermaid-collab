import type Database from 'better-sqlite3';

/**
 * Access count statistics for a topic
 */
export interface AccessCount {
  topic_id: number;
  total_count: number;
  last_30_days: number;
  last_accessed_at: string | null;
}

/**
 * Service for tracking topic access patterns.
 * Logs individual accesses and maintains aggregated statistics.
 */
export class AccessService {
  private db: Database.Database;
  private statements: {
    logAccess: Database.Statement;
    ensureCountRecord: Database.Statement;
    incrementCount: Database.Statement;
    getCounts: Database.Statement;
    calculateLast30Days: Database.Statement;
    getAllTopicIds: Database.Statement;
    updateLast30Days: Database.Statement;
    pruneOldLogs: Database.Statement;
  };

  constructor(db: Database.Database) {
    this.db = db;

    // Prepare all statements for performance
    this.statements = {
      logAccess: db.prepare(`
        INSERT INTO access_log (topic_id, accessed_at)
        VALUES (?, datetime('now'))
      `),

      ensureCountRecord: db.prepare(`
        INSERT OR IGNORE INTO access_counts (topic_id, total_count, last_30_days, last_accessed_at)
        VALUES (?, 0, 0, NULL)
      `),

      incrementCount: db.prepare(`
        UPDATE access_counts
        SET total_count = total_count + 1,
            last_accessed_at = datetime('now')
        WHERE topic_id = ?
      `),

      getCounts: db.prepare(`
        SELECT topic_id, total_count, last_30_days, last_accessed_at
        FROM access_counts
        WHERE topic_id = ?
      `),

      calculateLast30Days: db.prepare(`
        SELECT COUNT(*) as count
        FROM access_log
        WHERE topic_id = ?
          AND accessed_at >= datetime('now', '-30 days')
      `),

      getAllTopicIds: db.prepare(`
        SELECT DISTINCT topic_id FROM access_counts
      `),

      updateLast30Days: db.prepare(`
        UPDATE access_counts
        SET last_30_days = ?
        WHERE topic_id = ?
      `),

      pruneOldLogs: db.prepare(`
        DELETE FROM access_log
        WHERE accessed_at < datetime('now', '-90 days')
      `),
    };
  }

  /**
   * Log an access event for a topic.
   * Creates the access_counts record if it doesn't exist.
   * Increments total_count and updates last_accessed_at.
   */
  logAccess(topicId: number): void {
    // Use a transaction for consistency
    this.db.transaction(() => {
      // Log the individual access
      this.statements.logAccess.run(topicId);

      // Ensure the counts record exists
      this.statements.ensureCountRecord.run(topicId);

      // Increment the total count and update last_accessed_at
      this.statements.incrementCount.run(topicId);
    })();
  }

  /**
   * Get access count statistics for a topic.
   * Returns default values if no access record exists.
   */
  getCounts(topicId: number): AccessCount {
    const counts = this.statements.getCounts.get(topicId) as AccessCount | undefined;

    if (counts) {
      return counts;
    }

    // Return defaults if no record exists
    return {
      topic_id: topicId,
      total_count: 0,
      last_30_days: 0,
      last_accessed_at: null,
    };
  }

  /**
   * Recalculate last_30_days counts for all topics.
   * Should be called periodically (e.g., daily) to keep aggregates accurate.
   * Also prunes access logs older than 90 days.
   */
  refreshAggregates(): void {
    this.db.transaction(() => {
      // Get all topic IDs with access records
      const topicIds = this.statements.getAllTopicIds.all() as { topic_id: number }[];

      // Update last_30_days for each topic
      for (const { topic_id } of topicIds) {
        const result = this.statements.calculateLast30Days.get(topic_id) as { count: number };
        this.statements.updateLast30Days.run(result.count, topic_id);
      }

      // Prune old access logs (keep 90 days for historical analysis)
      this.statements.pruneOldLogs.run();
    })();
  }

  /**
   * Initialize access_counts record for a new topic.
   * Called when a topic is created to ensure the record exists.
   */
  initializeForTopic(topicId: number): void {
    this.statements.ensureCountRecord.run(topicId);
  }
}
