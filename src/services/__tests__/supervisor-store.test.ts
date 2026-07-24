import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'sup-store-ack-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  createEscalation,
  acknowledgeEscalation,
  resolveEscalation,
  getEscalation,
  resolveEscalationShortId,
  conditionIdentity,
  _closeDb,
} from '../supervisor-store';
import { TOKEN_BURN_KIND } from '../burn-watch';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

/**
 * Regression for acknowledged-escalation dedup semantics (task blueprint): an
 * acknowledged escalation blocks re-raise (isNew stays false) whereas a resolved
 * one allows it (isNew becomes true). This tests the exact contrast: both states
 * start from the SAME (project, session, questionText) triple.
 */
describe('createEscalation — acknowledge vs resolve dedup semantics', () => {
  it('acknowledge blocks re-raise: escalation stays deduplicated', () => {
    const triple = { project: '/test', session: 'sess-1', kind: TOKEN_BURN_KIND, questionText: 'serve capacity low' };

    // Create the escalation.
    const { escalation: esc1, isNew: isNew1 } = createEscalation(triple);
    expect(isNew1).toBe(true);
    expect(esc1.status).toBe('open');

    // Acknowledge it (a human has seen it, don't re-raise).
    const acknowledged = acknowledgeEscalation(esc1.id);
    expect(acknowledged).not.toBeNull();
    expect(acknowledged!.status).toBe('acknowledged');
    expect(acknowledged!.resolvedAt).toBeNull(); // Not marked as resolved.

    // Try to create the escalation again with the SAME (project, session, questionText).
    // The dedup query now includes 'acknowledged', so it should return the existing row.
    const { escalation: esc2, isNew: isNew2 } = createEscalation(triple);
    expect(isNew2).toBe(false); // Re-raise is blocked.
    expect(esc2.id).toBe(esc1.id); // Same row is returned.
    expect(esc2.status).toBe('acknowledged'); // Status is still acknowledged.
  });

  it('resolve causes re-raise: escalation is deduplicated until resolved, then new', () => {
    const triple = { project: '/test', session: 'sess-2', kind: TOKEN_BURN_KIND, questionText: 'burn limit exceeded' };

    // Create the escalation.
    const { escalation: esc1, isNew: isNew1 } = createEscalation(triple);
    expect(isNew1).toBe(true);
    expect(esc1.status).toBe('open');

    // Resolve it (a human handled it, mark it resolved).
    resolveEscalation(esc1.id, 'resolved', 'human');

    // Try to create the escalation again with the SAME (project, session, questionText).
    // The dedup query is NOT matching 'resolved', so it should mint a new escalation.
    const { escalation: esc2, isNew: isNew2 } = createEscalation(triple);
    expect(isNew2).toBe(true); // Re-raise is allowed: a new escalation.
    expect(esc2.id).not.toBe(esc1.id); // Different row is minted.
    expect(esc2.status).toBe('open'); // New escalation is open.
  });

  it('acknowledgeEscalation(id, acknowledgedBy) stamps resolvedBy with resolvedAt null', () => {
    const triple = { project: '/test', session: 'sess-3', kind: TOKEN_BURN_KIND, questionText: 'serve limit reached' };

    // Create the escalation.
    const { escalation: esc1, isNew: isNew1 } = createEscalation(triple);
    expect(isNew1).toBe(true);
    expect(esc1.status).toBe('open');

    // Acknowledge it with 'human' as the acknowledgedBy.
    const acknowledged = acknowledgeEscalation(esc1.id, 'human');
    expect(acknowledged).not.toBeNull();
    expect(acknowledged!.status).toBe('acknowledged');
    expect(acknowledged!.resolvedBy).toBe('human'); // Stamped with acknowledgedBy.
    expect(acknowledged!.resolvedAt).toBeNull(); // NOT marked as resolved.

    // Try to create the escalation again with the SAME (project, session, questionText).
    // The dedup query includes 'acknowledged', so it should return the existing row.
    const { escalation: esc2, isNew: isNew2 } = createEscalation(triple);
    expect(isNew2).toBe(false); // Re-raise is blocked.
    expect(esc2.id).toBe(esc1.id); // Same row is returned.
    expect(esc2.status).toBe('acknowledged'); // Status is still acknowledged.
  });
});

