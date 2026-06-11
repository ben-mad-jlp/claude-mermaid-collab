// One-command desktop deploy (`bun run deploy`).
//
// Deterministic + idempotent + verified redeploy of the packaged "Mermaid
// Collab.app" sidecar (mc-server) + UI bundle (ui/dist). Resolves review E1
// (design doc `design-deploy-script`): the old deploy was manual and footgun-
// laden (dirty-tree builds, orphaned sidecar on :9002, no health verification).
//
// Pipeline:
//   1. Cleanliness gate   — refuse a dirty tree unless --from-working-tree.
//   2. Build              — ui bundle + mc-server sidecar; ABORT before touching
//                           the bundle if either build fails (no half-swap).
//   3. Backup             — timestamped copy of current mc-server + ui/dist in
//                           the app Resources; prune to the last N.
//   4. Stop               — kill the running sidecar, POLL until :9002 is free.
//   5. Swap               — move the new mc-server + ui/dist into the bundle.
//   6. Relaunch           — open -a "Mermaid Collab".
//   7. Health-check       — poll until a NEW-PID server answers :9002 healthy;
//                           FAIL LOUDLY + offer --rollback if it doesn't.
//   8. Report             — old→new PID, deployed SHA, what swapped.
//
// `--rollback` restores the most recent backup of mc-server + ui/dist and
// restarts. macOS-only (uses `open`/`pkill`); the deploy target is a packaged
// desktop app, which only exists on the maintainer's Mac.

import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, cpSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const repoRoot = join(import.meta.dir, '..');
const PORT = Number(process.env.MERMAID_PORT ?? 9002);
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const APP_NAME = 'Mermaid Collab';
const BACKUPS_TO_KEEP = 5;

// Resolve the installed app bundle's Resources dir. Override with MC_APP_PATH
// (full path to the .app) for a non-default install location.
function resolveResourcesDir(): string {
  const candidates = [
    process.env.MC_APP_PATH ? join(process.env.MC_APP_PATH, 'Contents', 'Resources') : null,
    join('/Applications', `${APP_NAME}.app`, 'Contents', 'Resources'),
    join(process.env.HOME ?? '', 'Applications', `${APP_NAME}.app`, 'Contents', 'Resources'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(join(c, 'mc-server'))) return c;
  }
  fail(
    `Could not find an installed "${APP_NAME}.app" with a bundled mc-server.\n` +
      `Looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}\n` +
      `Set MC_APP_PATH=/path/to/${APP_NAME}.app to point at it.`,
  );
}

function fail(msg: string): never {
  console.error(`\n❌ deploy: ${msg}\n`);
  process.exit(1);
}
function log(msg: string): void {
  console.log(`▶ ${msg}`);
}

function sh(cmd: string, args: string[], opts: { cwd?: string; allowFail?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? repoRoot, encoding: 'utf8' });
  if (r.status !== 0 && !opts.allowFail) {
    fail(`\`${cmd} ${args.join(' ')}\` failed (exit ${r.status}):\n${r.stderr || r.stdout}`);
  }
  return (r.stdout ?? '').trim();
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// --- health / port helpers -------------------------------------------------

interface Health {
  healthy: boolean;
  pid: number;
}

/** Fetch /api/health, or null if nothing is answering. The server reports
 *  healthy:false when the Vite UI is down, but for deploy we only need the API
 *  (sidecar) up — so callers treat any 2xx with a pid as "alive". */
async function probeHealth(): Promise<Health | null> {
  try {
    const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const body = (await r.json()) as { healthy?: boolean; pid?: number };
    if (typeof body.pid !== 'number') return null;
    return { healthy: Boolean(body.healthy), pid: body.pid };
  } catch {
    return null;
  }
}

/** Poll until nothing answers on :9002 (the old sidecar is fully gone). */
async function waitForPortFree(timeoutMs = 15_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await probeHealth()) === null) return true;
    await sleep(300);
  }
  return false;
}

/** Poll until a server with a pid OTHER than oldPid answers healthy-enough. */
async function waitForNewPid(oldPid: number | null, timeoutMs = 30_000): Promise<Health | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const h = await probeHealth();
    if (h && h.pid !== oldPid) return h;
    await sleep(400);
  }
  return null;
}

