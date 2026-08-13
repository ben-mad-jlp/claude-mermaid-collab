import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import { computeFrictionSignature } from '../friction-signature';
import {
  recordFriction,
  recordFrictionWithRecurrence,
  listFriction,
  _closeProject,
} from '../friction-store';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join('/var/folders/df/46_3zwkn7vb9p8sv93r1qqz40000gn/T', 'friction-sig-test-'));
});

afterEach(() => {
  _closeProject(tmpDir);
  rmSync(tmpDir, { recursive: true });
});

describe('computeFrictionSignature', () => {
  it('computeFrictionSignature is stable across cosmetic detail differences and distinct across distinct reasons', () => {
    // Same reason with identical details → same signature.
    const sig1 = computeFrictionSignature('timeout', 'timeout waiting for port 9002');
    const sig2 = computeFrictionSignature('timeout', 'timeout waiting for port 9002');
    expect(sig1).toBe(sig2);

    // Same reason with detail differing only by uuid → same signature.
    const withUuid1 = 'timeout waiting for 12345678-1234-1234-1234-123456789abc';
    const withUuid2 = 'timeout waiting for 87654321-4321-4321-4321-987654321cba';
    expect(computeFrictionSignature('timeout', withUuid1)).toBe(
      computeFrictionSignature('timeout', withUuid2),
    );

    // Same reason with detail differing only by sha/hex run → same signature.
    const withSha1 = 'merge base is abc123def456f789a1b2c3d4e5f6789a';
    const withSha2 = 'merge base is 1234567890abcdef1234567890abcdef1234';
    expect(computeFrictionSignature('merge-conflict', withSha1)).toBe(
      computeFrictionSignature('merge-conflict', withSha2),
    );

    // Same reason with detail differing only by path → same signature.
    const withPath1 = 'file not found /Users/alice/Code/project/src/main.ts';
    const withPath2 = 'file not found /home/bob/repos/project/src/main.ts';
    expect(computeFrictionSignature('file-missing', withPath1)).toBe(
      computeFrictionSignature('file-missing', withPath2),
    );

    // Same reason with detail differing only by timestamp → same signature.
    const withTime1 = 'stale since 2026-08-13T12:34:56Z';
    const withTime2 = 'stale since 2026-08-14T09:22:11Z';
    expect(computeFrictionSignature('stale-data', withTime1)).toBe(
      computeFrictionSignature('stale-data', withTime2),
    );

    // Same reason with detail differing only by digit runs → same signature.
    const withNum1 = 'retry 5 failed after 1200ms';
    const withNum2 = 'retry 999 failed after 600ms';
    expect(computeFrictionSignature('retry-failed', withNum1)).toBe(
      computeFrictionSignature('retry-failed', withNum2),
    );

    // Same reason, different casing and whitespace → same signature.
    const withCase1 = 'TIMEOUT waiting for PORT';
    const withCase2 = 'timeout    waiting for port';
    expect(computeFrictionSignature('timeout', withCase1)).toBe(
      computeFrictionSignature('timeout', withCase2),
    );

    // Different reasons → different signature (with same detail).
    const sig3 = computeFrictionSignature('timeout', 'waiting');
    const sig4 = computeFrictionSignature('failure', 'waiting');
    expect(sig3).not.toBe(sig4);

    // Empty/absent detail is legal.
    const emptyDet = computeFrictionSignature('reason', '');
    const nullDet = computeFrictionSignature('reason', null);
    expect(emptyDet).toBe(nullDet);
  });
});

