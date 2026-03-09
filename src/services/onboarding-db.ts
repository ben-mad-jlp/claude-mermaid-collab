/**
 * Onboarding DB Service
 *
 * Manages two SQLite databases for onboarding:
 * - index.db: FTS5 full-text search over topic content
 * - progress.db: User progress tracking, notes, and team data
 *
 * Both stored at {project}/.collab/onboarding/ (gitignored)
 */

import Database from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface SearchResult {
  topicName: string;
  fileType: 'conceptual' | 'technical' | 'files';
  snippet: string;
}

export interface User {
  id: number;
  name: string;
  createdAt: string;
}

export interface ProgressEntry {
  topicName: string;
  status: 'explored' | 'skipped';
  completedAt: string;
}

export interface Note {
  id: number;
  userId: number;
  topicName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: number;
  name: string;
  createdAt: string;
  exploredCount: number;
  exploredTopics: string[];
  lastActive: string | null;
}

// ============================================================================
// Schema
// ============================================================================

const PROGRESS_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER REFERENCES users(id),
  topic_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'explored',
  completed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, topic_name)
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  topic_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS path_progress (
  user_id INTEGER REFERENCES users(id),
  path_id TEXT NOT NULL,
  current_step INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, path_id)
);
`;

// ============================================================================
// OnboardingDbService
// ============================================================================

export class OnboardingDbService {
  private project: string;
  private indexDb: Database | null = null;
  private progressDb: Database | null = null;
  private onboardingDir: string;

  constructor(project: string) {
    this.project = project;
    this.onboardingDir = join(project, '.collab', 'onboarding');
  }

  // --------------------------------------------------------------------------
  // FTS5 Index
  // --------------------------------------------------------------------------

  /**
   * Ensure FTS5 index is up-to-date. Rebuilds if any topic file is newer than index.db.
   */
  ensureIndex(): void {
    if (!existsSync(this.onboardingDir)) {
      mkdirSync(this.onboardingDir, { recursive: true });
    }

    const indexPath = join(this.onboardingDir, 'index.db');
    const topicsDir = join(this.project, '.collab', 'kodex', 'topics');

    if (!existsSync(topicsDir)) return;

    // Check if rebuild is needed
    let indexMtime = 0;
    if (existsSync(indexPath)) {
      indexMtime = statSync(indexPath).mtimeMs;
    }

    const topicDirs = readdirSync(topicsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);

    const fileTypes = ['conceptual', 'technical', 'files'] as const;

    const needsRebuild = indexMtime === 0 || topicDirs.some(topic =>
      fileTypes.some(ft => {
        const filePath = join(topicsDir, topic, `${ft}.md`);
        return existsSync(filePath) && statSync(filePath).mtimeMs > indexMtime;
      })
    );

    if (!needsRebuild && this.indexDb) return;

    // Open/reopen database
    if (this.indexDb) this.indexDb.close();
    this.indexDb = new Database(indexPath);

    if (!needsRebuild) return;

    // Rebuild index
    this.indexDb.exec('DROP TABLE IF EXISTS topic_fts');
    this.indexDb.exec(`
      CREATE VIRTUAL TABLE topic_fts USING fts5(
        topic_name, file_type, content,
        tokenize='porter unicode61'
      )
    `);

    const insert = this.indexDb.prepare(
      'INSERT INTO topic_fts (topic_name, file_type, content) VALUES (?, ?, ?)'
    );

    for (const topicName of topicDirs) {
      for (const fileType of fileTypes) {
        const filePath = join(topicsDir, topicName, `${fileType}.md`);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8');
          insert.run(topicName, fileType, content);
        }
      }
    }
  }

  /**
   * Full-text search across topic content.
   */
  search(q: string, scope?: string[]): SearchResult[] {
    this.ensureIndex();
    if (!this.indexDb) return [];

    let sql = `
      SELECT topic_name, file_type,
        snippet(topic_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet
      FROM topic_fts
      WHERE topic_fts MATCH ?
    `;
    // Escape FTS5 special syntax by wrapping in double quotes
    const safeQ = `"${q.replace(/"/g, '""')}"`;
    const params: any[] = [safeQ];

    if (scope && scope.length > 0) {
      const placeholders = scope.map(() => '?').join(', ');
      sql += ` AND topic_name IN (${placeholders})`;
      params.push(...scope);
    }

    sql += ' ORDER BY rank LIMIT 20';

    const rows = this.indexDb.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      topicName: row.topic_name,
      fileType: row.file_type,
      snippet: row.snippet,
    }));
  }

  // --------------------------------------------------------------------------
  // Progress DB
  // --------------------------------------------------------------------------

  private ensureProgressDb(): Database {
    if (this.progressDb) return this.progressDb;

    if (!existsSync(this.onboardingDir)) {
      mkdirSync(this.onboardingDir, { recursive: true });
    }

    const dbPath = join(this.onboardingDir, 'progress.db');
    this.progressDb = new Database(dbPath);
    this.progressDb.exec(PROGRESS_SCHEMA);

    return this.progressDb;
  }

  // --------------------------------------------------------------------------
  // User CRUD
  // --------------------------------------------------------------------------

  createUser(name: string): User {
    const db = this.ensureProgressDb();
    const result = db.prepare(
      'INSERT INTO users (name) VALUES (?) RETURNING id, name, created_at'
    ).get(name) as any;

    return {
      id: result.id,
      name: result.name,
      createdAt: result.created_at,
    };
  }

  listUsers(): User[] {
    const db = this.ensureProgressDb();
    const rows = db.prepare('SELECT id, name, created_at FROM users ORDER BY name').all() as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    }));
  }

  getUser(id: number): User | null {
    const db = this.ensureProgressDb();
    const row = db.prepare('SELECT id, name, created_at FROM users WHERE id = ?').get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    };
  }

  // --------------------------------------------------------------------------
  // Progress CRUD
  // --------------------------------------------------------------------------

  markProgress(userId: number, topic: string, status: 'explored' | 'skipped'): void {
    const db = this.ensureProgressDb();
    db.prepare(
      'INSERT OR REPLACE INTO progress (user_id, topic_name, status, completed_at) VALUES (?, ?, ?, datetime(\'now\'))'
    ).run(userId, topic, status);
  }

  deleteProgress(userId: number, topic: string): void {
    const db = this.ensureProgressDb();
    db.prepare('DELETE FROM progress WHERE user_id = ? AND topic_name = ?').run(userId, topic);
  }

  getUserProgress(userId: number): ProgressEntry[] {
    const db = this.ensureProgressDb();
    const rows = db.prepare(
      'SELECT topic_name, status, completed_at FROM progress WHERE user_id = ?'
    ).all(userId) as any[];

    return rows.map(row => ({
      topicName: row.topic_name,
      status: row.status,
      completedAt: row.completed_at,
    }));
  }

  // --------------------------------------------------------------------------
  // Notes CRUD
  // --------------------------------------------------------------------------

  getNotes(userId: number, topic: string): Note[] {
    const db = this.ensureProgressDb();
    const rows = db.prepare(
      'SELECT id, user_id, topic_name, content, created_at, updated_at FROM notes WHERE user_id = ? AND topic_name = ? ORDER BY created_at DESC'
    ).all(userId, topic) as any[];

    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      topicName: row.topic_name,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  addNote(userId: number, topic: string, content: string): Note {
    const db = this.ensureProgressDb();
    const row = db.prepare(
      'INSERT INTO notes (user_id, topic_name, content) VALUES (?, ?, ?) RETURNING id, user_id, topic_name, content, created_at, updated_at'
    ).get(userId, topic, content) as any;

    return {
      id: row.id,
      userId: row.user_id,
      topicName: row.topic_name,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  editNote(noteId: number, content: string): void {
    const db = this.ensureProgressDb();
    db.prepare(
      "UPDATE notes SET content = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(content, noteId);
  }

  deleteNote(noteId: number): void {
    const db = this.ensureProgressDb();
    db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
  }

  // --------------------------------------------------------------------------
  // Team
  // --------------------------------------------------------------------------

  getTeam(): TeamMember[] {
    const db = this.ensureProgressDb();
    const rows = db.prepare(`
      SELECT u.id, u.name, u.created_at,
        COUNT(p.topic_name) AS explored_count,
        MAX(p.completed_at) AS last_active
      FROM users u
      LEFT JOIN progress p ON p.user_id = u.id AND p.status = 'explored'
      GROUP BY u.id
      ORDER BY u.name
    `).all() as any[];

    // Fetch explored topic names per user
    const topicStmt = db.prepare(
      `SELECT topic_name FROM progress WHERE user_id = ? AND status = 'explored'`
    );

    return rows.map(row => {
      const topicRows = topicStmt.all(row.id) as any[];
      return {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        exploredCount: row.explored_count,
        exploredTopics: topicRows.map(r => r.topic_name),
        lastActive: row.last_active,
      };
    });
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  close(): void {
    if (this.indexDb) {
      this.indexDb.close();
      this.indexDb = null;
    }
    if (this.progressDb) {
      this.progressDb.close();
      this.progressDb = null;
    }
  }
}
