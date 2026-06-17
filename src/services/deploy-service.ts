/**
 * deploy-service — human-gated self-deploy of the running sidecar.
 *
 * Background (design land-deploy-hook-design): after a self-project epic lands,
 * the running :9002 binary is stale against master until someone runs
 * `npm run deploy`. This service is the one-click trigger — but it is
 * deliberately DECOUPLED from `landEpic`: land is an irreversible data mutation;
 * deploy is a disruptive, slow, retryable operational action. They never share a
 * button.
 *
 * THE CRUX: `scripts/deploy-desktop.sh` rebuilds the sidecar+UI, then `pkill -9`s
 * the whole app (including THIS process), swaps the binary, relaunches, and
 * health-checks the new sidecar. So the deploy KILLS the very process that
 * spawned it. We therefore spawn it FULLY DETACHED (own session via
 * `detached: true`, stdio redirected to a log file, then `unref()`), so the
 * deploy process is reparented away from this sidecar and survives its death.
 * This is the Phase-1 interim; Phase 2 moves ownership to the Electron main
 * process (sidecar-only hot-swap, app window never dies).
 *
 * Self-project hard gate: deploy is only ever run when `project` IS the
 * sidecar's own repo (MERMAID_PROJECT) AND that repo actually contains the
 * deploy script — never a silent deploy of another tracked repo. This gate lives
 * on the SERVER, not in the UI, so a crafted request can't bypass it.
 */
import { spawn } from 'node:child_process';
import { openSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

/**
 * package.json `name` of this very app. The self-project is identified by this
 * name — NOT by `project === MERMAID_PROJECT`. In the packaged desktop app the
 * sidecar's cwd (hence MERMAID_PROJECT) is the app bundle, never the source
 * checkout, so an equality check there is always false. Matching the target
 * repo's package name correctly identifies the collab source tree wherever it
 * lives, and rejects every other tracked repo (build123d, yolox, …).
 */
const SELF_PACKAGE_NAME = 'claude-mermaid-collab';

/** True when `project` is a checkout of THIS app's source repo. */
export function isSelfProject(project: string): boolean {
  try {
    const raw = readFileSync(join(project, 'package.json'), 'utf8');
    return (JSON.parse(raw) as { name?: unknown }).name === SELF_PACKAGE_NAME;
  } catch {
    return false;
  }
}

export interface DeployRequestResult {
  /** True when a detached deploy was actually launched. */
  ok: boolean;
  started: boolean;
  /** Machine-readable reason when not started. */
  reason:
    | 'ok'
    | 'not-self-project'
    | 'unsupported-platform'
    | 'deploy-script-missing'
    | 'spawn-failed';
  /** Absolute path to the deploy log (tail this to watch progress), when started. */
  logPath?: string;
  /** pid of the detached deploy process, when started. */
  pid?: number;
}

/** Relative path of the deploy script inside a self-project checkout. */
const DEPLOY_SCRIPT_REL = join('scripts', 'deploy-desktop.sh');

/**
 * Epoch-ms of the most recent self-project land, or null if none this process
 * lifetime. This is the PRECISE staleness signal the version-string `drift`
 * check misses: a land can advance master without a package.json version bump,
 * so `liveVersion === repoVersion` yet the binary is stale. If a self-land
 * happened AFTER the live sidecar started, the running binary cannot contain it.
 */
let lastSelfLandAt: number | null = null;

/** Record that a self-project epic just landed (called from landEpic). */
export function recordSelfLand(atMs: number): void {
  lastSelfLandAt = atMs;
}

/** The most recent self-land epoch-ms this process has seen, or null. */
export function getLastSelfLandAt(): number | null {
  return lastSelfLandAt;
}

/**
 * Launch a detached self-deploy. Returns immediately — the deploy runs
 * independently and will kill+relaunch this process. Callers should respond to
 * the client BEFORE the kill lands (the response races the pkill, but the
 * detached child owns the actual deploy regardless of whether the response
 * flushed).
 */
export interface DeployEligibility {
  eligible: boolean;
  reason: 'ok' | 'not-self-project' | 'unsupported-platform' | 'deploy-script-missing';
}

/**
 * The three hard gates, WITHOUT spawning — so the UI can decide whether to
 * even show a Deploy button. Same checks `requestSelfDeploy` enforces, so the
 * UI can never coax a deploy the server would reject.
 */
export function selfDeployEligibility(project: string): DeployEligibility {
  // Gate #1: must be a checkout of THIS app's source repo (by package name —
  // see isSelfProject). Deploying anyone else's repo from here is never correct.
  if (!isSelfProject(project)) return { eligible: false, reason: 'not-self-project' };
  // Gate #2: the deploy recipe is macOS-only (swaps into the installed .app).
  if (process.platform !== 'darwin') return { eligible: false, reason: 'unsupported-platform' };
  // Gate #3: the script must exist in this checkout. A packaged end-user
  // machine has no source repo, so this blocks deploy anywhere but a dev tree.
  if (!existsSync(join(project, DEPLOY_SCRIPT_REL))) {
    return { eligible: false, reason: 'deploy-script-missing' };
  }
  return { eligible: true, reason: 'ok' };
}

export function requestSelfDeploy(project: string): DeployRequestResult {
  const gate = selfDeployEligibility(project);
  if (!gate.eligible) {
    return { ok: false, started: false, reason: gate.reason as DeployRequestResult['reason'] };
  }
  const scriptPath = join(project, DEPLOY_SCRIPT_REL);

  const logDir = join(homedir(), '.mermaid-collab', 'deploy-logs');
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    /* best-effort; spawn below will fail loudly if the dir is unusable */
  }
  const logPath = join(logDir, 'self-deploy.log');

  // Phase-2 (49e3c1f6): under the Electron app (the desktop-control channel is in
  // our env) deploy in HOT-SWAP mode — the script asks main to restart only the
  // sidecar child so the app window never dies, and falls back to the full
  // relaunch on its own if that fails. A bare sidecar (no control channel) uses
  // the Phase-1 full relaunch.
  const underElectron = !!process.env.MC_DESKTOP_CONTROL_URL && !!process.env.MC_DESKTOP_CONTROL_TOKEN;
  const scriptArgs = underElectron ? [scriptPath, '--hot-swap'] : [scriptPath];

  try {
    const out = openSync(logPath, 'a');
    const child = spawn('bash', scriptArgs, {
      cwd: project,
      // Detach into its own process group/session so the deploy outlives a
      // sidecar restart (hot-swap kills the child; full-relaunch pkills the tree).
      detached: true,
      stdio: ['ignore', out, out],
      // Keep PATH etc. so bun/git/ditto resolve, AND the MC_DESKTOP_CONTROL_*
      // vars so the script can reach Electron main for the hot-swap.
      env: { ...process.env },
    });
    child.unref();
    return { ok: true, started: true, reason: 'ok', logPath, pid: child.pid };
  } catch {
    return { ok: false, started: false, reason: 'spawn-failed', logPath };
  }
}
