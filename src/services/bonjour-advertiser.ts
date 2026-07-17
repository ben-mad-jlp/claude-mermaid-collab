import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { userInfo } from 'node:os';

/** The subset of a spawned child we hold + kill. Keeps the injected test double tiny. */
export interface ChildLike {
  kill(signal?: NodeJS.Signals | number): boolean;
  on?(event: string, listener: (...args: any[]) => void): unknown;
  pid?: number;
}
/** Injectable spawn seam. Real impl is node:child_process spawn; the test injects a spy. */
export type SpawnFn = (cmd: string, args: string[]) => ChildLike;

export interface BonjourAdvertiserOptions {
  port: number;
  /** Bind host the server is on — the loopback guard signal (config.HOST). */
  host?: string;
  /** Service instance name shown in the picker. Default 'MermaidCollab'. */
  name?: string;
}

const SERVICE_TYPE = '_mermaidcollab._tcp';
const DEFAULT_NAME = 'MermaidCollab';

let child: ChildLike | null = null;

/** True when `host` is loopback-only (127.x / ::1 / localhost / undefined→safe-skip).
 *  A loopback-bound server is unreachable on the LAN, so advertising is pointless. */
export function isLoopbackHost(host: string | undefined | null): boolean {
  if (!host) return true; // no host → be conservative, don't advertise
  const h = host.toLowerCase();
  return h === 'localhost' || h === '::1' || h.startsWith('127.') || h.startsWith('::ffff:127.');
}

/** os.userInfo().username, best-effort — falls back to 'unknown' if unavailable
 *  (e.g. restricted sandboxes where uid lookup throws). Never throws. */
export function safeUsername(): string {
  try {
    return userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Best-effort: publish the service via `dns-sd -R`. Never throws.
 * Returns the held child handle, or null when skipped (loopback) or spawn failed.
 * `spawnFn` is injectable for tests; defaults to a node:child_process spawn adapter.
 */
export function startBonjourAdvertiser(
  opts: BonjourAdvertiserOptions,
  spawnFn: SpawnFn = defaultSpawn,
): ChildLike | null {
  const { port, host, name } = opts;
  if (isLoopbackHost(host)) {
    console.warn(`[bonjour] skip advertise — loopback-only bind (${host ?? 'unset'})`);
    return null;
  }
  if (child) return child; // idempotent — already advertising
  const base = name && name.trim() ? name.trim() : DEFAULT_NAME;
  const user = safeUsername();
  const instance = `${base}-${user}-${port}`;
  // argv ARRAY — never a shell string; name/port are server-controlled.
  const args = ['-R', instance, SERVICE_TYPE, '.', String(port), 'proto=collab', 'v=1'];
  try {
    child = spawnFn('dns-sd', args);
    child.on?.('error', (err: unknown) => {
      // ENOENT (non-macOS / dns-sd missing) or spawn error — warn, never throw.
      console.warn(`[bonjour] dns-sd unavailable — advertiser disabled: ${String(err)}`);
      child = null;
    });
    console.log(`[bonjour] advertising ${instance} ${SERVICE_TYPE} on :${port}`);
    return child;
  } catch (err) {
    console.warn(`[bonjour] failed to spawn dns-sd — advertiser disabled: ${String(err)}`);
    child = null;
    return null;
  }
}

/** Kill the held child. Idempotent — safe to call when nothing is advertising. */
export function stopBonjourAdvertiser(): void {
  if (!child) return;
  try { child.kill(); } catch { /* already dead */ }
  child = null;
}

/** Real spawn adapter — long-lived child, stdio ignored. */
function defaultSpawn(cmd: string, args: string[]): ChildLike {
  return spawn(cmd, args, { stdio: 'ignore' }) as unknown as ChildProcess as ChildLike;
}
