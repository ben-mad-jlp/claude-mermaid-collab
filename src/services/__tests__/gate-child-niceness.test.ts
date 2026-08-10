/**
 * Gate children must not be able to starve the sidecar that is judged on latency.
 *
 * MEASURED 2026-08-10: three watchdog SIGKILLs in fifteen minutes with ZERO gate runners and the
 * concurrency cap holding. Load 15 on 14 cores, dominated by ONE `vite` build inside an epic
 * worktree at 659% CPU. The probe latencies were a mixture (1818, 5000, 746, 1536, 515) rather
 * than pinned at the timeout — the signature of CPU starvation, not of a blocked event loop.
 *
 * The last test is the one that matters: it proves the child's scheduling priority is ACTUALLY
 * lowered, by asking the operating system. Asserting the argv shape alone would pass just as
 * happily if `nice` were spelled wrong or absent from the image.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { gateSpawnArgv, gateNiceness, DEFAULT_GATE_NICE } from '../leaf-gate';

const ORIGINAL = process.env.MERMAID_GATE_NICE;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MERMAID_GATE_NICE;
  else process.env.MERMAID_GATE_NICE = ORIGINAL;
});

describe('gate children are deprioritised below the sidecar', () => {
  it('wraps the lane in `nice`, preserving the command verbatim', () => {
    // `sh -c <command>` must survive intact — the command is project-declared and may contain
    // pipes, quoting and &&; splitting or re-quoting it would change what runs.
    const argv = gateSpawnArgv('cd ui && bun run build 2>&1 | tail -5', 10);
    expect(argv).toEqual(['nice', '-n', '10', 'sh', '-c', 'cd ui && bun run build 2>&1 | tail -5']);
  });

  it('0 disables the wrapper entirely, leaving the original argv', () => {
    expect(gateSpawnArgv('bun test', 0)).toEqual(['sh', '-c', 'bun test']);
  });

  it('refuses a NEGATIVE niceness instead of honouring it', () => {
    // Negative would raise gate children ABOVE the sidecar — the precise inversion of the point,
    // and it needs privilege the daemon does not have.
    process.env.MERMAID_GATE_NICE = '-5';
    expect(gateNiceness()).toBe(DEFAULT_GATE_NICE);
  });

  it('falls back to the default on an unparseable override', () => {
    for (const bad of ['', 'low', 'NaN']) {
      process.env.MERMAID_GATE_NICE = bad;
      expect(gateNiceness()).toBe(DEFAULT_GATE_NICE);
    }
  });

  it('honours a valid override', () => {
    process.env.MERMAID_GATE_NICE = '15';
    expect(gateNiceness()).toBe(15);
    expect(gateSpawnArgv('x')[2]).toBe('15');
  });

  it('ACTUALLY lowers the child\'s priority — asked of the OS, not of the argv', async () => {
    const read = async (argv: string[]) => {
      const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      return Number(out.trim());
    };
    // `ps -o nice= -p $$` reports the shell's own scheduling priority.
    const plain = await read(gateSpawnArgv('ps -o nice= -p $$', 0));
    const niced = await read(gateSpawnArgv('ps -o nice= -p $$', 10));

    expect(Number.isFinite(plain)).toBe(true);
    expect(niced).toBe(plain + 10); // the wrapper reaches the kernel, not just the argv array
  });
});
