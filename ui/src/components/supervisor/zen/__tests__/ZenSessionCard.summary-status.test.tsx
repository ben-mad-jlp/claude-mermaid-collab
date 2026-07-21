import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

/**
 * ZenSessionCard summary-status: verify the derived top-level status correctly
 * maps to the ClaudePix animation pool for summary-only (no-subscription-heartbeat)
 * sessions. A fresh external session auto-carded by OpsSessionCards has
 * `subStatus: 'unknown'`, `stale: undefined`, and relies on structured.status
 * to drive the visible state.
 */

vi.mock('@/components/layout/SessionCard', () => ({
  ClaudePixAvatar: ({ status }: { status: string }) => <div data-testid="pix" data-status={status} />,
  useElapsed: () => null,
}));
vi.mock('../ZenPulseLine', () => ({ ZenPulseLine: () => <div data-testid="pulse" /> }));
vi.mock('../ZenNextPanel', () => ({ ZenNextPanel: () => <div data-testid="next" /> }));

import { ZenSessionCard } from '../ZenSessionCard';

const NOW = 1000;
const paneSeenAt = NOW - 30_000;
const updatedAt = NOW - 5_000;
const project = '/repo';
const session = 'ext1';

const baseProps = {
  project,
  session,
  serverId: 'local',
  onDecideEscalation: vi.fn(),
  onAnswerPane: vi.fn(),
  onOpen: vi.fn(),
  now: NOW,
  subStatus: 'unknown' as const,
};

describe('ZenSessionCard summary-status mapping', () => {
  it("structured.status: 'working' → pix status is 'active'", () => {
    render(
      <ZenSessionCard
        {...baseProps}
        summary={{
          project,
          session,
          progressState: 'active',
          paneSeenAt,
          updatedAt,
          structured: { paragraph: 'Working on task', status: 'working' },
        }}
      />
    );
    const pix = screen.getByTestId('pix');
    expect(pix.getAttribute('data-status')).toBe('active');
    expect(document.querySelector('.opacity-60')).toBeNull();
  });

  it("structured.status: 'idle' → pix status is 'waiting'", () => {
    render(
      <ZenSessionCard
        {...baseProps}
        summary={{
          project,
          session,
          progressState: 'idle',
          paneSeenAt,
          updatedAt,
          structured: { paragraph: 'Idle', status: 'idle' },
        }}
      />
    );
    const pix = screen.getByTestId('pix');
    expect(pix.getAttribute('data-status')).toBe('waiting');
    expect(document.querySelector('.opacity-60')).toBeNull();
  });

  it("structured.status: 'needs-input' (hasQuestion → status 'permission') → pix status is 'permission'", () => {
    render(
      <ZenSessionCard
        {...baseProps}
        summary={{
          project,
          session,
          progressState: 'active',
          paneSeenAt,
          updatedAt,
          structured: {
            paragraph: 'Waiting for input',
            status: 'needs-input',
            question: 'Pick one:',
            options: [{ label: 'Option A' }, { label: 'Option B' }],
          },
        }}
      />
    );
    const pix = screen.getByTestId('pix');
    expect(pix.getAttribute('data-status')).toBe('permission');
    expect(document.querySelector('.opacity-60')).toBeNull();
  });
});
