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
import { migrate0002 } from './migrations/0002_phase1_session_cols.js';

const REPLAY_PAGE_SIZE = 200;

// Module-level flags for one-time aggregate column verification.
let aggregateColumnsVerified = false;
let aggregateColumnsAvailable = false;

export class EventLog {
  private readonly db: Database;

  // Prepared statements for appendWithAggregates — initialized lazily once
  // aggregate columns are confirmed present (BUG-03).
  private _aggEnsureSession: ReturnType<Database['prepare']> | null = null;
  private _aggGetLast: ReturnType<Database['prepare']> | null = null;
  private _aggInsertEvent: ReturnType<Database['prepare']> | null = null;
  private _aggUpdateLast: ReturnType<Database['prepare']> | null = null;
  private _aggUpdateAggregates: ReturnType<Database['prepare']> | null = null;

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
    migrate0002(this.db);
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
   * One-time verification that the 6 aggregate columns added by migration 0002
   * are present on agent_sessions (BUG-01). Sets module-level flags so the
   * check runs at most once per process lifetime.
   */
  private verifyAggregateColumns(): void {
    if (aggregateColumnsVerified) return;
    aggregateColumnsVerified = true;
    try {
      const rows = this.db
        .prepare('PRAGMA table_info(agent_sessions)')
        .all() as Array<{ name: string }>;
      const cols = new Set(rows.map((r) => r.name));
      const required = [
        'total_cost_usd',
        'total_input_tokens',
        'total_output_tokens',
        'total_cache_read_tokens',
        'total_cache_creation_tokens',
        'last_activity_ts',
      ];
      const missing = required.filter((c) => !cols.has(c));
      if (missing.length > 0) {
        console.warn(
          `[event-log] aggregate columns missing (migration 0002 not applied?): ${missing.join(', ')}. ` +
          'Aggregate updates will be skipped — events will still be appended normally.',
        );
        aggregateColumnsAvailable = false;
      } else {
        aggregateColumnsAvailable = true;
        // Lazily initialize prepared statements now that columns are confirmed (BUG-03).
        this._aggEnsureSession = this.db.prepare(
          'INSERT OR IGNORE INTO agent_sessions (session_id, last_seq) VALUES (?, 0)',
        );
        this._aggGetLast = this.db.prepare(
          'SELECT last_seq FROM agent_sessions WHERE session_id = ?',
        );
        this._aggInsertEvent = this.db.prepare(
          'INSERT INTO agent_events (session_id, seq, ts, kind, event_json) VALUES (?, ?, ?, ?, ?)',
        );
        this._aggUpdateLast = this.db.prepare(
          'UPDATE agent_sessions SET last_seq = ? WHERE session_id = ?',
        );
        this._aggUpdateAggregates = this.db.prepare(
          `UPDATE agent_sessions SET
             total_cost_usd = total_cost_usd + ?,
             total_input_tokens = total_input_tokens + ?,
             total_output_tokens = total_output_tokens + ?,
             total_cache_read_tokens = total_cache_read_tokens + ?,
             total_cache_creation_tokens = total_cache_creation_tokens + ?,
             last_activity_ts = ?
           WHERE session_id = ?`,
        );
      }
    } catch (err) {
      console.warn('[event-log] could not verify aggregate columns, skipping aggregates:', err);
      aggregateColumnsAvailable = false;
    }
  }

