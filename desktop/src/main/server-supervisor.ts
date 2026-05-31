import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface SupervisorOpts {
  repoRoot: string;
  project: string;
  session: string;
  host: string;
  port?: number;
  token?: string;
  cdpPort?: number;
  /** Injectable for tests. Defaults to node:child_process spawn. */
  spawnImpl?: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Health-poll overrides (mainly for tests). */
  healthTimeoutMs?: number;
  healthPollMs?: number;
  /** Prod: path to the compiled sidecar binary. When set, spawn it instead of `bun run src/server.ts`. */
  serverBinaryPath?: string;
  /** Prod: bundled resources dir (ui/dist, public) passed to the sidecar as MERMAID_RESOURCES_PATH. */
  resourcesPath?: string;
  /** Desktop control server URL passed to the sidecar as MC_DESKTOP_CONTROL_URL. */
  controlUrl?: string;
  /** Desktop control server auth token passed to the sidecar as MC_DESKTOP_CONTROL_TOKEN. */
  controlToken?: string;
  /** Prod: file to append sidecar stdout/stderr to, so startup failures are diagnosable. */
  logFilePath?: string;
}

const HEALTH_TIMEOUT_MS = 25_000;
const HEALTH_POLL_MS = 300;

/** Common user bin dirs that a GUI-launched PATH typically omits. */
function commonBinDirs(homeDir: string): string[] {
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    path.join(homeDir, '.bun', 'bin'),
    path.join(homeDir, '.local', 'bin'),
  ];
}

/** Prepend any of `dirs` not already present to the colon-joined `base` PATH. */
function prependDirs(base: string, dirs: string[]): string {
  const existing = base.split(':').filter(Boolean);
  const have = new Set(existing);
  return [...dirs.filter((d) => !have.has(d)), ...existing].join(':');
}

const PATH_SENTINEL = '__MC_LOGIN_PATH__';

/**
 * GUI-launched macOS apps (Finder, Dock, login items) inherit a minimal PATH —
 * `/usr/bin:/bin:/usr/sbin:/sbin` — with no Homebrew/nvm/asdf/bun dirs. The
 * sidecar then can't find user-installed tools, so e.g. `tmux` (Homebrew-only at
 * `/opt/homebrew/bin/tmux`) is missing and clicking a session opens a dead
 * terminal. Resolve the real login-shell PATH the way VS Code / the `shell-env`
 * package do — run the user's login+interactive shell so rc files that export
 * PATH are sourced — then merge in the common dirs as a backstop. Exported for
 * testing. On Windows, PATH semantics differ and the GUI inherits a full PATH,
 * so this is a no-op.
 */
export function resolveLoginPath(opts?: {
  currentPath?: string;
  platform?: NodeJS.Platform;
  shell?: string;
  homeDir?: string;
  execImpl?: (cmd: string, args: string[], options: { timeout: number; encoding: 'utf8' }) => string;
}): string {
  const currentPath = opts?.currentPath ?? process.env.PATH ?? '';
  const platform = opts?.platform ?? process.platform;
  const homeDir = opts?.homeDir ?? os.homedir();
  if (platform === 'win32') return currentPath;

  const dirs = commonBinDirs(homeDir);
  const shell = opts?.shell ?? process.env.SHELL ?? '/bin/zsh';
  const exec =
    opts?.execImpl ??
    ((cmd, args, options) =>
      execFileSync(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'ignore'] }).toString());

  try {
    // -i -l -c: interactive login shell so ~/.zprofile, ~/.zshrc, nvm, asdf, etc.
    // all run. Bracket PATH with a sentinel so rc-file chatter on stdout can't be
    // mistaken for the value.
    const script = `printf '%s' '${PATH_SENTINEL}'; printf '%s' "$PATH"; printf '%s' '${PATH_SENTINEL}'`;
    const out = exec(shell, ['-ilc', script], { timeout: 5_000, encoding: 'utf8' });
    const start = out.indexOf(PATH_SENTINEL);
    const end = out.indexOf(PATH_SENTINEL, start + PATH_SENTINEL.length);
    if (start !== -1 && end !== -1) {
      const resolved = out.slice(start + PATH_SENTINEL.length, end).trim();
      if (resolved.includes('/')) return prependDirs(resolved, dirs);
    }
  } catch {
    // Shell missing/slow/erroring — fall through to the static backstop.
  }
  return prependDirs(currentPath, dirs);
}

/** Memoized so we only pay the login-shell spawn once per app run. */
let cachedLoginPath: string | null = null;
function augmentedPath(): string {
  if (cachedLoginPath == null) cachedLoginPath = resolveLoginPath();
  return cachedLoginPath;
}

/** Resolve a free loopback port (lifted from the verified spike). */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Spawns and supervises the Bun collab server as a sidecar child process.
 * The server is deeply Bun-native, so it runs unchanged — we only own its
 * lifecycle (spawn / health / teardown).
 */
export class ServerSupervisor {
  private opts: SupervisorOpts;
  private spawnImpl: NonNullable<SupervisorOpts['spawnImpl']>;
  private fetchImpl: typeof fetch;
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private attached = false;
  /** Ring buffer of the most recent stderr lines, surfaced in the health-timeout error. */
  private stderrTail: string[] = [];
  private logStream: fs.WriteStream | null = null;

