import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Per-PROJECT session status store. Mirrors the bun:sqlite-per-project pattern
 * used by todo-store.ts: one DB file per project under `.collab`, WAL journal
 * mode, and a Map-based connection cache keyed on project path.
 */

export type ClaudeStatus = 'active' | 'waiting' | 'permission';

export interface SessionStatusRow {
  project: string;
  session: string;
  status: ClaudeStatus;
  updatedAt: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS session_status (
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  status TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (project, session)
);
`;

const dbCache = new Map<string, Database>();

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'session-status.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  dbCache.set(project, db);
  return db;
}

export function recordStatus(project: string, session: string, status: ClaudeStatus): void {
  const db = openDb(project);
  db.query(
    `INSERT INTO session_status (project, session, status, updatedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project, session) DO UPDATE SET
       status = excluded.status,
       updatedAt = excluded.updatedAt`,
  ).run(project, session, status, Date.now());
}

export function getStatuses(project: string): SessionStatusRow[] {
  const db = openDb(project);
  return db.query(
    `SELECT project, session, status, updatedAt
     FROM session_status
     WHERE project = ?`,
  ).all(project) as SessionStatusRow[];
}

export function getStatus(project: string, session: string): SessionStatusRow | null {
  const db = openDb(project);
  const row = db.query(
    `SELECT project, session, status, updatedAt
     FROM session_status
     WHERE project = ? AND session = ?`,
  ).get(project, session) as SessionStatusRow | undefined;
  return row ?? null;
}
