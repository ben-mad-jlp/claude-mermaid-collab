import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import Database from 'bun:sqlite';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  deriveAudience,
  createEscalation,
  getEscalation,
  _closeDb,
} from '../supervisor-store';

describe('escalation-audience', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `mermaid-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.MERMAID_SUPERVISOR_DIR = testDir;
    _closeDb();
  });

  afterEach(() => {
    _closeDb();
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.MERMAID_SUPERVISOR_DIR;
  });

  it('deriveAudience: operatorGated=true always returns human', () => {
    expect(deriveAudience('leaf-infra-rejected', true)).toBe('human');
  });

  it('deriveAudience: hygiene kind returns internal', () => {
    expect(deriveAudience('infra-park', false)).toBe('internal');
  });

  it('deriveAudience: unknown kind returns human', () => {
    expect(deriveAudience('question', false)).toBe('human');
  });

  it('mapEscalationRow: NULL audience coalesces to human', () => {
    const db = new Database(join(testDir, 'supervisor.db'));
    try {
      // Insert a raw row with audience omitted (NULL)
      db.exec(`
        CREATE TABLE IF NOT EXISTS escalation (
          id TEXT PRIMARY KEY,
          project TEXT NOT NULL,
          session TEXT NOT NULL,
          kind TEXT NOT NULL,
          questionText TEXT NOT NULL,
          status TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          resolvedAt INTEGER,
          serverId TEXT NOT NULL DEFAULT '',
          todoId TEXT,
          optionsJson TEXT,
          recommended TEXT,
          uiJson TEXT,
          routedTo TEXT DEFAULT 'human',
          operatorGated INTEGER DEFAULT 0,
          proof TEXT,
          stewardAttempts INTEGER DEFAULT 0,
          suggestedActionJson TEXT,
          triageInFlight INTEGER DEFAULT 0,
          resolvedBy TEXT,
          briefingMd TEXT,
          briefingModel TEXT,
          briefingAt INTEGER,
          conditionKey TEXT,
          conditionHash TEXT,
          lastSeenAt INTEGER,
          recurrenceCount INTEGER DEFAULT 0,
          audience TEXT
        )
      `);
      db.prepare(
        `INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt, serverId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('test-id-null-audience', 'test-proj', 'test-sess', 'question', 'test q', 'open', Date.now(), '');

      const result = getEscalation('test-id-null-audience');
      expect(result).not.toBeNull();
      expect(result!.audience).toBe('human');
    } finally {
      db.close();
    }
  });

  it('createEscalation: operatorGated override wins over audience input', () => {
    const { escalation } = createEscalation({
      project: 'test-proj',
      session: 'test-sess',
      kind: 'leaf-infra-rejected',
      questionText: 'test q',
      operatorGated: true,
      audience: 'internal',
    });
    expect(escalation.audience).toBe('human');

    // Verify persistence via refetch
    const refetched = getEscalation(escalation.id);
    expect(refetched!.audience).toBe('human');
  });

  it('createEscalation: invalid audience throws', () => {
    expect(() => {
      createEscalation({
        project: 'test-proj',
        session: 'test-sess',
        kind: 'question',
        questionText: 'test q',
        audience: 'nobody' as any,
      });
    }).toThrow('invalid audience');
  });

  it('createEscalation: hygiene kind derives internal audience', () => {
    const { escalation } = createEscalation({
      project: 'test-proj',
      session: 'test-sess',
      kind: 'epic-sweep-triage',
      questionText: 'test q',
      operatorGated: false,
    });
    expect(escalation.audience).toBe('internal');

    // Verify persistence
    const refetched = getEscalation(escalation.id);
    expect(refetched!.audience).toBe('internal');
  });
});
