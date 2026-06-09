/**
 * WorkerRoster — the per-worker timer reads the lane's REAL last-activity and
 * shows '—' when none is known (todo caae8574). It must NEVER fabricate a
 * render-time value, and a null-timestamp lane must not read as crashed.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkerRoster } from './WorkerRoster';
import { deriveLiveness } from '@/lib/liveness';

const baseSub = {
  serverId: 'local',
  project: '/repo',
  session: 'backend-2',
  contextPercent: undefined,
};

describe('WorkerRoster timer', () => {
  it("shows '—' for a worker with no real last-activity timestamp", () => {
    render(
      <WorkerRoster
        embedded
        subscriptions={[{ ...baseSub, status: 'waiting', lastUpdate: null }]}
        todos={[]}
      />,
    );
    expect(screen.getByTestId('roster-timer-backend-2').textContent).toBe('—');
  });

  it('renders a relative time from a real timestamp', () => {
    render(
      <WorkerRoster
        embedded
        subscriptions={[{ ...baseSub, status: 'active', lastUpdate: Date.now() - 90_000 }]}
        todos={[]}
      />,
    );
    // ~90s ago → "1m" (minutes bucket); never '—' when a real timestamp exists.
    expect(screen.getByTestId('roster-timer-backend-2').textContent).not.toBe('—');
  });
});

describe('deriveLiveness null timestamp', () => {
  it('never marks a null-timestamp lane as crashed even with a current todo', () => {
    const todo = { id: 't', status: 'in_progress' } as any;
    expect(deriveLiveness({ status: 'waiting', lastUpdate: null }, todo, Date.now())).not.toBe('crashed');
  });
});
