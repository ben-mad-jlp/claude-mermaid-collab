import { describe, it, expect, vi } from 'vitest';
import { findChrome, ChromeManager, type ChromeProc } from '../chrome-manager.js';

describe('findChrome', () => {
  it('returns an explicit chromePath when it exists', () => {
    const bin = findChrome({ chromePath: '/custom/chrome', existsImpl: (p) => p === '/custom/chrome' });
    expect(bin).toBe('/custom/chrome');
  });

  it('throws when an explicit chromePath does not exist', () => {
    expect(() => findChrome({ chromePath: '/missing', existsImpl: () => false })).toThrow('MERMAID_CHROME_PATH');
  });

  it('finds the first existing platform binary (linux)', () => {
    const bin = findChrome({ platform: 'linux', existsImpl: (p) => p === '/usr/bin/chromium' });
    expect(bin).toBe('/usr/bin/chromium');
  });

  it('uses the macOS mdfind fallback when static paths miss', () => {
    const bin = findChrome({
      platform: 'darwin',
      existsImpl: (p) => p === '/Found/Chrome',
      mdfindImpl: () => '/Found/Chrome',
    });
    expect(bin).toBe('/Found/Chrome');
  });

  it('throws an actionable error when nothing is found', () => {
    expect(() => findChrome({ platform: 'linux', existsImpl: () => false })).toThrow('MERMAID_CHROME_PATH');
  });
});

function fakeProc(): ChromeProc & { kill: ReturnType<typeof vi.fn> } {
  let code: number | null = null;
  const kill = vi.fn(() => { code = 0; });
  return {
    pid: 4242,
    get exitCode() { return code; },
    kill,
  } as ChromeProc & { kill: ReturnType<typeof vi.fn> };
}

describe('ChromeManager', () => {
  it('start() spawns Chrome with CDP port + flags and resolves once CDP is reachable', async () => {
    const proc = fakeProc();
    const spawnImpl = vi.fn((_bin: string, _args: string[]) => proc);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 2) throw new Error('not up');
      return { ok: true };
    }) as unknown as typeof fetch;

    const cm = new ChromeManager({
      cdpPort: 9444, headless: true, spawnImpl, fetchImpl,
      findChromeImpl: () => '/fake/chrome', readyPollMs: 5, readyTimeoutMs: 2000,
    });
    await cm.start();

    expect(spawnImpl).toHaveBeenCalledOnce();
    const [bin, args] = spawnImpl.mock.calls[0];
    expect(bin).toBe('/fake/chrome');
    expect(args).toContain('--remote-debugging-port=9444');
    expect(args).toContain('--headless=new');
    expect(args.some((a: string) => a.startsWith('--user-data-dir='))).toBe(true);
    expect(cm.isAlive()).toBe(true);

    cm.stop();
    expect(proc.kill).toHaveBeenCalled();
    expect(cm.isAlive()).toBe(false);
  });

  it('start() rejects if Chrome exits before CDP is reachable', async () => {
    const proc = fakeProc();
    proc.kill(); // mark exited (exitCode 0)
    const cm = new ChromeManager({
      cdpPort: 9444, spawnImpl: () => proc,
      fetchImpl: (async () => { throw new Error('no'); }) as unknown as typeof fetch,
      findChromeImpl: () => '/fake/chrome', readyPollMs: 5, readyTimeoutMs: 500,
    });
    await expect(cm.start()).rejects.toThrow(/exited before CDP/);
  });

  it('omits --headless=new when not headless', async () => {
    const spawnImpl = vi.fn((_bin: string, _args: string[]) => fakeProc());
    const cm = new ChromeManager({
      cdpPort: 9444, headless: false, spawnImpl,
      fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
      findChromeImpl: () => '/fake/chrome', readyPollMs: 5,
    });
    await cm.start();
    expect(spawnImpl.mock.calls[0][1]).not.toContain('--headless=new');
    cm.stop();
  });
});
