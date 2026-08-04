import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Isolate the global supervisor.db BEFORE the store module opens it (openDb memoises
// the handle — supervisor-store.ts:314).
const tempDir = mkdtempSync(join(tmpdir(), 'escalation-status-norm-'));
process.env.MERMAID_SUPERVISOR_DIR = tempDir;

import {
  createEscalation,
  resolveEscalation,
  getEscalation,
  ESCALATION_STATUSES,
  normalizeEscalationStatus,
  reopenResolvedEscalationByConditionKey,
  conditionIdentity,
  _closeDb,
} from '../supervisor-store';

beforeAll(() => {
  _closeDb();
});

afterAll(() => {
  _closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('escalation-status-normalization', () => {
  it('keyed escalation resolved with prose status re-raises as isNew:false with canonical status and resolutionNote', () => {
    const project = '/test/project';
    const session = 'test-session';
    const { key, hash } = conditionIdentity('test-kind', ['subject-1']);

    // Create an initial keyed escalation
    const { escalation: initial, isNew: initialIsNew } = createEscalation({
      project,
      session,
      kind: 'test-kind',
      questionText: 'Initial question',
      audience: 'human',
      conditionKey: key,
      conditionTuple: ['subject-1'],
    });

    expect(initialIsNew).toBe(true);
    expect(initial.status).toBe('open');

    // Resolve it with a prose status string
    resolveEscalation(initial.id, 'resolved: This is a long multi-sentence note explaining the resolution.', 'human', undefined);

    // Verify the stored escalation has canonical status + resolutionNote
    const resolved = getEscalation(initial.id);
    expect(resolved).toBeDefined();
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolutionNote).toBe('This is a long multi-sentence note explaining the resolution.');
    expect(resolved!.resolvedBy).toBe('human');

    // Re-raise the same condition (via createEscalation with same key+tuple)
    const { escalation: reraise, isNew: reraiseIsNew } = createEscalation({
      project,
      session,
      kind: 'test-kind',
      questionText: 'Re-raised question',
      audience: 'human',
      conditionKey: key,
      conditionTuple: ['subject-1'],
    });

    // Should NOT be new (matched the resolved row)
    expect(reraiseIsNew).toBe(false);
    expect(reraise.id).toBe(initial.id);
    // Status is still 'resolved' (not re-opened by createEscalation)
    expect(reraise.status).toBe('resolved');
    expect(reraise.resolutionNote).toBe('This is a long multi-sentence note explaining the resolution.');
  });

  it('each of the 8 ESCALATION_STATUSES passed through normalizeEscalationStatus returns unchanged', () => {
    const statuses: string[] = ['open','acknowledged','resolved','stale','decided','superseded','obsolete','linear'];
    for (const status of statuses) {
      const { status: normalized, note } = normalizeEscalationStatus(status);
      expect(normalized).toBe(status);
      expect(note).toBeNull();
    }
  });

  it('a garbage status falls back to resolved with the original string as note', () => {
    const { status, note } = normalizeEscalationStatus('whatever happened');
    expect(status).toBe('resolved');
    expect(note).toBe('whatever happened');
  });

  it('a legacy prose-status row written directly is still matched by the createEscalation suppression query', () => {
    const project = '/test/project2';
    const session = 'test-session2';
    const { key, hash } = conditionIdentity('direct-write-kind', ['subject-2']);

    // Simulate a legacy row written directly via db handle (bypassing normalizeEscalationStatus).
    // This row has a prose status like "resolved: some reason" but no resolutionNote yet.
    const dbPath = join(tempDir, 'supervisor.db');
    const directDb = new Database(dbPath);

    // Insert a legacy row with prose status directly
    const legacyId = crypto.randomUUID();
    const now = Date.now();
    directDb.prepare(
      `INSERT INTO escalation
        (id, project, session, kind, questionText, status, createdAt, resolvedAt, serverId, todoId, conditionKey, conditionHash, audience)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      legacyId,
      project,
      session,
      'direct-write-kind',
      'Legacy question',
      'resolved: some old reason',  // prose status, not canonical
      now,
      now,
      '',
      null,
      key,
      hash,
      'human',
    );
    directDb.close();

    // Now try to create an escalation with the same key+tuple.
    // It should match the legacy row (despite its prose status) because we loosened
    // the suppression query to match 'resolved:%' and 'resolved - %'.
    const { escalation: created, isNew } = createEscalation({
      project,
      session,
      kind: 'direct-write-kind',
      questionText: 'Matching question',
      audience: 'human',
      conditionKey: key,
      conditionTuple: ['subject-2'],
    });

    // Should NOT create a new escalation (matched the legacy row)
    expect(isNew).toBe(false);
    expect(created.id).toBe(legacyId);
    expect(created.status).toBe('resolved: some old reason'); // still has prose status
  });

  it('reopenResolvedEscalationByConditionKey reopens a prose-status row', () => {
    const project = '/test/project3';
    const session = 'test-session3';
    const { key, hash } = conditionIdentity('reopen-kind', ['subject-3']);

    // Insert a legacy prose-status row directly
    const dbPath = join(tempDir, 'supervisor.db');
    const directDb = new Database(dbPath);

    const proseId = crypto.randomUUID();
    const now = Date.now();
    directDb.prepare(
      `INSERT INTO escalation
        (id, project, session, kind, questionText, status, createdAt, resolvedAt, serverId, todoId, conditionKey, conditionHash, lastSeenAt, recurrenceCount, audience)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      proseId,
      project,
      session,
      'reopen-kind',
      'Prose status question',
      'resolved - some old note',  // prose status with dash delimiter
      now,
      now,
      '',
      null,
      key,
      hash,
      now,
      0,
      'human',
    );
    directDb.close();

    // Reopen the prose-status row
    const result = reopenResolvedEscalationByConditionKey({
      project,
      conditionKey: key,
    });

    expect(result).toBeDefined();
    expect(result!.reopened).toBe(true);
    expect(result!.escalation.id).toBe(proseId);
    expect(result!.escalation.status).toBe('open');
    expect(result!.escalation.resolvedAt).toBeNull();
    expect(result!.escalation.resolvedBy).toBeNull();
  });

  it('normalizeEscalationStatus with explicit note appends it after split prose', () => {
    const { status, note } = normalizeEscalationStatus(
      'stale: this is the split prose',
      'and this is the explicit note'
    );
    expect(status).toBe('stale');
    expect(note).toBe('this is the split prose | and this is the explicit note');
  });

  it('normalizeEscalationStatus handles dash delimiter with explicit note', () => {
    const { status, note } = normalizeEscalationStatus(
      'decided - split by dash',
      'explicit addition'
    );
    expect(status).toBe('decided');
    expect(note).toBe('split by dash | explicit addition');
  });

  it('normalizeEscalationStatus with only explicit note on canonical status', () => {
    const { status, note } = normalizeEscalationStatus(
      'resolved',
      'only explicit note'
    );
    expect(status).toBe('resolved');
    expect(note).toBe('only explicit note');
  });

  it('normalizeEscalationStatus falls back gracefully with explicit note', () => {
    const { status, note } = normalizeEscalationStatus(
      'some garbage status',
      'plus explicit note'
    );
    expect(status).toBe('resolved');
    expect(note).toBe('some garbage status | plus explicit note');
  });
});
