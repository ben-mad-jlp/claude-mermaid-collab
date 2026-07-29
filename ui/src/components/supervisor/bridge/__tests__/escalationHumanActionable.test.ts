import { describe, it, expect } from 'vitest';
import type { Escalation, SuggestedAction } from '@/stores/supervisorStore';
import { selectHumanActionableEscalations, selectMachineHandledCount } from '../escalationSelectors';
import {
  selectHumanActionableEscalations as selectHumanActionableEscalationsStatusScope,
  selectMachineHandledCount as selectMachineHandledCountStatusScope,
} from '@/lib/statusSelectors';

const esc = (
  project: string,
  status: string,
  id: string,
  overrides?: Partial<Escalation>,
): Escalation =>
  ({
    id,
    project,
    session: `${project}-sess`,
    kind: 'decision',
    questionText: 'q',
    status,
    createdAt: 1,
    ...overrides,
  }) as Escalation;

const FIXTURE: Escalation[] = [
  esc('projA', 'open', 'gated1', { operatorGated: 1 }),
  esc('projA', 'open', 'plain1'),
  esc('projA', 'open', 'hygiene_epic_sweep_triage', { kind: 'epic-sweep-triage', audience: 'internal' }),
  esc('projA', 'open', 'hygiene_infra_park', { kind: 'infra-park', audience: 'internal' }),
  esc('projA', 'open', 'hygiene_leaf_infra_rejected', { kind: 'leaf-infra-rejected', audience: 'internal' }),
  esc('projA', 'open', 'hygiene_split_proposal', { kind: 'split-proposal', audience: 'internal' }),
  esc('projA', 'open', 'hygiene_base_moved', { kind: 'base-moved', audience: 'internal' }),
  esc('projA', 'open', 'handling1', { triageInFlight: true, audience: 'internal' }),
  esc('projA', 'open', 'suggested1', {
    suggestedAction: {
      bucket: 'genuine-decision',
      verb: null,
      confidence: 0.8,
      rationale: 'Test suggestion',
    } as SuggestedAction,
    audience: 'internal',
  }),
  esc('projA', 'resolved', 'resolved1'),
];

describe('selectHumanActionableEscalations (bridge module)', () => {
  it('returns only human-actionable escalations', () => {
    const result = selectHumanActionableEscalations(FIXTURE, 'projA');
    expect(result.map((e) => e.id)).toEqual(['gated1', 'plain1']);
  });

  it('filters out machine-hygiene kinds', () => {
    const result = selectHumanActionableEscalations(FIXTURE, 'projA');
    const ids = result.map((e) => e.id);
    expect(ids).not.toContain('hygiene_epic_sweep_triage');
    expect(ids).not.toContain('hygiene_infra_park');
    expect(ids).not.toContain('hygiene_leaf_infra_rejected');
    expect(ids).not.toContain('hygiene_split_proposal');
    expect(ids).not.toContain('hygiene_base_moved');
  });

  it('filters out triageInFlight escalations', () => {
    const result = selectHumanActionableEscalations(FIXTURE, 'projA');
    expect(result.map((e) => e.id)).not.toContain('handling1');
  });

  it('filters out ai-suggested escalations', () => {
    const result = selectHumanActionableEscalations(FIXTURE, 'projA');
    expect(result.map((e) => e.id)).not.toContain('suggested1');
  });

  it('filters out non-open escalations', () => {
    const result = selectHumanActionableEscalations(FIXTURE, 'projA');
    expect(result.map((e) => e.id)).not.toContain('resolved1');
  });

  it('sorts operator-gated rows first', () => {
    const result = selectHumanActionableEscalations(FIXTURE, 'projA');
    expect(result.map((e) => e.id)).toEqual(['gated1', 'plain1']);
    expect(result[0].id).toBe('gated1');
  });

  it('returns empty array for non-array input', () => {
    expect(selectHumanActionableEscalations(null as any, 'projA')).toEqual([]);
  });

  it('audience:internal, status:open escalations are excluded', () => {
    const internal = esc('projA', 'open', 'internal-1', { audience: 'internal' });
    const result = selectHumanActionableEscalations([internal], 'projA');
    expect(result.map((e) => e.id)).not.toContain('internal-1');
  });

  it('audience:human, status:open escalations are included', () => {
    const human = esc('projA', 'open', 'human-1', { audience: 'human' });
    const result = selectHumanActionableEscalations([human], 'projA');
    expect(result.map((e) => e.id)).toContain('human-1');
  });

  it('leaf-infra-rejected with audience:human is present as first when operatorGated', () => {
    const infraRejected = esc('projA', 'open', 'infra-rej-1', {
      kind: 'leaf-infra-rejected',
      operatorGated: 1,
      audience: 'human',
    });
    const result = selectHumanActionableEscalations([infraRejected], 'projA');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.id).toBe('infra-rej-1');
  });
});

describe('selectMachineHandledCount (bridge module)', () => {
  it('counts only audience:internal escalations', () => {
    const count = selectMachineHandledCount(FIXTURE, 'projA');
    expect(count).toBe(7);
  });

  it('does not count triageInFlight or ai-suggested when audience:human', () => {
    const count = selectMachineHandledCount(FIXTURE, 'projA');
    expect(count).toBe(7);
  });

  it('returns 0 for non-array input', () => {
    expect(selectMachineHandledCount(null as any, 'projA')).toBe(0);
  });
});

describe('parity: bridge and statusSelectors agree', () => {
  it('selectHumanActionableEscalations matches by-project vs scope-based calls', () => {
    const bridgeResult = selectHumanActionableEscalations(FIXTURE, 'projA');
    const scopeResult = selectHumanActionableEscalationsStatusScope(FIXTURE, {
      kind: 'project',
      project: 'projA',
    });
    expect(scopeResult.map((e) => e.id)).toEqual(bridgeResult.map((e) => e.id));
  });

  it('selectMachineHandledCount matches by-project vs scope-based calls', () => {
    const bridgeCount = selectMachineHandledCount(FIXTURE, 'projA');
    const scopeCount = selectMachineHandledCountStatusScope(FIXTURE, {
      kind: 'project',
      project: 'projA',
    });
    expect(scopeCount).toBe(bridgeCount);
  });

  it('fleet scope restricted to projA matches project scope', () => {
    const fleetResult = selectHumanActionableEscalationsStatusScope(FIXTURE, { kind: 'fleet' });
    const fleetProjA = fleetResult.filter((e) => e.project === 'projA');
    const projectResult = selectHumanActionableEscalationsStatusScope(FIXTURE, {
      kind: 'project',
      project: 'projA',
    });
    expect(fleetProjA.map((e) => e.id)).toEqual(projectResult.map((e) => e.id));
  });
});
