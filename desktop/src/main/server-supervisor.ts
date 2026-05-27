import net from 'node:net';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

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
  /** Seam for the supervisor-instance-dedup task. */
  discoveryImpl?: () => Promise<Array<{ project: string; session: string; port: number }>>;
  /** Health-poll overrides (mainly for tests). */
  healthTimeoutMs?: number;
  healthPollMs?: number;
  /** Prod: path to the compiled sidecar binary. When set, spawn it instead of `bun run src/server.ts`. */
  serverBinaryPath?: string;
  /** Prod: bundled resources dir (ui/dist, public) passed to the sidecar as MERMAID_RESOURCES_PATH. */
  resourcesPath?: string;
}

const HEALTH_TIMEOUT_MS = 25_000;
const HEALTH_POLL_MS = 300;

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

  constructor(opts: SupervisorOpts) {
    this.opts = opts;
    this.spawnImpl = opts.spawnImpl ?? spawn;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Detect an already-running server for this (project, session) — started by
   * Claude's SessionStart hook or the CLI — and return its port so we attach
   * instead of double-binding. Requires `discoveryImpl` (the app wires it to the
   * instance registry's readInstances); without it, we always spawn.
   * Only attaches if the discovered instance actually passes a health check.
   */
  private async checkExistingInstance(): Promise<number | null> {
    if (!this.opts.discoveryImpl) return null;
    let instances: Array<{ project: string; session: string; port: number }>;
    try {
      instances = await this.opts.discoveryImpl();
    } catch {
      return null;
    }
    const match = instances.find(
      (i) => i.project === this.opts.project && i.session === this.opts.session
    );
    if (!match) return null;
    try {
      const r = await this.fetchImpl(`http://${this.opts.host}:${match.port}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) return match.port;
    } catch {
      // discovered instance is stale/dead — fall through to spawn
    }
    return null;
  }

  async start(): Promise<{ port: number; attached: boolean }> {
    const existing = await this.checkExistingInstance();
    if (existing != null) {
      this.port = existing;
      this.attached = true;
      return { port: existing, attached: true };
    }

    const port = this.opts.port ?? (await getFreePort());

    const env: NodeJS.ProcessEnv = {
      ...process.env,
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
    this.child.stdout?.on('data', () => {});
    this.child.stderr?.on('data', () => {});

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
    throw new Error('server health timeout');
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
