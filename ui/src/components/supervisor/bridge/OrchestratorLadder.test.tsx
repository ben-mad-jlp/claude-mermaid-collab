import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { OrchestratorLadder } from './OrchestratorLadder';

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

    fireEvent.click(screen.getByTestId('orchestrator-stop-on'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith({ project: projectB, level: 'on' });

    resolveB!(undefined);
    await waitFor(() => new Promise((r) => setTimeout(r, 0)));

    expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-level')).toBe('on');
    expect(screen.getByTestId('orchestrator-stop-on').getAttribute('data-active')).toBe('true');
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
});
