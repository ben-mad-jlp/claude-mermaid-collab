/**
 * Supervisor Store — setSupervisedLocal (optimistic group-move).
 *
 * Covers the toggle UX fix: marking a session supervised must reflect in the
 * store immediately (so the card moves between the Watching and Supervisor
 * groups without waiting for a poll/reload), and un-supervising removes it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSupervisorStore, type SupervisedSession, type Escalation, type LandJob, runningLandJobFor } from './supervisorStore';

const sess = (session: string, extra?: Partial<SupervisedSession>): SupervisedSession => ({
  project: '/repo',
  session,
  source: 'manual',
  serverId: 'srv1',
  ...extra,
});

describe('supervisorStore.setSupervisedLocal', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ supervised: [], knownServerIds: [] });
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

  it('setSupervisedLocal(false) leaves no cached copy of that project+session on any server', () => {
    // Seed with multiple copies of the same project+session across different servers
    useSupervisorStore.setState({
      supervised: [
        sess('alpha', { project: '/repo', serverId: 'srvA' }),
        sess('alpha', { project: '/repo', serverId: 'srvB' }),
        sess('alpha', { project: '/repo', serverId: 'srvC' }),
        sess('beta', { project: '/repo', serverId: 'srvA' }),
      ],
      knownServerIds: ['srvA', 'srvB', 'srvC'],
    });

    // Remove alpha from /repo (should remove all server copies)
    useSupervisorStore.getState().setSupervisedLocal(sess('alpha', { project: '/repo' }), false);

    const supervised = useSupervisorStore.getState().supervised;

    // No copies of alpha should remain across any server
    const alphaRows = supervised.filter((s) => s.session === 'alpha' && s.project === '/repo');
    expect(alphaRows).toHaveLength(0);

    // beta should still be there
    const betaRows = supervised.filter((s) => s.session === 'beta' && s.project === '/repo');
    expect(betaRows).toHaveLength(1);
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

/**
 * #4 — defensive summaries hydrate (GET /api/supervisor/summaries → fetch-on-mount
 * / reconnect). Folds the server snapshot into sessionSummaries; the ingest's
 * monotonic guard must keep a stale snapshot from clobbering newer live WS state.
 */
describe('supervisorStore.hydrateSessionSummaries', () => {
  beforeEach(() => useSupervisorStore.setState({ sessionSummaries: {} }));
  afterEach(() => vi.unstubAllGlobals());

  const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const msg = (over?: Record<string, unknown>) => ({
    type: 'session_summary_updated', project: '/repo', session: 's1',
    progressState: 'stalled', paneSeenAt: 1000, updatedAt: 1000,
    summaryText: 'snapshot', refreshState: 'stale-failing',
    paneHash: 'H', summaryPaneHash: 'H', ...over,
  });

  it('fetches the snapshot and folds entries (incl. pane hashes) into sessionSummaries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ summaries: [msg()] })));
    await useSupervisorStore.getState().hydrateSessionSummaries(['srv1']);
    const e = useSupervisorStore.getState().sessionSummaries['/repo::s1'];
    expect(e).toBeDefined();
    expect(e.refreshState).toBe('stale-failing');
    expect(e.paneHash).toBe('H');
    expect(e.summaryPaneHash).toBe('H');
  });

  it('monotonic guard: an older snapshot does not clobber newer live state', async () => {
    // Newer live WS state already present.
    useSupervisorStore.getState().ingestSessionSummary(
      msg({ updatedAt: 5000, summaryText: 'NEW', refreshState: 'fresh' }) as never,
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      okJson({ summaries: [msg({ updatedAt: 1000, summaryText: 'OLD', refreshState: 'stale-failing' })] }),
    ));
    await useSupervisorStore.getState().hydrateSessionSummaries(['srv1']);
    const e = useSupervisorStore.getState().sessionSummaries['/repo::s1'];
    expect(e.summaryText).toBe('NEW');
    expect(e.refreshState).toBe('fresh');
  });

  it('best-effort: a failed fetch keeps prior state (no throw, no clobber)', async () => {
    useSupervisorStore.getState().ingestSessionSummary(msg({ updatedAt: 3000, summaryText: 'KEEP' }) as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await useSupervisorStore.getState().hydrateSessionSummaries(['srv1']);
    expect(useSupervisorStore.getState().sessionSummaries['/repo::s1'].summaryText).toBe('KEEP');
  });
});

