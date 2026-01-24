import type Database from 'better-sqlite3';
import type { ConfidenceTier } from '../types/index.js';

/**
 * Database record for a topic
 */
export interface TopicRecord {
  id: number;
  name: string;
  created_at: string;
  last_modified_at: string;
  last_verified_at: string | null;
  confidence_tier: ConfidenceTier;
  has_draft: boolean;
}

/**
 * Raw database row (before boolean conversion)
 */
interface TopicRow {
  id: number;
  name: string;
  created_at: string;
  last_modified_at: string;
  last_verified_at: string | null;
  confidence_tier: ConfidenceTier;
  has_draft: number;
}

/**
 * Service for managing topic records in the database.
 */
export class TopicService {
  private db: Database.Database;
  private statements: {
    getByName: Database.Statement;
    create: Database.Statement;
    updateVerified: Database.Statement;
    updateModified: Database.Statement;
    list: Database.Statement;
    setHasDraft: Database.Statement;
    updateConfidence: Database.Statement;
    delete: Database.Statement;
  };

  constructor(db: Database.Database) {
    this.db = db;

    // Prepare all statements for performance
    this.statements = {
      getByName: db.prepare(`
        SELECT id, name, created_at, last_modified_at, last_verified_at, confidence_tier, has_draft
        FROM topics
        WHERE name = ?
      `),

      create: db.prepare(`
        INSERT INTO topics (name, created_at, last_modified_at, confidence_tier, has_draft)
        VALUES (?, datetime('now'), datetime('now'), 'low', 0)
      `),

      updateVerified: db.prepare(`
        UPDATE topics
        SET last_verified_at = datetime('now'), last_modified_at = datetime('now')
        WHERE name = ?
      `),

      updateModified: db.prepare(`
        UPDATE topics
        SET last_modified_at = datetime('now')
        WHERE name = ?
      `),

      list: db.prepare(`
        SELECT id, name, created_at, last_modified_at, last_verified_at, confidence_tier, has_draft
        FROM topics
        ORDER BY name ASC
      `),

      setHasDraft: db.prepare(`
        UPDATE topics
        SET has_draft = ?, last_modified_at = datetime('now')
        WHERE name = ?
      `),

      updateConfidence: db.prepare(`
        UPDATE topics
        SET confidence_tier = ?, last_modified_at = datetime('now')
        WHERE name = ?
      `),

      delete: db.prepare(`
        DELETE FROM topics
        WHERE name = ?
      `),
    };
  }

  /**
   * Convert a database row to a TopicRecord with proper types
   */
  private rowToRecord(row: TopicRow): TopicRecord {
    return {
      ...row,
      has_draft: row.has_draft === 1,
    };
  }

  /**
   * Get a topic by its unique name.
   * Returns null if not found.
   */
  getByName(name: string): TopicRecord | null {
    const row = this.statements.getByName.get(name) as TopicRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  /**
   * Create a new topic with the given name.
   * Returns the created topic record.
   * Throws if a topic with this name already exists.
   */
  create(name: string): TopicRecord {
    this.statements.create.run(name);
    const record = this.getByName(name);
    if (!record) {
      throw new Error(`Failed to create topic: ${name}`);
    }
    return record;
  }

  /**
   * Update the last_verified_at timestamp for a topic.
   * Also updates last_modified_at.
   */
  updateVerified(name: string): void {
    const result = this.statements.updateVerified.run(name);
    if (result.changes === 0) {
      throw new Error(`Topic not found: ${name}`);
    }
  }

  /**
   * Update the last_modified_at timestamp for a topic.
   */
  updateModified(name: string): void {
    const result = this.statements.updateModified.run(name);
    if (result.changes === 0) {
      throw new Error(`Topic not found: ${name}`);
    }
  }

  /**
   * List all topics ordered by name.
   */
  list(): TopicRecord[] {
    const rows = this.statements.list.all() as TopicRow[];
    return rows.map((row) => this.rowToRecord(row));
  }

  /**
   * Set the has_draft flag for a topic.
   */
  setHasDraft(name: string, hasDraft: boolean): void {
    const result = this.statements.setHasDraft.run(hasDraft ? 1 : 0, name);
    if (result.changes === 0) {
      throw new Error(`Topic not found: ${name}`);
    }
  }

  /**
   * Update the confidence tier for a topic.
   */
  updateConfidence(name: string, confidence: ConfidenceTier): void {
    const result = this.statements.updateConfidence.run(confidence, name);
    if (result.changes === 0) {
      throw new Error(`Topic not found: ${name}`);
    }
  }

  /**
   * Delete a topic by name.
   * Returns true if deleted, false if not found.
   */
  delete(name: string): boolean {
    const result = this.statements.delete.run(name);
    return result.changes > 0;
  }
}
