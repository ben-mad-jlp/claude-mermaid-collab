import { describe, it, expect } from 'vitest';
import { deriveSystemNodes, mapStatus, supervisorLiveness, type DeriveInput } from './systemNodes';

const base: DeriveInput = {
  config: { supervisorProject: '/p', supervisorSession: 'sup' },
  supervised: [
    { project: '/p', session: 'w1' },
    { project: '/p', session: 'w2' },
    { project: '/other', session: 'w3' },
  ],
  // subscriptionStore map shape (`serverId:project:session` → SessionStatus).
  subscriptions: {
    'local:/p:w1': { serverId: 'local', project: '/p', session: 'w1', status: 'active' },
    'local:/p:w2': { serverId: 'local', project: '/p', session: 'w2', status: 'waiting' },
  },
  openEscalations: [{ project: '/p', session: 'w2' }],
  project: '/p',
};

describe('mapStatus', () => {
  it('maps subscription status → system status', () => {
    expect(mapStatus('active')).toBe('running');
    expect(mapStatus('waiting')).toBe('waiting');
    expect(mapStatus('permission')).toBe('permission');
    expect(mapStatus(undefined)).toBe('unknown');
  });
});

describe('deriveSystemNodes', () => {
  it('builds a supervisor root + worker nodes parented to it', () => {
    const nodes = deriveSystemNodes(base);
    const sup = nodes.find((n) => n.kind === 'supervisor');
    expect(sup?.label).toBe('sup');
    const w1 = nodes.find((n) => n.session === 'w1');
    expect(w1?.kind).toBe('worker');
    expect(w1?.parentId).toBe('supervisor');
    expect(w1?.status).toBe('running'); // active → running
  });

  it('an open escalation overrides live status', () => {
    const w2 = deriveSystemNodes(base).find((n) => n.session === 'w2');
    expect(w2?.status).toBe('escalation'); // even though sub says waiting
  });

  it('respects project scope', () => {
    const sessions = deriveSystemNodes(base).map((n) => n.session);
    expect(sessions).toContain('w1');
    expect(sessions).not.toContain('w3'); // /other filtered out
  });

  it('includes all projects when scope omitted', () => {
    const sessions = deriveSystemNodes({ ...base, project: undefined }).map((n) => n.session);
    expect(sessions).toContain('w3');
  });

  it('no config → no supervisor node, workers unparented', () => {
    const nodes = deriveSystemNodes({ ...base, config: null });
    expect(nodes.some((n) => n.kind === 'supervisor')).toBe(false);
    expect(nodes.find((n) => n.session === 'w1')?.parentId).toBeUndefined();
  });
});

describe('supervisorLiveness', () => {
  const cfg = { supervisorProject: '/p', supervisorSession: 'sup' };
  const supSub = (lastUpdate: number) => ({
    'local:/p:sup': { serverId: 'local', project: '/p', session: 'sup', status: 'active' as const, lastUpdate },
  });
  it('unknown without config', () => {
    expect(supervisorLiveness(null, {}, 1000)).toBe('unknown');
  });
  it('running with a fresh status update', () => {
    expect(supervisorLiveness(cfg, supSub(1000), 1000 + 5000)).toBe('running');
  });
  it('crashed when the signal is stale', () => {
    expect(supervisorLiveness(cfg, supSub(1000), 1000 + 200_000)).toBe('crashed');
  });
  it('crashed when config present but no signal at all', () => {
    expect(supervisorLiveness(cfg, {}, 1000)).toBe('crashed');
  });
});
