/**
 * SessionUnseenBadge — unseen notification count badge for watched sessions.
 * Tests the store action and component rendering contract.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { SessionUnseenBadge } from './SessionUnseenBadge';

describe('SessionUnseenBadge', () => {
  beforeEach(() => {
    useSubscriptionStore.setState({ subscriptions: {}, order: [] });
  });

  it('a session with unseen notifications shows its count', () => {
    // Seed one SubscribedSession with unseen count
    useSubscriptionStore.setState({
      subscriptions: {
        'srv:p:worker-1': {
          serverId: 'srv',
          project: 'p',
          session: 'worker-1',
          status: 'active',
          lastUpdate: Date.now(),
        },
      },
    });

    // Apply unseen counts
    useSubscriptionStore.getState().applyUnseenCounts({ 'worker-1': 3 });

    // Render and verify
    render(<SessionUnseenBadge subscriptionKey="srv:p:worker-1" />);
    const badge = screen.getByTestId('unseen-count');
    expect(badge.textContent).toBe('3');
  });

  it('the badge value after a drain equals 0', async () => {
    // Seed one SubscribedSession with unseen count
    useSubscriptionStore.setState({
      subscriptions: {
        'srv:p:worker-1': {
          serverId: 'srv',
          project: 'p',
          session: 'worker-1',
          status: 'active',
          lastUpdate: Date.now(),
        },
      },
    });

    // Apply initial unseen counts
    useSubscriptionStore.getState().applyUnseenCounts({ 'worker-1': 3 });

    // Render
    const { rerender } = render(<SessionUnseenBadge subscriptionKey="srv:p:worker-1" />);
    expect(screen.getByTestId('unseen-count').textContent).toBe('3');

    // Drain: apply empty counts (post-drain payload)
    await act(async () => {
      useSubscriptionStore.getState().applyUnseenCounts({});
    });

    // Re-render to pick up the subscription store update
    rerender(<SessionUnseenBadge subscriptionKey="srv:p:worker-1" />);

    // Verify count is now 0
    expect(screen.getByTestId('unseen-count').textContent).toBe('0');
  });
});
