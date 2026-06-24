/**
 * PoolSizeControl tests — post-unification it drives the per-project in-flight CAP via
 * /api/leaf-executor/inflight-caps (so it agrees with the Executor "Concurrency Pools"),
 * not the legacy worker pool-size.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PoolSizeControl } from './PoolSizeControl';

afterEach(() => vi.restoreAllMocks());

describe('PoolSizeControl — per-project in-flight cap', () => {
  it('loads the projectMax from the inflight-caps endpoint and displays it', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ globalMax: 4, projectMax: 3 }) }) as any;
    render(<PoolSizeControl project="/abs/build123d" />);
    await waitFor(() => expect(screen.getByTestId('pool-size-value').textContent).toBe('3'));
    // Hits the canonical caps endpoint, NOT the legacy pool-size route.
    expect((global.fetch as any).mock.calls[0][0]).toContain('/api/leaf-executor/inflight-caps');
  });

  it('the + stepper POSTs an increased projectMax to the inflight-caps endpoint', async () => {
    const calls: Array<{ url: string; body?: any }> = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ globalMax: 4, projectMax: init?.method === 'POST' ? JSON.parse(init.body).projectMax : 2 }) });
    }) as any;
    render(<PoolSizeControl project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('pool-size-value').textContent).toBe('2'));
    fireEvent.click(screen.getByTestId('pool-size-inc'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/inflight-caps') && c.body?.projectMax === 3 && c.body?.project === '/abs/p')).toBe(true));
  });
});