describe('friction-store signature integration', () => {
  it('a friction.db created without the signature column gains it and keeps existing rows readable', async () => {
    // Create an old-schema DB by hand (without signature column).
    const colDir = join(tmpDir, '.collab');
    mkdirSync(colDir, { recursive: true });
    const dbPath = join(colDir, 'friction.db');
    const oldDb = new Database(dbPath);
    oldDb.exec('PRAGMA journal_mode = WAL');
    oldDb.exec(`
      CREATE TABLE friction_notes (
        id TEXT PRIMARY KEY,
        todoId TEXT,
        session TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        layer TEXT NOT NULL,
        retryReason TEXT NOT NULL,
        detail TEXT,
        createdAt TEXT NOT NULL,
        retractedAt TEXT,
        retractedReason TEXT,
        supersededBy TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_friction_todo ON friction_notes(todoId);
      CREATE INDEX IF NOT EXISTS idx_friction_layer ON friction_notes(layer);
      CREATE TABLE IF NOT EXISTS friction_watch_state (
        signalKey TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // Insert a row without signature.
    oldDb.prepare(
      `INSERT INTO friction_notes (id, todoId, session, attempt, layer, retryReason, detail, createdAt)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run('old-row-1', 'todo-1', 'session-1', 1, 'domain', 'api-failed', 'details', '2026-08-13T00:00:00Z');
    oldDb.close();
    _closeProject(tmpDir);

    // Now open via the store (which will migrate).
    const newNote = await recordFriction(tmpDir, {
      todoId: 'todo-2',
      layer: 'domain',
      retryReason: 'network-error',
      detail: 'connection refused',
    });

    // Old row should still be readable.
    const old = listFriction(tmpDir).find((n) => n.id === 'old-row-1');
    expect(old).toBeDefined();
    expect(old?.signature).toBeNull(); // Pre-migration row has no signature.
    expect(old?.retryReason).toBe('api-failed');

    // New row has signature.
    expect(newNote.signature).toBeDefined();
    expect(newNote.signature).not.toBeNull();
    expect(typeof newNote.signature).toBe('string');
    expect(newNote.signature!.length).toBe(16); // sha256 first 16 hex chars.

    // Idempotent: close and reopen without error.
    _closeProject(tmpDir);
    const refetch = listFriction(tmpDir).find((n) => n.id === newNote.id);
    expect(refetch?.signature).toBe(newNote.signature);
  });

  it('recordFrictionWithRecurrence returns priorCount 0, 1, 2 and the third carries the first two note ids', async () => {
    // First call: priorCount should be 0.
    const result1 = await recordFrictionWithRecurrence(tmpDir, {
      layer: 'domain',
      retryReason: 'recurring-issue',
      detail: 'this keeps happening',
    });
    expect(result1.priorCount).toBe(0);
    expect(result1.priorNoteIds).toEqual([]);
    const note1Id = result1.note.id;

    // Second call: priorCount should be 1, and priorNoteIds should contain note1.
    const result2 = await recordFrictionWithRecurrence(tmpDir, {
      layer: 'domain',
      retryReason: 'recurring-issue',
      detail: 'this keeps happening',
    });
    expect(result2.priorCount).toBe(1);
    expect(result2.priorNoteIds).toContain(note1Id);
    const note2Id = result2.note.id;

    // Third call: priorCount should be 2, and priorNoteIds should contain both prior ids.
    const result3 = await recordFrictionWithRecurrence(tmpDir, {
      layer: 'domain',
      retryReason: 'recurring-issue',
      detail: 'this keeps happening',
    });
    expect(result3.priorCount).toBe(2);
    expect(result3.priorNoteIds.length).toBe(2);
    expect(result3.priorNoteIds).toContain(note1Id);
    expect(result3.priorNoteIds).toContain(note2Id);

    // Verify all three are stored.
    const allNotes = listFriction(tmpDir);
    expect(allNotes.length).toBe(3);
    expect(allNotes.map((n) => n.id)).toContain(note1Id);
    expect(allNotes.map((n) => n.id)).toContain(note2Id);
    expect(allNotes.map((n) => n.id)).toContain(result3.note.id);

    // All three should have the same signature.
    const sig = result1.signature;
    expect(result2.signature).toBe(sig);
    expect(result3.signature).toBe(sig);
  });
});