function killSidecar(resourcesDir: string): void {
  // Match the bundled binary path so we never kill an unrelated process.
  const binPath = join(resourcesDir, 'mc-server');
  sh('pkill', ['-f', binPath], { allowFail: true });
}

function relaunch(resourcesDir: string): void {
  log(`relaunching "${APP_NAME}"…`);
  // Launch by FULL BUNDLE PATH, not `open -a "<name>"`: the name is ambiguous on
  // this machine (a Parallels WinApp shares it), which makes `open -a` fail with
  // LSOpenURLs error -600. The bundle is two levels up from its Resources dir.
  const appPath = join(resourcesDir, '..', '..');
  sh('open', [appPath], { allowFail: false });
}

// --- backup / swap helpers -------------------------------------------------

const SERVER = 'mc-server';
const UI = 'ui/dist';

function backupName(base: string, ts: number): string {
  return `${base}.bak-${ts}`;
}

/** Timestamped backup of the current mc-server + ui/dist; prune to last N. */
function backupCurrent(resourcesDir: string, ts: number): void {
  for (const rel of [SERVER, UI]) {
    const src = join(resourcesDir, rel);
    if (!existsSync(src)) continue;
    const dst = join(resourcesDir, backupName(rel, ts));
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
    log(`backed up ${rel} → ${backupName(rel, ts)}`);
  }
  pruneBackups(resourcesDir);
}

function listBackups(resourcesDir: string, base: string): { name: string; ts: number }[] {
  const prefix = `${base.split('/').pop()}.bak-`;
  return readdirSync(resourcesDir)
    .filter((n) => n.startsWith(prefix))
    .map((n) => ({ name: n, ts: Number(n.slice(prefix.length)) }))
    .filter((b) => Number.isFinite(b.ts))
    .sort((a, b) => b.ts - a.ts);
}

function pruneBackups(resourcesDir: string): void {
  // Server backups live directly in Resources as mc-server.bak-<ts>.
  for (const b of listBackups(resourcesDir, SERVER).slice(BACKUPS_TO_KEEP)) {
    rmSync(join(resourcesDir, b.name), { recursive: true, force: true });
  }
  // ui/dist backups live under Resources/ui as dist.bak-<ts>.
  const uiDir = join(resourcesDir, 'ui');
  if (existsSync(uiDir)) {
    for (const b of listBackups(uiDir, 'dist').slice(BACKUPS_TO_KEEP)) {
      rmSync(join(uiDir, b.name), { recursive: true, force: true });
    }
  }
}

/** Atomically-ish swap a freshly built artifact into the bundle. We move the
 *  current one aside (already backed up) then copy the new one in. */
function swapIn(resourcesDir: string, rel: string, newSrc: string): void {
  const dst = join(resourcesDir, rel);
  if (!existsSync(newSrc)) fail(`built artifact missing: ${newSrc}`);
  rmSync(dst, { recursive: true, force: true });
  cpSync(newSrc, dst, { recursive: true });
  log(`swapped ${rel}`);
}

// --- main flows ------------------------------------------------------------

async function doRollback(resourcesDir: string): Promise<void> {
  log('rolling back to most recent backup…');
  const serverBackups = listBackups(resourcesDir, SERVER);
  const uiDirParent = join(resourcesDir, 'ui');
  const uiBackups = existsSync(uiDirParent) ? listBackups(uiDirParent, 'dist') : [];
  if (serverBackups.length === 0 && uiBackups.length === 0) {
    fail('no backups found to roll back to.');
  }

  const oldHealth = await probeHealth();
  const oldPid = oldHealth?.pid ?? null;
  killSidecar(resourcesDir);
  if (!(await waitForPortFree())) fail(`port ${PORT} still busy after kill; aborting rollback.`);

  if (serverBackups[0]) {
    const from = join(resourcesDir, serverBackups[0].name);
    rmSync(join(resourcesDir, SERVER), { recursive: true, force: true });
    cpSync(from, join(resourcesDir, SERVER), { recursive: true });
    log(`restored ${SERVER} from ${serverBackups[0].name}`);
  }
  if (uiBackups[0]) {
    const from = join(uiDirParent, uiBackups[0].name);
    rmSync(join(resourcesDir, UI), { recursive: true, force: true });
    cpSync(from, join(resourcesDir, UI), { recursive: true });
    log(`restored ${UI} from ${uiBackups[0].name}`);
  }

  relaunch(resourcesDir);
  const h = await waitForNewPid(oldPid);
  if (!h) fail(`server did not come back healthy on :${PORT} after rollback.`);
  console.log(`\n✅ rollback complete — server up (pid ${h.pid}) on :${PORT}.\n`);
}

