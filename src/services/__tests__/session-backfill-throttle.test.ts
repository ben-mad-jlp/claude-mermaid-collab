// Runs via `bun test`. Verifies the on-disk session-discovery/backfill scan inside
// SessionRegistry.list() (collectProjectRoots + discoverDiskSessions — synchronous fs walks
// across every project) fires at most once per SESSION_BACKFILL_INTERVAL_MS rather than on
// every ~30s list() poll. Uses a temp registry + real on-disk session dirs; the clock is
// injected so the throttle is exercised deterministically without real time.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRegistry, SESSION_BACKFILL_INTERVAL_MS, ARTIFACTLESS_SESSION_MAX_AGE_MS, getWorkspacesDir } from '../session-registry';

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

/** Create an on-disk session folder that discoverDiskSessions can pick up.
 *  Backfill only recovers REAL workspaces (≥1 artifact file) — an empty dir is
 *  daemon debris and intentionally not resurrected — so seed one artifact. */
function makeDiskSession(name: string): void {
  const dir = join(project, '.collab', getWorkspacesDir(), name, 'documents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'note.md'), '# artifact');
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

describe('artifactless daemon-session hygiene', () => {
  it('an empty (artifactless) disk dir is NOT backfilled — deletion sticks', async () => {
    const reg = new SessionRegistry(registryPath);
    await reg.register(project, 'aaa');
    // Bare dir, the shape a daemon lane leaves behind (or a just-deleted session).
    mkdirSync(join(project, '.collab', getWorkspacesDir(), 'daemon-lane'), { recursive: true });
    const listed = await reg.list({ now: () => 9_000_000, force: true });
    expect(listed.some((s) => s.session === 'daemon-lane')).toBe(false);
  });

  it('an artifactless registered session past the max age self-cleans; one with artifacts survives', async () => {
    const reg = new SessionRegistry(registryPath);
    await reg.register(project, 'daemon-old');   // register() mkdirs empty typed subdirs
    await reg.register(project, 'real-old');
    writeFileSync(join(project, '.collab', getWorkspacesDir(), 'real-old', 'documents', 'kept.md'), 'x');
    const future = Date.now() + ARTIFACTLESS_SESSION_MAX_AGE_MS + 60_000;
    const listed = await reg.list({ now: () => future });
    expect(listed.some((s) => s.session === 'daemon-old')).toBe(false);
    expect(listed.some((s) => s.session === 'real-old')).toBe(true);
  });

  it('a FRESH artifactless session (just registered) is kept', async () => {
    const reg = new SessionRegistry(registryPath);
    await reg.register(project, 'fresh-empty');
    const listed = await reg.list({ now: () => Date.now() });
    expect(listed.some((s) => s.session === 'fresh-empty')).toBe(true);
  });
});
