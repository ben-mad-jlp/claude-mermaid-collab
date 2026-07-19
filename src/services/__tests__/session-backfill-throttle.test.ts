// Runs via `bun test`. Verifies the on-disk session-discovery/backfill scan inside
// SessionRegistry.list() (collectProjectRoots + discoverDiskSessions — synchronous fs walks
// across every project) fires at most once per SESSION_BACKFILL_INTERVAL_MS rather than on
// every ~30s list() poll. Uses a temp registry + real on-disk session dirs; the clock is
// injected so the throttle is exercised deterministically without real time.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRegistry, SESSION_BACKFILL_INTERVAL_MS, getWorkspacesDir } from '../session-registry';

let tmp: string;
let project: string;
let registryPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'backfill-throttle-'));
  project = join(tmp, 'proj');
  registryPath = join(tmp, 'sessions.json');
  mkdirSync(join(project, '.collab', getWorkspacesDir()), { recursive: true });
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

/** Create an on-disk session folder that discoverDiskSessions can pick up. */
function makeDiskSession(name: string): void {
  mkdirSync(join(project, '.collab', getWorkspacesDir(), name), { recursive: true });
}

describe('session-backfill throttle', () => {
  it('discovers a new on-disk session on the first list(), then SKIPS it within the interval', async () => {
    const reg = new SessionRegistry(registryPath);
    // Register 'aaa' so `project` is a known root the disk scan will walk.
    await reg.register(project, 'aaa');
    const t = 9_000_000;

    // First list() runs the backfill scan → sees the registered session.
    const first = await reg.list({ now: () => t });
    expect(first.some((s) => s.session === 'aaa')).toBe(true);

    // A new session appears on disk AFTER the scan already ran this interval.
    makeDiskSession('bbb');

    // Second list() within the interval must NOT re-scan → 'bbb' not backfilled yet.
    const second = await reg.list({ now: () => t + 1 });
    expect(second.some((s) => s.session === 'bbb')).toBe(false);
  });

  it('re-scans and discovers the new session once the injected clock advances past the interval', async () => {
    const reg = new SessionRegistry(registryPath);
    await reg.register(project, 'aaa');
    const t = 9_000_000;

    await reg.list({ now: () => t });        // first scan
    makeDiskSession('bbb');
    await reg.list({ now: () => t + 1 });     // throttled — bbb still hidden

    const third = await reg.list({ now: () => t + SESSION_BACKFILL_INTERVAL_MS });
    expect(third.some((s) => s.session === 'bbb')).toBe(true);
  });

  it('force:true bypasses the throttle even inside the interval', async () => {
    const reg = new SessionRegistry(registryPath);
    await reg.register(project, 'aaa');
    const t = 9_000_000;

    await reg.list({ now: () => t });        // first scan
    makeDiskSession('ccc');

    const forced = await reg.list({ now: () => t + 1, force: true });
    expect(forced.some((s) => s.session === 'ccc')).toBe(true);
  });
});