async function doDeploy(resourcesDir: string, fromWorkingTree: boolean): Promise<void> {
  // 1. Cleanliness gate.
  const dirty = sh('git', ['status', '--porcelain'], { allowFail: true });
  if (dirty && !fromWorkingTree) {
    fail(
      'working tree is dirty — refusing to deploy (the live binary would run ahead of any commit).\n' +
        'Commit/stash first, or re-run with --from-working-tree to deploy uncommitted changes.',
    );
  }
  const sha = sh('git', ['rev-parse', '--short', 'HEAD'], { allowFail: true }) || '(unknown)';
  log(`deploying SHA ${sha}${fromWorkingTree && dirty ? ' + uncommitted working-tree changes' : ''}`);

  // 2. Build (abort BEFORE touching the bundle on any failure).
  log('building ui bundle…');
  sh('bun', ['run', 'build'], { cwd: repoRoot }); // root "build" → cd ui && bun run build
  const builtUi = join(repoRoot, 'ui', 'dist');
  if (!existsSync(builtUi)) fail('ui build produced no ui/dist — aborting before bundle is touched.');

  log('building mc-server sidecar…');
  sh('bun', ['run', join('scripts', 'build-sidecar.ts')], { cwd: join(repoRoot, 'desktop') });
  const builtServer = join(repoRoot, 'desktop', 'resources', 'mc-server');
  if (!existsSync(builtServer)) fail('sidecar build produced no mc-server — aborting before bundle is touched.');

  // Capture current state for the report + restart.
  const oldHealth = await probeHealth();
  const oldPid = oldHealth?.pid ?? null;

  // 3. Backup current artifacts (timestamped, pruned).
  const ts = Math.floor(statSync(builtServer).mtimeMs); // stable, no Date.now()
  backupCurrent(resourcesDir, ts);

  // 4. Stop the running sidecar; poll until :9002 is free.
  log('stopping running sidecar…');
  killSidecar(resourcesDir);
  // Quitting the app is the clean path (Part 1 makes quit kill the sidecar);
  // pkill is the belt-and-suspenders for an orphaned/detached old binary.
  sh('osascript', ['-e', `tell application "${APP_NAME}" to quit`], { allowFail: true });
  if (!(await waitForPortFree())) {
    fail(`port ${PORT} still busy after stop — old sidecar would shadow the new binary. Aborting.`);
  }

  // 5. Swap new artifacts into the bundle.
  swapIn(resourcesDir, SERVER, builtServer);
  swapIn(resourcesDir, UI, builtUi);

  // 6. Relaunch.
  relaunch(resourcesDir);

  // 7. Health-check: a NEW pid must answer on :9002.
  log(`waiting for a fresh server on :${PORT}…`);
  const h = await waitForNewPid(oldPid);
  if (!h) {
    fail(
      `new server did not come up healthy on :${PORT} within timeout.\n` +
        `Run \`bun run deploy --rollback\` to restore the previous build.`,
    );
  }

  // 8. Report.
  console.log(
    `\n✅ deploy complete\n` +
      `   SHA:     ${sha}\n` +
      `   PID:     ${oldPid ?? '(none)'} → ${h.pid}\n` +
      `   swapped: mc-server, ui/dist\n` +
      `   backup:  *.bak-${ts} (keeping last ${BACKUPS_TO_KEEP})\n`,
  );
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    fail('deploy targets the packaged macOS desktop app and only runs on macOS.');
  }
  const args = new Set(process.argv.slice(2));
  const resourcesDir = resolveResourcesDir();

  if (args.has('--rollback')) {
    await doRollback(resourcesDir);
    return;
  }
  await doDeploy(resourcesDir, args.has('--from-working-tree'));
}

await main();