describe('resolveEscalation / acknowledgeEscalation — short-id parity contract', () => {
  it('short-id resolve path: 8-char prefix routes to resolveFullEscalationId fallback and updates status', () => {
    const triple = { project: '/test', session: 'sess-4', kind: TOKEN_BURN_KIND, questionText: 'query timeout' };
    const { escalation: esc1 } = createEscalation(triple);

    const shortId = esc1.id.slice(0, 8);
    resolveEscalation(shortId, 'resolved', 'human');

    const resolved = getEscalation(esc1.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolvedAt).not.toBeNull();
  });

  it('unknown id throws with not found message', () => {
    expect(() => {
      resolveEscalation('deadbeef', 'resolved', 'human');
    }).toThrow(/not found/);
  });

  it('full-id path: exact match short-circuits and updates status', () => {
    const triple = { project: '/test', session: 'sess-5', kind: TOKEN_BURN_KIND, questionText: 'rate limit exceeded' };
    const { escalation: esc1 } = createEscalation(triple);

    resolveEscalation(esc1.id, 'resolved', 'human');

    const resolved = getEscalation(esc1.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('resolved');
  });

  it('ambiguous short-id throws when multiple rows share an 8-hex prefix', () => {
    const dbPath = join(dir, 'supervisor.db');
    const directDb = new Database(dbPath);

    const id1 = 'aaaaaaaa-0000-0000-0000-000000000001';
    const id2 = 'aaaaaaaa-0000-0000-0000-000000000002';
    const now = Date.now();

    directDb.prepare(
      'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt) VALUES (?,?,?,?,?,?,?)'
    ).run(id1, '/test', 'test-ambig-1', 'test', 'test question', 'open', now);
    directDb.prepare(
      'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt) VALUES (?,?,?,?,?,?,?)'
    ).run(id2, '/test', 'test-ambig-2', 'test', 'test question', 'open', now);

    directDb.close();

    expect(() => {
      resolveEscalationShortId('aaaaaaaa');
    }).toThrow(/ambiguous/);
  });

  it('acknowledge via short id: status becomes acknowledged, resolvedAt stays null', () => {
    const triple = { project: '/test', session: 'sess-6', kind: TOKEN_BURN_KIND, questionText: 'connection refused' };
    const { escalation: esc1 } = createEscalation(triple);

    const shortId = esc1.id.slice(0, 8);
    const acknowledged = acknowledgeEscalation(shortId, 'human');

    expect(acknowledged).not.toBeNull();
    expect(acknowledged!.status).toBe('acknowledged');
    expect(acknowledged!.resolvedAt).toBeNull();

    const fetched = getEscalation(esc1.id);
    expect(fetched!.status).toBe('acknowledged');
  });
});

describe('conditionIdentity', () => {
  it('key is `${kind}:${subject[0]}`', () => {
    expect(conditionIdentity('blocker', ['b', 'a']).key).toBe('blocker:b');
  });

  it('hash is stable under reordering but changes when an element is added', () => {
    const h1 = conditionIdentity('blocker', ['b', 'a']).hash;
    const h2 = conditionIdentity('blocker', ['a', 'b']).hash;
    expect(h1).toBe(h2);
    const h3 = conditionIdentity('blocker', ['a', 'b', 'c']).hash;
    expect(h3).not.toBe(h1);
  });
});

describe('createEscalation — condition-key identity', () => {
  const countRows = (project: string, conditionKey: string): number => {
    const dbPath = join(dir, 'supervisor.db');
    const directDb = new Database(dbPath);
    const rows = directDb.query('SELECT id FROM escalation WHERE project = ? AND conditionKey = ?').all(project, conditionKey) as { id: string }[];
    directDb.close();
    return rows.length;
  };

  it('keyed raise twice while open updates one row in place', () => {
    const project = '/test-condition-1';
    const conditionKey = 'blocker:test-condition-1';
    const { escalation: esc1, isNew: isNew1 } = createEscalation({
      project, session: 'sess-c1', kind: 'blocker', questionText: 'first wording',
      conditionKey, conditionTuple: ['a'],
    });
    expect(isNew1).toBe(true);
    expect(esc1.recurrenceCount).toBe(0);

    const { escalation: esc2, isNew: isNew2 } = createEscalation({
      project, session: 'sess-c1', kind: 'blocker', questionText: 'refreshed wording',
      conditionKey, conditionTuple: ['a'],
    });
    expect(isNew2).toBe(false);
    expect(esc2.id).toBe(esc1.id);
    expect(esc2.recurrenceCount).toBe(1);
    expect(esc2.lastSeenAt).not.toBeNull();
    expect(esc2.questionText).toBe('refreshed wording');

    expect(countRows(project, conditionKey)).toBe(1);
  });

  it('raise → resolve → raise with the identical tuple stays suppressed (still one row)', () => {
    const project = '/test-condition-2';
    const conditionKey = 'blocker:test-condition-2';
    const { escalation: esc1 } = createEscalation({
      project, session: 'sess-c2', kind: 'blocker', questionText: 'condition present',
      conditionKey, conditionTuple: ['x', 'y'],
    });
    resolveEscalation(esc1.id, 'resolved', 'human');

    const { escalation: esc2, isNew: isNew2 } = createEscalation({
      project, session: 'sess-c2', kind: 'blocker', questionText: 'condition present again',
      conditionKey, conditionTuple: ['x', 'y'],
    });
    expect(isNew2).toBe(false);
    expect(esc2.status).toBe('resolved');
    expect(countRows(project, conditionKey)).toBe(1);
  });

  it('raise → resolve → raise with a changed tuple re-raises (two rows)', () => {
    const project = '/test-condition-3';
    const conditionKey = 'blocker:test-condition-3';
    const { escalation: esc1 } = createEscalation({
      project, session: 'sess-c3', kind: 'blocker', questionText: 'condition present',
      conditionKey, conditionTuple: ['x', 'y'],
    });
    resolveEscalation(esc1.id, 'resolved', 'human');

    const { escalation: esc2, isNew: isNew2 } = createEscalation({
      project, session: 'sess-c3', kind: 'blocker', questionText: 'condition changed',
      conditionKey, conditionTuple: ['x', 'z'],
    });
    expect(isNew2).toBe(true);
    expect(esc2.id).not.toBe(esc1.id);
    expect(esc2.recurrenceCount).toBe(0);
    expect(countRows(project, conditionKey)).toBe(2);
  });

  it('an unkeyed pair with the same (project, session, questionText) still dedups to one row with conditionKey null', () => {
    const project = '/test-condition-4';
    const triple = { project, session: 'sess-c4', kind: 'blocker', questionText: 'unkeyed condition' };
    const { escalation: esc1, isNew: isNew1 } = createEscalation(triple);
    expect(isNew1).toBe(true);
    expect(esc1.conditionKey).toBeNull();

    const { escalation: esc2, isNew: isNew2 } = createEscalation(triple);
    expect(isNew2).toBe(false);
    expect(esc2.id).toBe(esc1.id);
    expect(esc2.conditionKey).toBeNull();

    const dbPath = join(dir, 'supervisor.db');
    const directDb = new Database(dbPath);
    const rows = directDb.query('SELECT id FROM escalation WHERE project = ? AND session = ? AND questionText = ?').all(project, triple.session, triple.questionText) as { id: string }[];
    directDb.close();
    expect(rows.length).toBe(1);
  });
});
