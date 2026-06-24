// Pure summarizeFrictionTrends tests — no DB needed.
import { describe, test, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FrictionNote } from '../friction-store';
import { recordFriction, _closeProject } from '../friction-store';
import { summarizeFrictionTrends, frictionTrends } from '../friction-trends';

let seq = 0;
function note(partial: Partial<FrictionNote> & { layer: FrictionNote['layer']; retryReason: string }): FrictionNote {
  return {
    id: `f${++seq}`,
    todoId: null,
    session: null,
    attempt: 1,
    detail: null,
    createdAt: partial.createdAt ?? '2026-06-11T00:00:00.000Z',
    ...partial,
  };
}

describe('summarizeFrictionTrends', () => {
  test('empty → zeroed rollup', () => {
    const r = summarizeFrictionTrends([]);
    expect(r.total).toBe(0);
    expect(r.byLayer).toEqual([]);
    expect(r.recurring).toEqual([]);
  });

  test('groups by layer with counts and ranks reasons by count', () => {
    const r = summarizeFrictionTrends([
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation', session: 'a', createdAt: '2026-06-11T03:00:00.000Z' }),
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation', session: 'b', createdAt: '2026-06-11T02:00:00.000Z' }),
      note({ layer: 'orchestration', retryReason: 'gate-format', session: 'a', createdAt: '2026-06-11T01:00:00.000Z' }),
      note({ layer: 'domain', retryReason: 'cad-api-rederived', createdAt: '2026-06-11T00:30:00.000Z' }),
    ]);
    expect(r.total).toBe(4);
    // orchestration (3) ranks before domain (1)
    expect(r.byLayer.map((l) => l.layer)).toEqual(['orchestration', 'domain']);
    const orch = r.byLayer[0];
    expect(orch.count).toBe(3);
    // tmux-accumulation (2) ranks before gate-format (1)
    expect(orch.reasons.map((x) => x.retryReason)).toEqual(['tmux-accumulation', 'gate-format']);
    const top = orch.reasons[0];
    expect(top.count).toBe(2);
    expect(top.sessions.sort()).toEqual(['a', 'b']);
    expect(top.lastAt).toBe('2026-06-11T03:00:00.000Z'); // max createdAt
  });

  test('recurring lists only reasons seen more than once, most-recurring first', () => {
    const r = summarizeFrictionTrends([
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation' }),
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation' }),
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation' }),
      note({ layer: 'domain', retryReason: 'flaky-test' }),
      note({ layer: 'domain', retryReason: 'flaky-test' }),
      note({ layer: 'domain', retryReason: 'one-off' }),
    ]);
    expect(r.recurring).toEqual([
      { layer: 'orchestration', retryReason: 'tmux-accumulation', count: 3 },
      { layer: 'domain', retryReason: 'flaky-test', count: 2 },
    ]);
  });

  test('null sessions are excluded from a reason\'s session list', () => {
    const r = summarizeFrictionTrends([
      note({ layer: 'domain', retryReason: 'x', session: null }),
      note({ layer: 'domain', retryReason: 'x', session: 'w1' }),
    ]);
    expect(r.byLayer[0].reasons[0].sessions).toEqual(['w1']);
  });

  test('operational notes roll up under their own layer group', () => {
    const r = summarizeFrictionTrends([
      note({ layer: 'operational', retryReason: 'stale-shadow-server' }),
      note({ layer: 'operational', retryReason: 'stale-shadow-server' }),
      note({ layer: 'domain', retryReason: 'cad-api-rederived' }),
    ]);
    const layers = r.byLayer.map((l) => l.layer);
    expect(layers).toContain('operational');
    const op = r.byLayer.find((l) => l.layer === 'operational')!;
    expect(op.count).toBe(2);
    expect(op.reasons[0].retryReason).toBe('stale-shadow-server');
    expect(op.reasons[0].count).toBe(2);
    // appears in recurring (count > 1)
    expect(r.recurring.some((x) => x.layer === 'operational' && x.retryReason === 'stale-shadow-server')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Store-backed frictionTrends(project) — DB integration
// ---------------------------------------------------------------------------

describe('frictionTrends (store-backed)', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'friction-trends-'));
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('operational notes surface in the store-backed rollup and recurring list', async () => {
    await recordFriction(project, { layer: 'operational', retryReason: 'stale-worktree' });
    await recordFriction(project, { layer: 'operational', retryReason: 'stale-worktree' });
    await recordFriction(project, { layer: 'domain', retryReason: 'cad-api-rederived' });

    const r = frictionTrends(project);
    const op = r.byLayer.find((l) => l.layer === 'operational');
    expect(op).toBeDefined();
    expect(op!.count).toBe(2);
    expect(r.recurring.some((x) => x.layer === 'operational' && x.retryReason === 'stale-worktree' && x.count === 2)).toBe(true);
  });

  it('layer-filter param flows to listFriction (only one group returned)', async () => {
    await recordFriction(project, { layer: 'operational', retryReason: 'stale-worktree' });
    await recordFriction(project, { layer: 'operational', retryReason: 'stale-worktree' });
    await recordFriction(project, { layer: 'domain', retryReason: 'cad-api-rederived' });

    const r = frictionTrends(project, { layer: 'operational' });
    expect(r.byLayer.length).toBe(1);
    expect(r.byLayer[0].layer).toBe('operational');
    expect(r.total).toBe(2);
  });

  it('limit cap is honored (newest-first, only cap notes considered)', async () => {
    await recordFriction(project, { layer: 'domain', retryReason: 'old-reason' });
    await recordFriction(project, { layer: 'domain', retryReason: 'newer-reason' });
    await recordFriction(project, { layer: 'domain', retryReason: 'newest-reason' });

    const r = frictionTrends(project, { limit: 2 });
    expect(r.total).toBe(2);
  });
});
