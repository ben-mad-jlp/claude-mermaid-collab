import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { OrchestratorLadder } from './OrchestratorLadder';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn((serverId: string, path: string, init?: any) => (global.fetch as any)(path, init)),
}));

import { apiFetch } from '@/lib/api';

afterEach(() => vi.restoreAllMocks());

describe('OrchestratorLadder', () => {
  it('a click before a late GET resolves keeps the POSTed level, not the stale response', async () => {
    const projectA = '/abs/a';
    const projectB = '/abs/b';
    const post = vi.fn();
    let resolveB: (v: any) => void;
    const pendingB = new Promise((r) => { resolveB = r; });

    global.fetch = vi.fn((url: any, init?: any) => {
      if (init?.method === 'POST') {
        post(JSON.parse(init.body));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      if (String(url).includes(encodeURIComponent(projectB))) {
        return pendingB.then(() => ({ ok: true, json: () => Promise.resolve({ level: 'off' }) }));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'off' }) });
    }) as any;

    const { rerender } = render(<OrchestratorLadder project={projectA} />);
    await waitFor(() =>
      expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-level')).toBe('off'),
    );

    rerender(<OrchestratorLadder project={projectB} />);
    await waitFor(() =>
      expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-project')).toBe(projectB),
    );

    fireEvent.click(screen.getByTestId('daemon-toggle'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith({ project: projectB, level: 'on' });

    resolveB!(undefined);
    await waitFor(() => new Promise((r) => setTimeout(r, 0)));

    expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-level')).toBe('on');
    expect(screen.getByTestId('daemon-toggle').getAttribute('data-lever-level')).toBe('on');
  });

  it("rerendering to a new project does not present the old project's level as loaded", async () => {
    const projectA = '/abs/a';
    const projectB = '/abs/b';
    const pendingB = new Promise(() => { /* never resolves */ });

    global.fetch = vi.fn((url: any, init?: any) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      if (String(url).includes(encodeURIComponent(projectB))) {
        return pendingB as any;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'on' }) });
    }) as any;

    const { rerender } = render(<OrchestratorLadder project={projectA} />);
    await waitFor(() =>
      expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-level')).toBe('on'),
    );

    rerender(<OrchestratorLadder project={projectB} />);

    const ladder = screen.getByTestId('orchestrator-ladder');
    expect(ladder.getAttribute('data-project')).toBe(projectB);
    expect(ladder.className).toContain('opacity-50');
  });

  it('reads the orchestrator level through the scoped server route', async () => {
    const project = '/abs/test';
    global.fetch = vi.fn((url: any, init?: any) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'off' }) });
    }) as any;

    render(<OrchestratorLadder project={project} serverScope="remote-1" />);

    await waitFor(() =>
      expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-level')).toBe('off'),
    );

    const getCall = (apiFetch as any).mock.calls.find((call: any[]) => call[1].includes('/api/orchestrator/level?'));
    expect(getCall).toBeDefined();
    expect(getCall[0]).toBe('remote-1');
  });

  it('posts a level change to the scoped server and rolls back when it fails', async () => {
    const project = '/abs/test';
    let postCall: any;

    global.fetch = vi.fn((url: any, init?: any) => {
      if (init?.method === 'POST') {
        postCall = { path: url, init };
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'off' }) });
    }) as any;

    render(<OrchestratorLadder project={project} serverScope="remote-1" />);

    await waitFor(() =>
      expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-level')).toBe('off'),
    );

    fireEvent.click(screen.getByTestId('daemon-toggle'));

    await waitFor(() => {
      expect(postCall).toBeDefined();
    });

    const postApiCall = (apiFetch as any).mock.calls.find(
      (call: any[]) => call[1] === '/api/orchestrator/level' && call[2]?.method === 'POST'
    );
    expect(postApiCall).toBeDefined();
    expect(postApiCall[0]).toBe('remote-1');
    expect(postApiCall[2].method).toBe('POST');
    const bodyObj = JSON.parse(postApiCall[2].body);
    expect(bodyObj).toEqual({ project, level: 'on' });

    await waitFor(() =>
      expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-level')).toBe('off'),
    );
  });
});
