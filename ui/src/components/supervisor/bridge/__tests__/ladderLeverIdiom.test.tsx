import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ConductorLadder } from '../ConductorLadder';

afterEach(() => vi.restoreAllMocks());

/** Route conductor / orchestrator / kick the same way ConductorLadder.test.tsx kick helpers do. */
function mockLadder(opts: {
  enabled: boolean;
  level?: string;
}) {
  const posts: { url: string; body: any }[] = [];
  global.fetch = vi.fn((url: any, init?: any) => {
    if (String(url).includes('/api/conductor/kick')) {
      if (init?.method === 'POST') {
        posts.push({ url: String(url), body: JSON.parse(init.body) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
    }
    if (init?.method === 'POST') {
      posts.push({ url: String(url), body: JSON.parse(init.body) });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, enabled: JSON.parse(init.body).enabled }),
      });
    }
    if (String(url).includes('/api/orchestrator/level')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: opts.level ?? 'on' }) });
    }
    if (String(url).includes('/api/supervisor/conductor')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: opts.enabled }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }) as any;
  return posts;
}

describe('ladder lever idiom', () => {
  it('one click on the conductor lever posts the flipped enabled value', async () => {
    const posts = mockLadder({ enabled: false, level: 'on' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('conductor-ladder').getAttribute('data-enabled')).toBe('false'),
    );
    fireEvent.click(screen.getByTestId('conductor-toggle'));
    await waitFor(() => expect(posts.length).toBeGreaterThan(0));
    expect(posts[0].body).toEqual({ project: '/abs/p', enabled: true });
  });

  it('the kick control still renders and posts', async () => {
    const posts = mockLadder({ enabled: true, level: 'on' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('conductor-kick'));
    await waitFor(() => expect(posts.some((p) => p.url.includes('/api/conductor/kick'))).toBe(true));
    const kick = posts.find((p) => p.url.includes('/api/conductor/kick'));
    expect(kick!.body).toEqual({ project: '/abs/p' });
  });

  it('the conductor lever is disabled while the daemon level reads off', async () => {
    const posts = mockLadder({ enabled: false, level: 'off' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('conductor-ladder').getAttribute('data-daemon-off')).toBe('true'),
    );
    expect(screen.getByTestId('conductor-toggle').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('conductor-toggle'));
    await new Promise((r) => setTimeout(r, 10));
    expect(posts).toEqual([]);
  });
});
