/**
 * EventLog — SQLite append-only log for agent events.
 *
 * Uses bun:sqlite with WAL journal mode. Provides atomic multi-event append
 * with monotonic per-session sequence numbers and paged async replay.
 *
 * Schema:
 *   agent_sessions(session_id PK, last_seq INTEGER)
 *   agent_events(session_id, seq, ts, kind, event_json, PRIMARY KEY(session_id, seq))
 */

import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentEvent } from './contracts.js';

const REPLAY_PAGE_SIZE = 200;

export class EventLog {
  private readonly db: Database;

  constructor(dbPath: string = '.collab/agent-events.db') {
    // Ensure parent directory exists for file-based DBs (skip for :memory:).
    if (dbPath !== ':memory:') {
      try {
        mkdirSync(dirname(dbPath), { recursive: true });
      } catch {
        // best-effort; Database open will throw a meaningful error if path bad
      }
    }
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        session_id TEXT PRIMARY KEY,
        last_seq INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS agent_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
    `);
  }

  /**
   * Atomically append events for a session. Assigns contiguous monotonic seq
   * numbers starting at last_seq+1. Returns the events with seq attached.
   */
  append(sessionId: string, events: AgentEvent[]): AgentEvent[] {
    if (events.length === 0) return [];

    const ensureSession = this.db.prepare(
      'INSERT OR IGNORE INTO agent_sessions (session_id, last_seq) VALUES (?, 0)',
    );
    const getLast = this.db.prepare(
      'SELECT last_seq FROM agent_sessions WHERE session_id = ?',
    );
    const insertEvent = this.db.prepare(
      'INSERT INTO agent_events (session_id, seq, ts, kind, event_json) VALUES (?, ?, ?, ?, ?)',
    );
    const updateLast = this.db.prepare(
      'UPDATE agent_sessions SET last_seq = ? WHERE session_id = ?',
    );

    const tx = this.db.transaction((evts: AgentEvent[]): AgentEvent[] => {
      ensureSession.run(sessionId);
      const row = getLast.get(sessionId) as { last_seq: number } | undefined;
      let seq = row?.last_seq ?? 0;
      const out: AgentEvent[] = [];
      for (const ev of evts) {
        seq += 1;
        const ts = (ev as { ts?: number }).ts ?? Date.now();
        const stamped = Object.assign({}, ev, { seq, ts }) as AgentEvent & { seq: number };
        insertEvent.run(sessionId, seq, ts, (ev as { kind: string }).kind, JSON.stringify(stamped));
        out.push(stamped);
      }
      updateLast.run(seq, sessionId);
      return out;
    });

    return tx(events);
  }

  /**
   * Async generator yielding events with seq > fromSeqExclusive, in seq order.
   * Paged internally (200 rows per page). If a stored event fails JSON.parse,
   * yields a synthetic log_corruption event and continues.
   */
  async *replay(sessionId: string, fromSeqExclusive: number): AsyncIterable<AgentEvent> {
    const stmt = this.db.prepare(
      `SELECT seq, ts, event_json FROM agent_events
       WHERE session_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`,
    );
    let cursor = fromSeqExclusive;
    while (true) {
      const rows = stmt.all(sessionId, cursor, REPLAY_PAGE_SIZE) as Array<{
        seq: number;
        ts: number;
        event_json: string;
      }>;
      if (rows.length === 0) return;
      for (const r of rows) {
        try {
          const parsed = JSON.parse(r.event_json) as AgentEvent;
          yield parsed;
        } catch {
          yield {
            kind: 'log_corruption',
            sessionId,
            seq: r.seq,
            ts: Date.now(),
          } as unknown as AgentEvent;
        }
        cursor = r.seq;
      }
      if (rows.length < REPLAY_PAGE_SIZE) return;
    }
  }

  getLastSeq(sessionId: string): number {
    const row = this.db
      .prepare('SELECT last_seq FROM agent_sessions WHERE session_id = ?')
      .get(sessionId) as { last_seq: number } | undefined;
    return row?.last_seq ?? 0;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}
