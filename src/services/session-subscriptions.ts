/**
 * Session subscriptions — a registered collab session SUBSCRIBES to a todo, an epic, or a
 * whole project, and the daemon's notification router enqueues coalesced updates for it. A
 * tiny tmux nudge then wakes the (idle) session, which drains the queue via `inbox()` and
 * acts. This module is the durable STORE + the pure matcher; the router/delivery live
 * elsewhere (so this stays unit-testable with no timing/tmux).
 *
 * Design + rationale (incl. the Grok consult + re-pivot to injection/nudge-to-pull) live in
 * the `session-subscriptions-design` doc.
 */

import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

export type SubscriptionScope = 'todo' | 'epic' | 'mission' | 'project';
export type SubscriptionMode = 'nudge'; // nudge-to-pull (only mode for now)

export interface Subscription {
  project: string;
  session: string;
  scope: SubscriptionScope;
  /** Empty string for `project` scope (kept non-null so it's a stable PRIMARY KEY part). */
  targetId: string;
  mode: SubscriptionMode;
  createdAt: number;
}

export interface SessionNotification {
  id: string;
  project: string;
  session: string;
  scope: SubscriptionScope;
  targetId: string;
  event: string;
  summary: string;
  payload: string | null;
  ts: number;
  seen: boolean;
}

/** The minimal shape the router resolves for an event before matching. */
export interface SubscribableEvent {
  project: string;
  todoId?: string | null;
  epicId?: string | null;
  missionId?: string | null;
}

/**
 * Pure match: does `sub` fire for `evt`? Separated from the DB so the matching rule is
 * trivially unit-testable. project-scope matches any event in the project; todo/epic/mission
 * match by id. Mission subscriptions are resolved from the todo graph at match time (via
 * ChangeEvent missionId), so a new epic created in a later iteration still matches a mission
 * subscription created in an earlier one — the walk inherits from the live graph, not from a
 * baked subscription. A daemon-driven event with no todoId/epicId/missionId only matches a
 * project subscription.
 */
export function subscriptionMatches(sub: Subscription, evt: SubscribableEvent): boolean {
  if (sub.project !== evt.project) return false;
  switch (sub.scope) {
    case 'project': return true;
    case 'todo': return !!evt.todoId && sub.targetId === evt.todoId;
    case 'epic': return !!evt.epicId && sub.targetId === evt.epicId;
    case 'mission': return !!evt.missionId && sub.targetId === evt.missionId;
    default: return false;
  }
}

const DDL = `
CREATE TABLE IF NOT EXISTS session_subscription (
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  scope TEXT NOT NULL,
  targetId TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'nudge',
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (project, session, scope, targetId)
);
CREATE TABLE IF NOT EXISTS session_notification (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  scope TEXT NOT NULL,
  targetId TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT,
  ts INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notif_session ON session_notification(project, session, seen);
`;

let db: Database | null = null;

function openDb(): Database {
  if (db) return db;
  // MERMAID_DATA_DIR lets tests isolate the store off the real ~/.mermaid-collab.
  const dir = process.env.MERMAID_DATA_DIR ?? join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  const d = new Database(join(dir, 'subscriptions.db'));
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(DDL);
  db = d;
  return db;
}

/** Test seam: close + drop the cached handle so the next call re-opens at the current dir. */
export function __resetForTest(): void {
  try { db?.close(); } catch { /* already closed */ }
  db = null;
}

function rowToSub(r: any): Subscription {
  return { project: r.project, session: r.session, scope: r.scope, targetId: r.targetId, mode: r.mode, createdAt: r.createdAt };
}

/** Subscribe (idempotent upsert). `targetId` omitted/empty ⇒ stored '' (project scope). */
export function addSubscription(
  project: string,
  session: string,
  scope: SubscriptionScope,
  targetId?: string | null,
  mode: SubscriptionMode = 'nudge',
  now: number = Date.now(),
): Subscription {
  const tid = scope === 'project' ? '' : (targetId ?? '').trim();
  if (scope !== 'project' && !tid) throw new Error(`${scope} subscription requires a targetId`);
  const d = openDb();
  d.prepare(
    `INSERT INTO session_subscription (project, session, scope, targetId, mode, createdAt) VALUES (?,?,?,?,?,?)
     ON CONFLICT(project, session, scope, targetId) DO UPDATE SET mode=excluded.mode`,
  ).run(project, session, scope, tid, mode, now);
  return { project, session, scope, targetId: tid, mode, createdAt: now };
}

/** Unsubscribe one subscription. Returns true if a row was removed. */
export function removeSubscription(project: string, session: string, scope: SubscriptionScope, targetId?: string | null): boolean {
  const tid = scope === 'project' ? '' : (targetId ?? '').trim();
  const d = openDb();
  const r = d.prepare(`DELETE FROM session_subscription WHERE project=? AND session=? AND scope=? AND targetId=?`).run(project, session, scope, tid);
  return r.changes > 0;
}

