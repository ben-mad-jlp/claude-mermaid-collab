/**
 * Supervisor Store — setSupervisedLocal (optimistic group-move).
 *
 * Covers the toggle UX fix: marking a session supervised must reflect in the
 * store immediately (so the card moves between the Watching and Supervisor
 * groups without waiting for a poll/reload), and un-supervising removes it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSupervisorStore, type SupervisedSession, type Escalation } from './supervisorStore';

const sess = (session: string, extra?: Partial<SupervisedSession>): SupervisedSession => ({
  project: '/repo',
  session,
  source: 'manual',
  serverId: 'srv1',
  ...extra,
});

describe('supervisorStore.setSupervisedLocal', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ supervised: [] });
  });

  it('adds a session optimistically', () => {
    useSupervisorStore.getState().setSupervisedLocal(sess('alpha'), true);
    const list = useSupervisorStore.getState().supervised;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ project: '/repo', session: 'alpha' });
    expect(typeof list[0].addedAt).toBe('number');
  });

  it('removes a session optimistically', () => {
    useSupervisorStore.setState({ supervised: [sess('alpha'), sess('beta')] });
    useSupervisorStore.getState().setSupervisedLocal(sess('alpha'), false);
    const sessions = useSupervisorStore.getState().supervised.map((s) => s.session);
    expect(sessions).toEqual(['beta']);
  });

  it('does not duplicate when adding an already-supervised session', () => {
    useSupervisorStore.setState({ supervised: [sess('alpha')] });
    useSupervisorStore.getState().setSupervisedLocal(sess('alpha'), true);
    expect(useSupervisorStore.getState().supervised).toHaveLength(1);
  });

  it('keys on project+session, not just session', () => {
    useSupervisorStore.setState({ supervised: [sess('alpha', { project: '/repo' })] });
    useSupervisorStore.getState().setSupervisedLocal(sess('alpha', { project: '/other' }), true);
    expect(useSupervisorStore.getState().supervised).toHaveLength(2);
  });
});

/**
 * L1 (design-ui-status-coherence §4): the open/resolved slice split + race-guard.
 * The bug this fixes (D2): a single `escalations` array meant a resolved-tab fetch
 * wholesale-overwrote it and momentarily zeroed every open count. The slices are now
 * independent; `escalations` is a deprecated alias kept in lockstep with the open set.
 */
const esc = (id: string, extra?: Partial<Escalation>): Escalation => ({
  id,
  project: '/repo',
  session: 's1',
  kind: 'decision',
  questionText: 'q',
  status: 'open',
  createdAt: 0,
  serverId: 'srv1',
  ...extra,
});

describe('supervisorStore escalation slices (L1)', () => {
  beforeEach(() => {
    useSupervisorStore.setState({
      openEscalations: [],
      resolvedEscalations: [],
      escalations: [],
      hydrateEpoch: 0,
    });
  });

  it('ingestEscalationCreated upserts into the open slice and bumps the epoch', () => {
    const before = useSupervisorStore.getState().hydrateEpoch;
    useSupervisorStore.getState().ingestEscalationCreated(esc('e1'));
    const s = useSupervisorStore.getState();
    expect(s.openEscalations.map((e) => e.id)).toEqual(['e1']);
    expect(s.hydrateEpoch).toBe(before + 1);
  });

  it('ingest replaces an existing open card in place (no duplicate)', () => {
    const api = useSupervisorStore.getState();
    api.ingestEscalationCreated(esc('e1', { questionText: 'first' }));
    api.ingestEscalationCreated(esc('e1', { questionText: 'second' }));
    const open = useSupervisorStore.getState().openEscalations;
    expect(open).toHaveLength(1);
    expect(open[0].questionText).toBe('second');
  });

  it('ingest of a non-open escalation never enters the open slice', () => {
    useSupervisorStore.getState().ingestEscalationCreated(esc('e1', { status: 'resolved' }));
    expect(useSupervisorStore.getState().openEscalations).toHaveLength(0);
  });

  it('the deprecated `escalations` alias mirrors the open slice', () => {
    useSupervisorStore.getState().ingestEscalationCreated(esc('e1'));
    const s = useSupervisorStore.getState();
    expect(s.escalations).toBe(s.openEscalations);
    expect(s.escalations.map((e) => e.id)).toEqual(['e1']);
  });

  it('resolving moves the id open→resolved authoritatively (D2: open count never via a resolved write)', async () => {
    // Stub the network so the optimistic local move runs (res.ok === true).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    useSupervisorStore.setState({ openEscalations: [esc('e1'), esc('e2')], escalations: [esc('e1'), esc('e2')] });
    await useSupervisorStore.getState().resolveEscalation('srv1', 'e1', 'resolved');
    const s = useSupervisorStore.getState();
    expect(s.openEscalations.map((e) => e.id)).toEqual(['e2']);
    expect(s.resolvedEscalations.map((e) => e.id)).toEqual(['e1']);
    expect(s.resolvedEscalations[0].status).toBe('resolved');
    // the alias tracked the move
    expect(s.escalations.map((e) => e.id)).toEqual(['e2']);
    vi.unstubAllGlobals();
  });
});

