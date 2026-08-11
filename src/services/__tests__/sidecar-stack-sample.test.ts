/**
 * A watchdog kill must leave behind WHAT the sidecar was doing, not just that it stopped.
 *
 * MEASURED: 1154 recorded sidecar exits, 200 of them on 2026-08-08 alone, every one
 * `watchdog-unresponsive` with probe latencies pinned flat at the 5000ms timeout. The log
 * named the symptom and nothing else, so diagnosing the wedge meant guessing at commits.
 *
 * The last test is the one that matters: it runs the real sampler against a real process and
 * reads the output back. Asserting the argv alone would pass just as happily if `sample` were
 * misspelled, absent from the image, or rejecting our flags.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stackSampleCommand,
  formatStackSampleLine,
  formatDeathContext,
  DEFAULT_STACK_SAMPLE_SECONDS,
} from '../sidecar-forensics';

const TS = Date.parse('2026-08-11T04:05:06.789Z');

describe('stackSampleCommand', () => {
  it('targets the pid, bounds the duration, and writes to a named file', () => {
    const cmd = stackSampleCommand({ pid: 4321, dir: '/logs', ts: TS, platform: 'darwin' });
    expect(cmd).not.toBeNull();
    expect(cmd!.argv[0]).toBe('sample');
    expect(cmd!.argv[1]).toBe('4321');
    expect(cmd!.argv[2]).toBe(String(DEFAULT_STACK_SAMPLE_SECONDS));
    // -mayDie: we signal this process moments later; its disappearance is expected, not an error.
    expect(cmd!.argv).toContain('-mayDie');
    expect(cmd!.argv[cmd!.argv.length - 1]).toBe(cmd!.file);
  });

  it('names the file with a path-safe stamp — no colons from the ISO time', () => {
    const cmd = stackSampleCommand({ pid: 7, dir: '/logs', ts: TS, platform: 'darwin' });
    expect(cmd!.file.startsWith('/logs/')).toBe(true);
    expect(cmd!.file).not.toContain(':');
    expect(cmd!.file).toContain('pid7');
  });

  it('returns null off darwin so the kill proceeds instead of hanging on a missing sampler', () => {
    expect(stackSampleCommand({ pid: 1, dir: '/l', ts: TS, platform: 'linux' })).toBeNull();
    expect(stackSampleCommand({ pid: 1, dir: '/l', ts: TS, platform: 'win32' })).toBeNull();
  });

  it('refuses a nonsense pid rather than sampling something arbitrary', () => {
    for (const pid of [0, -1, 1.5, NaN]) {
      expect(stackSampleCommand({ pid, dir: '/l', ts: TS, platform: 'darwin' })).toBeNull();
    }
  });
});

describe('forensics lines', () => {
  it('records where the sample landed, so the log points at the file', () => {
    const line = formatStackSampleLine({ ts: TS, outcome: 'captured', file: '/logs/stack.txt' });
    expect(line).toContain('stack-sample outcome=captured');
    expect(line).toContain('file=/logs/stack.txt');
    expect(line).toContain('2026-08-11T04:05:06.789Z');
  });

  it('distinguishes the failure modes — a timeout is not a missing sampler', () => {
    expect(formatStackSampleLine({ ts: TS, outcome: 'timeout' })).toContain('outcome=timeout');
    expect(formatStackSampleLine({ ts: TS, outcome: 'unsupported' })).toContain('outcome=unsupported');
    expect(formatStackSampleLine({ ts: TS, outcome: 'failed', detail: 'ENOENT' })).toContain('detail=ENOENT');
  });

  it('death context reports a missing counter as `unknown`, never as a silent 0', () => {
    const line = formatDeathContext({ ts: TS, counts: { pid: 12, sessions: null, loadavg: '17.19' } });
    expect(line).toContain('pid=12');
    expect(line).toContain('sessions=unknown'); // a real 0 would be a finding; null is absence
    expect(line).toContain('loadavg=17.19');
  });
});

describe('the sampler actually works — asked of the OS, not of the argv', () => {
  it('captures a readable stack from a live process', async () => {
    if (process.platform !== 'darwin') return;
    const dir = mkdtempSync(join(tmpdir(), 'stack-sample-'));
    // A real, live, sleeping child: something with a stack to walk.
    const victim = Bun.spawn(['sleep', '30'], { stdout: 'ignore', stderr: 'ignore' });
    try {
      const cmd = stackSampleCommand({ pid: victim.pid, dir, ts: TS, seconds: 1 })!;
      const [bin, ...argv] = cmd.argv;
      const proc = Bun.spawn([bin, ...argv], { stdout: 'ignore', stderr: 'pipe' });
      const code = await proc.exited;

      expect(code).toBe(0);
      expect(existsSync(cmd.file)).toBe(true);
      const out = readFileSync(cmd.file, 'utf-8');
      // The whole point is a CALL STACK, not an empty file the exit code would still bless.
      expect(out.length).toBeGreaterThan(200);
      expect(out).toContain('Call graph');
    } finally {
      victim.kill();
    }
  }, 30_000);
});