describe('supervisorStore.hydrateWatchedSessions', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ supervised: [], knownServerIds: [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  const okRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it('keeps a failed server\'s rows with stale:true while a succeeding server\'s rows refresh clean', async () => {
    // Seed with rows from both srvA and srvB
    useSupervisorStore.setState({
      supervised: [
        sess('srvA-sess', { serverId: 'srvA' }),
        sess('srvB-sess', { serverId: 'srvB' }),
      ],
    });

    // Stub fetch: srvA resolves ok, srvB rejects
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okRes({ supervised: [{ project: '/repo', session: 'srvA-new', serverId: 'srvA' }] }))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }));

    await useSupervisorStore.getState().hydrateWatchedSessions(['srvA', 'srvB']);

    const supervised = useSupervisorStore.getState().supervised;
    // srvA rows: fresh, stale:false (or falsy)
    const srvARows = supervised.filter((s) => s.serverId === 'srvA');
    expect(srvARows).toHaveLength(1);
    expect(srvARows[0].session).toBe('srvA-new');
    expect(srvARows[0].stale).toBeFalsy();

    // srvB rows: retained from prior, stale:true
    const srvBRows = supervised.filter((s) => s.serverId === 'srvB');
    expect(srvBRows).toHaveLength(1);
    expect(srvBRows[0].session).toBe('srvB-sess');
    expect(srvBRows[0].stale).toBe(true);
  });

  it('drops rows for serverIds absent from the known list and dedupes to one row per (serverId, project, session)', async () => {
    // Seed with rows from srvA, srvB, and srvC, plus a duplicate of srvA
    useSupervisorStore.setState({
      supervised: [
        sess('alpha', { serverId: 'srvA', project: '/repo1' }),
        sess('alpha', { serverId: 'srvA', project: '/repo1' }), // duplicate
        sess('beta', { serverId: 'srvB', project: '/repo1' }),
        sess('gamma', { serverId: 'srvC', project: '/repo1' }), // will be pruned
      ],
    });

    // Stub fetch: only hydrate srvA and srvB (srvC is absent from the known list)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okRes({ supervised: [{ project: '/repo1', session: 'alpha-new', serverId: 'srvA' }] }))
      .mockResolvedValueOnce(okRes({ supervised: [{ project: '/repo1', session: 'beta-new', serverId: 'srvB' }] })));

    await useSupervisorStore.getState().hydrateWatchedSessions(['srvA', 'srvB']);

    const supervised = useSupervisorStore.getState().supervised;

    // srvA row: fresh, deduplicated
    const srvARows = supervised.filter((s) => s.serverId === 'srvA');
    expect(srvARows).toHaveLength(1);
    expect(srvARows[0].session).toBe('alpha-new');

    // srvB row: fresh, not a duplicate
    const srvBRows = supervised.filter((s) => s.serverId === 'srvB');
    expect(srvBRows).toHaveLength(1);
    expect(srvBRows[0].session).toBe('beta-new');

    // srvC row: pruned (not in knownServerIds)
    const srvCRows = supervised.filter((s) => s.serverId === 'srvC');
    expect(srvCRows).toHaveLength(0);

    // knownServerIds is set
    expect(useSupervisorStore.getState().knownServerIds).toEqual(['srvA', 'srvB']);
  });

  it('collapses three seeded serverIds (one live, two dead) to exactly one supervised row', async () => {
    useSupervisorStore.setState({
      supervised: [
        sess('live-a', { serverId: 'srvLive', project: '/repo1' }),
        sess('live-a', { serverId: 'srvLive', project: '/repo1' }),
        sess('dead-a', { serverId: 'srvDeadA', project: '/repo1' }),
        sess('dead-b', { serverId: 'srvDeadB', project: '/repo1' }),
      ],
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes({ supervised: [{ project: '/repo1', session: 'live-a', serverId: 'srvLive' }] })));

    await useSupervisorStore.getState().hydrateWatchedSessions(['srvLive']);

    const supervised = useSupervisorStore.getState().supervised;
    expect(supervised).toHaveLength(1);
    expect(supervised[0].serverId).toBe('srvLive');
    expect(supervised.some((s) => s.serverId === 'srvDeadA' || s.serverId === 'srvDeadB')).toBe(false);
  });
});

