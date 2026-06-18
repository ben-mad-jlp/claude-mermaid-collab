import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { performHandshake, serverOwner } from '../../../src/services/port-ownership';
import { buildWslSidecarCommand } from '../../../src/services/wsl/sidecar-launch';
import { winToWslPath } from '../../../src/services/session-mux/wsl-path';

/**
 * P6: transform a native sidecar launch into one that runs inside WSL. Crosses
 * only the sidecar's own env vars (the MERMAID_, MC_ and XAI_ prefixes, plus PORT,
 * HOST and CDP_PORT) — NOT the Windows PATH. The repo path inside WSL defaults to a /mnt/c translation
 * of repoRoot (override with MC_WSL_REPO for an ext4 checkout). When a Windows
 * `serverBinaryPath` was chosen it can't run in Linux, so under WSL mode we launch
 * from source (`bun run src/server.ts`) unless MC_WSL_SERVER_BIN names a Linux binary.
 */
export function wrapSidecarForWsl(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  repoRoot: string,
): { cmd: string; args: string[] } {
  const distro = process.env.MC_WSL_DISTRO || 'Ubuntu';
  const repoWslPath = process.env.MC_WSL_REPO || winToWslPath(repoRoot);
  const runtime = process.env.MC_WSL_SERVER_BIN
    ? { cmd: process.env.MC_WSL_SERVER_BIN, args: [] as string[] }
    : { cmd: 'bun', args: ['run', 'src/server.ts'] };
  const crossEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v == null || k === 'PATH') continue;
    if (/^(MERMAID_|MC_|XAI_)/.test(k) || k === 'PORT' || k === 'HOST' || k === 'CDP_PORT') {
      crossEnv[k] = v;
    }
  }
  return buildWslSidecarCommand({
    distro,
    repoWslPath,
    runtime,
    env: crossEnv,
    pathKeys: ['MERMAID_RESOURCES_PATH', 'MERMAID_CONFIG_PATH'],
  });
}

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
  /** Injectable for tests: probe whether the canonical port is already in use. Defaults to a real socket check. */
  portInUseImpl?: (port: number, host: string) => Promise<boolean>;
  /** Health-poll overrides (mainly for tests). */
  healthTimeoutMs?: number;
  healthPollMs?: number;
  /** Health-based liveness watchdog overrides (mainly for tests). */
  healthWatchdogPollMs?: number;
  healthWatchdogThresholdMs?: number;
  healthWatchdogGraceMs?: number;
  healthWatchdogTimeoutMs?: number;
  /** Disable the periodic watchdog interval (tests drive checkHealthOnce directly). */
  disableHealthWatchdog?: boolean;
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
  /** App/server version, used by the port-ownership handshake to tell a current owner from a stale shadow. */
  version?: string;
  /** Startup-progress callback — fired while the sidecar comes up so the loading
   *  screen can show live info (phase, elapsed, the latest sidecar.log line)
   *  instead of a bare spinner during the cold-start window. Best-effort. */
  onStartupProgress?: (info: { phase: 'spawning' | 'attached' | 'waiting'; elapsedMs: number; lastLog?: string }) => void;
}

// Give the sidecar a generous startup window before surfacing the health-timeout
// error in the desktop UI — a cold compiled mc-server (first launch, large bundle,
// DB migrations) can take well past 25s on a busy machine.
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 300;

// Health-based liveness watchdog (drive-wedge recovery). Poll cadence, the
// alive-but-unresponsive window that triggers a kill+respawn, the startup grace
// that protects a legitimate slow start (registry backfill) from a false respawn,
// and the per-probe timeout. All overridable via SupervisorOpts (mainly for tests).
const HEALTH_WATCHDOG_POLL_MS = 15_000;
const HEALTH_WATCHDOG_THRESHOLD_MS = 45_000;
const HEALTH_WATCHDOG_GRACE_MS = 90_000;
const HEALTH_WATCHDOG_TIMEOUT_MS = 5_000;

