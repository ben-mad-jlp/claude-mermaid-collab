import { describe, it, expect } from 'bun:test';
import { startPRStatusPoller, type SpawnFn } from '../pr-status-poller';

const goodJson = JSON.stringify({ number: 42, url: 'https://gh/42', statusCheckRollup: [], reviews: [] });

function fakeSpawn(result: { code: number; stdout: string; stderr?: string }): SpawnFn {
  return async () => ({ code: result.code, stdout: result.stdout, stderr: result.stderr ?? '' });
}

describe('pr-status-poller', () => {
  it('calls onUpdate with parsed status on first tick', async () => {
    const calls: any[] = [];
    const handle = startPRStatusPoller({
      sessionId: 's1',
      worktreePath: '/tmp/nonexistent',
      onUpdate: (s) => calls.push(s),
      intervalMs: 10000,
      spawn: fakeSpawn({ code: 0, stdout: goodJson }),
    });
    await new Promise((r) => setTimeout(r, 50));
    handle.stop();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].number).toBe(42);
    expect(calls[0].url).toBe('https://gh/42');
  });

  it('silent on non-zero exit', async () => {
    const calls: any[] = [];
    const handle = startPRStatusPoller({
      sessionId: 's1',
      worktreePath: '/tmp/nonexistent',
      onUpdate: (s) => calls.push(s),
      intervalMs: 10000,
      spawn: fakeSpawn({ code: 1, stdout: '', stderr: 'no pr' }),
    });
    await new Promise((r) => setTimeout(r, 30));
    handle.stop();
    expect(calls.length).toBe(0);
  });

  it('silent on malformed JSON', async () => {
    const calls: any[] = [];
    const handle = startPRStatusPoller({
      sessionId: 's1',
      worktreePath: '/tmp/nonexistent',
      onUpdate: (s) => calls.push(s),
      intervalMs: 10000,
      spawn: fakeSpawn({ code: 0, stdout: 'not json' }),
    });
    await new Promise((r) => setTimeout(r, 30));
    handle.stop();
    expect(calls.length).toBe(0);
  });

  it('stop prevents further ticks', async () => {
    const calls: any[] = [];
    const handle = startPRStatusPoller({
      sessionId: 's1',
      worktreePath: '/tmp/nonexistent',
      onUpdate: (s) => calls.push(s),
      intervalMs: 20,
      spawn: fakeSpawn({ code: 0, stdout: goodJson }),
    });
    await new Promise((r) => setTimeout(r, 30));
    handle.stop();
    const count = calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(calls.length).toBe(count);
  });

  it('passes cwd and correct argv to spawn', async () => {
    let captured: { cmd?: string[]; cwd?: string } = {};
    const handle = startPRStatusPoller({
      sessionId: 's1',
      worktreePath: '/some/wt',
      onUpdate: () => {},
      intervalMs: 10000,
      spawn: async (cmd, opts) => {
        captured = { cmd, cwd: opts.cwd };
        return { code: 0, stdout: goodJson, stderr: '' };
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    handle.stop();
    expect(captured.cwd).toBe('/some/wt');
    expect(captured.cmd?.[0]).toBe('gh');
    expect(captured.cmd).toContain('--json');
  });
});
