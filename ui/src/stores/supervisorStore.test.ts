/**
 * Supervisor Store — setSupervisedLocal (optimistic group-move).
 *
 * Covers the toggle UX fix: marking a session supervised must reflect in the
 * store immediately (so the card moves between the Watching and Supervisor
 * groups without waiting for a poll/reload), and un-supervising removes it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSupervisorStore, type SupervisedSession } from './supervisorStore';

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