/**
 * Common user bin dirs that a GUI-launched PATH typically omits. Spans macOS
 * (Homebrew) and Linux (`/usr/bin`, `/snap/bin`) — dirs absent on a given
 * platform are harmless: prependDirs only adds them, and a non-existent PATH
 * entry is simply skipped by the OS during lookup.
 */
function commonBinDirs(homeDir: string): string[] {
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
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
  // Default login shell: macOS ships zsh, most Linux distros ship bash. $SHELL
  // still wins when set; this only picks the fallback when it isn't.
  const defaultShell = platform === 'linux' ? '/bin/bash' : '/bin/zsh';
  const shell = opts?.shell ?? process.env.SHELL ?? defaultShell;
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

/**
 * Secret/API keys the sidecar should inherit from the GUI-held config when the
 * launching environment doesn't already carry them. A Dock/Finder/login-item
 * launch starts with a clean env (no XAI_API_KEY), so without this the sidecar
 * — and the children it spawns (claude, consult_grok's reader) — can't see the
 * key the user entered in the desktop Settings UI. Keep this list in sync with
 * the keys the server's config-service reads.
 */
const INJECTED_SECRET_KEYS = ['XAI_API_KEY'] as const;
/**
 * Non-secret FEATURE FLAGS injected into the sidecar spawn the same way as
 * secrets. This is the DURABLE way to enable MERMAID_WORKER_ISOLATION (and future
 * flags) for a Dock-/login-launched sidecar: `launchctl setenv` is unreliable for
 * app-spawned children, so we read the flag from ~/.mermaid-collab/config.json and
 * inject it into the child env at spawn — surviving app restarts without a
 * standalone-sidecar/launchctl stopgap.
 */
const INJECTED_FLAG_KEYS = [
  'MERMAID_WORKER_ISOLATION',
  // Pool sizing (the parallelism dial) — injected the same durable way as the
  // isolation flag so a Dock-/login-launched sidecar honors config.json pool
  // overrides instead of silently reverting to the per-type defaults (backend=1)
  // on every app restart. pickEnvFromConfig only injects keys actually present in
  // config.json, so listing all of them here is safe when some are unset.
  'MERMAID_POOL_FRONTEND',
  'MERMAID_POOL_BACKEND',
  'MERMAID_POOL_API',
  'MERMAID_POOL_UI',
  'MERMAID_POOL_LIBRARY',
  'MERMAID_POOL_GENERAL',
] as const;

interface ConfigEnvOpts {
  currentEnv?: NodeJS.ProcessEnv;
  configPath?: string;
  keys?: readonly string[];
  readFileImpl?: (p: string) => string;
  existsImpl?: (p: string) => boolean;
}

/**
 * Shared core: pick `keys` from the GUI config file for any key the launching env
 * doesn't already provide. Honors config-service precedence (env → config.json):
 * a key already in the env is left untouched so an explicit override still wins;
 * only missing keys are filled from the file. Number/boolean values are
 * stringified (so `"MERMAID_WORKER_ISOLATION": 1` or `true` both work).
 */
function pickEnvFromConfig(keys: readonly string[], opts?: ConfigEnvOpts): Record<string, string> {
  const currentEnv = opts?.currentEnv ?? process.env;
  const configFile =
    opts?.configPath ??
    process.env.MERMAID_CONFIG_PATH ??
    path.join(os.homedir(), '.mermaid-collab', 'config.json');
  const exists = opts?.existsImpl ?? fs.existsSync;
  const read = opts?.readFileImpl ?? ((p: string) => fs.readFileSync(p, 'utf8'));

  let fileConfig: Record<string, unknown> = {};
  try {
    if (exists(configFile)) fileConfig = JSON.parse(read(configFile)) as Record<string, unknown>;
  } catch {
    // missing/unreadable/corrupt config — inject nothing; the server still falls
    // back to its own config-service read of the same file.
    fileConfig = {};
  }

  const out: Record<string, string> = {};
  for (const key of keys) {
    const envVal = currentEnv[key];
    if (envVal !== undefined && envVal !== '') continue; // env already wins — don't override
    const fileVal = fileConfig[key];
    if (typeof fileVal === 'string' && fileVal !== '') out[key] = fileVal;
    else if (typeof fileVal === 'number' || typeof fileVal === 'boolean') out[key] = String(fileVal);
  }
  return out;
}

/**
 * Secret env vars to inject into the sidecar spawn (XAI_API_KEY, …), read from
 * the GUI-held secrets file (~/.mermaid-collab/config.json, the same file the
 * desktop Settings "Secrets" tab writes). Env-wins precedence. Exported for testing.
 */
export function resolveSecretsEnv(opts?: ConfigEnvOpts): Record<string, string> {
  return pickEnvFromConfig(opts?.keys ?? INJECTED_SECRET_KEYS, opts);
}

/**
 * Feature-flag env vars to inject into the sidecar spawn (MERMAID_WORKER_ISOLATION,
 * …) from ~/.mermaid-collab/config.json, env-wins. The durable enable-isolation
 * path for a GUI-launched sidecar. Exported for testing.
 */
export function resolveFlagsEnv(opts?: ConfigEnvOpts): Record<string, string> {
  return pickEnvFromConfig(opts?.keys ?? INJECTED_FLAG_KEYS, opts);
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
  /** Ring buffer of the most recent sidecar output lines (stdout+stderr), surfaced
   *  in the health-timeout error AND as live loading-screen info. */
  private stderrTail: string[] = [];

  /** The latest meaningful sidecar output line — ANSI-stripped + truncated — for
   *  the loading screen's live startup readout. Empty until output arrives. */
  private lastLogLine(): string | undefined {
    for (let i = this.stderrTail.length - 1; i >= 0; i--) {
      // eslint-disable-next-line no-control-regex
      const clean = this.stderrTail[i].replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (clean) return clean.length > 120 ? clean.slice(0, 120) + '…' : clean;
    }
    return undefined;
  }
  private logStream: fs.WriteStream | null = null;
  /** ms-epoch the current sidecar child was spawned — the anchor the watchdog
   *  startup grace is measured from (re-stamped on every respawn). */
  private spawnedAt = 0;
  private healthWatchdog: ReturnType<typeof setInterval> | null = null;
  /** Accumulated alive-but-unresponsive time since the last healthy probe. */
  private unhealthyForMs = 0;
  private respawning = false;
  private stopped = false;

  constructor(opts: SupervisorOpts) {
    this.opts = opts;
    this.spawnImpl = opts.spawnImpl ?? spawn;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async start(): Promise<{ port: number; attached: boolean }> {
    const port = this.opts.port ?? Number(process.env.MERMAID_PORT ?? 9002);

    // Canonical :9002 take-over-or-refuse handshake (design-ubuntu-native §4),
    // replacing the old attach-blind hole that would happily attach to ANY server
    // on the port — including a stale plugin-cache `bun run src/server.ts` shadow
    // that made every deploy cosmetic. The handshake distinguishes a rightful
    // owner (attach, don't double-bind) from a stale/foreign shadow (evict it,
    // then spawn our own).
    // The self-identity here describes the SIDECAR this supervisor manages — the
    // compiled mc-server binary (prod) at serverBinaryPath, or no fixed path in
    // dev (`bun run src/server.ts`) — NOT the Electron process. In dev the empty
    // exePath makes the handshake fall back to a version match, so a healthy
    // same-version server attaches; a stale shadow (different binary / older
    // version) is evicted.
    const handshake = await performHandshake({
      host: this.opts.host,
      port,
      env: { ...process.env, PORT: String(port) },
      self: { exePath: this.opts.serverBinaryPath ?? '', version: this.opts.version ?? '', owner: serverOwner() },
      fetchImpl: this.fetchImpl,
      portInUseImpl: this.opts.portInUseImpl,
    });
    if (handshake.action === 'defer') {
      // A rightful owner already holds the port — attach to it rather than spawn.
      this.opts.onStartupProgress?.({ phase: 'attached', elapsedMs: 0 });
      this.port = port;
      this.attached = true;
      return { port, attached: true };
    }
    if (handshake.action === 'refuse') {
      throw new Error(
        `Refusing to start the collaboration server on :${port} — ${handshake.reason}. ` +
          `Another process owns the port and the guard is in refuse mode.`,
      );
    }
    // action === 'proceed' → the port is ours (was free, or a stale holder was evicted); spawn.
    this.stopped = false;
    this.opts.onStartupProgress?.({ phase: 'spawning', elapsedMs: 0 });
    this.spawnChild(port);
    await this.waitForHealth(port);

    this.port = port;
    this.attached = false;
    // Start the health-based liveness watchdog now that the sidecar is up. This is
    // the RECOVERY half of the drive-wedge fix: ServerSupervisor otherwise respawns
    // only on process EXIT, so a pegged-but-ALIVE hang (CPU spin, frozen HTTP/MCP)
    // never exits and sits wedged indefinitely (the 9h23m drive wedge, 2026-06-11).
    this.startHealthWatchdog();
    return { port, attached: false };
  }

  /**
   * Build the sidecar child env (secrets + durable flags + repaired PATH + the
   * port/host/project wiring). Extracted so the initial spawn and a watchdog
   * respawn produce an identical environment.
   */
  private buildChildEnv(port: number): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Inject GUI-held secrets (XAI_API_KEY, …) from ~/.mermaid-collab/config.json
      // for the keys this (often Dock-/login-launched, clean-env) process lacks.
      ...resolveSecretsEnv(),
      // Inject durable feature flags (MERMAID_WORKER_ISOLATION, …) from the same
      // config file, so they survive an app restart (env still wins if set).
      ...resolveFlagsEnv(),
      // Repair the minimal PATH a GUI/login-item launch inherits.
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
    if (this.opts.token) env.MERMAID_AUTH_TOKEN = this.opts.token;
    return env;
  }

  /**
   * Spawn the sidecar child and wire up log teeing + the stderr tail + the
   * exit-reason recorder. Sets this.child and stamps this.spawnedAt (the anchor the
   * watchdog startup grace is measured from). Does NOT wait for health — the initial
   * start() awaits waitForHealth explicitly; a watchdog respawn lets the watchdog
   * re-verify on its next tick.
   */
  private spawnChild(port: number): void {
    const env = this.buildChildEnv(port);
    // Prod: run the compiled sidecar binary directly, with assets resolved from the
    // bundled resources dir. Dev: `bun run src/server.ts` from the repo.
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

    // Windows port P6 (sidecar-in-WSL, decision 588c6df1): OPT-IN via
    // MC_SIDECAR_IN_WSL=1 — launch the sidecar INSIDE a WSL distro so it runs as a
    // native Linux process (TmuxSessionMux drives tmux-in-WSL with no wrapping).
    // Fully gated by win32 + the flag, so it never touches the proven mac/linux
    // path. Boot-validation pending a WSL2-capable host (the dev VM's WSL2 is
    // blocked by the Apple-Silicon/Parallels nested-virt wall).
    if (process.platform === 'win32' && process.env.MC_SIDECAR_IN_WSL === '1') {
      const wrapped = wrapSidecarForWsl(cmd, args, env, this.opts.repoRoot);
      cmd = wrapped.cmd;
      args = wrapped.args;
    }

    this.child = this.spawnImpl(cmd, args, {
      cwd: this.opts.repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.spawnedAt = Date.now();

    // Tee sidecar output to a log file (best-effort) so a failed startup is
    // diagnosable on machines with no console — and keep a tail of stderr to fold
    // into the health-timeout error.
    if (this.opts.logFilePath && !this.logStream) {
      try {
        this.logStream = fs.createWriteStream(this.opts.logFilePath, { flags: 'a' });
      } catch { this.logStream = null; }
    }
    this.logStream?.write(`\n--- sidecar start ${new Date().toISOString()} (${cmd}) ---\n`);
    const capture = (d: Buffer) => {
      this.logStream?.write(d);
      for (const line of d.toString().split('\n')) {
        if (!line.trim()) continue;
        this.stderrTail.push(line);
        if (this.stderrTail.length > 40) this.stderrTail.shift();
      }
    };
    // Capture BOTH streams into the tail — the sidecar's startup progress lines go
    // to stdout, and the loading screen surfaces the latest line (lastLogLine).
    this.child.stdout?.on('data', capture);
    this.child.stderr?.on('data', capture);
    // If the process dies before health comes up, record the exit reason.
    this.child.on('exit', (code, signal) => {
      this.stderrTail.push(`[sidecar exited code=${code} signal=${signal}]`);
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });
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
      // Surface live startup info to the loading screen — the latest sidecar.log
      // line (what the server is actually doing) + elapsed, so it isn't a bare
      // spinner through the cold-start window.
      this.opts.onStartupProgress?.({ phase: 'waiting', elapsedMs: Date.now() - start, lastLog: this.lastLogLine() });
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

  // --- Health-based liveness watchdog (drive-wedge recovery) ---------------------
  // The exit handler respawns the sidecar only when the process EXITS. A
  // pegged-but-alive hang (one thread at 98.8% CPU, HTTP/MCP frozen) never exits, so
  // without this it sits wedged indefinitely. This watchdog polls /api/health while
  // the process is alive and, if it is unresponsive for the threshold window (after
  // a startup grace covering a legitimate slow start / registry backfill), kill -9 +
  // respawns it — turning a multi-hour outage into a ~30s blip.

  /**
   * Single watchdog evaluation. Exposed (not private) so the deterministic unit
   * tests can drive it instead of waiting on a real interval. Returns a status
   * describing what it did this tick.
   */
  async checkHealthOnce(): Promise<'idle' | 'grace' | 'healthy' | 'exited' | 'unhealthy' | 'respawned'> {
    if (this.stopped || this.respawning) return 'idle';
    if (this.attached || !this.child || this.port == null) return 'idle';
    const port = this.port;
    // Startup grace: a fresh sidecar may still be doing heavy first-start work (e.g.
    // the per-start session-registry backfill) and not yet answering /health. Don't
    // count those misses — only a hang AFTER the process has had time to come up is a
    // real wedge.
    const graceMs = this.opts.healthWatchdogGraceMs ?? HEALTH_WATCHDOG_GRACE_MS;
    if (Date.now() - this.spawnedAt < graceMs) { this.unhealthyForMs = 0; return 'grace'; }

    const timeoutMs = this.opts.healthWatchdogTimeoutMs ?? HEALTH_WATCHDOG_TIMEOUT_MS;
    const healthy = await this.probeHealth(port, timeoutMs);
    if (healthy) { this.unhealthyForMs = 0; return 'healthy'; }
    // Unresponsive. If the process has already EXITED, that's the exit-respawn path's
    // job — don't double-handle it here.
    if (this.child.exitCode != null || this.child.signalCode != null) { this.unhealthyForMs = 0; return 'exited'; }

    const pollMs = this.opts.healthWatchdogPollMs ?? HEALTH_WATCHDOG_POLL_MS;
    this.unhealthyForMs += pollMs;
    const thresholdMs = this.opts.healthWatchdogThresholdMs ?? HEALTH_WATCHDOG_THRESHOLD_MS;
    if (this.unhealthyForMs >= thresholdMs) {
      await this.respawnHung(port);
      return 'respawned';
    }
    return 'unhealthy';
  }

  /** Probe /api/health with a hard timeout. true iff a 2xx came back in time. */
  private async probeHealth(port: number, timeoutMs: number): Promise<boolean> {
    try {
      const r = await this.fetchImpl(`http://${this.opts.host}:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Kill -9 the wedged (alive-but-unresponsive) sidecar and respawn it. The new
   *  process re-stamps spawnedAt so its own startup grace applies; the watchdog
   *  re-verifies health on subsequent ticks (no synchronous health wait here). */
  private async respawnHung(port: number): Promise<void> {
    this.respawning = true;
    try {
      const pid = this.child?.pid;
      try { this.child?.kill('SIGKILL'); } catch { /* ignore */ }
      if (process.platform === 'win32' && pid != null) {
        try { this.spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], {}); } catch { /* ignore */ }
      }
      this.child = null;
      this.unhealthyForMs = 0;
      // A stop() that landed mid-respawn must win — don't spawn a child the
      // teardown can no longer track.
      if (this.stopped) return;
      this.spawnChild(port);
    } finally {
      this.respawning = false;
    }
  }

  /**
   * Phase-2 hot-swap (todo 49e3c1f6): restart ONLY the sidecar child so the app
   * window never dies during a self-deploy. The deploy script builds + swaps the
   * mc-server binary in place, then asks Electron main to call this — we SIGKILL
   * the running child, wait for the port to free, then respawn from the (now
   * swapped) binary and wait for health. Returns true iff the new sidecar answers
   * healthy; on false the caller falls back to the full app relaunch, so a failed
   * hot-swap never strands the deploy. No-op (false) when we don't own the child
   * (attached mode) — we must not kill a server we didn't spawn.
   */
  async hotSwapRestart(): Promise<boolean> {
    // File-based diagnostics — the packaged app's main-process console isn't easily
    // captured, so append the hot-swap trace to a stable log the operator can tail.
    const hsLog = (m: string) => {
      const line = `[${new Date().toISOString()}] [hot-swap] ${m}`;
      console.log(line);
      try {
        const dir = path.join(os.homedir(), '.mermaid-collab', 'deploy-logs');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, 'hot-swap.log'), line + '\n');
      } catch { /* best-effort */ }
    };
    // No-op when we don't own the child: in attached mode we never spawned it, so
    // there's nothing of ours to swap (the deploy script falls back to a full
    // relaunch, which re-spawns under a fresh supervisor that DOES own it).
    if (this.attached || this.stopped || this.port == null) {
      hsLog(`declined — ${this.attached ? 'attached (not our child)' : this.stopped ? 'stopped' : 'no port'}`);
      return false;
    }
    const port = this.port;
    this.respawning = true;
    try {
      const pid = this.child?.pid;
      try { this.child?.kill('SIGKILL'); } catch { /* already gone */ }
      if (process.platform === 'win32' && pid != null) {
        try { this.spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], {}); } catch { /* ignore */ }
      }
      this.child = null;
      // Wait for the old sidecar to actually release the port (≤5s) so the respawn
      // can bind — probe until health stops answering.
      for (let i = 0; i < 50; i++) {
        if (!(await this.probeHealth(port, 300))) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      this.unhealthyForMs = 0;
      hsLog(`old child (pid ${pid ?? '?'}) killed; spawning new sidecar on :${port}`);
      this.spawnChild(port);
      // Poll for health OURSELVES (don't reuse waitForHealth — it SIGTERMs the child
      // on timeout, which would kill a slow-but-fine cold-starting compiled binary).
      // Generous budget: a freshly-built mc-server cold start (Bun warmup + registry
      // backfill) can take ~45-60s. On failure we leave the child for the liveness
      // watchdog and return false so the script falls back.
      const deadline = Date.now() + (this.opts.healthTimeoutMs ?? HEALTH_TIMEOUT_MS) + 30_000;
      while (Date.now() < deadline) {
        if (await this.probeHealth(port, 1500)) {
          hsLog('new sidecar healthy — window survived');
          this.startHealthWatchdog();
          return true;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      hsLog(`new sidecar did not reach health within budget (child exited? stderr tail: ${this.stderrTail.join(' | ').slice(-400)})`);
      return false;
    } catch (e) {
      hsLog(`error: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      this.respawning = false;
    }
  }

  /** (Re)start the periodic watchdog interval. No-op when disabled (tests drive
   *  checkHealthOnce directly). The interval is unref'd so it never keeps the
   *  process alive on its own. */
  private startHealthWatchdog(): void {
    this.stopHealthWatchdog();
    if (this.opts.disableHealthWatchdog) return;
    const pollMs = this.opts.healthWatchdogPollMs ?? HEALTH_WATCHDOG_POLL_MS;
    this.unhealthyForMs = 0;
    this.healthWatchdog = setInterval(() => { void this.checkHealthOnce(); }, pollMs);
    this.healthWatchdog.unref?.();
  }

  private stopHealthWatchdog(): void {
    if (this.healthWatchdog) {
      clearInterval(this.healthWatchdog);
      this.healthWatchdog = null;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopHealthWatchdog();
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

