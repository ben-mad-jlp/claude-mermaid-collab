import { describe, it, expect, mock } from 'bun:test';

// Mocks registered BEFORE importing ../land-authority so the static import graph is intercepted.
mock.module('../mission-store', () => ({
  getMission: (_p: string, todoId: string) => MISSIONS.get(todoId),
  isMissionTerminal: (m: { status: string; abandonedAt: number | null }) => m.abandonedAt != null || m.status === 'converged',
}));
mock.module('../todo-store', () => ({ listTodos: () => TODOS }));

import { landAuthority, landedByTrailer, type LandActor, type LandProbes } from '../land-authority';
import type { Todo } from '../todo-store';
import type { EpicLandGateResult, LandGateUnit } from '../epic-land-gate';

const PROJECT = '/tmp/mc-land-actor-project';
const SESSION = 'conductor-session-1';

/** `kind` is authoritative now, but these fixtures are written in the older title
 *  dialect ("[MISSION] …", "[EPIC] …", "[LAND] …"). Derive the kind from that prefix.
 *  An explicit `kind` in the override always wins. */
const inferKind = (title: string): Todo['kind'] => {
  if (/^\s*\[MISSION\]/i.test(title)) return 'mission';
  if (/^\s*\[EPIC\]/i.test(title)) return 'epic';
  if (/^\s*\[LAND\]/i.test(title)) return 'land';
  return 'leaf';
};

const todo = (over: Partial<Todo>): Todo =>
  ({
    id: 'x',
    title: 't',
    status: 'planned',
    dependsOn: [],
    assigneeKind: 'agent',
    kind: inferKind(over.title ?? 't'),
    ...over,
  }) as Todo;

// mission -> epic -> [ code leaf (done/accepted), [LAND] leaf dependsOn code leaf ]
const MISSION = todo({ id: 'm1', title: '[MISSION] Converge', ownerSession: SESSION });
const EPIC = todo({ id: 'e1', title: '[EPIC] Owned work', parentId: 'm1' });
const CODE = todo({ id: 'c1', title: 'build thing', parentId: 'e1', status: 'done', acceptanceStatus: 'accepted' });
const LAND = todo({ id: 'l1', title: '[LAND] Owned work → master', parentId: 'e1', assigneeKind: 'human', dependsOn: ['c1'] });
let TODOS = [MISSION, EPIC, CODE, LAND];

let MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

const gateUnit = (over: Partial<LandGateUnit> = {}): LandGateUnit => ({
  key: '0:test.ts',
  command: 'test command',
  laneCwd: '/tmp',
  files: ['test.ts'],
  branch: 'pass',
  classification: 'ok',
  ...over,
});

const greenGate = (): EpicLandGateResult => ({
  status: 'pass',
  declared: true,
  manifestPath: '',
  units: [],
  regressions: [],
  inherited: [],
  incidents: [],
  reasons: [],
  specFiles: [],
  epicTipSha: 'abc',
  baseSha: 'def',
});

function countingProbes() {
  const calls = { presence: [] as string[], gate: [] as string[], merge: [] as string[] };
  const probes: LandProbes = {
    todos: () => TODOS,
    presence: (p, e) => {
      calls.presence.push(`${p}:${e}`);
      return {
        project: p,
        epicId: e,
        epicBranch: '',
        checked: 1,
        findings: [],
        exemptions: [],
        duplicateCommits: [],
        blocking: false,
      };
    },
    gate: async (o) => {
      calls.gate.push(`${o.project}:${o.epicId}`);
      return greenGate();
    },
    merge: (p, b) => {
      calls.merge.push(`${p}:${b}`);
      return { tscClean: true, mergeClean: true };
    },
  };
  return { calls, probes };
}

