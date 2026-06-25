/**
 * DaemonProviderControl — per-project default provider toggle. Loads the current value
 * from node-provider and POSTs a change (inherit → null).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DaemonProviderControl } from './DaemonProviderControl';

afterEach(() => vi.restoreAllMocks());

describe('DaemonProviderControl', () => {
  it('loads the current project provider from node-provider', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ nodeProvider: 'grok-build', choices: ['claude', 'grok-build'] }) }) as any;
    render(<DaemonProviderControl project="/abs/p" />);
    await waitFor(() => expect((screen.getByTestId('daemon-provider-select') as HTMLSelectElement).value).toBe('grok-build'));
    expect((global.fetch as any).mock.calls[0][0]).toContain('/api/orchestrator/node-provider');
  });

  it('POSTs the chosen provider; selecting inherit sends null', async () => {
    const calls: Array<{ url: string; body?: any }> = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ nodeProvider: null, choices: ['claude', 'grok-build'] }) });
    }) as any;
    render(<DaemonProviderControl project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('daemon-provider-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('daemon-provider-select'), { target: { value: 'grok-build' } });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/node-provider') && c.body?.nodeProvider === 'grok-build' && c.body?.project === '/abs/p')).toBe(true),
    );
    fireEvent.change(screen.getByTestId('daemon-provider-select'), { target: { value: '' } });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/node-provider') && c.body?.nodeProvider === null)).toBe(true),
    );
  });
});
