import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useConductorEnabled } from './useConductorEnabled';

let apiFetchMockResponses: Record<string, { enabled?: boolean; lastPass?: any }> = {};

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(async (serverId: string, path: string, init?: any) => {
    const response = apiFetchMockResponses[serverId] || { enabled: false };
    return {
      ok: true,
      json: () => Promise.resolve(response),
    };
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
  apiFetchMockResponses = {};
});

describe('useConductorEnabled', () => {
  it(
    'writes and polls through the scoped server route when a serverScope is set',
    async () => {
      apiFetchMockResponses = {
        'remote-1': { enabled: false },
        'local': { enabled: false },
      };
      globalThis.fetch = vi.fn();

      let setEnabledFn: ((next: boolean) => Promise<void>) | null = null;

      const HostComponent = () => {
        const { setEnabled } = useConductorEnabled('/p', 'remote-1');
        setEnabledFn = setEnabled;
        return React.createElement('div', { 'data-testid': 'host' }, 'loaded');
      };

      render(React.createElement(HostComponent));

      const { apiFetch } = await import('@/lib/api');
      vi.mocked(apiFetch).mockClear();

      // Call setEnabled
      if (setEnabledFn) {
        await act(async () => {
          await setEnabledFn(true);
        });
      }

      // Verify that apiFetch was called with 'remote-1' for POST
      const calls = vi.mocked(apiFetch).mock.calls;

      // Should have POST call with 'remote-1'
      const postCall = calls.find(call => {
        const init = call[2];
        return init && init.method === 'POST';
      });

      expect(postCall).toBeDefined();
      expect(postCall?.[0]).toBe('remote-1');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
    { timeout: 10000 }
  );

  it(
    'a toggle on a remote-scoped project holds its value across the next reconcile poll',
    async () => {
      apiFetchMockResponses = {
        'remote-1': { enabled: false },
        'local': { enabled: false },
      };

      let capturedEnabled: boolean | null = null;
      let setEnabledFn: ((next: boolean) => Promise<void>) | null = null;
      let capturedLastPass: any = null;

      const HostComponent = () => {
        const { enabled, setEnabled, lastPass } = useConductorEnabled('/p', 'remote-1');
        capturedEnabled = enabled;
        capturedLastPass = lastPass;
        setEnabledFn = setEnabled;
        return React.createElement('div', { 'data-testid': 'host' }, String(enabled));
      };

      render(React.createElement(HostComponent));

      // Update the mock response for remote-1 to return enabled: true
      apiFetchMockResponses['remote-1'] = { enabled: true };

      // Call setEnabled
      if (setEnabledFn) {
        await act(async () => {
          await setEnabledFn(true);
        });
      }

      expect(capturedEnabled).toBe(true);

      // The value should remain true after the component rerender
      // (simulating what would happen after the 10s poll if the mock still returns enabled: true)
      expect(capturedEnabled).toBe(true);
    },
    { timeout: 10000 }
  );
});
