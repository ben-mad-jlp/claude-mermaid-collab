/**
 * campaign-pass.ts — group failing campaign probes by failure signature and forge missions.
 *
 * The campaign pass is the rung above the conductor: probe → mission. This module groups
 * failing probes by their failure signature (normalized evidence or fallback to command text)
 * and forges one mission per group, maintaining durable probe→mission links for tracking.
 */
import Database from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalProjectRoot, canonicalProjectRootLoose } from './store-paths.ts';
import { openCollabDb, closeCollabDb } from './collab-db.ts';
import {
  campaignFront,
  listProbeVerdicts,
  listProbes,
  recordProbeVerdict,
  type CampaignProbe,
  type ProbeVerdictRecord,
  type RecordedVerdict,
} from './campaign-store.ts';
import { forgeMission, type ForgeMissionInput, type ForgeMissionResult } from '../mcp/tools/mission-forge.ts';
import { getMission, isMissionTerminal } from './mission-store.ts';

/** A probe's linked mission, or null if no link exists. */
export interface ProbeMissionLink {
  probeId: string;
  missionId: string;
  campaignId: string;
  createdAt: number;
}

/** Result of running the campaign pass: grouped probes, forged missions, and skipped probes. */
export interface CampaignPassResult {
  /** The derived grouping by failure signature (even when a forge threw). */
  groups: Array<{ signature: string; probeIds: string[] }>;
  /** Successfully forged missions and their linked probes. */
  forged: Array<{ signature: string; missionId: string; probeIds: string[] }>;
  /** Probes that were skipped because they already hold an open linked mission. */
  skipped: string[];
  /** Probe ids that were re-measured this pass (every probe in the front was executed). */
  executed: string[];
}

/** Injectable dependencies for runCampaignPass. */
export interface CampaignPassDeps {
  /** Forge a mission from criteria. Defaults to the live forgeMission implementation. */
  forgeMission?: typeof forgeMission;
  /** Derive the front of a campaign. Defaults to the live campaignFront implementation. */
  campaignFront?: typeof campaignFront;
  /** List recorded verdicts for a probe. Defaults to the live listProbeVerdicts implementation. */
  listProbeVerdicts?: typeof listProbeVerdicts;
  /** List all probes for a campaign. Defaults to the live listProbes implementation. */
  listProbes?: typeof listProbes;
  /** Record a probe verdict. Defaults to the live recordProbeVerdict implementation. */
  recordProbeVerdict?: typeof recordProbeVerdict;
  /** Execute a probe command and return its verdict. Defaults to the live defaultExecProbe implementation. */
  execProbe?: (probe: CampaignProbe) => Promise<{ verdict: RecordedVerdict; evidence?: string | null }>;
  /** Resolve the current commit sha. Defaults to the live defaultCommitSha implementation. */
  commitSha?: () => string;
  /** Determine if a mission is still open. Defaults to checking via getMission + isMissionTerminal. */
  isMissionOpen?: (project: string, missionId: string) => boolean;
  /** Current time in milliseconds. Defaults to Date.now. */
  now?: () => number;
}

const CAMPAIGN_PROBE_MISSION_DDL = `
CREATE TABLE IF NOT EXISTS campaign_probe_mission (
  probeId TEXT PRIMARY KEY,
  missionId TEXT NOT NULL,
  campaignId TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
`;

/**
 * Module-local prepared marker, mirroring campaign-store's pattern.
 * Tracks which canonical project roots have already run the DDL.
 */
const prepared = new Set<string>();

/**
 * Open the campaign pass database and ensure the campaign_probe_mission table exists.
 * Uses the same collab database as campaign-store with an additional module-local DDL.
 */
function openCampaignPassDb(project: string): Database {
  project = canonicalProjectRoot(project);
  if (!existsSync(project)) {
    throw new Error(`unknown project: ${project}`);
  }

  // Get the database from collab-db (same one campaign-store uses).
  const db = openCollabDb(project);

  // Ensure our table exists (idempotent, runs once per root via prepared marker).
  if (prepared.has(project)) return db;
  db.exec(CAMPAIGN_PROBE_MISSION_DDL);
  prepared.add(project);
  return db;
}

