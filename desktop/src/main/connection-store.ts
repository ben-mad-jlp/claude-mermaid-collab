import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

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
}

/** Minimal safeStorage surface so tests can supply a fake without Electron. */
export interface SafeStorageLike {
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

export interface ConnectionStoreOpts {
  userDataDir?: string;
  instancesDir?: string;
  safeStorage?: SafeStorageLike;
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
  private activeId: string | null = null;
  // host:port of local servers the user explicitly forgot, so refreshLocal
  // doesn't auto-re-add them while the instance is still alive.
  private forgotten = new Set<string>();
  private readonly userDataDir: string;
  private readonly instancesDir: string;
  private readonly safeStorage: SafeStorageLike;
  private readonly serversFile: string;

  constructor(opts: ConnectionStoreOpts = {}) {
    // Lazy-require electron only when defaults are needed, so tests can inject.
    this.userDataDir = opts.userDataDir ?? requireElectron().app.getPath('userData');
    this.instancesDir = opts.instancesDir ?? join(homedir(), '.mermaid-collab', 'instances');
    this.safeStorage = opts.safeStorage ?? requireElectron().safeStorage;
    this.serversFile = join(this.userDataDir, 'servers.json');
  }

  async init(): Promise<void> {
    await mkdir(this.userDataDir, { recursive: true });
    try {
      const raw = await readFile(this.serversFile, 'utf-8');
      const parsed = JSON.parse(raw) as { entries: PersistedEntry[]; activeId: string | null; forgotten?: string[] };
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
      this.activeId = parsed.activeId ?? null;
    } catch {
      // no file yet — empty store
    }
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
    });
    void this.persist();
    return id;
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    // Forgetting a still-running local server must stick — otherwise refreshLocal
    // re-adds it from the live registry. Manual servers just delete (no rediscovery).
    if (e?.source === 'local') this.forgotten.add(`${e.host}:${e.port}`);
    this.entries.delete(id);
    if (this.activeId === id) this.activeId = null;
    void this.persist();
  }

  setActive(id: string): void {
    if (!this.entries.has(id)) throw new Error(`unknown server id: ${id}`);
    this.activeId = id;
    void this.persist();
  }

  getActive(): ServerEntry | null {
    if (!this.activeId) return null;
    return this.entries.get(this.activeId) ?? null;
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
      } else {
        const id = randomUUID();
        this.entries.set(id, {
          id,
          label: localLabel,
          host: '127.0.0.1',
          port: inst.port,
          status: 'offline',
          source: 'local',
          lastProject: inst.project,
          lastSession: inst.session,
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
        if (this.activeId === id) this.activeId = null;
      }
    }
  }

  private async persist(): Promise<void> {
    const entries: PersistedEntry[] = Array.from(this.entries.values()).map((e) => {
      const { token, ...rest } = e;
      const p: PersistedEntry = { ...rest };
      if (token) p.encryptedToken = Array.from(this.safeStorage.encryptString(token));
      return p;
    });
    await mkdir(dirname(this.serversFile), { recursive: true });
    await writeFile(this.serversFile, JSON.stringify({ entries, activeId: this.activeId, forgotten: [...this.forgotten] }, null, 2));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireElectron(): any {
  // Indirection keeps electron out of the test path (tests inject userDataDir + safeStorage).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('electron');
}