/**
 * L3 (useStatusSync) — the bootstrap/reconnect hydrate + its race guard (design
 * §2.1). hydrateOpenEscalations fetches the open set over the watched servers and
 * merges it under an epoch guard, so a slow reconnect snapshot can never clobber a
 * newer WS upsert, and a locally-resolved id is never resurrected.
 */
describe('supervisorStore.hydrateOpenEscalations (L3)', () => {
  beforeEach(() => {
    useSupervisorStore.setState({
      openEscalations: [],
      resolvedEscalations: [],
      escalations: [],
      hydrateEpoch: 0,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it('merges the fetched open set and bumps the epoch (happy path)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ escalations: [esc('e1'), esc('e2')] })));
    await useSupervisorStore.getState().hydrateOpenEscalations(['srv1']);
    const st = useSupervisorStore.getState();
    expect(st.openEscalations.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(st.hydrateEpoch).toBe(1);
    // the deprecated alias tracks the open slice
    expect(st.escalations.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('keeps prior state if ANY watched server fails (no partial clobber)', async () => {
    useSupervisorStore.setState({ openEscalations: [esc('keep')], escalations: [esc('keep')], hydrateEpoch: 0 });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson({ escalations: [esc('a')] }))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }));
    await useSupervisorStore.getState().hydrateOpenEscalations(['srvA', 'srvB']);
    expect(useSupervisorStore.getState().openEscalations.map((e) => e.id)).toEqual(['keep']);
  });

  it('reconnect hydrate cannot clobber a mid-flight WS upsert (the race)', async () => {
    // The reconnect REST snapshot is older (no 'e2'); an ingest delivers 'e2'
    // while the fetch is in flight. The epoch guard must discard the stale result.
    let release!: (v: unknown) => void;
    const gate = new Promise((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      await gate; // hold the in-flight REST read open
      return okJson({ escalations: [] }); // stale snapshot, server didn't have e2 yet
    }));

    const pending = useSupervisorStore.getState().hydrateOpenEscalations(['srv1']); // snapshots epoch 0
    // A newer WS upsert arrives mid-flight and bumps the epoch.
    useSupervisorStore.getState().ingestEscalationCreated(esc('e2'));
    expect(useSupervisorStore.getState().openEscalations.map((e) => e.id)).toEqual(['e2']);

    release(null);
    await pending;
    // The stale empty snapshot was discarded — the WS upsert survives.
    expect(useSupervisorStore.getState().openEscalations.map((e) => e.id)).toEqual(['e2']);
  });

  it('never resurrects a locally-resolved id', async () => {
    // The user already moved 'e1' to resolved; a stale server snapshot still lists
    // it open. The merge must NOT bring it back into the open slice.
    useSupervisorStore.setState({
      openEscalations: [],
      resolvedEscalations: [esc('e1', { status: 'resolved' })],
      escalations: [],
      hydrateEpoch: 0,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ escalations: [esc('e1'), esc('e2')] })));
    await useSupervisorStore.getState().hydrateOpenEscalations(['srv1']);
    expect(useSupervisorStore.getState().openEscalations.map((e) => e.id)).toEqual(['e2']);
  });
});
