/**
 * Kodex Manager - Project Knowledge Management
 *
 * Manages project knowledge base with:
 * - SQLite for metadata and analytics
 * - Markdown files for topic content
 * - Draft workflow for AI-generated content
 */

import Database from 'bun:sqlite';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs';

// ============================================================================
// Types
// ============================================================================

export type Confidence = 'low' | 'medium' | 'high';
export type FlagType = 'outdated' | 'incorrect' | 'incomplete' | 'missing';
export type FlagStatus = 'open' | 'resolved' | 'dismissed';
export type AccessSource = 'mcp' | 'api' | 'ui';

export interface TopicContent {
  conceptual: string;
  technical: string;
  files: string;
  related: string;
}

export interface TopicMetadata {
  name: string;
  title: string;
  confidence: Confidence;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
  hasDraft: boolean;
}

export interface Topic extends TopicMetadata {
  content: TopicContent;
}

export interface Draft {
  topicName: string;
  content: TopicContent;
  createdAt: string;
  createdBy: string;
  reason: string;
}

export interface Flag {
  id: number;
  topicName: string;
  type: FlagType;
  description: string;
  status: FlagStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AccessLogEntry {
  id: number;
  topicName: string;
  accessedAt: string;
  source: AccessSource;
  context: string | null;
}

export interface MissingTopicEntry {
  id: number;
  topicName: string;
  requestedAt: string;
  context: string | null;
  count: number;
}

export interface DashboardStats {
  totalTopics: number;
  verifiedTopics: number;
  pendingDrafts: number;
  openFlags: number;
  recentAccess: AccessLogEntry[];
  topMissing: MissingTopicEntry[];
}

// ============================================================================
// SQL Schema
// ============================================================================

const CREATE_TABLES_SQL = `
-- Topics metadata
CREATE TABLE IF NOT EXISTS topics (
  name TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  confidence TEXT CHECK(confidence IN ('low', 'medium', 'high')) DEFAULT 'low',
  verified INTEGER DEFAULT 0,
  verified_at TEXT,
  verified_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  has_draft INTEGER DEFAULT 0
);

-- Access log (per-access)
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_name TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  source TEXT CHECK(source IN ('mcp', 'api', 'ui')) NOT NULL,
  context TEXT
);

-- Access counts (aggregated)
CREATE TABLE IF NOT EXISTS access_counts (
  topic_name TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  last_accessed TEXT
);

-- Missing topics
CREATE TABLE IF NOT EXISTS missing_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_name TEXT NOT NULL UNIQUE,
  requested_at TEXT NOT NULL,
  context TEXT,
  count INTEGER DEFAULT 1
);

-- Flags
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_name TEXT NOT NULL,
  type TEXT CHECK(type IN ('outdated', 'incorrect', 'incomplete', 'missing')) NOT NULL,
  description TEXT NOT NULL,
  status TEXT CHECK(status IN ('open', 'resolved', 'dismissed')) DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Generation context (for AI-generated content)
CREATE TABLE IF NOT EXISTS generation_context (
  topic_name TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  model TEXT,
  prompt_hash TEXT,
  source_files TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_access_log_topic ON access_log(topic_name);
CREATE INDEX IF NOT EXISTS idx_access_log_time ON access_log(accessed_at);
CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status);
CREATE INDEX IF NOT EXISTS idx_flags_topic ON flags(topic_name);
`;

// ============================================================================
// KodexManager Class
// ============================================================================

export class KodexManager {
  private db: Database | null = null;
  private kodexDir: string;
  private topicsDir: string;
  private dbPath: string;