export function listSubscriptionsForSession(project: string, session: string): Subscription[] {
  return openDb().query(`SELECT * FROM session_subscription WHERE project=? AND session=? ORDER BY createdAt`).all(project, session).map(rowToSub);
}

export function listAllSubscriptions(): Subscription[] {
  return openDb().query(`SELECT * FROM session_subscription ORDER BY createdAt`).all().map(rowToSub);
}

/** Drop ALL of a session's subscriptions + its queued notifications. Used by session-delete
 *  cleanup (the dangling-registration class) and unsubscribe-all. Returns rows removed. */
export function dropSubscriptionsForSession(project: string, session: string): number {
  const d = openDb();
  const r = d.prepare(`DELETE FROM session_subscription WHERE project=? AND session=?`).run(project, session);
  d.prepare(`DELETE FROM session_notification WHERE project=? AND session=?`).run(project, session);
  return r.changes;
}

/** Expire all todo/epic subscriptions pointing at a now-terminal target. Returns rows removed. */
export function expireSubscriptionsForTarget(project: string, targetId: string): number {
  const d = openDb();
  const r = d.prepare(`DELETE FROM session_subscription WHERE project=? AND scope IN ('todo','epic') AND targetId=?`).run(project, targetId);
  return r.changes;
}

/** Enqueue a pending notification for a subscriber (the router calls this per matched sub). */
export function enqueueNotification(
  n: { project: string; session: string; scope: SubscriptionScope; targetId: string; event: string; summary: string; payload?: unknown; ts?: number },
): SessionNotification {
  const id = crypto.randomUUID();
  const ts = n.ts ?? Date.now();
  const payload = n.payload === undefined ? null : JSON.stringify(n.payload);
  // DEDUPE-WHILE-PENDING: the same (target,event) re-emitted before the session drains
  // (claim churn re-firing in_progress, repeated flags) previously stacked duplicate rows,
  // so one nudge listed the same line twice and the count inflated (observed: 79-deep
  // queue with doubled lines). An UNSEEN duplicate is refreshed in place (ts + summary),
  // never re-inserted; a drained (seen) row never blocks a new event.
  const dupe = openDb().query(
    `SELECT id FROM session_notification WHERE project=? AND session=? AND scope=? AND targetId=? AND event=? AND seen=0 LIMIT 1`,
  ).get(n.project, n.session, n.scope, n.targetId, n.event) as { id: string } | undefined;
  if (dupe) {
    openDb().prepare(`UPDATE session_notification SET ts=?, summary=?, payload=? WHERE id=?`)
      .run(ts, n.summary, payload, dupe.id);
    return { id: dupe.id, project: n.project, session: n.session, scope: n.scope, targetId: n.targetId, event: n.event, summary: n.summary, payload, ts, seen: false };
  }
  openDb().prepare(
    `INSERT INTO session_notification (id, project, session, scope, targetId, event, summary, payload, ts, seen) VALUES (?,?,?,?,?,?,?,?,?,0)`,
  ).run(id, n.project, n.session, n.scope, n.targetId, n.event, n.summary, payload, ts);
  return { id, project: n.project, session: n.session, scope: n.scope, targetId: n.targetId, event: n.event, summary: n.summary, payload, ts, seen: false };
}

/** Count unseen notifications for a session (the nudge says "N updates"). */
export function pendingCount(project: string, session: string): number {
  const r = openDb().query(`SELECT COUNT(*) AS c FROM session_notification WHERE project=? AND session=? AND seen=0`).get(project, session) as { c: number };
  return r.c;
}

/** Peek unseen notifications for a session WITHOUT draining (marking seen). The tick uses
 *  this to carry the top-N summaries in a nudge; draining stays a pull-side action. */
export function listPending(project: string, session: string, limit?: number): SessionNotification[] {
  const lim = limit && limit > 0 ? ` LIMIT ${Math.floor(limit)}` : '';
  const rows = openDb()
    .query(`SELECT * FROM session_notification WHERE project=? AND session=? AND seen=0 ORDER BY ts DESC${lim}`)
    .all(project, session) as any[];
  return rows.map((r) => ({ id: r.id, project: r.project, session: r.session, scope: r.scope, targetId: r.targetId, event: r.event, summary: r.summary, payload: r.payload, ts: r.ts, seen: false }));
}

/** Drain the inbox: return all unseen notifications for the session and mark them seen. The
 *  FULL drain is what makes a missed nudge self-heal — any later nudge delivers everything. */
export function drainInbox(project: string, session: string): SessionNotification[] {
  const d = openDb();
  const rows = d.query(`SELECT * FROM session_notification WHERE project=? AND session=? AND seen=0 ORDER BY ts`).all(project, session) as any[];
  if (rows.length > 0) {
    d.prepare(`UPDATE session_notification SET seen=1 WHERE project=? AND session=? AND seen=0`).run(project, session);
  }
  return rows.map((r) => ({ id: r.id, project: r.project, session: r.session, scope: r.scope, targetId: r.targetId, event: r.event, summary: r.summary, payload: r.payload, ts: r.ts, seen: false }));
}
