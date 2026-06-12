import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Socket } from 'node:net';

/** Mirrors src/services/instance-discovery.ts Instance (replicated, not imported — separate package). */
interface Instance {
  version: 1;
  sessionId: string;
  port: number;
  project: string;
  session: string;
  pid: number;
  startedAt: string;
  serverVersion: string;
}

export interface ServerCapabilities {
  tmux: boolean;
}

export interface ServerEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  token?: string;
  status: 'online' | 'offline' | 'connecting';
  lastProject?: string;
  lastSession?: string;
  source: 'local' | 'manual';
  /** Deterministic emoji icon assigned at add/discover time, persisted. */
  icon: string;
}

/**
 * Lucide icon-name pool for per-server icons. The store holds the NAME; the
 * renderer maps name → lucide component (`ui/src/components/ServerIcon.tsx`).
 * Names match `lucide-react`'s exported component names exactly.
 */
const ICON_POOL: readonly string[] = [
  'Circle', 'Square', 'Triangle', 'Diamond', 'Hexagon',
  'Star', 'Heart', 'Cloud', 'Sun', 'Moon',
  'Zap', 'Flame', 'Leaf', 'Flag', 'Anchor',
  'Box', 'Compass', 'Crown', 'Feather', 'Gem',
  'Globe', 'Key', 'Lock', 'Mountain', 'Rocket',
  'Shield', 'Snowflake', 'Sparkles', 'Target', 'Tent',
];

