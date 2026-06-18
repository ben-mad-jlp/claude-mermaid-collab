import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServerSupervisor, resolveSecretsEnv, resolveFlagsEnv, wrapSidecarForWsl } from '../server-supervisor';

function fakeChild(pid = 12345) {
  const child: any = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

const okFetch = (async () => ({ ok: true })) as unknown as typeof fetch;
const failFetch = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

/** A /api/health fetch stub that returns the canonical identity block. */
function identityFetch(identity: { version?: string; pid?: number; exePath?: string; owner?: string }): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ ok: true, version: '5.90.1', pid: 1, exePath: '', owner: 'desktop', ...identity }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

const portFree = async () => false;
const portBusy = async () => true;

const baseOpts = {
  repoRoot: '/repo',
  project: '/repo',
  session: 's',
  host: '127.0.0.1',
  // Keep the port-ownership handshake off the real network in unit tests; each
  // case drives the probe + health response explicitly.
  portInUseImpl: portFree,
};

describe('ServerSupervisor', () => {
  // Isolate the port-ownership lockfile ($XDG_RUNTIME_DIR/mermaid-collab/server.lock)
  // to a fresh temp dir per test, so the handshake never reads/writes the real
  // shared lock — and can never SIGTERM the vitest worker by mistaking a lock
  // that records the worker's own pid for a hung server.
  let prevXdg: string | undefined;
  let tmpRuntime: string;
  beforeEach(() => {
    vi.restoreAllMocks();
    prevXdg = process.env.XDG_RUNTIME_DIR;
    tmpRuntime = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sup-'));
    process.env.XDG_RUNTIME_DIR = tmpRuntime;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (prevXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = prevXdg;
    fs.rmSync(tmpRuntime, { recursive: true, force: true });
  });

  it('start() spawns (attached=false) when the canonical port is free', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch });
    const { port, attached } = await sup.start();
    expect(port).toBe(9999);
    expect(attached).toBe(false);
    expect(spawnImpl).toHaveBeenCalledOnce();
    const [cmd, args] = spawnImpl.mock.calls[0];
    expect(cmd).toBe('bun');
    expect(args).toEqual(['run', 'src/server.ts']);
  });

  it('start() uses the provided port', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch });
    const { port } = await sup.start();
    expect(port).toBe(9999);
  });

  it('start() passes CDP_PORT + electron-view env when cdpPort is set', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, cdpPort: 7777, spawnImpl, fetchImpl: okFetch });
    await sup.start();
    const opts = spawnImpl.mock.calls[0][2] as any;
    expect(opts.env.CDP_PORT).toBe('7777');
    expect(opts.env.MC_BROWSER_TARGET).toBe('electron-view');
    expect(opts.env.PORT).toBe('9999');
    expect(opts.env.MERMAID_BIND_HOST).toBe('127.0.0.1');
  });

  it('start() rejects with health timeout and kills the child', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const sup = new ServerSupervisor({
      ...baseOpts, port: 9999, spawnImpl, fetchImpl: failFetch,
      healthTimeoutMs: 40, healthPollMs: 5,
    });
    await expect(sup.start()).rejects.toThrow('did not respond');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stop() sends SIGTERM for a spawned server', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch });
    await sup.start();
    await sup.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('isHealthy() reflects the fetch result', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch });
    await sup.start();
    expect(await sup.isHealthy()).toBe(true);
  });

  it('isHealthy() returns false before start()', async () => {
    const sup = new ServerSupervisor({ ...baseOpts, fetchImpl: okFetch });
    expect(await sup.isHealthy()).toBe(false);
  });

  it('start() attaches (no spawn) when a rightful same-version owner already holds the port', async () => {
    // Port busy + a health identity matching our version (empty self exePath in
    // dev → version match) → the handshake DEFERS and we attach.
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({
      ...baseOpts, port: 9999, spawnImpl,
      portInUseImpl: portBusy,
      fetchImpl: identityFetch({ version: '5.90.1', pid: 42 }),
      version: '5.90.1',
    });
    const { port, attached } = await sup.start();
    expect(port).toBe(9999);
    expect(attached).toBe(true);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('start() refuses when an unidentified process holds the port (no identity, not our lock)', async () => {
    // Port busy but /api/health gives no identity → held-by-unknown-process →
    // refuse rather than blindly killing an unknown process.
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({
      ...baseOpts, port: 9999, spawnImpl,
      portInUseImpl: portBusy,
      fetchImpl: failFetch,
    });
    await expect(sup.start()).rejects.toThrow('Refusing to start');
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('stop() is a no-op when attached to an existing instance', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({
      ...baseOpts, port: 9999, spawnImpl,
      portInUseImpl: portBusy,
      fetchImpl: identityFetch({ version: '5.90.1', pid: 42 }),
      version: '5.90.1',
    });
    await sup.start();
    await sup.stop(); // should not throw and nothing to kill
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  // --- Health-based liveness watchdog (drive-wedge recovery) ---
  // The acceptance: an alive-but-unresponsive sidecar is detected within the
  // threshold and kill -9 + respawned; a normal slow-start within the grace does
  // NOT trigger a false respawn. Ticks are driven deterministically via
  // checkHealthOnce() (disableHealthWatchdog keeps the real interval off).

  it('watchdog kill -9 + respawns a sidecar that is alive but unresponsive past the threshold', async () => {
    const child1 = fakeChild(111);
    const child2 = fakeChild(222);
    const spawnImpl = vi.fn().mockReturnValueOnce(child1).mockReturnValueOnce(child2);
    // Health passes for the initial start, then goes dark (the CPU peg).
    let healthy = true;
    const fetchImpl = (async () => {
      if (healthy) return { ok: true };
      throw new Error('frozen');
    }) as unknown as typeof fetch;
    const sup = new ServerSupervisor({
      ...baseOpts, port: 9999, spawnImpl, fetchImpl,
      disableHealthWatchdog: true,    // drive ticks manually
      healthWatchdogGraceMs: 0,       // no grace for this case
      healthWatchdogPollMs: 10,
      healthWatchdogThresholdMs: 30,  // 3 consecutive unhealthy ticks
      healthWatchdogTimeoutMs: 20,
    });
    await sup.start();
    expect(spawnImpl).toHaveBeenCalledOnce();

    healthy = false;                  // sidecar pegs — /health goes dark while alive
    expect(await sup.checkHealthOnce()).toBe('unhealthy'); // 10ms
    expect(await sup.checkHealthOnce()).toBe('unhealthy'); // 20ms
    expect(await sup.checkHealthOnce()).toBe('respawned'); // 30ms → kill+respawn
    expect(child1.kill).toHaveBeenCalledWith('SIGKILL');
    expect(spawnImpl).toHaveBeenCalledTimes(2);            // respawned a fresh sidecar
  });

  it('watchdog does NOT respawn during the startup grace even when /health is down (slow-start backfill)', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    let healthy = true;
    const fetchImpl = (async () => {
      if (healthy) return { ok: true };
      throw new Error('starting');
    }) as unknown as typeof fetch;
    const sup = new ServerSupervisor({
      ...baseOpts, port: 9999, spawnImpl, fetchImpl,
      disableHealthWatchdog: true,
      healthWatchdogGraceMs: 60_000,  // long grace (registry backfill window)
      healthWatchdogPollMs: 10,
      healthWatchdogThresholdMs: 10,  // would trip on the first miss but for the grace
    });
    await sup.start();
    healthy = false;
    expect(await sup.checkHealthOnce()).toBe('grace');
    expect(await sup.checkHealthOnce()).toBe('grace');
    expect(spawnImpl).toHaveBeenCalledOnce();   // no respawn during grace
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('watchdog leaves a healthy sidecar alone', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const sup = new ServerSupervisor({
      ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch,
      disableHealthWatchdog: true, healthWatchdogGraceMs: 0,
      healthWatchdogPollMs: 10, healthWatchdogThresholdMs: 10,
    });
    await sup.start();
    expect(await sup.checkHealthOnce()).toBe('healthy');
    expect(await sup.checkHealthOnce()).toBe('healthy');
    expect(spawnImpl).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('stop() halts the watchdog (no respawn after stop)', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const sup = new ServerSupervisor({
      ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch,
      disableHealthWatchdog: true, healthWatchdogGraceMs: 0,
      healthWatchdogPollMs: 10, healthWatchdogThresholdMs: 10,
    });
    await sup.start();
    await sup.stop();
    // After stop() the watchdog is inert — a tick is a no-op even if /health is down.
    expect(await sup.checkHealthOnce()).toBe('idle');
    expect(spawnImpl).toHaveBeenCalledOnce();
  });
});

describe('resolveSecretsEnv', () => {
  const cfg = '/fake/.mermaid-collab/config.json';
  const withFile = (json: string) => ({
    configPath: cfg,
    existsImpl: () => true,
    readFileImpl: () => json,
  });

  it('injects a secret from config.json when the launching env lacks it', () => {
    const out = resolveSecretsEnv({
      currentEnv: {},
      ...withFile(JSON.stringify({ XAI_API_KEY: 'xai-from-file' })),
    });
    expect(out).toEqual({ XAI_API_KEY: 'xai-from-file' });
  });

  it('does NOT override a key the launching env already provides (env wins)', () => {
    const out = resolveSecretsEnv({
      currentEnv: { XAI_API_KEY: 'xai-from-env' },
      ...withFile(JSON.stringify({ XAI_API_KEY: 'xai-from-file' })),
    });
    expect(out).toEqual({}); // nothing injected — explicit env override stands
  });

  it('treats an empty-string env value as missing and fills from the file', () => {
    const out = resolveSecretsEnv({
      currentEnv: { XAI_API_KEY: '' },
      ...withFile(JSON.stringify({ XAI_API_KEY: 'xai-from-file' })),
    });
    expect(out).toEqual({ XAI_API_KEY: 'xai-from-file' });
  });

  it('injects nothing when the config file is absent', () => {
    const out = resolveSecretsEnv({
      currentEnv: {},
      configPath: cfg,
      existsImpl: () => false,
      readFileImpl: () => { throw new Error('should not read'); },
    });
    expect(out).toEqual({});
  });

  it('injects nothing when the config file is corrupt', () => {
    const out = resolveSecretsEnv({
      currentEnv: {},
      ...withFile('{ not valid json'),
    });
    expect(out).toEqual({});
  });

  it('only injects the declared keys, ignoring other file entries', () => {
    const out = resolveSecretsEnv({
      currentEnv: {},
      keys: ['XAI_API_KEY'],
      ...withFile(JSON.stringify({ XAI_API_KEY: 'k', OTHER_SECRET: 'nope' })),
    });
    expect(out).toEqual({ XAI_API_KEY: 'k' });
  });
});

describe('resolveFlagsEnv (durable worker-isolation enable — 828a89a9)', () => {
  const cfg = '/fake/.mermaid-collab/config.json';
  const withFile = (json: string) => ({ configPath: cfg, existsImpl: () => true, readFileImpl: () => json });

  it('injects MERMAID_WORKER_ISOLATION from config.json when the env lacks it', () => {
    const out = resolveFlagsEnv({ currentEnv: {}, ...withFile(JSON.stringify({ MERMAID_WORKER_ISOLATION: '1' })) });
    expect(out).toEqual({ MERMAID_WORKER_ISOLATION: '1' });
  });

  it('stringifies a numeric or boolean flag value (1 / true both enable)', () => {
    expect(resolveFlagsEnv({ currentEnv: {}, ...withFile(JSON.stringify({ MERMAID_WORKER_ISOLATION: 1 })) }))
      .toEqual({ MERMAID_WORKER_ISOLATION: '1' });
    expect(resolveFlagsEnv({ currentEnv: {}, ...withFile(JSON.stringify({ MERMAID_WORKER_ISOLATION: true })) }))
      .toEqual({ MERMAID_WORKER_ISOLATION: 'true' });
  });

  it('does NOT override the flag when the launching env already sets it (env wins)', () => {
    const out = resolveFlagsEnv({
      currentEnv: { MERMAID_WORKER_ISOLATION: '0' },
      ...withFile(JSON.stringify({ MERMAID_WORKER_ISOLATION: '1' })),
    });
    expect(out).toEqual({}); // explicit env stands (e.g. a launchctl override)
  });

  it('injects nothing when the flag is absent / config missing', () => {
    expect(resolveFlagsEnv({ currentEnv: {}, ...withFile(JSON.stringify({ XAI_API_KEY: 'k' })) })).toEqual({});
    expect(resolveFlagsEnv({ currentEnv: {}, configPath: cfg, existsImpl: () => false, readFileImpl: () => { throw new Error('no'); } })).toEqual({});
  });
});

describe('wrapSidecarForWsl (Windows port P6 — sidecar-in-WSL)', () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    for (const k of ['MC_WSL_DISTRO', 'MC_WSL_REPO', 'MC_WSL_SERVER_BIN']) delete process.env[k];
    Object.assign(process.env, origEnv);
  });

  it('wraps bun launch in wsl.exe, crossing only sidecar env (not PATH)', () => {
    process.env.MC_WSL_DISTRO = 'Ubuntu-24.04';
    process.env.MC_WSL_REPO = '/home/ben/mermaid-collab';
    const { cmd, args } = wrapSidecarForWsl(
      'bun',
      ['run', 'src/server.ts'],
      { PORT: '9002', HOST: '127.0.0.1', PATH: 'C:\\Windows', MERMAID_PROJECT: '/p', MC_DESKTOP_CONTROL_TOKEN: 't', RANDOM: 'x' },
      'C:\\repo',
    );
    expect(cmd).toBe('wsl.exe');
    expect(args.slice(0, 5)).toEqual(['-d', 'Ubuntu-24.04', '--', 'bash', '-lc']);
    const script = args[5];
    expect(script).toContain("cd '/home/ben/mermaid-collab'");
    expect(script).toContain('exec bun');
    expect(script).toContain("export PORT='9002'");
    expect(script).toContain("export MERMAID_PROJECT='/p'");
    expect(script).toContain("export MC_DESKTOP_CONTROL_TOKEN='t'");
    // Windows PATH value must NOT cross into WSL. The script DOES set a
    // WSL-internal PATH prefix (export PATH="$HOME/.bun/bin:…:$PATH") so `bun`
    // resolves in the non-interactive login shell — that's a Linux-side $PATH
    // construction, not the crossed Windows env. Assert the Windows value is
    // absent and no crossed `export PATH='…'` (single-quoted env form) exists.
    expect(script).not.toContain('C:\\Windows');
    expect(script).not.toMatch(/export PATH='/);  // crossed-env form would be single-quoted
    expect(script).not.toContain('RANDOM=');  // non-sidecar vars excluded
  });

  it('defaults the WSL repo path to a /mnt/c translation of repoRoot', () => {
    const { args } = wrapSidecarForWsl('bun', ['run', 'src/server.ts'], { PORT: '9002' }, 'C:\\Users\\ben\\repo');
    expect(args[5]).toContain("cd '/mnt/c/Users/ben/repo'");
  });

  it('launches from source even if a Windows serverBinaryPath was chosen', () => {
    // caller passes the Windows binary; under WSL mode we ignore it and use bun+source
    const { args } = wrapSidecarForWsl('C:\\app\\mc-server.exe', [], { PORT: '9002' }, 'C:\\repo');
    expect(args[5]).toContain('exec bun');
    expect(args[5]).not.toContain('mc-server.exe');
  });

  it('honors MC_WSL_SERVER_BIN for a Linux-native sidecar binary', () => {
    process.env.MC_WSL_SERVER_BIN = '/opt/mc/mc-server';
    const { args } = wrapSidecarForWsl('bun', ['run', 'src/server.ts'], { PORT: '9002' }, 'C:\\repo');
    expect(args[5]).toContain('exec /opt/mc/mc-server');
  });
});
