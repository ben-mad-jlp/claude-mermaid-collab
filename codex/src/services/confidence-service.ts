import type Database from 'better-sqlite3';
import type { ConfidenceTier } from '../types/index.js';

/**
 * Confidence tier calculation thresholds (in days)
 */
const CONFIDENCE_THRESHOLDS = {
  HIGH_VERIFIED_DAYS: 7, // Verified within 7 days for high confidence
  MEDIUM_VERIFIED_DAYS: 30, // Verified within 30 days for medium confidence
  MEDIUM_MAX_FLAGS: 1, // Maximum open flags for medium confidence
};

/**
 * Service for calculating topic confidence tiers.
 *
 * Confidence rules:
 * - HIGH:   Verified <7 days ago AND 0 open flags
 * - MEDIUM: Verified <30 days ago AND <=1 open flags
 * - LOW:    Verified >30 days ago OR >1 open flags OR never verified
 */
export class ConfidenceService {
  private db: Database.Database;
  private statements: {
    getTopicVerification: Database.Statement;
    getOpenFlagCount: Database.Statement;
    updateConfidence: Database.Statement;
    getAllTopics: Database.Statement;
  };

  constructor(db: Database.Database) {
    this.db = db;

    // Prepare all statements for performance
    this.statements = {
      getTopicVerification: db.prepare(`
        SELECT
          id,
          name,
          last_verified_at,
          confidence_tier,
          CASE
            WHEN last_verified_at IS NULL THEN NULL
            ELSE CAST((julianday('now') - julianday(last_verified_at)) AS INTEGER)
          END as days_since_verified
        FROM topics
        WHERE id = ?
      `),

      getOpenFlagCount: db.prepare(`
        SELECT COUNT(*) as count
        FROM flags
        WHERE topic_id = ? AND status = 'open'
      `),

      updateConfidence: db.prepare(`
        UPDATE topics
        SET confidence_tier = ?
        WHERE id = ?
      `),

      getAllTopics: db.prepare(`
        SELECT id FROM topics
      `),
    };
  }

  /**
   * Calculate the confidence tier for a topic based on verification date and flags.
   * Does NOT update the database - just returns the calculated tier.
   */
  calculate(topicId: number): ConfidenceTier {
    // Get topic verification info
    const topic = this.statements.getTopicVerification.get(topicId) as
      | {
          id: number;
          name: string;
          last_verified_at: string | null;
          confidence_tier: ConfidenceTier;
          days_since_verified: number | null;
        }
      | undefined;

    if (!topic) {
      throw new Error(`Topic not found: ${topicId}`);
    }

    // Get open flag count
    const flagResult = this.statements.getOpenFlagCount.get(topicId) as { count: number };
    const openFlagCount = flagResult.count;

    // Never verified = low confidence
    if (topic.last_verified_at === null || topic.days_since_verified === null) {
      return 'low';
    }

    const daysSinceVerified = topic.days_since_verified;

    // Check for high confidence: verified <7 days AND 0 flags
    if (
      daysSinceVerified < CONFIDENCE_THRESHOLDS.HIGH_VERIFIED_DAYS &&
      openFlagCount === 0
    ) {
      return 'high';
    }

    // Check for medium confidence: verified <30 days AND <=1 flags
    if (
      daysSinceVerified < CONFIDENCE_THRESHOLDS.MEDIUM_VERIFIED_DAYS &&
      openFlagCount <= CONFIDENCE_THRESHOLDS.MEDIUM_MAX_FLAGS
    ) {
      return 'medium';
    }

    // Default to low confidence
    return 'low';
  }

  /**
   * Calculate and update the confidence tier for a topic.
   * Returns the new confidence tier.
   */
  calculateAndUpdate(topicId: number): ConfidenceTier {
    const newTier = this.calculate(topicId);
    this.statements.updateConfidence.run(newTier, topicId);
    return newTier;
  }

  /**
   * Recalculate confidence for all topics.
   * Useful for batch updates after time passes or flags change.
   */
  recalculateAll(): void {
    this.db.transaction(() => {
      const topics = this.statements.getAllTopics.all() as { id: number }[];

      for (const { id } of topics) {
        const newTier = this.calculate(id);
        this.statements.updateConfidence.run(newTier, id);
      }
    })();
  }
}
