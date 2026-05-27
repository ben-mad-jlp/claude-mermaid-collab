import { existsSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Server-side Chrome ownership for "owned-chrome" mode (Phase 7): when the
 * collab server runs on a remote/headless machine, it spawns and supervises its
 * own Chrome on CDP_PORT so the browser_* tools (which target 127.0.0.1:CDP_PORT)
 * work without any cross-network CDP. Logic is lifted from the VSCode extension's
 * proven spawn flags + cross-platform binary discovery.
 */

const CHROME_BINARIES_LINUX = [
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];
const CHROME_BINARIES_MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const CHROME_BINARIES_WIN = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? 'C:\\Users\\Default\\AppData\\Local'}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

export interface FindChromeOpts {
  chromePath?: string; // explicit override (MERMAID_CHROME_PATH)
  platform?: NodeJS.Platform;
  existsImpl?: (p: string) => boolean;
  mdfindImpl?: () => string | null; // macOS spotlight fallback; injectable for tests
}

/** Resolve a Chrome/Chromium binary path. Throws with an actionable message if none found. */
export function findChrome(opts: FindChromeOpts = {}): string {
  const platform = opts.platform ?? process.platform;
  const exists = opts.existsImpl ?? existsSync;

  if (opts.chromePath) {
    if (exists(opts.chromePath)) return opts.chromePath;
    throw new Error(`MERMAID_CHROME_PATH set but not found: ${opts.chromePath}`);
  }

  const bins = platform === 'darwin' ? CHROME_BINARIES_MAC
    : platform === 'win32' ? CHROME_BINARIES_WIN
    : CHROME_BINARIES_LINUX;
  for (const bin of bins) {
    if (bin && exists(bin)) return bin;
  }

  if (platform === 'darwin' && opts.mdfindImpl) {
    const found = opts.mdfindImpl();
    if (found && exists(found)) return found;
  }

  throw new Error(
    'No Chrome/Chromium binary found — install Chrome/Chromium or set MERMAID_CHROME_PATH'
  );
}

/** Minimal subprocess shape so Bun.spawn (and test fakes) both satisfy it. */
export interface ChromeProc {
  readonly pid?: number;
  readonly exitCode: number | null;
  kill(signal?: number | NodeJS.Signals): void;
}

export interface ChromeManagerOpts {
  cdpPort: number;
  headless?: boolean;
  chromePath?: string;
  /** Injectable for tests; defaults to Bun.spawn. */
  spawnImpl?: (bin: string, args: string[]) => ChromeProc;
  /** Injectable for tests; defaults to global fetch. Used to poll CDP readiness. */
  fetchImpl?: typeof fetch;
  findChromeImpl?: (opts: FindChromeOpts) => string;
  readyTimeoutMs?: number;
  readyPollMs?: number;
}

const DEFAULT_FLAGS = [
  '--remote-allow-origins=*',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-sync',
  '--safebrowsing-disable-auto-update',
];

export class ChromeManager {
  private opts: ChromeManagerOpts;
  private spawnImpl: NonNullable<ChromeManagerOpts['spawnImpl']>;
  private fetchImpl: typeof fetch;
  private proc: ChromeProc | null = null;
  private userDataDir: string | null = null;

  constructor(opts: ChromeManagerOpts) {
    this.opts = opts;
    this.spawnImpl = opts.spawnImpl ?? defaultSpawn;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  isAlive(): boolean {
    return !!this.proc && this.proc.exitCode === null;
  }

  async start(): Promise<void> {
    if (this.isAlive()) return;
    const bin = (this.opts.findChromeImpl ?? findChrome)({ chromePath: this.opts.chromePath });
    this.userDataDir = mkdtempSync(join(tmpdir(), 'mc-chrome-'));
    const args = [
      `--remote-debugging-port=${this.opts.cdpPort}`,
      `--user-data-dir=${this.userDataDir}`,
      ...DEFAULT_FLAGS,
      ...(this.opts.headless ? ['--headless=new'] : []),
      'about:blank',
    ];
    this.proc = this.spawnImpl(bin, args);
    await this.waitForCdp();
  }

  private async waitForCdp(): Promise<void> {
    const url = `http://127.0.0.1:${this.opts.cdpPort}/json/version`;
    const timeout = this.opts.readyTimeoutMs ?? 30_000;
    const poll = this.opts.readyPollMs ?? 300;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!this.isAlive()) throw new Error('Chrome exited before CDP became reachable');
      try {
        const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((res) => setTimeout(res, poll));
    }
    this.stop();
    throw new Error(`Chrome CDP not reachable on ${this.opts.cdpPort} within ${timeout}ms`);
  }

  stop(): void {
    if (this.proc && this.proc.exitCode === null) {
      try {
        this.proc.kill();
      } catch {
        // ignore
      }
    }
    this.proc = null;
    if (this.userDataDir) {
      try {
        rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      this.userDataDir = null;
    }
  }
}

function defaultSpawn(bin: string, args: string[]): ChromeProc {
  // Bun.spawn — matches the server's existing spawn sites; detached-ish, output ignored.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).Bun.spawn([bin, ...args], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
  return {
    get pid() { return proc.pid; },
    get exitCode() { return proc.exitCode; },
    kill: (signal?: number | NodeJS.Signals) => proc.kill(signal as number | undefined),
  };
}