describe('supervisorStore.fetchLandJobs', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ landJobs: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchLandJobs populates landJobs keyed by targetId', async () => {
    const jobs: LandJob[] = [
      { id: 'job1', targetId: 'epic-abc123', status: 'running', phase: 'merge', updatedAt: 1000 },
      { id: 'job2', targetId: 'esc-def456', status: 'pending', phase: null, updatedAt: 2000 },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs }) }));
    await useSupervisorStore.getState().fetchLandJobs('srv1', '/repo');
    const state = useSupervisorStore.getState();
    expect(state.landJobs).toEqual({
      'epic-abc123': jobs[0],
      'esc-def456': jobs[1],
    });
  });

  it('fetchLandJobs skips jobs without targetId', async () => {
    const jobs = [
      { id: 'job1', targetId: 'epic-abc123', status: 'running', phase: 'merge', updatedAt: 1000 },
      { id: 'job2', targetId: null, status: 'pending', phase: null, updatedAt: 2000 },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs }) }));
    await useSupervisorStore.getState().fetchLandJobs('srv1', '/repo');
    const state = useSupervisorStore.getState();
    expect(state.landJobs).toEqual({
      'epic-abc123': jobs[0],
    });
  });

  it('fetchLandJobs replaces the entire map on success', async () => {
    useSupervisorStore.setState({
      landJobs: { 'old-id': { id: 'old', targetId: 'old-id', status: 'done' } },
    });
    const jobs = [
      { id: 'job1', targetId: 'epic-new', status: 'running', phase: 'merge' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs }) }));
    await useSupervisorStore.getState().fetchLandJobs('srv1', '/repo');
    const state = useSupervisorStore.getState();
    expect(state.landJobs).toEqual({
      'epic-new': jobs[0],
    });
    expect(state.landJobs['old-id']).toBeUndefined();
  });

  it('fetchLandJobs leaves landJobs unchanged on failure', async () => {
    const original = { 'epic-abc': { id: 'j1', targetId: 'epic-abc', status: 'running' } };
    useSupervisorStore.setState({ landJobs: original });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await useSupervisorStore.getState().fetchLandJobs('srv1', '/repo');
    expect(useSupervisorStore.getState().landJobs).toEqual(original);
  });
});

describe('supervisorStore.runningLandJobFor', () => {
  const job: LandJob = { id: 'j1', targetId: 'epic-abc', status: 'running' };
  const state = { landJobs: { 'epic-abc': job, 'esc-def': { id: 'j2', targetId: 'esc-def', status: 'pending' } } };

  it('runningLandJobFor matches escalation id, then todoId, else null', () => {
    expect(runningLandJobFor(state, { id: 'epic-abc' })).toBe(job);
    expect(runningLandJobFor(state, { id: 'nonexistent' })).toBeNull();
    expect(runningLandJobFor(state, { todoId: 'esc-def' })).toEqual(state.landJobs['esc-def']);
  });

  it('runningLandJobFor prefers id over todoId', () => {
    expect(runningLandJobFor(state, { id: 'epic-abc', todoId: 'esc-def' })).toBe(job);
  });

  it('runningLandJobFor returns null for null or undefined escalation', () => {
    expect(runningLandJobFor(state, null)).toBeNull();
    expect(runningLandJobFor(state, undefined)).toBeNull();
  });

  it('runningLandJobFor guards against null/undefined todoId', () => {
    expect(runningLandJobFor(state, { todoId: null })).toBeNull();
    expect(runningLandJobFor(state, { todoId: undefined })).toBeNull();
  });
});
