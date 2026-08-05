import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

/**
 * Stale indicator on SessionCard — displays ⋯ glyph for stale+unknown sessions
 * (retained from an unreachable peer). Tests that staleDim continues to apply
 * opacity-50 on other stale statuses.
 */

vi.mock('@/stores/browserStore', () => ({
  useBrowserStore: {
    getState: () => ({
      activateSession: vi.fn(),
    }),
  },
}));

import { SessionCard, type SessionCardData } from '../SessionCard';

describe('SessionCard — stale indicator', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the stale indicator when stale and status is unknown', () => {
    const sub: SessionCardData = {
      serverId: 'local',
      project: '/test-project',
      session: 'session-1',
      status: 'unknown',
      lastUpdate: Date.now(),
      stale: true,
    };

    render(
      <SessionCard
        sub={sub}
        onNavigate={vi.fn()}
        isSelected={false}
        supervised={false}
        onToggleSupervise={vi.fn()}
      />
    );

    expect(screen.getByTestId('session-card-stale')).toBeTruthy();
    const staleSpan = screen.getByTestId('session-card-stale');
    expect(staleSpan.textContent).toBe('⋯');
    expect(staleSpan.getAttribute('data-stale')).toBe('true');
  });

  it('hides the stale indicator when unknown but not stale', () => {
    const sub: SessionCardData = {
      serverId: 'local',
      project: '/test-project',
      session: 'session-2',
      status: 'unknown',
      lastUpdate: Date.now(),
      stale: false,
    };

    render(
      <SessionCard
        sub={sub}
        onNavigate={vi.fn()}
        isSelected={false}
        supervised={false}
        onToggleSupervise={vi.fn()}
      />
    );

    expect(screen.queryByTestId('session-card-stale')).toBeNull();
  });

  it('hides the stale indicator for a stale waiting session and keeps opacity-50 dim', () => {
    const sub: SessionCardData = {
      serverId: 'local',
      project: '/test-project',
      session: 'session-3',
      status: 'waiting',
      lastUpdate: Date.now(),
      stale: true,
    };

    const { container } = render(
      <SessionCard
        sub={sub}
        onNavigate={vi.fn()}
        isSelected={false}
        supervised={false}
        onToggleSupervise={vi.fn()}
      />
    );

    // Stale indicator should NOT be shown for non-unknown statuses
    expect(screen.queryByTestId('session-card-stale')).toBeNull();

    // Verify that staleDim (opacity-50) still applies to the card outer div
    const card = container.querySelector('[data-watch-card]');
    expect(card).toBeTruthy();
    expect(card?.className).toContain('opacity-50');
  });
});