  /**
   * Atomically append events AND update session aggregates in a single transaction.
   * If the aggregate columns are missing (migration not run), logs a warning once
   * and falls back to plain append so events still commit (BUG-01).
   * Prepared statements are class-level fields, initialized once (BUG-03).
   */
  appendWithAggregates(
    sessionId: string,
    events: AgentEvent[],
    aggregate: {
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      lastActivityTs: number;
    } | null,
  ): AgentEvent[] {
    if (events.length === 0) return [];

    // One-time column check; sets aggregateColumnsAvailable and lazily prepares stmts.
    this.verifyAggregateColumns();

    // If columns are unavailable, fall back to plain append (degraded but non-crashing).
    if (!aggregateColumnsAvailable) {
      return this.append(sessionId, events);
    }

    const ensureSession = this._aggEnsureSession!;
    const getLast = this._aggGetLast!;
    const insertEvent = this._aggInsertEvent!;
    const updateLast = this._aggUpdateLast!;
    const updateAggregates = this._aggUpdateAggregates!;

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
      if (aggregate) {
        updateAggregates.run(
          aggregate.costUsd,
          aggregate.inputTokens,
          aggregate.outputTokens,
          aggregate.cacheReadTokens,
          aggregate.cacheCreationTokens,
          aggregate.lastActivityTs,
          sessionId,
        );
      }
      return out;
    });

    try {
      return tx(events);
    } catch (err) {
      console.error('[event-log] appendWithAggregates failed', err);
      throw err;
    }
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

  /**
   * Delete all events for a session with seq >= fromSeqInclusive, and update
   * the session's last_seq to fromSeqInclusive - 1. Runs in one transaction.
   * Returns the number of rows deleted.
   */
  deleteFromSeq(sessionId: string, fromSeqInclusive: number): number {
    const del = this.db.prepare(
      'DELETE FROM agent_events WHERE session_id = ? AND seq >= ?',
    );
    const updateLast = this.db.prepare(
      'UPDATE agent_sessions SET last_seq = ? WHERE session_id = ?',
    );
    const tx = this.db.transaction((): number => {
      const result = del.run(sessionId, fromSeqInclusive) as { changes: number };
      updateLast.run(fromSeqInclusive - 1, sessionId);
      return result.changes ?? 0;
    });
    return tx();
  }

  getLastSeq(sessionId: string): number {
    const row = this.db
      .prepare('SELECT last_seq FROM agent_sessions WHERE session_id = ?')
      .get(sessionId) as { last_seq: number } | undefined;
    return row?.last_seq ?? 0;
  }

  /** Exposes the underlying DB so the session registry can run Phase-1
   *  queries/mutations against agent_sessions without opening a second
   *  connection. */
  getDb(): Database {
    return this.db;
  }

  /** Read the active model for a session (populated by model_changed handler).
   *  If the DB column is null (e.g. model was changed by Claude auto-routing),
   *  falls back to the most recent model_changed event in the event log (BUG-04).
   */
  getSessionModel(sessionId: string): string | null {
    const row = this.db
      .prepare('SELECT model FROM agent_sessions WHERE session_id = ?')
      .get(sessionId) as { model: string | null } | undefined;
    if (row?.model) return row.model;
    // Fallback: scan recent events for a model_changed kind.
    try {
      const eventRow = this.db
        .prepare(
          `SELECT event_json FROM agent_events
           WHERE session_id = ? AND kind = 'model_changed'
           ORDER BY seq DESC LIMIT 1`,
        )
        .get(sessionId) as { event_json: string } | undefined;
      if (eventRow) {
        const ev = JSON.parse(eventRow.event_json) as { model?: string };
        if (ev.model) return ev.model;
      }
    } catch {
      // best-effort fallback
    }
    return null;
  }

  /** Accumulate per-turn token/cost totals onto agent_sessions. Best-effort. */
  updateSessionAggregates(
    sessionId: string,
    delta: {
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      lastActivityTs: number;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE agent_sessions SET
           total_cost_usd = total_cost_usd + ?,
           total_input_tokens = total_input_tokens + ?,
           total_output_tokens = total_output_tokens + ?,
           total_cache_read_tokens = total_cache_read_tokens + ?,
           total_cache_creation_tokens = total_cache_creation_tokens + ?,
           last_activity_ts = ?
         WHERE session_id = ?`,
      )
      .run(
        delta.costUsd,
        delta.inputTokens,
        delta.outputTokens,
        delta.cacheReadTokens,
        delta.cacheCreationTokens,
        delta.lastActivityTs,
        sessionId,
      );
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}
