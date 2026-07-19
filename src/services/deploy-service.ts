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
import { openSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { listLeafInflight, reapStaleInflight } from './worker-ledger';
import { treeStatus } from './tree-integrity';
import { recordAutonomousMutation } from './autonomy-log';

/** B6 observability — record a deploy-gate refusal, fail-open (a throw here must never
 *  turn a safe refusal into an unsafe deploy or crash the gate). */
function recordDeployRefusal(project: string, reason: DeploySafetyRefusal): void {
  try {
    recordAutonomousMutation({ kind: 'deploy-refusal', actor: 'deploy-gate', reason, project, at: Date.now() });
  } catch { /* fail-open */ }
}

/**
 * Directory the deploy script + this service share for logs and the outcome
 * status file. Defaults to `~/.mermaid-collab/deploy-logs`; `MERMAID_DEPLOY_LOG_DIR`
 * overrides it (the deploy script honors the same env) so tests can point both
 * halves at a tmp dir. Keep this the SINGLE source of the path — the shell script
 * derives the identical default independently.
 */
export function deployLogDir(): string {
  return process.env.MERMAID_DEPLOY_LOG_DIR || join(homedir(), '.mermaid-collab', 'deploy-logs');
}

/** Absolute path of the machine-readable deploy-outcome file the script writes. */
export function deployStatusPath(): string {
  return join(deployLogDir(), 'self-deploy-status.json');
}

/**
 * Outcome of the most recent self-deploy, written by deploy-desktop.sh at its end
 * (and a `phase:'started'` marker written here at spawn). This is the signal that
 * turns a SILENT cosmetic deploy into a detectable one:
 *  - `ok:false` / `shadow:true` — a stale server shadowed :9002; the new binary
 *    never took over (Mode C).
 *  - `escalated:true` — a hot-swap left a wedged Electron main and the script had
 *    to fall back to the external full relaunch (Mode B).
 *  - `phase:'started'` with no later terminal write — the deploy was killed mid-run.
 */
export interface SelfDeployStatus {
  phase: 'started' | 'done';
  ok: boolean | null;
  mode?: 'hot-swap' | 'full';
  servedPid?: number | null;
  escalated?: boolean;
  shadow?: boolean;
  message?: string;
  ts: number;
  pid?: number;
}

/** Read the last self-deploy outcome, or null if none/unreadable/malformed. */
export function readSelfDeployStatus(): SelfDeployStatus | null {
  try {
    const raw = readFileSync(deployStatusPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const s = parsed as Record<string, unknown>;
    if (s.phase !== 'started' && s.phase !== 'done') return null;
    if (typeof s.ts !== 'number') return null;
    return parsed as SelfDeployStatus;
  } catch {
    return null;
  }
}

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
    | 'leaves-in-flight'
    | 'tree-does-not-match-head'
    | 'epic-mid-land'
    | 'spawn-failed';
  /** Absolute path to the deploy log (tail this to watch progress), when started. */
  logPath?: string;
  /** pid of the detached deploy process, when started. */
  pid?: number;
  /** When refused with 'leaves-in-flight': the leaf ids currently running (so the
   *  caller can show what would be hard-killed). Pass force to deploy anyway. */
  inflightLeaves?: string[];
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

/** A live-read precondition failure that makes a self-deploy unsafe (B2, fail-closed). */
export type DeploySafetyRefusal = 'leaves-in-flight' | 'tree-does-not-match-head' | 'epic-mid-land';

export type DeploySafetyResult =
  | { ok: true }
  | { ok: false; reason: DeploySafetyRefusal; inflightLeaves?: string[] };

export interface DeploySafetyDeps {
  reap?: () => void;
  inflight?: (project: string) => Array<{ leafId: string }>;
  tree?: (project: string) => ReturnType<typeof treeStatus>;
  epicMidLand?: (project: string) => boolean;
}

/** True iff a git merge is in progress in the checkout (`.git/MERGE_HEAD` present) — i.e. master is
 *  mid-land and in flux. Cheap fs probe; the self-deploy runs on the main checkout. */
export function isEpicMidLand(project: string): boolean {
  return existsSync(join(project, '.git', 'MERGE_HEAD'));
}

/** B2 — fail-CLOSED deploy safety gate. RE-READS live state at the decision point (never a stale
 *  briefing) and refuses unless EVERY precondition holds, naming the exact failing one:
 *   - no leaf in flight (reapStaleInflight drops phantom rows first) — a deploy hard-kills the sidecar
 *     and orphans a live leaf. This is the courtesy check `force` may bypass.
 *   - the working tree matches HEAD (git write-tree vs HEAD^{tree}) — never deploy a dirty/rolled-back
 *     tree (the land_epic_clobbers_working_tree P0). HARD safety — `force` never bypasses it.
 *   - no epic mid-land (no in-progress merge — master in flux). HARD safety.
 *  master-green is NOT re-checked here: the land pipeline verifies green before every land, so a
 *  landed master is green by construction; re-running tsc/tests would cost minutes for no added
 *  safety. Pure over injected reads (deps) so each precondition is unit-testable. */
export function deploySafetyGate(
  project: string,
  deps: DeploySafetyDeps = {},
  opts: { force?: boolean } = {},
): DeploySafetyResult {
  const reap = deps.reap ?? reapStaleInflight;
  const inflight = deps.inflight ?? ((p: string) => listLeafInflight({ project: p }));
  const tree = deps.tree ?? treeStatus;
  const epicMidLand = deps.epicMidLand ?? isEpicMidLand;

  if (!opts.force) {
    reap();
    const live = inflight(project);
    if (live.length > 0) {
      recordDeployRefusal(project, 'leaves-in-flight');
      return { ok: false, reason: 'leaves-in-flight', inflightLeaves: live.map((r) => r.leafId) };
    }
  }

  const st = tree(project);
  if (st.resolved && !st.match) {
    console.error(`[deploy] refused — working tree does not match HEAD\n  write-tree   ${st.workTree}\n  HEAD^{tree}  ${st.headTree}`);
    recordDeployRefusal(project, 'tree-does-not-match-head');
    return { ok: false, reason: 'tree-does-not-match-head' };
  }

  let midLand = true; // fail CLOSED if the probe throws (deploying is the exceptional act)
  try { midLand = epicMidLand(project); } catch { midLand = true; }
  if (midLand) {
    recordDeployRefusal(project, 'epic-mid-land');
    return { ok: false, reason: 'epic-mid-land' };
  }

  return { ok: true };
}

export function requestSelfDeploy(
  project: string,
  opts: { force?: boolean } = {},
): DeployRequestResult {
  const gate = selfDeployEligibility(project);
  if (!gate.eligible) {
    return { ok: false, started: false, reason: gate.reason as DeployRequestResult['reason'] };
  }
  // B2 — fail-closed live-read safety gate (refuse-while-building + tree-match + no-epic-mid-land).
  const safety = deploySafetyGate(project, {}, { force: opts.force });
  if (!safety.ok) {
    return { ok: false, started: false, reason: safety.reason, inflightLeaves: safety.inflightLeaves };
  }

  const scriptPath = join(project, DEPLOY_SCRIPT_REL);

  const logDir = deployLogDir();
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
    // Stamp a 'started' marker so a deploy killed mid-run (before the script writes
    // its terminal outcome) is detectable as an incomplete deploy rather than
    // reading a stale prior 'done'. The script overwrites this at the end.
    try {
      writeFileSync(
        deployStatusPath(),
        JSON.stringify({ phase: 'started', ok: null, mode: underElectron ? 'hot-swap' : 'full', ts: Date.now() }),
      );
    } catch {
      /* best-effort — a missing status file just reads as null downstream */
    }
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
