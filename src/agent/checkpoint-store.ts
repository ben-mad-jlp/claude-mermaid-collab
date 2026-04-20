/**
 * CheckpointStore — SQLite-backed store for per-turn agent checkpoints.
 *
 * Each checkpoint records the first event seq of a turn alongside a stash sha
 * representing the working tree snapshot captured before the turn ran. Used to
 * roll back workspace state when a turn is truncated or replayed.
 *
 * Stored at {cwd}/.collab/agent-checkpoints.db by default. Supports `:memory:`
 * for tests. Matches the bun:sqlite patterns from command-receipts.ts and
 * event-log.ts.
 */

import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Checkpoint {
  sessionId: string;
  turnId: string;
  firstSeq: number;
  stashSha: string;
  createdAt: number;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS agent_checkpoints (
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    first_seq INTEGER NOT NULL,
    stash_sha TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, turn_id)
  );
  CREATE INDEX IF NOT EXISTS idx_checkpoints_first_seq
    ON agent_checkpoints(session_id, first_seq);
`;

interface CheckpointRow {
  session_id: string;
  turn_id: string;
  first_seq: number;
  stash_sha: string;
  created_at: number;
}

function rowToCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    sessionId: row.session_id,
    turnId: row.turn_id,
    firstSeq: row.first_seq,
    stashSha: row.stash_sha,
    createdAt: row.created_at,
  };
}

export class CheckpointStore {
  private readonly db: Database;

  constructor(dbPath: string = join('.collab', 'agent-checkpoints.db')) {
    if (dbPath !== ':memory:') {
      try {
        mkdirSync(dirname(dbPath), { recursive: true });
      } catch {
        // best-effort; Database open will throw a meaningful error if path bad
      }
    }
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec(DDL);
  }

  /**
   * Insert (or replace) a checkpoint for the given (sessionId, turnId).
   * Uses INSERT OR REPLACE so callers can overwrite an existing checkpoint for
   * the same turn — matches the blueprint.
   */
  insert(row: {
    sessionId: string;
    turnId: string;
    firstSeq: number;
    stashSha: string;
  }): void {
    const createdAt = Date.now();
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO agent_checkpoints
         (session_id, turn_id, first_seq, stash_sha, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    stmt.run(row.sessionId, row.turnId, row.firstSeq, row.stashSha, createdAt);
  }

  get(sessionId: string, turnId: string): Checkpoint | undefined {
    const row = this.db
      .prepare(
        `SELECT session_id, turn_id, first_seq, stash_sha, created_at
           FROM agent_checkpoints
          WHERE session_id = ? AND turn_id = ?`,
      )
      .get(sessionId, turnId) as CheckpointRow | undefined;
    return row ? rowToCheckpoint(row) : undefined;
  }

  /**
   * List all checkpoints for a session, ordered by first_seq ascending.
   */
  listBySession(sessionId: string): Checkpoint[] {
    const rows = this.db
      .prepare(
        `SELECT session_id, turn_id, first_seq, stash_sha, created_at
           FROM agent_checkpoints
          WHERE session_id = ?
          ORDER BY first_seq ASC`,
      )
      .all(sessionId) as CheckpointRow[];
    return rows.map(rowToCheckpoint);
  }

  /**
   * Delete all checkpoints for a session whose first_seq is >= fromSeqInclusive.
   * Returns the number of rows deleted.
   */
  deleteFromSeq(sessionId: string, fromSeqInclusive: number): number {
    const stmt = this.db.prepare(
      `DELETE FROM agent_checkpoints
         WHERE session_id = ? AND first_seq >= ?`,
    );
    const result = stmt.run(sessionId, fromSeqInclusive) as { changes: number };
    return result.changes ?? 0;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}
