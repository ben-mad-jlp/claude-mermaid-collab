import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionTabs } from '../SessionTabs';
import { useAgentStore } from '../../../stores/agentStore';

function seed(
  sessions: Record<string, { name: string; unread: number }>,
  activeSessionId: string | null,
) {
  useAgentStore.setState({ multiSession: { activeSessionId, sessions } });
}

describe('SessionTabs', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('renders nothing when there are no sessions', () => {
    const { container } = render(<SessionTabs />);
    expect(container.firstChild).toBeNull();
  });

  it('renders tabs from store with active state', () => {
    seed(
      {
        s1: { name: 'Alpha', unread: 0 },
        s2: { name: 'Beta', unread: 3 },
      },
      's1',
    );
    render(<SessionTabs />);
    const t1 = screen.getByTestId('session-tab-s1');
    const t2 = screen.getByTestId('session-tab-s2');
    expect(t1.textContent).toContain('Alpha');
    expect(t2.textContent).toContain('Beta');
    expect(t1.getAttribute('aria-selected')).toBe('true');
    expect(t2.getAttribute('aria-selected')).toBe('false');
  });

  it('shows unread badge only on inactive sessions with unread > 0', () => {
    seed(
      {
        s1: { name: 'Alpha', unread: 5 },
        s2: { name: 'Beta', unread: 3 },
        s3: { name: 'Gamma', unread: 0 },
      },
      's1',
    );
    render(<SessionTabs />);
    // active, no badge even though unread>0
    expect(screen.queryByTestId('session-tab-unread-s1')).toBeNull();
    // inactive with unread > 0
    const badge = screen.getByTestId('session-tab-unread-s2');
    expect(badge.textContent).toBe('3');
    // inactive with zero unread
    expect(screen.queryByTestId('session-tab-unread-s3')).toBeNull();
  });

  it('calls onSelect when a tab is clicked', () => {
    seed(
      {
        s1: { name: 'Alpha', unread: 0 },
        s2: { name: 'Beta', unread: 1 },
      },
      's1',
    );
    const onSelect = vi.fn();
    render(<SessionTabs onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('session-tab-s2'));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('calls onClose without triggering onSelect when close button is clicked', () => {
    seed(
      {
        s1: { name: 'Alpha', unread: 0 },
      },
      's1',
    );
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<SessionTabs onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('session-tab-close-s1'));
    expect(onClose).toHaveBeenCalledWith('s1');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