describe('Landed-By trailer records the actor', () => {
  it('landedByTrailer for human', () => {
    expect(landedByTrailer({ kind: 'human' })).toBe('Landed-By: human');
  });

  it('landedByTrailer for conductor', () => {
    expect(landedByTrailer({ kind: 'conductor', session: SESSION })).toBe(`Landed-By: conductor:${SESSION}`);
  });

  it('landedByTrailer for daemon', () => {
    expect(landedByTrailer({ kind: 'daemon', level: 'auto' })).toBe('Landed-By: daemon:auto');
  });

  it('trailer injection is neutralised: newlines stripped', () => {
    const malicious = 's1\nSigned-off-by: evil';
    const result = landedByTrailer({ kind: 'conductor', session: malicious });
    expect(result).not.toContain('\n');
    expect(result).not.toContain('\r');
    expect(result).toBe('Landed-By: conductor:s1Signed-off-by: evil');
  });

  it('trailer injection is neutralised: carriage returns stripped', () => {
    const malicious = 's1\rAnother-header: attack';
    const result = landedByTrailer({ kind: 'conductor', session: malicious });
    expect(result).not.toContain('\n');
    expect(result).not.toContain('\r');
  });

  it('trailer is trimmed', () => {
    const padded = '  session-value  ';
    const result = landedByTrailer({ kind: 'conductor', session: padded });
    expect(result).toBe('Landed-By: conductor:session-value');
  });

  it('human actor: verdict.trailer matches landedByTrailer', async () => {
    // Reset mocks for this test
    TODOS = [MISSION, EPIC, CODE, LAND];
    MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

    const actor: LandActor = { kind: 'human' };
    const { calls, probes } = countingProbes();
    const verdict = await landAuthority(PROJECT, 'e1', actor, { probes, todos: TODOS });

    expect(verdict.trailer).toBe(landedByTrailer(actor));
    expect(verdict.actor).toEqual(actor);
  });

  it('conductor actor: verdict.trailer matches landedByTrailer', async () => {
    TODOS = [MISSION, EPIC, CODE, LAND];
    MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

    const actor: LandActor = { kind: 'conductor', session: SESSION };
    const { calls, probes } = countingProbes();
    const verdict = await landAuthority(PROJECT, 'e1', actor, { probes, todos: TODOS });

    expect(verdict.trailer).toBe(landedByTrailer(actor));
    expect(verdict.actor).toEqual(actor);
  });

  it('daemon actor: verdict.trailer matches landedByTrailer', async () => {
    TODOS = [MISSION, EPIC, CODE, LAND];
    MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

    const actor: LandActor = { kind: 'daemon', level: 'auto' };
    const { calls, probes } = countingProbes();
    const verdict = await landAuthority(PROJECT, 'e1', actor, { probes, todos: TODOS });

    expect(verdict.trailer).toBe(landedByTrailer(actor));
    expect(verdict.actor).toEqual(actor);
  });
});

