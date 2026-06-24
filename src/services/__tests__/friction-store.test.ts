// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordFriction, listFriction, _closeProject, getWatchState, setWatchState } from '../friction-store';

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
    await expect(recordFriction(project, { todoId: 't', layer: 'domain', retryReason: '' })).rejects.toThrow('retryReason is required');
  });

  it('records with no todoId (operational note) — stores null and round-trips', async () => {
    const note = await recordFriction(project, { layer: 'operational', retryReason: 'stale-shadow-server', detail: 'plugin hook started old binary' });
    expect(note.todoId).toBeNull();
    expect(note.layer).toBe('operational');
    expect(note.retryReason).toBe('stale-shadow-server');
    // round-trip via list
    const all = listFriction(project);
    expect(all[0].todoId).toBeNull();
  });

  it('accepts operational layer and filters by it', async () => {
    await recordFriction(project, { layer: 'operational', retryReason: 'nudge-not-delivered' });
    await recordFriction(project, { todoId: 't1', layer: 'domain', retryReason: 'cad-api-rederived' });
    const operational = listFriction(project, { layer: 'operational' });
    expect(operational.length).toBe(1);
    expect(operational[0].retryReason).toBe('nudge-not-delivered');
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

describe('friction-store watch-state KV', () => {
  it('returns null for an unset key', () => {
    expect(getWatchState(project, 'watch:unset')).toBeNull();
  });

  it('round-trips a set value', async () => {
    await setWatchState(project, 'watch:unlanded-threshold', 'over');
    expect(getWatchState(project, 'watch:unlanded-threshold')).toBe('over');
  });

  it('upserts (second set overwrites, no duplicate row)', async () => {
    const key = 'watch:stale-wt:/tmp/wt-a';
    await setWatchState(project, key, 'branch-gone');
    await setWatchState(project, key, 'stale');
    expect(getWatchState(project, key)).toBe('stale');
  });

  it('keeps distinct keys independent', async () => {
    await setWatchState(project, 'watch:a', 'x');
    await setWatchState(project, 'watch:b', 'y');
    expect(getWatchState(project, 'watch:a')).toBe('x');
    expect(getWatchState(project, 'watch:b')).toBe('y');
  });

  it('persists across a reopened handle', async () => {
    await setWatchState(project, 'watch:persist', 'over');
    _closeProject(project); // drop cached handle → reopen DB file
    expect(getWatchState(project, 'watch:persist')).toBe('over');
  });
});
