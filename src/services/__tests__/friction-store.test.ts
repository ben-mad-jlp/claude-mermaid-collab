// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordFriction, listFriction, _closeProject } from '../friction-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'friction-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('friction-store', () => {
  it('records a note and returns the stored shape', async () => {
    const note = await recordFriction(project, {
      todoId: 't1', session: 'general-1', attempt: 2,
      layer: 'domain', retryReason: 'cad-api-rederived', detail: 'no @mcp.tool for fitness',
    });
    expect(typeof note.id).toBe('string');
    expect(note.todoId).toBe('t1');
    expect(note.session).toBe('general-1');
    expect(note.attempt).toBe(2);
    expect(note.layer).toBe('domain');
    expect(note.retryReason).toBe('cad-api-rederived');
    expect(note.detail).toBe('no @mcp.tool for fitness');
    expect(typeof note.createdAt).toBe('string');
  });

  it('defaults attempt to 1 and detail/session to null', async () => {
    const note = await recordFriction(project, { todoId: 't2', layer: 'orchestration', retryReason: 'gate-format' });
    expect(note.attempt).toBe(1);
    expect(note.detail).toBeNull();
    expect(note.session).toBeNull();
  });

  it('rejects an invalid layer and missing required fields', async () => {
    // @ts-expect-error — invalid layer at the type level too
    await expect(recordFriction(project, { todoId: 't', layer: 'bogus', retryReason: 'x' })).rejects.toThrow('layer must be one of');
    await expect(recordFriction(project, { todoId: '', layer: 'domain', retryReason: 'x' })).rejects.toThrow('todoId is required');
    await expect(recordFriction(project, { todoId: 't', layer: 'domain', retryReason: '' })).rejects.toThrow('retryReason is required');
  });

  it('answers "which todos hit DOMAIN-layer friction and why" via the layer filter', async () => {
    await recordFriction(project, { todoId: 't1', layer: 'domain', retryReason: 'cad-api-rederived' });
    await recordFriction(project, { todoId: 't2', layer: 'orchestration', retryReason: 'wrong-test-cmd' });
    await recordFriction(project, { todoId: 't3', layer: 'domain', retryReason: 'missing-domain-model' });

    const domain = listFriction(project, { layer: 'domain' });
    expect(domain.map((n) => n.todoId).sort()).toEqual(['t1', 't3']);
    expect(domain.map((n) => n.retryReason).sort()).toEqual(['cad-api-rederived', 'missing-domain-model']);

    const orchestration = listFriction(project, { layer: 'orchestration' });
    expect(orchestration.map((n) => n.todoId)).toEqual(['t2']);
  });

  it('filters by todoId and by session; unfiltered returns all newest-first', async () => {
    await recordFriction(project, { todoId: 't1', session: 's1', layer: 'domain', retryReason: 'a' });
    await recordFriction(project, { todoId: 't1', session: 's2', layer: 'orchestration', retryReason: 'b' });
    await recordFriction(project, { todoId: 't2', session: 's1', layer: 'domain', retryReason: 'c' });

    expect(listFriction(project, { todoId: 't1' }).length).toBe(2);
    expect(listFriction(project, { session: 's1' }).map((n) => n.retryReason).sort()).toEqual(['a', 'c']);
    expect(listFriction(project).length).toBe(3);
    // newest-first: 'c' (last inserted) leads
    expect(listFriction(project)[0].retryReason).toBe('c');
  });

  it('persists across a reopen (survives a closed handle)', async () => {
    await recordFriction(project, { todoId: 't1', layer: 'domain', retryReason: 'persisted' });
    _closeProject(project); // drop the cached handle → next call reopens the DB file
    const notes = listFriction(project, { todoId: 't1' });
    expect(notes.length).toBe(1);
    expect(notes[0].retryReason).toBe('persisted');
  });
});