describe('ONE proof, THREE actors — no path bypasses landReadiness', () => {
  it('green probes: all three actors call identical probes exactly once', async () => {
    const actors: LandActor[] = [
      { kind: 'human' },
      { kind: 'conductor', session: SESSION },
      { kind: 'daemon', level: 'auto' },
    ];

    const results = [];
    for (const actor of actors) {
      TODOS = [MISSION, EPIC, CODE, LAND];
      MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

      const { calls, probes } = countingProbes();
      const verdict = await landAuthority(PROJECT, 'e1', actor, { probes, todos: TODOS });

      results.push({ actor, verdict, calls });

      // Each probe must be called exactly once with consistent params
      expect(calls.presence).toHaveLength(1);
      expect(calls.gate).toHaveLength(1);
      expect(calls.merge).toHaveLength(1);

      expect(calls.presence[0]).toBe(`${PROJECT}:e1`);
      expect(calls.gate[0]).toBe(`${PROJECT}:e1`);
      expect(calls.merge[0]).toMatch(/^\/tmp\/mc-land-actor-project:/);

      // All three should be green
      expect(verdict.green).toBe(true);
      expect(verdict.blockers).toHaveLength(0);
    }

    // Verify all three actors got the same green/blockers result
    expect(results[0].verdict.green).toBe(results[1].verdict.green);
    expect(results[0].verdict.green).toBe(results[2].verdict.green);
    expect(results[0].verdict.blockers).toHaveLength(0);
    expect(results[1].verdict.blockers).toHaveLength(0);
    expect(results[2].verdict.blockers).toHaveLength(0);
  });

  it('green probes: all three actors authorized', async () => {
    const actors: LandActor[] = [
      { kind: 'human' },
      { kind: 'conductor', session: SESSION },
      { kind: 'daemon', level: 'auto' },
    ];

    for (const actor of actors) {
      TODOS = [MISSION, EPIC, CODE, LAND];
      MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

      const { calls, probes } = countingProbes();
      const verdict = await landAuthority(PROJECT, 'e1', actor, { probes, todos: TODOS });

      expect(verdict.authorized).toBe(true);
    }
  });

  it('green probes: ownership is n/a for human and daemon, owned for conductor', async () => {
    TODOS = [MISSION, EPIC, CODE, LAND];
    MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

    const human: LandActor = { kind: 'human' };
    const { probes: probes1 } = countingProbes();
    const humanVerdict = await landAuthority(PROJECT, 'e1', human, { probes: probes1, todos: TODOS });
    expect(humanVerdict.ownership).toBe('n/a');

    TODOS = [MISSION, EPIC, CODE, LAND];
    MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

    const daemon: LandActor = { kind: 'daemon', level: 'auto' };
    const { probes: probes2 } = countingProbes();
    const daemonVerdict = await landAuthority(PROJECT, 'e1', daemon, { probes: probes2, todos: TODOS });
    expect(daemonVerdict.ownership).toBe('n/a');

    TODOS = [MISSION, EPIC, CODE, LAND];
    MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

    const conductor: LandActor = { kind: 'conductor', session: SESSION };
    const { probes: probes3 } = countingProbes();
    const conductorVerdict = await landAuthority(PROJECT, 'e1', conductor, { probes: probes3, todos: TODOS });
    expect(conductorVerdict.ownership).toBe('owned');
  });

  it('red probes: all three actors get same red verdict', async () => {
    const actors: LandActor[] = [
      { kind: 'human' },
      { kind: 'conductor', session: SESSION },
      { kind: 'daemon', level: 'auto' },
    ];

    const results = [];
    for (const actor of actors) {
      TODOS = [MISSION, EPIC, CODE, LAND];
      MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

      const { calls, probes } = countingProbes();

      // Override probes to return red
      probes.merge = () => ({ tscClean: false, mergeClean: false });
      probes.gate = async () => ({
        ...greenGate(),
        regressions: [gateUnit({ baseline: 'pass', branch: 'fail', classification: 'regression' })],
      });

      const verdict = await landAuthority(PROJECT, 'e1', actor, { probes, todos: TODOS });
      results.push({ actor, verdict });

      expect(verdict.green).toBe(false);
      expect(verdict.authorized).toBe(false);
    }

    // Extract block codes and sort them for comparison
    const codes = (result: any) => result.verdict.blockers.map((b: any) => b.code).sort();
    const code0 = codes(results[0]);
    const code1 = codes(results[1]);
    const code2 = codes(results[2]);

    expect(code1).toEqual(code0);
    expect(code2).toEqual(code0);
    // Verify we got the expected codes
    expect(code0).toContain('gate-regression');
    expect(code0).toContain('merge-conflict');
    expect(code0).toContain('tsc-failed');
  });

  it('authority does not short-circuit safety: foreign conductor still runs full proof', async () => {
    TODOS = [MISSION, EPIC, CODE, LAND];
    MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

    const foreigner: LandActor = { kind: 'conductor', session: 'someone-else' };
    const { calls, probes } = countingProbes();
    const verdict = await landAuthority(PROJECT, 'e1', foreigner, { probes, todos: TODOS });

    // Authority refuses due to foreign mission
    expect(verdict.authorized).toBe(false);
    expect(verdict.blockers[0]?.code).toBe('foreign-mission');
    expect(verdict.blockers[0]?.message).toContain(SESSION);

    // But safety proof still ran — gate probe was invoked
    expect(calls.gate).toHaveLength(1);
    expect(calls.presence).toHaveLength(1);
    expect(calls.merge).toHaveLength(1);
  });

  it('safety does not short-circuit authority: foreign conductor + red probes', async () => {
    TODOS = [MISSION, EPIC, CODE, LAND];
    MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

    const foreigner: LandActor = { kind: 'conductor', session: 'someone-else' };
    const { calls, probes } = countingProbes();

    // Make probes red
    probes.merge = () => ({ tscClean: false, mergeClean: false });
    probes.gate = async () => ({
      ...greenGate(),
      regressions: [gateUnit({ baseline: 'pass', branch: 'fail', classification: 'regression' })],
    });

    const verdict = await landAuthority(PROJECT, 'e1', foreigner, { probes, todos: TODOS });

    // Should have blockers from BOTH authority and safety
    expect(verdict.blockers.length).toBeGreaterThan(1);
    expect(verdict.blockers[0]?.code).toBe('foreign-mission'); // authority first
    const codes = verdict.blockers.map((b) => b.code);
    expect(codes).toContain('gate-regression');
    expect(codes).toContain('merge-conflict');
    expect(codes).toContain('tsc-failed');
  });
});

describe('inherited red is reported, not blocking', () => {
  it('gate returns inherited: green=true, inheritedRed=true, authorized=true for owning conductor', async () => {
    TODOS = [MISSION, EPIC, CODE, LAND];
    MISSIONS = new Map([['m1', { todoId: 'm1', active: true, status: 'needs-discovery', abandonedAt: null }]]);

    const conductor: LandActor = { kind: 'conductor', session: SESSION };
    const { calls, probes } = countingProbes();

    // Override gate to return inherited red (not blocking)
    probes.gate = async () => ({
      ...greenGate(),
      inherited: [gateUnit({ baseline: 'fail', branch: 'fail', classification: 'inherited' })],
    });

    const verdict = await landAuthority(PROJECT, 'e1', conductor, { probes, todos: TODOS });

    expect(verdict.green).toBe(true);
    expect(verdict.inheritedRed).toBe(true);
    expect(verdict.authorized).toBe(true);
    expect(verdict.blockers).toHaveLength(0);
  });
});