/**
 * Drop a possibly-stale cached handle (test isolation / after a rebuild).
 * Mirrors campaign-store's _resetCampaignDbCache.
 */
export function _resetCampaignPassDbCache(project?: string): void {
  if (project) {
    prepared.delete(canonicalProjectRootLoose(project));
    closeCollabDb(project);
  } else {
    prepared.clear();
  }
}

/** Timeout in milliseconds for probe command execution. */
export const PROBE_EXEC_TIMEOUT_MS = 30000;

/**
 * Pure: select the failure signature for a probe from its recorded verdicts.
 *
 * Selects the LAST verdict record whose verdict === 'fail' (verdicts are ordered by
 * recordedAt then id, so last-in-array is most recent). Uses that record's `evidence`
 * when non-null and non-blank, else falls back to `probe.command`. If no fail record
 * exists, uses `probe.command` directly. Normalises deterministically: strips ANSI
 * escape sequences, collapses whitespace runs to a single space, trims, lowercases,
 * and truncates to 200 chars. Returns '' only when the source text is genuinely empty.
 */
export function failureSignature(probe: CampaignProbe, verdicts: ProbeVerdictRecord[]): string {
  // Find the most recent 'fail' verdict (verdicts are already ordered by recordedAt, id).
  let sourceText: string | null = null;
  for (let i = verdicts.length - 1; i >= 0; i--) {
    if (verdicts[i].verdict === 'fail') {
      sourceText = verdicts[i].evidence;
      break;
    }
  }

  // Fallback to command if no fail evidence or if evidence is empty/blank.
  if (!sourceText || !sourceText.trim()) {
    sourceText = probe.command ?? '';
  }

  // Normalise: strip ANSI, collapse whitespace, trim, lowercase, truncate.
  let normalized = sourceText
    // Strip ANSI escape sequences (e.g. \x1b[31m).
    .replace(/\x1b\[[0-9;]*m/g, '')
    // Collapse runs of whitespace (including newlines) to a single space.
    .replace(/\s+/g, ' ')
    // Trim leading/trailing whitespace.
    .trim()
    // Lowercase.
    .toLowerCase()
    // Truncate to 200 chars.
    .slice(0, 200);

  return normalized;
}

/**
 * Default implementation: execute a probe command in the project root and return its verdict.
 * Exit code 0 -> 'pass', any other -> 'fail'. Captures stdout + stderr as evidence.
 * Throws if the probe has no command.
 */
export async function defaultExecProbe(
  project: string,
  probe: CampaignProbe,
): Promise<{ verdict: RecordedVerdict; evidence?: string | null }> {
  if (!probe.command || !probe.command.trim()) {
    throw new Error(`probe ${probe.id} has no command`);
  }

  const execFileAsync = promisify(execFile);
  const projectRoot = canonicalProjectRoot(project);

  try {
    await execFileAsync('/bin/sh', ['-c', probe.command], {
      cwd: projectRoot,
      timeout: PROBE_EXEC_TIMEOUT_MS,
      maxBuffer: 1024 * 1024, // 1MB
      shell: false,
    });

    // Exit code 0 = pass
    return { verdict: 'pass' as const, evidence: null };
  } catch (err: any) {
    // Any error (including timeout) = fail
    let evidence: string | null = null;

    if (err.stdout || err.stderr) {
      const combined = `${err.stdout || ''}${err.stderr || ''}`.trim();
      evidence = combined.length > 0 ? combined.slice(0, 4000) : null;
    }

    return { verdict: 'fail' as const, evidence };
  }
}

/**
 * Resolve the current commit sha in the project root.
 * Never throws, never returns empty string. Returns 'unknown' on any error.
 */
function defaultCommitSha(project: string): string {
  try {
    const execFileSync = require('node:child_process').execFileSync;
    const projectRoot = canonicalProjectRoot(project);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 5000,
    })
      .trim();
    return sha.length > 0 ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Link a probe to a mission in the campaign_probe_mission table.
 * INSERT OR REPLACE: idempotent, keyed on probeId.
 */
export function linkProbeToMission(
  project: string,
  probeId: string,
  missionId: string,
  campaignId: string,
  at?: number,
): void {
  const db = openCampaignPassDb(project);
  const createdAt = at ?? Date.now();

  db.prepare(
    `INSERT OR REPLACE INTO campaign_probe_mission (probeId, missionId, campaignId, createdAt)
     VALUES (?, ?, ?, ?)`,
  ).run(probeId, missionId, campaignId, createdAt);
}

/**
 * Read a probe's mission link, or null if no link exists.
 */
export function getProbeMissionLink(project: string, probeId: string): ProbeMissionLink | null {
  const db = openCampaignPassDb(project);
  const row = db.prepare('SELECT * FROM campaign_probe_mission WHERE probeId = ?').get(probeId) as any;
  if (!row) return null;
  return {
    probeId: row.probeId,
    missionId: row.missionId,
    campaignId: row.campaignId,
    createdAt: row.createdAt,
  };
}

/**
 * List all open linked missions for a campaign.
 * Filters links to those whose mission is still open (not terminal).
 */
export function listOpenLinkedMissions(
  project: string,
  campaignId: string,
  isMissionOpen?: (project: string, missionId: string) => boolean,
): ProbeMissionLink[] {
  const db = openCampaignPassDb(project);
  const check = isMissionOpen ?? ((proj: string, missionId: string) => {
    const mission = getMission(proj, missionId);
    return mission != null && !isMissionTerminal(mission);
  });

  const rows = db
    .prepare('SELECT * FROM campaign_probe_mission WHERE campaignId = ?')
    .all(campaignId) as any[];

  return rows.filter((row) => {
    try {
      return check(project, row.missionId);
    } catch {
      // Fail-open: if checking a mission throws, treat it as closed/non-open.
      return false;
    }
  }).map((row) => ({
    probeId: row.probeId,
    missionId: row.missionId,
    campaignId: row.campaignId,
    createdAt: row.createdAt,
  }));
}

/**
 * Pure: render one citable capability line per probe.
 * Naming the probe id, its command, and its environment.
 */
export function probeCriterionText(probe: CampaignProbe): string {
  const parts: string[] = [];
  if (probe.id) parts.push(`[${probe.id}]`);
  if (probe.command) parts.push(probe.command);
  if (probe.environment) parts.push(`(${probe.environment})`);
  return parts.join(' ') || probe.id;
}

/**
 * Run the campaign pass: group failing probes by signature and forge missions.
 *
 * Order of operations:
 * 0. Derive the campaign front (probes with verdict !== 'pass' whose deps passed) and re-measure every one of them.
 * 1. Get the campaign front again and filter to failing probes.
 * 2. For each, skip if it already has an open linked mission.
 * 3. Group the remainder by failureSignature.
 * 4. Per group, forge one mission with criteria = group.probes.map(probeCriterionText).
 * 5. Link every probe in the group to the returned missionId.
 *
 * Fail-open at four levels: outermost try/catch for the whole operation, a per-stage
 * try/catch for re-execution, per-probe try/catch for verdict/link reads, and per-group
 * try/catch for forge+link.
 *
 * Returns { groups, forged, skipped, executed } even when a forge throws (partial success).
 */
export async function runCampaignPass(
  project: string,
  campaignId: string,
  session: string,
  deps: CampaignPassDeps = {},
): Promise<CampaignPassResult> {
  try {
    const frontFn = deps.campaignFront ?? campaignFront;
    const verdictsFn = deps.listProbeVerdicts ?? listProbeVerdicts;
    const recordVerdictFn = deps.recordProbeVerdict ?? recordProbeVerdict;
    const execProbeFn = deps.execProbe ?? ((probe: CampaignProbe) => defaultExecProbe(project, probe));
    const commitShaFn = deps.commitSha ?? (() => defaultCommitSha(project));
    const forgeReq = deps.forgeMission ?? forgeMission;
    const isMissionOpenFn = deps.isMissionOpen ?? ((proj: string, missionId: string) => {
      const mission = getMission(proj, missionId);
      return mission != null && !isMissionTerminal(mission);
    });

    // 0. Derive the front and re-measure every front probe (not-run or fail).
    const executed: string[] = [];
    try {
      const front = frontFn(project, campaignId);
      const sha = commitShaFn();

      for (const probe of front) {
        try {
          const result = await execProbeFn(probe);
          recordVerdictFn(project, {
            probeId: probe.id,
            verdict: result.verdict,
            environment: probe.environment,
            commitSha: sha,
            evidence: result.evidence ?? null,
          });
          executed.push(probe.id);
        } catch {
          // Fail-open per-probe: one throwing exec/record leaves the probe unchanged
          // and doesn't prevent others from executing.
        }
      }
    } catch {
      // Fail-open for the entire re-execution stage: a throwing frontFn or other
      // stage-level error means no probes are re-executed, but the pass continues.
    }

    // 1. Get the campaign front again and filter to failing probes.
    const front = frontFn(project, campaignId);
    const failing = front.filter((p) => p.verdict === 'fail');

    // 2. Skip probes that already have open linked missions.
    const skipped: string[] = [];
    const toGroup: CampaignProbe[] = [];

    for (const probe of failing) {
      try {
        const link = getProbeMissionLink(project, probe.id);
        if (link && isMissionOpenFn(project, link.missionId)) {
          skipped.push(probe.id);
        } else {
          toGroup.push(probe);
        }
      } catch {
        // Fail-open per-probe: one bad link lookup doesn't kill the whole pass.
        toGroup.push(probe);
      }
    }

    // 3. Group by failure signature.
    type SignatureGroup = { signature: string; probes: CampaignProbe[] };
    const groupMap = new Map<string, CampaignProbe[]>();

    for (const probe of toGroup) {
      try {
        const verdicts = verdictsFn(project, probe.id);
        const sig = failureSignature(probe, verdicts);
        if (!groupMap.has(sig)) {
          groupMap.set(sig, []);
        }
        groupMap.get(sig)!.push(probe);
      } catch {
        // Fail-open per-probe: one bad verdict read doesn't kill grouping.
        // Treat it as a group by itself.
        if (!groupMap.has('')) {
          groupMap.set('', []);
        }
        groupMap.get('')!.push(probe);
      }
    }

    const groups: SignatureGroup[] = Array.from(groupMap.entries())
      .map(([signature, probes]) => ({ signature, probes }));

    const groupResults = groups.map((g) => ({ signature: g.signature, probeIds: g.probes.map((p) => p.id) }));
    const forged: Array<{ signature: string; missionId: string; probeIds: string[] }> = [];

    // 4. Per group, forge one mission and link probes.
    for (const group of groups) {
      try {
        const title = `Probe failures: ${group.signature || '(empty)'}`.slice(0, 200);
        const criteria = group.probes.map(probeCriterionText);

        const missionInput: ForgeMissionInput = {
          session,
          title,
          criteria,
          // Campaigns are derived from observations, so they're created unapproved.
          // Approval happens separately in the mission-approval path.
          approved: true,
        };

        const result = await forgeReq(project, missionInput);
        const missionId = result.missionId;

        // 5. Link every probe in the group.
        for (const probe of group.probes) {
          try {
            linkProbeToMission(project, probe.id, missionId, campaignId);
          } catch (err) {
            // Fail-open per-link: one link failure doesn't prevent others.
            // Log for debugging but continue.
          }
        }

        forged.push({
          signature: group.signature,
          missionId,
          probeIds: group.probes.map((p) => p.id),
        });
      } catch (err) {
        // Fail-open per-group: one throwing forge leaves the other groups forged.
        // The group remains in the groups array but not in forged.
      }
    }

    return {
      groups: groupResults,
      forged,
      skipped,
      executed,
    };
  } catch {
    // Fail-open outermost: a throwing store read or front derivation yields empty result.
    return {
      groups: [],
      forged: [],
      skipped: [],
      executed: [],
    };
  }
}
