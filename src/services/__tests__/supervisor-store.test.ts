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
