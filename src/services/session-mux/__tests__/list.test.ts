/**
 * P3: mux.list() parsing — `#{session_name}\t#{session_created}` lines → SessionInfo[],
 * with tmux's epoch-seconds normalized to ms and "no server" → [].
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { TmuxSessionMux } from '../TmuxSessionMux.ts';

const origSpawn = Bun.spawn;

function stubSpawn(stdout: string, exitCode: number) {
  (Bun as any).spawn = () => ({
    stdout: new Response(stdout).body,
    exited: Promise.resolve(exitCode),
  });
}

describe('TmuxSessionMux.list()', () => {
  afterEach(() => { (Bun as any).spawn = origSpawn; });

  it('parses session_name + session_created (epoch s → ms)', async () => {
    stubSpawn('mc-repo-backendclaude1\t1781536357\nmc-repo-planner\t1781000000\n', 0);
    const sessions = await new TmuxSessionMux().list();
    expect(sessions).toEqual([
      { name: 'mc-repo-backendclaude1', createdAt: 1781536357000 },
      { name: 'mc-repo-planner', createdAt: 1781000000000 },
    ]);
  });

  it('returns [] when tmux exits non-zero (no server running)', async () => {
    stubSpawn('', 1);
    expect(await new TmuxSessionMux().list()).toEqual([]);
  });

  it('skips blank lines and tolerates a missing created field', async () => {
    stubSpawn('mc-a\t\n\nmc-b\t1781000000\n', 0);
    const sessions = await new TmuxSessionMux().list();
    expect(sessions).toEqual([
      { name: 'mc-a', createdAt: null },
      { name: 'mc-b', createdAt: 1781000000000 },
    ]);
  });
});
