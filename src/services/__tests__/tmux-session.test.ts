import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock tmux availability + the Bun.spawn used by tmuxOut.
vi.mock('../tmux-availability.ts', () => ({
  isTmuxAvailable: vi.fn(async () => true),
}));

import { healStaleTmuxSession } from '../tmux-session.ts';
import { isTmuxAvailable } from '../tmux-availability.ts';

/**
 * Drive healStaleTmuxSession by stubbing Bun.spawn. Each tmux invocation is
 * matched by its argv so we can assert which commands ran.
 */
function stubTmux(handlers: { hasSession: number; startPath?: string }) {
  const calls: string[][] = [];
  const spawn = vi.fn((argv: string[]) => {
    calls.push(argv);
    const sub = argv.slice(1); // drop 'tmux'
    let code = 0;
    let stdout = '';
    if (sub[0] === 'has-session') code = handlers.hasSession;
    else if (sub[0] === 'display-message') stdout = handlers.startPath ?? '';
    else if (sub[0] === 'kill-session') code = 0;
    return {
      stdout: new Response(stdout).body,
      exited: Promise.resolve(code),
    };
  });
  (globalThis as any).Bun = { spawn };
  return { calls };
}

describe('healStaleTmuxSession', () => {
  const origBun = (globalThis as any).Bun;
  beforeEach(() => vi.mocked(isTmuxAvailable).mockResolvedValue(true));
  afterEach(() => { (globalThis as any).Bun = origBun; vi.clearAllMocks(); });

  it('kills the session when its start dir differs from the project', async () => {
    const { calls } = stubTmux({ hasSession: 0, startPath: '/Applications/App/Contents/Resources' });
    const healed = await healStaleTmuxSession('mc-proj-sess', '/Users/me/proj');
    expect(healed).toBe(true);
    expect(calls.some((c) => c[1] === 'kill-session')).toBe(true);
  });

  it('does nothing when the start dir already matches the project', async () => {
    const { calls } = stubTmux({ hasSession: 0, startPath: '/Users/me/proj' });
    const healed = await healStaleTmuxSession('mc-proj-sess', '/Users/me/proj');
    expect(healed).toBe(false);
    expect(calls.some((c) => c[1] === 'kill-session')).toBe(false);
  });

  it('does nothing when the session does not exist', async () => {
    const { calls } = stubTmux({ hasSession: 1 });
    const healed = await healStaleTmuxSession('mc-proj-sess', '/Users/me/proj');
    expect(healed).toBe(false);
    expect(calls.some((c) => c[1] === 'kill-session')).toBe(false);
  });

  it('does nothing when tmux is unavailable', async () => {
    vi.mocked(isTmuxAvailable).mockResolvedValue(false);
    const spawn = vi.fn();
    (globalThis as any).Bun = { spawn };
    const healed = await healStaleTmuxSession('mc-proj-sess', '/Users/me/proj');
    expect(healed).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});