  constructor(opts: SupervisorOpts) {
    this.opts = opts;
    this.spawnImpl = opts.spawnImpl ?? spawn;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async start(): Promise<{ port: number; attached: boolean }> {
    const port = this.opts.port ?? Number(process.env.MERMAID_PORT ?? 9002);

    // Attach to an already-running server on the canonical port (e.g. started by
    // Claude's SessionStart hook or the CLI) rather than double-binding.
    try {
      const r = await this.fetchImpl(`http://${this.opts.host}:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) { this.port = port; this.attached = true; return { port, attached: true }; }
    } catch { /* not up — fall through to spawn */ }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Repair the minimal PATH a GUI/login-item launch inherits, so the sidecar
      // and its children (tmux, the PTY shells, git, claude) can find
      // user-installed tools. Without this, tmux is missing after a restart and
      // session terminals open dead.
      PATH: augmentedPath(),
      PORT: String(port),
      HOST: this.opts.host,
      MERMAID_PROJECT: this.opts.project,
      MERMAID_SESSION: this.opts.session,
      MERMAID_BIND_HOST: this.opts.host,
    };
    if (this.opts.cdpPort != null) {
      env.CDP_PORT = String(this.opts.cdpPort);
      env.MC_BROWSER_TARGET = 'electron-view';
    }
    if (this.opts.controlUrl) env.MC_DESKTOP_CONTROL_URL = this.opts.controlUrl;
    if (this.opts.controlToken) env.MC_DESKTOP_CONTROL_TOKEN = this.opts.controlToken;
    if (this.opts.token) {
      env.MERMAID_AUTH_TOKEN = this.opts.token;
    }

    // Prod: run the compiled sidecar binary directly, with assets resolved from
    // the bundled resources dir. Dev: `bun run src/server.ts` from the repo.
    let cmd: string;
    let args: string[];
    if (this.opts.serverBinaryPath) {
      cmd = this.opts.serverBinaryPath;
      args = [];
      if (this.opts.resourcesPath) env.MERMAID_RESOURCES_PATH = this.opts.resourcesPath;
    } else {
      cmd = 'bun';
      args = ['run', 'src/server.ts'];
    }

    this.child = this.spawnImpl(cmd, args, {
      cwd: this.opts.repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Tee sidecar output to a log file (best-effort) so a failed startup is
    // diagnosable on machines with no console — and keep a tail of stderr to
    // fold into the health-timeout error.
    if (this.opts.logFilePath) {
      try {
        this.logStream = fs.createWriteStream(this.opts.logFilePath, { flags: 'a' });
        this.logStream.write(`\n--- sidecar start ${new Date().toISOString()} (${cmd}) ---\n`);
      } catch { this.logStream = null; }
    }
    this.child.stdout?.on('data', (d: Buffer) => { this.logStream?.write(d); });
    this.child.stderr?.on('data', (d: Buffer) => {
      this.logStream?.write(d);
      for (const line of d.toString().split('\n')) {
        if (!line.trim()) continue;
        this.stderrTail.push(line);
        if (this.stderrTail.length > 40) this.stderrTail.shift();
      }
    });
    // If the process dies before health comes up, record the exit reason.
    this.child.on('exit', (code, signal) => {
      this.stderrTail.push(`[sidecar exited code=${code} signal=${signal}]`);
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });

    await this.waitForHealth(port);

    this.port = port;
    this.attached = false;
    return { port, attached: false };
  }

  private async waitForHealth(port: number): Promise<void> {
    const url = `http://${this.opts.host}:${port}/api/health`;
    const timeoutMs = this.opts.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
    const pollMs = this.opts.healthPollMs ?? HEALTH_POLL_MS;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((res) => setTimeout(res, pollMs));
    }
    try {
      this.child?.kill('SIGTERM');
    } catch {
      // ignore
    }
    const tail = this.stderrTail.join('\n').trim();
    const where = this.opts.logFilePath ? ` See ${this.opts.logFilePath}.` : '';
    const err = new Error(
      `The collaboration server did not respond within ${Math.round(timeoutMs / 1000)}s.${where}`,
    ) as Error & { detail?: string; logPath?: string };
    if (tail) err.detail = tail;
    if (this.opts.logFilePath) err.logPath = this.opts.logFilePath;
    throw err;
  }

  async stop(): Promise<void> {
    if (this.attached) return; // we didn't spawn it — don't kill it
    if (!this.child) return;
    const pid = this.child.pid;
    try {
      this.child.kill('SIGTERM');
    } catch {
      // ignore
    }
    if (process.platform === 'win32' && pid != null) {
      // No POSIX signals on Windows — kill the whole process tree.
      try {
        this.spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], {});
      } catch {
        // ignore
      }
    }
    this.child = null;
    try { this.logStream?.end(); } catch { /* ignore */ }
    this.logStream = null;
  }

  async isHealthy(): Promise<boolean> {
    if (this.port == null) return false;
    try {
      const r = await this.fetchImpl(`http://${this.opts.host}:${this.port}/api/health`);
      return r.ok;
    } catch {
      return false;
    }
  }
}