  constructor(projectPath: string) {
    this.kodexDir = join(projectPath, '.collab', 'kodex');
    this.topicsDir = join(this.kodexDir, 'topics');
    this.dbPath = join(this.kodexDir, 'kodex.db');
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  private ensureInitialized(): Database {
    if (this.db) {
      return this.db;
    }

    // Create directories
    if (!existsSync(this.kodexDir)) {
      mkdirSync(this.kodexDir, { recursive: true });
    }
    if (!existsSync(this.topicsDir)) {
      mkdirSync(this.topicsDir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.dbPath);
    this.db.exec(CREATE_TABLES_SQL);

    return this.db;
  }

  // --------------------------------------------------------------------------
  // Topic CRUD
  // --------------------------------------------------------------------------

  async listTopics(): Promise<TopicMetadata[]> {
    const db = this.ensureInitialized();
    const rows = db.query('SELECT * FROM topics ORDER BY updated_at DESC').all() as any[];
    return rows.map(this.rowToTopicMetadata);
  }

  async getTopic(name: string, includeContent = true): Promise<Topic | null> {
    const db = this.ensureInitialized();
    const row = db.query('SELECT * FROM topics WHERE name = ?').get(name) as any;

    if (!row) {
      await this.logMissing(name, 'getTopic');
      return null;
    }

    await this.logAccess(name, 'api');

    const metadata = this.rowToTopicMetadata(row);

    if (!includeContent) {
      return { ...metadata, content: { conceptual: '', technical: '', files: '', related: '' } };
    }

    const content = this.readTopicContent(name);
    return { ...metadata, content };
  }

  async createTopic(name: string, title: string, content: TopicContent, createdBy: string): Promise<Draft> {
    const db = this.ensureInitialized();
    const now = this.isoTimestamp();

    // Create draft directory
    const draftDir = join(this.topicsDir, name, 'draft');
    mkdirSync(draftDir, { recursive: true });

    // Write draft content
    writeFileSync(join(draftDir, 'conceptual.md'), content.conceptual);
    writeFileSync(join(draftDir, 'technical.md'), content.technical);
    writeFileSync(join(draftDir, 'files.md'), content.files);
    writeFileSync(join(draftDir, 'related.md'), content.related);

    // Insert or update metadata with has_draft = true
    db.run(`
      INSERT INTO topics (name, title, created_at, updated_at, has_draft)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(name) DO UPDATE SET has_draft = 1, updated_at = ?
    `, name, title, now, now, now);

    return {
      topicName: name,
      content,
      createdAt: now,
      createdBy,
      reason: 'New topic'
    };
  }

  async updateTopic(name: string, content: Partial<TopicContent>, reason: string): Promise<Draft> {
    const db = this.ensureInitialized();
    const existing = db.query('SELECT * FROM topics WHERE name = ?').get(name) as any;

    if (!existing) {
      throw new Error(`Topic not found: ${name}`);
    }

    // Get current content and merge
    const currentContent = this.readTopicContent(name);
    const mergedContent: TopicContent = {
      conceptual: content.conceptual ?? currentContent.conceptual,
      technical: content.technical ?? currentContent.technical,
      files: content.files ?? currentContent.files,
      related: content.related ?? currentContent.related,
    };

    // Create draft directory
    const draftDir = join(this.topicsDir, name, 'draft');
    mkdirSync(draftDir, { recursive: true });

    // Write draft content
    writeFileSync(join(draftDir, 'conceptual.md'), mergedContent.conceptual);
    writeFileSync(join(draftDir, 'technical.md'), mergedContent.technical);
    writeFileSync(join(draftDir, 'files.md'), mergedContent.files);
    writeFileSync(join(draftDir, 'related.md'), mergedContent.related);

    const now = this.isoTimestamp();
    db.run('UPDATE topics SET has_draft = 1, updated_at = ? WHERE name = ?', now, name);

    return {
      topicName: name,
      content: mergedContent,
      createdAt: now,
      createdBy: 'claude',
      reason
    };
  }

  async deleteTopic(name: string): Promise<void> {
    const db = this.ensureInitialized();
    const topicDir = join(this.topicsDir, name);

    if (existsSync(topicDir)) {
      rmSync(topicDir, { recursive: true });
    }

    db.run('DELETE FROM topics WHERE name = ?', name);
    db.run('DELETE FROM flags WHERE topic_name = ?', name);
  }

  async verifyTopic(name: string, verifiedBy: string): Promise<void> {
    const db = this.ensureInitialized();
    const now = this.isoTimestamp();

    db.run(`
      UPDATE topics
      SET verified = 1, verified_at = ?, verified_by = ?, confidence = 'high'
      WHERE name = ?
    `, now, verifiedBy, name);
  }

  // --------------------------------------------------------------------------
  // Draft Management
  // --------------------------------------------------------------------------

  async listDrafts(): Promise<Draft[]> {
    const db = this.ensureInitialized();
    const rows = db.query('SELECT * FROM topics WHERE has_draft = 1').all() as any[];
    const drafts: Draft[] = [];

    for (const row of rows) {
      const content = this.readDraftContent(row.name);
      drafts.push({
        topicName: row.name,
        content,
        createdAt: row.updated_at,
        createdBy: 'claude',
        reason: 'Update'
      });
    }

    return drafts;
  }

  async listDraftsSummary(): Promise<{ topicName: string; title: string; createdAt: string }[]> {
    const db = this.ensureInitialized();
    const rows = db.query('SELECT name, title, updated_at FROM topics WHERE has_draft = 1 ORDER BY updated_at DESC').all() as any[];
    return rows.map(row => ({
      topicName: row.name,
      title: row.title,
      createdAt: row.updated_at,
    }));
  }

  async getDraft(topicName: string): Promise<Draft | null> {
    const db = this.ensureInitialized();
    const row = db.query('SELECT * FROM topics WHERE name = ? AND has_draft = 1').get(topicName) as any;

    if (!row) {
      return null;
    }

    const content = this.readDraftContent(topicName);
    return {
      topicName,
      content,
      createdAt: row.updated_at,
      createdBy: 'claude',
      reason: 'Update'
    };
  }

  async approveDraft(topicName: string): Promise<Topic> {
    const db = this.ensureInitialized();
    const draftDir = join(this.topicsDir, topicName, 'draft');
    const liveDir = join(this.topicsDir, topicName);

    // Ensure live directory exists
    if (!existsSync(liveDir)) {
      mkdirSync(liveDir, { recursive: true });
    }

    // Move draft files to live
    for (const file of ['conceptual.md', 'technical.md', 'files.md', 'related.md']) {
      const draftFile = join(draftDir, file);
      if (existsSync(draftFile)) {
        const content = readFileSync(draftFile, 'utf-8');
        writeFileSync(join(liveDir, file), content);
      }
    }

    // Remove draft directory
    if (existsSync(draftDir)) {
      rmSync(draftDir, { recursive: true });
    }

    const now = this.isoTimestamp();
    db.run('UPDATE topics SET has_draft = 0, updated_at = ? WHERE name = ?', now, topicName);

    // Auto-resolve open flags for this topic
    const openFlags = db.query(
      "SELECT id FROM flags WHERE topic_name = ? AND status = 'open'"
    ).all(topicName) as { id: number }[];

    for (const flag of openFlags) {
      await this.updateFlagStatus(flag.id, 'resolved');
    }

    const topic = await this.getTopic(topicName);
    if (!topic) {
      throw new Error(`Topic not found after approval: ${topicName}`);
    }
    return topic;
  }

  async rejectDraft(topicName: string): Promise<void> {
    const db = this.ensureInitialized();
    const draftDir = join(this.topicsDir, topicName, 'draft');

    if (existsSync(draftDir)) {
      rmSync(draftDir, { recursive: true });
    }

    db.run('UPDATE topics SET has_draft = 0 WHERE name = ?', topicName);
  }

  // --------------------------------------------------------------------------
  // Flag Management
  // --------------------------------------------------------------------------

  async listFlags(status?: FlagStatus): Promise<Flag[]> {
    const db = this.ensureInitialized();
    let rows: any[];

    if (status) {
      rows = db.query('SELECT * FROM flags WHERE status = ? ORDER BY created_at DESC').all(status) as any[];
    } else {
      rows = db.query('SELECT * FROM flags ORDER BY created_at DESC').all() as any[];
    }

    return rows.map(this.rowToFlag);
  }

  async createFlag(topicName: string, type: FlagType, description: string): Promise<Flag> {
    const db = this.ensureInitialized();
    const now = this.isoTimestamp();

    const result = db.run(`
      INSERT INTO flags (topic_name, type, description, created_at)
      VALUES (?, ?, ?, ?)
    `, topicName, type, description, now);

    return {
      id: Number(result.lastInsertRowid),
      topicName,
      type,
      description,
      status: 'open',
      createdAt: now,
      resolvedAt: null
    };
  }

  async updateFlagStatus(id: number, status: FlagStatus): Promise<void> {
    const db = this.ensureInitialized();
    const resolvedAt = status === 'open' ? null : this.isoTimestamp();
    db.run('UPDATE flags SET status = ?, resolved_at = ? WHERE id = ?', status, resolvedAt, id);
  }

  // --------------------------------------------------------------------------
  // Analytics
  // --------------------------------------------------------------------------

  async logAccess(topicName: string, source: AccessSource, context?: string): Promise<void> {
    const db = this.ensureInitialized();
    const now = this.isoTimestamp();

    // Insert into access_log
    db.run(`
      INSERT INTO access_log (topic_name, accessed_at, source, context)
      VALUES (?, ?, ?, ?)
    `, topicName, now, source, context ?? null);

    // Update access_counts
    db.run(`
      INSERT INTO access_counts (topic_name, count, last_accessed)
      VALUES (?, 1, ?)
      ON CONFLICT(topic_name) DO UPDATE SET
        count = count + 1,
        last_accessed = ?
    `, topicName, now, now);
  }

  async logMissing(topicName: string, context?: string): Promise<void> {
    const db = this.ensureInitialized();
    const now = this.isoTimestamp();

    db.run(`
      INSERT INTO missing_topics (topic_name, requested_at, context, count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(topic_name) DO UPDATE SET
        count = count + 1,
        requested_at = ?
    `, topicName, now, context ?? null, now);
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const db = this.ensureInitialized();

    const totalTopics = (db.query('SELECT COUNT(*) as count FROM topics').get() as any).count;
    const verifiedTopics = (db.query('SELECT COUNT(*) as count FROM topics WHERE verified = 1').get() as any).count;
    const pendingDrafts = (db.query('SELECT COUNT(*) as count FROM topics WHERE has_draft = 1').get() as any).count;
    const openFlags = (db.query("SELECT COUNT(*) as count FROM flags WHERE status = 'open'").get() as any).count;

    const recentAccess = db.query(`
      SELECT * FROM access_log
      ORDER BY accessed_at DESC
      LIMIT 10
    `).all() as any[];

    const topMissing = db.query(`
      SELECT * FROM missing_topics
      ORDER BY count DESC
      LIMIT 10
    `).all() as any[];

    return {
      totalTopics,
      verifiedTopics,
      pendingDrafts,
      openFlags,
      recentAccess: recentAccess.map(this.rowToAccessLogEntry),
      topMissing: topMissing.map(this.rowToMissingTopicEntry)
    };
  }

  async getMissingTopics(): Promise<MissingTopicEntry[]> {
    const db = this.ensureInitialized();
    const rows = db.query('SELECT * FROM missing_topics ORDER BY count DESC').all() as any[];
    return rows.map(this.rowToMissingTopicEntry);
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private readTopicContent(name: string): TopicContent {
    const dir = join(this.topicsDir, name);
    return {
      conceptual: this.readFileOrEmpty(join(dir, 'conceptual.md')),
      technical: this.readFileOrEmpty(join(dir, 'technical.md')),
      files: this.readFileOrEmpty(join(dir, 'files.md')),
      related: this.readFileOrEmpty(join(dir, 'related.md')),
    };
  }

  private readDraftContent(name: string): TopicContent {
    const dir = join(this.topicsDir, name, 'draft');
    return {
      conceptual: this.readFileOrEmpty(join(dir, 'conceptual.md')),
      technical: this.readFileOrEmpty(join(dir, 'technical.md')),
      files: this.readFileOrEmpty(join(dir, 'files.md')),
      related: this.readFileOrEmpty(join(dir, 'related.md')),
    };
  }

  private readFileOrEmpty(path: string): string {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
    return '';
  }

  private isoTimestamp(): string {
    return new Date().toISOString();
  }

  private rowToTopicMetadata = (row: any): TopicMetadata => ({
    name: row.name,
    title: row.title,
    confidence: row.confidence as Confidence,
    verified: Boolean(row.verified),
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasDraft: Boolean(row.has_draft),
  });

  private rowToFlag = (row: any): Flag => ({
    id: row.id,
    topicName: row.topic_name,
    type: row.type as FlagType,
    description: row.description,
    status: row.status as FlagStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });

  private rowToAccessLogEntry = (row: any): AccessLogEntry => ({
    id: row.id,
    topicName: row.topic_name,
    accessedAt: row.accessed_at,
    source: row.source as AccessSource,
    context: row.context,
  });

  private rowToMissingTopicEntry = (row: any): MissingTopicEntry => ({
    id: row.id,
    topicName: row.topic_name,
    requestedAt: row.requested_at,
    context: row.context,
    count: row.count,
  });

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton factory - creates managers per project
const managers = new Map<string, KodexManager>();

export function getKodexManager(projectPath: string): KodexManager {
  if (!managers.has(projectPath)) {
    managers.set(projectPath, new KodexManager(projectPath));
  }
  return managers.get(projectPath)!;
}
