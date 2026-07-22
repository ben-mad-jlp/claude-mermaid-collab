import { describe, it, expect, afterEach } from 'bun:test';
import { registerLeafProc, killLeafSubtree, _resetLeafProcRegistry } from '../leaf-subprocess-registry';

// REAL-process proof that the E1 mechanism actually works on this platform: a node is
// spawned `detached` (own process group → leader pid == pgid), so killLeafSubtree's
// process.kill(-pid) tears down the WHOLE subtree — the parent AND the child it forked
// (mirrors the `claude -p` CLI forking the model subprocess). Guards against a future
// Bun dropping `detached` support, which the mocked unit tests can't catch.

afterEach(() => _resetLeafProcRegistry());

async function aliveCount(pids: number[]): Promise<number> {
  const out = await new Response(
    Bun.spawn(['bash', '-c', `for p in ${pids.join(' ')}; do ps -p $p >/dev/null && echo x; done`], { stdout: 'pipe' }).stdout,
  ).text();
  return out.trim() ? out.trim().split('\n').length : 0;
}

describe('leaf-subprocess-registry (live process-group kill)', () => {
  it('killLeafSubtree kills the detached parent AND its forked child', async () => {
    // Parent forks a backgrounded child then sleeps — two pids in one group.
    const oldEnv = process.env.MERMAID_TEST_ALLOW_DETACHED;
    try {
      process.env.MERMAID_TEST_ALLOW_DETACHED = '1';
      const proc = Bun.spawn(['bash', '-c', 'sleep 30 & sleep 30'], {
        detached: true,
        stdout: 'ignore',
        stderr: 'ignore',
      } as Parameters<typeof Bun.spawn>[1]);
      const parent = proc.pid!;
      await Bun.sleep(250); // let the child fork

      const childList = (
        await new Response(Bun.spawn(['pgrep', '-P', String(parent)], { stdout: 'pipe' }).stdout).text()
      )
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(Number);
      const tree = [parent, ...childList];
      expect(await aliveCount(tree)).toBeGreaterThanOrEqual(2); // parent + ≥1 child alive

      registerLeafProc('LIVE', parent, '/p');
      expect(killLeafSubtree('LIVE')).toBe(true);
      await Bun.sleep(400); // SIGTERM propagates to the group

      expect(await aliveCount(tree)).toBe(0); // whole subtree gone
    } finally {
      if (oldEnv !== undefined) {
        process.env.MERMAID_TEST_ALLOW_DETACHED = oldEnv;
      } else {
        delete process.env.MERMAID_TEST_ALLOW_DETACHED;
      }
    }
  }, 10_000);
});