/** Pick an icon from the pool, preferring those not already taken. */
function pickIcon(taken: Set<string>): string {
  const available = ICON_POOL.filter((i) => !taken.has(i));
  const pool = available.length > 0 ? available : ICON_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Minimal safeStorage surface so tests can supply a fake without Electron. */
export interface SafeStorageLike {
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

/** Liveness shape passed to the instance-liveness probe. */
export interface InstanceLiveness {
  pid: number;
  port: number;
  host?: string;
}

export interface ConnectionStoreOpts {
  userDataDir?: string;
  instancesDir?: string;
  safeStorage?: SafeStorageLike;
  /**
   * Liveness probe for a discovered instance record. Defaults to a real
   * pid + TCP-port check; tests inject a deterministic stub. A record that
   * fails this is treated as a stale/phantom registration and excluded from
   * the local server list (so pruneLocalNotIn drops any existing entry).
   */
  isInstanceLive?: (inst: InstanceLiveness) => boolean | Promise<boolean>;
}

/** True iff `pid` is a running process (EPERM = exists but not ours = alive). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string })?.code === 'EPERM';
  }
}

/** True iff something is accepting TCP connections on host:port. */
function isPortListening(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (alive: boolean) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* best-effort */ }
      resolve(alive);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

/**
 * Default instance-liveness: the record's pid must still be running AND
 * something must be listening on its port. The port check is what distinguishes
 * a live server from a stale file whose pid was recycled (pid-alive, port-dead).
 */
async function defaultInstanceLive(inst: InstanceLiveness): Promise<boolean> {
  if (typeof inst.pid === 'number' && !isPidAlive(inst.pid)) return false;
  return isPortListening(inst.host ?? '127.0.0.1', inst.port);
}

interface PersistedEntry extends Omit<ServerEntry, 'token'> {
  encryptedToken?: number[]; // Buffer bytes
}

/**
 * Persisted list of collab servers the app can connect to. Tokens are encrypted
 * at rest via safeStorage and never leave the main process (list() omits them).
 * Local servers are auto-discovered from the ~/.mermaid-collab/instances registry.
 */
export class ConnectionStore {
  private entries = new Map<string, ServerEntry>();
  // Runtime-learned server capabilities (e.g. tmux support). NOT persisted —
  // re-detected on each app launch since features may be enabled/disabled
  // server-side between sessions.
  private capabilities = new Map<string, ServerCapabilities>();
  // host:port of local servers the user explicitly forgot, so refreshLocal
  // doesn't auto-re-add them while the instance is still alive.
  private forgotten = new Set<string>();
  private readonly userDataDir: string;
  private readonly instancesDir: string;
  private readonly safeStorage: SafeStorageLike;
  private readonly serversFile: string;
  private readonly isInstanceLive: (inst: InstanceLiveness) => boolean | Promise<boolean>;
  // Tail of the serialized persist chain. add()/remove() schedule a write
  // fire-and-forget for UI responsiveness, but every scheduled write is linked
  // here so a caller (e.g. before-quit) can `await flush()` for the final state
  // to actually hit disk. Writes are serialized to avoid interleaved truncation.
  private persistTail: Promise<void> = Promise.resolve();

  constructor(opts: ConnectionStoreOpts = {}) {
    // Lazy-require electron only when defaults are needed, so tests can inject.
    this.userDataDir = opts.userDataDir ?? requireElectron().app.getPath('userData');
    this.instancesDir = opts.instancesDir ?? join(homedir(), '.mermaid-collab', 'instances');
    this.safeStorage = opts.safeStorage ?? requireElectron().safeStorage;
    this.serversFile = join(this.userDataDir, 'servers.json');
    this.isInstanceLive = opts.isInstanceLive ?? defaultInstanceLive;
  }

  async init(): Promise<void> {
    await mkdir(this.userDataDir, { recursive: true });
    try {
      const raw = await readFile(this.serversFile, 'utf-8');
      // `activeId` may be present in legacy persisted files — ignored on read.
      const parsed = JSON.parse(raw) as { entries: PersistedEntry[]; forgotten?: string[] };
      this.entries.clear();
      this.forgotten = new Set(parsed.forgotten ?? []);
      for (const p of parsed.entries ?? []) {
        const { encryptedToken, ...rest } = p;
        const entry: ServerEntry = { ...rest };
        if (encryptedToken && encryptedToken.length > 0) {
          try {
            entry.token = this.safeStorage.decryptString(Buffer.from(encryptedToken));
          } catch {
            // undecryptable (e.g. keyring changed) — drop the token, keep the entry
          }
        }
        this.entries.set(entry.id, entry);
      }
    } catch {
      // no file yet — empty store
    }
    // Icon backfill / re-migration. Triggers when:
    // - the entry has no icon (first-time backfill on legacy stores), OR
    // - the entry's icon isn't in the current ICON_POOL (e.g. the previous
    //   pool was emoji; we've since switched to lucide icon names).
    // Compute `taken` incrementally so each new icon prefers unused ones,
    // and persist once at the end iff anything changed.
    let patched = false;
    const poolSet = new Set(ICON_POOL);
    const taken = new Set<string>();
    for (const e of this.entries.values()) {
      if (e.icon && poolSet.has(e.icon)) taken.add(e.icon);
    }
    for (const e of this.entries.values()) {
      if (!e.icon || !poolSet.has(e.icon)) {
        e.icon = pickIcon(taken);
        taken.add(e.icon);
        patched = true;
      }
    }
    if (patched) await this.persist();
  }

  private takenIcons(): Set<string> {
    const s = new Set<string>();
    for (const e of this.entries.values()) if (e.icon) s.add(e.icon);
    return s;
  }

  /** Renderer-facing list — never includes tokens. */
  list(): Array<Omit<ServerEntry, 'token'>> {
    return Array.from(this.entries.values()).map(({ token: _token, ...rest }) => rest);
  }

  get(id: string): ServerEntry | null {
    return this.entries.get(id) ?? null;
  }

  add(opts: { label: string; host: string; port: number; token?: string }): string {
    const id = randomUUID();
    this.entries.set(id, {
      id,
      label: opts.label,
      host: opts.host,
      port: opts.port,
      token: opts.token,
      status: 'offline',
      source: 'manual',
      icon: pickIcon(this.takenIcons()),
    });
    // Fire-and-forget for UI responsiveness; before-quit awaits flush() for durability.
    void this.persist().catch(() => {});
    return id;
  }

  /**
   * Set (or clear) the bearer token on an existing entry — used after a remote
   * launch generates a token the launched server now requires, so the existing
   * connection authenticates on its immediate reconnect. No-ops on unknown id.
   */
  setToken(id: string, token: string | undefined): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.token = token || undefined;
    void this.persist().catch(() => {});
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    // Forgetting a still-running local server must stick — otherwise refreshLocal
    // re-adds it from the live registry. Manual servers just delete (no rediscovery).
    if (e?.source === 'local') this.forgotten.add(`${e.host}:${e.port}`);
    this.entries.delete(id);
    this.capabilities.delete(id);
    // Fire-and-forget for UI responsiveness; before-quit awaits flush() for durability.
    void this.persist().catch(() => {});
  }

  getServerCapabilities(id: string): ServerCapabilities {
    // Optimistic default: assume tmux is available until the server's
    // create-terminal handler tells us otherwise via setServerCapabilities.
    // Returning false here caused a deadlock — the client gates create-terminal
    // on caps.tmux, so caps would never get learned.
    return this.capabilities.get(id) ?? { tmux: true };
  }

  /**
   * Persist a probe/liveness result onto the matching entry's status. The
   * mc:probeServer IPC reports reachability by host:port (the renderer can't
   * cross-origin fetch other servers) but never wrote it back, so even the live
   * local server read "offline". No-ops when the status is unchanged.
   */
  setStatusByHostPort(host: string, port: number, status: ServerEntry['status']): void {
    for (const e of this.entries.values()) {
      if (e.host === host && e.port === port) {
        if (e.status !== status) {
          e.status = status;
          void this.persist().catch(() => {});
        }
        return;
      }
    }
  }

  setServerCapabilities(id: string, caps: Partial<ServerCapabilities>): void {
    if (!this.entries.has(id)) return;
    const current = this.capabilities.get(id) ?? { tmux: false };
    this.capabilities.set(id, { ...current, ...caps });
  }

  /** Sync the `source:'local'` entries with the live instance registry. */
  async refreshLocal(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.instancesDir);
    } catch {
      // no registry dir — drop any stale local entries and return
      this.pruneLocalNotIn(new Set());
      return;
    }

    const liveKeys = new Set<string>();
    const manualKeys = new Set(
      Array.from(this.entries.values())
        .filter((e) => e.source === 'manual')
        .map((e) => `${e.host}:${e.port}`)
    );

    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      let inst: Instance;
      try {
        inst = JSON.parse(await readFile(join(this.instancesDir, f), 'utf-8')) as Instance;
      } catch {
        continue; // skip corrupt records
      }
      if (typeof inst.port !== 'number') continue;
      // Trust liveness, not file existence: a SIGKILL'd server leaves its
      // instance file behind (only graceful exit deletes it), which otherwise
      // mints a phantom "offline" local entry on a dead port forever. Skipping
      // a non-live record keeps it out of liveKeys so pruneLocalNotIn drops any
      // existing entry for it.
      if (!(await this.isInstanceLive({ pid: inst.pid, port: inst.port, host: '127.0.0.1' }))) continue;

      const key = `127.0.0.1:${inst.port}`;
      liveKeys.add(key);
      if (manualKeys.has(key)) continue; // a manual entry already covers this host:port
      if (this.forgotten.has(key)) continue; // user forgot this local server

      // Local servers are all on this machine — label by system hostname (the
      // host:port shown alongside disambiguates multiple local instances).
      const localLabel = hostname();
      const existing = Array.from(this.entries.values()).find(
        (e) => e.source === 'local' && `${e.host}:${e.port}` === key
      );
      if (existing) {
        existing.label = localLabel;
        existing.lastProject = inst.project;
        existing.lastSession = inst.session;
        // We just confirmed it's listening — reflect that so the live local
        // server doesn't read "offline" (it was initialized offline and the
        // probe result was never written back).
        existing.status = 'online';
      } else {
        const id = randomUUID();
        this.entries.set(id, {
          id,
          label: localLabel,
          host: '127.0.0.1',
          port: inst.port,
          status: 'online',
          source: 'local',
          lastProject: inst.project,
          lastSession: inst.session,
          icon: pickIcon(this.takenIcons()),
        });
      }
    }

    this.pruneLocalNotIn(liveKeys);
    await this.persist();
  }

  private pruneLocalNotIn(liveKeys: Set<string>): void {
    for (const [id, e] of this.entries) {
      if (e.source === 'local' && !liveKeys.has(`${e.host}:${e.port}`)) {
        this.entries.delete(id);
        this.capabilities.delete(id);
      }
    }
  }

  /**
   * Schedule a durable write. Serializes onto the persist chain and returns a
   * promise that resolves once THIS snapshot has been written, so callers can
   * either `void persist()` (fire-and-forget) or `await persist()`.
   */
  private persist(): Promise<void> {
    const next = this.persistTail.then(
      () => this.writeToDisk(),
      // A prior write failing must not poison the chain — log nothing here (the
      // writer already throws to its own awaiter) and proceed with this write.
      () => this.writeToDisk()
    );
    // Keep the tail un-rejected so flush() never rejects on a transient write error.
    this.persistTail = next.catch(() => {});
    return next;
  }

  /** Await all scheduled writes — call before quit so the final state is durable. */
  async flush(): Promise<void> {
    await this.persistTail;
  }

  private async writeToDisk(): Promise<void> {
    const entries: PersistedEntry[] = Array.from(this.entries.values()).map((e) => {
      const { token, ...rest } = e;
      const p: PersistedEntry = { ...rest };
      if (token) p.encryptedToken = Array.from(this.safeStorage.encryptString(token));
      return p;
    });
    await mkdir(dirname(this.serversFile), { recursive: true });
    await writeFile(this.serversFile, JSON.stringify({ entries, forgotten: [...this.forgotten] }, null, 2));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireElectron(): any {
  // Indirection keeps electron out of the test path (tests inject userDataDir + safeStorage).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('electron');
}
