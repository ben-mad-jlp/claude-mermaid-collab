import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ConductorStatusBadge } from './ConductorStatusBadge';

afterEach(() => vi.restoreAllMocks());

describe('ConductorStatusBadge', () => {
  it('renders nothing before the enabled state resolves', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any;
    render(<ConductorStatusBadge project="/abs/p" />);
    expect(screen.queryByTestId('conductor-status-badge')).toBeNull();
  });

  it('shows the enabled state with a success dot', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ enabled: true }) }) as any;
    render(<ConductorStatusBadge project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-status-badge')).toBeTruthy());
    const badge = screen.getByTestId('conductor-status-badge');
    expect(badge.getAttribute('data-enabled')).toBe('true');
    expect(badge.querySelector('span[aria-hidden="true"]')?.className).toContain('bg-success-500');
  });

  it('shows the disabled state with a gray dot', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ enabled: false }) }) as any;
    render(<ConductorStatusBadge project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-status-badge')).toBeTruthy());
    const badge = screen.getByTestId('conductor-status-badge');
    expect(badge.getAttribute('data-enabled')).toBe('false');
    expect(badge.querySelector('span[aria-hidden="true"]')?.className).toContain('bg-gray-400');
  });

  it('never issues a POST request', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ enabled: true }) }) as any;
    render(<ConductorStatusBadge project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-status-badge')).toBeTruthy());
    const calls = (global.fetch as any).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const init = call[1];
      expect(init?.method).not.toBe('POST');
    }
  });
});
