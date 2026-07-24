/**
 * conductor-wake-gate — "has this lane actually MOVED?" for the conductor's INFRA arm.
 *
 * `runInfraRejectionArm` re-probes every INFRA-rejected candidate on EVERY conductor beat, and
 * that probe is not free: a cached `fail` past `BASE_GATE_FAIL_TTL_MS` re-runs the whole base
 * gate, and the arm's `cardsRaised`/`reset` output feeds `infraActed` in conductor-pass, which
 * BYPASSES the fingerprint debounce. A statically-red base therefore bought 19 conductor nodes
 * in 90 minutes — the loop never asked whether anything about the lane had changed.
 *
 * The wake signal must be a fact about the WORLD, not about the pass's own mutations: the epic
 * branch tip and the trunk tip. Both are read-only git probes; neither moves because the
 * conductor raised a card.
 *
 * Two fail-open properties are load-bearing:
 *   - a signature we cannot compute is {@link UNKNOWN_LANE_SIGNATURE} and NEVER produces a skip
 *     (an unreadable git is extra work, never a silently un-probed leaf);
 *   - the TTL arm is not padding. `shouldHonourCachedBaseGate` exists precisely so a base
 *     repaired WITHOUT a new commit (flake, contention, a fixed toolchain) still un-parks its
 *     leaves; a pure signature-equality gate would pin that self-heal off forever. Beat cadence
 *     is seconds-to-minutes, so a 30-minute floor still collapses ~19 probes to 1.
 */
import { pickBaseRef } from './epic-branch-status.js';
import {
  getEpicProbeSignature,
  BASE_GATE_FAIL_TTL_MS,
} from './worker-ledger.js';

/** Injectable git IO for {@link laneSignature}. Both defaults resolve their heavy dependencies
 *  lazily inside the async body, so importing this module stays cheap for the pass. */
export interface LaneSignatureIo {
  epicHeadSha: (epicId: string, targetProject: string) => Promise<string | null | undefined>;
  trunkHeadSha: (targetProject: string) => Promise<string | null | undefined>;
}

/** The signature we could not compute. Never persisted, never a skip. */
export const UNKNOWN_LANE_SIGNATURE = 'unknown';

/** How long a lane may sit un-probed on an UNCHANGED signature before the gate lets one probe
 *  through anyway. Mirrors the base-gate fail TTL: the same self-heal window, for the same
 *  reason (a base can be repaired without a commit). */
export const WAKE_GATE_REPROBE_TTL_MS = BASE_GATE_FAIL_TTL_MS;

/** Run git in `cwd`, returning { code, stdout }. Never throws, never hangs. Mirrors
 *  epic-branch-status' module-private runGit (async spawn — never spawnSync, which would pin
 *  the sidecar event loop). */
async function runGit(cwd: string, gitArgs: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const p = Bun.spawn(['git', ...gitArgs], { cwd, stdout: 'pipe', stderr: 'ignore' });
    const killTimer = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } }, 15_000);
    try {
      const [stdout, code] = await Promise.all([
        p.stdout ? new Response(p.stdout).text() : Promise.resolve(''),
        p.exited,
      ]);
      return { code: code ?? 1, stdout };
    } finally {
      clearTimeout(killTimer);
    }
  } catch {
    return { code: 1, stdout: '' };
  }
}

/** Resolve the LIVE lane IO, with any field overridden for tests. */
export function makeLaneSignatureIo(io?: Partial<LaneSignatureIo>): LaneSignatureIo {
  const epicHeadSha = io?.epicHeadSha ?? (async (epicId: string, targetProject: string) => {
    const { getWorktreeManager } = await import('./coordinator-live.js');
    return getWorktreeManager(targetProject).epicHeadSha(epicId);
  });
  const trunkHeadSha = io?.trunkHeadSha ?? (async (targetProject: string) => {
    // Same trunk picker the branch-status surface uses: a `main`-default repo has no `master`,
    // and a literal 'master' would resolve to nothing (a signature that never moves).
    const ref = await pickBaseRef(
      'master',
      async (r) => (await runGit(targetProject, ['rev-parse', '--verify', '--quiet', `refs/heads/${r}`])).code === 0,
      async () => {
        const r = await runGit(targetProject, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
        const short = r.code === 0 ? r.stdout.trim().replace(/^origin\//, '') : '';
        return short || null;
      },
    );
    const r = await runGit(targetProject, ['rev-parse', ref]);
    if (r.code !== 0) return null;
    return r.stdout.trim() || null;
  });
  return { epicHeadSha, trunkHeadSha };
}

/**
 * The lane's world-state fingerprint: `${epicSha}:${trunkSha}`.
 *
 * Returns {@link UNKNOWN_LANE_SIGNATURE} when either sha is missing or anything throws —
 * FAIL-OPEN, because an unknown signature must always probe.
 */
export async function laneSignature(
  epicId: string,
  targetProject: string,
  io?: Partial<LaneSignatureIo>,
): Promise<string> {
  try {
    const resolved = makeLaneSignatureIo(io);
    const [epicSha, trunkSha] = await Promise.all([
      resolved.epicHeadSha(epicId, targetProject),
      resolved.trunkHeadSha(targetProject),
    ]);
    if (!epicSha || !trunkSha) return UNKNOWN_LANE_SIGNATURE;
    return `${epicSha}:${trunkSha}`;
  } catch {
    return UNKNOWN_LANE_SIGNATURE;
  }
}

/**
 * Should this epic's base be re-probed on this beat?
 *
 * `true` (probe) when: the signature is unknown, no row exists, the stored signature differs,
 * or the stored probe is older than {@link WAKE_GATE_REPROBE_TTL_MS}. Any ledger fault also
 * returns `true` — a broken read degrades to extra work, never a skipped probe.
 */
export function shouldReprobeEpicBase(args: {
  epicId: string;
  project: string;
  signature: string;
  now?: number;
}): boolean {
  if (args.signature === UNKNOWN_LANE_SIGNATURE) return true;
  try {
    const row = getEpicProbeSignature(args.epicId);
    if (!row) return true;
    if (row.signature !== args.signature) return true;
    const now = args.now ?? Date.now();
    return now - row.probedAt > WAKE_GATE_REPROBE_TTL_MS;
  } catch {
    return true;
  }
}
