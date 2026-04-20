import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PRStatusBadge } from '../PRStatusBadge';
import { useAgentStore } from '../../../stores/agentStore';

describe('PRStatusBadge', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('renders PR number and url from store', () => {
    useAgentStore.getState().setPRStatus('sess-1', {
      number: 42,
      url: 'https://github.com/owner/repo/pull/42',
      checks: 'passing',
    });

    render(<PRStatusBadge sessionId="sess-1" />);

    const link = screen.getByRole('link', { name: /pull request #42/i });
    expect(link.textContent).toContain('#42');
    expect(link.getAttribute('href')).toBe('https://github.com/owner/repo/pull/42');
  });

  it('renders nothing when no PR exists for session', () => {
    const { container } = render(<PRStatusBadge sessionId="sess-missing" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('uses green color when checks are passing', () => {
    useAgentStore.getState().setPRStatus('sess-2', {
      number: 7,
      url: 'https://example.com/pr/7',
      checks: 'passing',
    });
    render(<PRStatusBadge sessionId="sess-2" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('style')).toContain('rgb(22, 163, 74)');
  });

  it('uses red color when checks are failing', () => {
    useAgentStore.getState().setPRStatus('sess-3', {
      number: 8,
      url: 'https://example.com/pr/8',
      checks: 'failing',
    });
    render(<PRStatusBadge sessionId="sess-3" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('style')).toContain('rgb(220, 38, 38)');
  });

  it('uses amber color when checks are pending', () => {
    useAgentStore.getState().setPRStatus('sess-4', {
      number: 9,
      url: 'https://example.com/pr/9',
      checks: 'pending',
    });
    render(<PRStatusBadge sessionId="sess-4" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('style')).toContain('rgb(217, 119, 6)');
  });
});
