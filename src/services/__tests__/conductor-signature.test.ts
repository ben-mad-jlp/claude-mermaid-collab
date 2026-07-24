// Pure module — no tmpdir/db. Runs under bun:test.
import { describe, test, expect } from 'bun:test';
import {
  HARD_CARD_KINDS,
  LAND_CARD_KIND,
  collectMissionCardIds,
  buildServeSignature,
  buildPassSignature,
  conductorFingerprint,
  type ConductorActionRow,
} from '../conductor-signature';
import { CRITERION_SERVE_CAP_KIND } from '../conductor-pass';
import { INFRA_REJECTED_KIND } from '../conductor-infra-arm';

type CardInput = { id: string; kind: string; project: string; status: string; todoId: string | null };

function card(overrides: Partial<CardInput> & { id: string }): CardInput {
  return {
    kind: 'blocker',
    project: 'p1',
    status: 'open',
    todoId: 'm1',
    ...overrides,
  };
}

describe('conductor-signature — HARD_CARD_KINDS identity', () => {
  test('contains the pinned CRITERION_SERVE_CAP_KIND and INFRA_REJECTED_KIND literals', () => {
    expect(HARD_CARD_KINDS).toContain(CRITERION_SERVE_CAP_KIND);
    expect(HARD_CARD_KINDS).toContain(INFRA_REJECTED_KIND);
  });
});

describe('buildServeSignature / conductorFingerprint byte-identity', () => {
  const actions: ConductorActionRow[] = [
    { id: 'c2', action: 'met' },
    { id: 'c1', action: 'building', rejectedParked: 2 },
  ];

  test('empty hardCardIds path is byte-identical to conductorFingerprint', () => {
    const sig = buildServeSignature({ status: 'in_progress', actions });
    expect(sig).toBe(conductorFingerprint('in_progress', actions));
    expect(sig).not.toContain('|cards:');
  });

  test('omitted hardCardIds path is also byte-identical', () => {
    const sig = buildServeSignature({ status: 'in_progress', actions, hardCardIds: [] });
    expect(sig).toBe(conductorFingerprint('in_progress', actions));
  });

  test('action ordering does not affect the signature', () => {
    const reordered = [...actions].reverse();
    expect(buildServeSignature({ status: 'in_progress', actions: reordered })).toBe(
      buildServeSignature({ status: 'in_progress', actions })
    );
  });

  test('a non-empty hardCardIds list appends a sorted |cards: segment', () => {
    const sig = buildServeSignature({ status: 'in_progress', actions, hardCardIds: ['z', 'a'] });
    expect(sig).toContain('|cards:a,z');
  });

  test('hardCardIds ordering does not affect the signature', () => {
    const a = buildServeSignature({ status: 's', actions: [], hardCardIds: ['x', 'y'] });
    const b = buildServeSignature({ status: 's', actions: [], hardCardIds: ['y', 'x'] });
    expect(a).toBe(b);
  });

  test('a differing hard-card id changes the serve signature', () => {
    const a = buildServeSignature({ status: 's', actions: [], hardCardIds: ['x'] });
    const b = buildServeSignature({ status: 's', actions: [], hardCardIds: ['y'] });
    expect(a).not.toBe(b);
  });
});

describe('buildPassSignature', () => {
  test('appends sorted land card ids', () => {
    const serve = buildServeSignature({ status: 's', actions: [] });
    expect(buildPassSignature(serve, ['b', 'a'])).toBe(`${serve}|land:a,b`);
  });

  test('a differing land-card id changes the pass signature', () => {
    const serve = buildServeSignature({ status: 's', actions: [] });
    const a = buildPassSignature(serve, ['x']);
    const b = buildPassSignature(serve, ['y']);
    expect(a).not.toBe(b);
  });

  test('land card ordering does not affect the signature', () => {
    const serve = buildServeSignature({ status: 's', actions: [] });
    expect(buildPassSignature(serve, ['a', 'b'])).toBe(buildPassSignature(serve, ['b', 'a']));
  });
});

describe('collectMissionCardIds — scoping', () => {
  test('drops foreign-project cards', () => {
    const escs = [card({ id: 'e1', project: 'other' })];
    const { hardCardIds } = collectMissionCardIds(escs, 'p1', ['m1']);
    expect(hardCardIds).toEqual([]);
  });

  test('drops resolved-status cards but keeps acknowledged', () => {
    const escs = [
      card({ id: 'e1', status: 'resolved' }),
      card({ id: 'e2', status: 'acknowledged' }),
    ];
    const { hardCardIds } = collectMissionCardIds(escs, 'p1', ['m1']);
    expect(hardCardIds).toEqual(['e2']);
  });

  test('drops null-todoId cards', () => {
    const escs = [card({ id: 'e1', todoId: null })];
    const { hardCardIds } = collectMissionCardIds(escs, 'p1', ['m1']);
    expect(hardCardIds).toEqual([]);
  });

  test('drops out-of-mission-set cards', () => {
    const escs = [card({ id: 'e1', todoId: 'm-other' })];
    const { hardCardIds } = collectMissionCardIds(escs, 'p1', ['m1']);
    expect(hardCardIds).toEqual([]);
  });

  test('partitions hard-card kinds vs LAND_CARD_KIND vs unknown kinds', () => {
    const escs = [
      card({ id: 'e1', kind: 'blocker' }),
      card({ id: 'e2', kind: LAND_CARD_KIND }),
      card({ id: 'e3', kind: 'question' }),
    ];
    const { hardCardIds, landCardIds } = collectMissionCardIds(escs, 'p1', ['m1']);
    expect(hardCardIds).toEqual(['e1']);
    expect(landCardIds).toEqual(['e2']);
  });

  test('output is order-independent and de-duplicated w.r.t. input order', () => {
    const escs = [
      card({ id: 'e2', kind: 'blocker' }),
      card({ id: 'e1', kind: 'blocker' }),
    ];
    const reordered = [...escs].reverse();
    const a = collectMissionCardIds(escs, 'p1', ['m1']);
    const b = collectMissionCardIds(reordered, 'p1', new Set(['m1']));
    expect(a).toEqual(b);
    expect(a.hardCardIds).toEqual(['e1', 'e2']);
  });
});
