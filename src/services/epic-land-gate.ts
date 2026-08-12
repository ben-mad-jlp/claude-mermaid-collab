/**
 * epic-land-gate.ts — G10 — run the project's declared gate against an epic branch,
 * then for each failing unit, re-run the identical command against a detached master
 * baseline worktree. Classify regressions (branch fails, master passes) vs inherited
 * (both fail) vs incidents (cannot run).
 *
 * The land gate is the difference between "tsc + merge clean" (the old G9-limited proof)
 * and "no untested commits land to master" — the goal of FBPE P7. It runs the SAME
 * test commands on the epic-diff spec set that the leaves themselves ran per-file,
 * but here: a full epic-wide sweep, baseline-compared, and never auto-bypassed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LandActor } from './land-authority';
import { lastLines, extractFailingTests, SPEC_FILE_RE } from './gate-runner';
import type { LeafGateConfig, GateTestLane, GateSpawn, GateFloorLane } from './leaf-gate';
import { resolveLanes, routeSpecsToLanes, expandLaneCommands } from './leaf-gate';
import type { GateDeclaration } from './leaf-gate';
import { resolveGateDeclaration } from './leaf-gate';
import { loadManifestSource } from '../config/project-manifest';
import { defaultGateSpawn } from './leaf-gate';
import { recordEpicLandGate, getEpicLandGate, listObservations } from './worker-ledger';
import { activeQuarantine } from './flaky-quarantine';
import type { TestQuarantineRow } from './worker-ledger';

export type LandGateStatus = 'pass' | 'fail' | 'error' | 'abstain';

export interface LandGateUnit {
  /** stable key: `${laneIndex}:${files.join(',')}` */
  key: string;
  command: string;
  laneCwd: string;
  files: string[];
  branch: 'pass' | 'fail' | 'error';
  baseline?: 'pass' | 'fail' | 'error' | 'absent';
  classification: 'ok' | 'inherited' | 'regression' | 'incident';
  output?: string;
}

export interface EpicLandGateResult {
  status: LandGateStatus;
  declared: boolean;
  manifestPath: string;
  typecheck?: { command: string; status: 'pass' | 'fail' | 'error'; output: string };
  units: LandGateUnit[];
  regressions: LandGateUnit[];
  inherited: LandGateUnit[];
  incidents: LandGateUnit[];
  reasons: string[];
  specFiles: string[];
  epicTipSha: string | null;
  baseSha: string | null;
  sweep?: SourceGuardSweepResult;
  floor?: { command: string; status: 'pass' | 'fail' | 'error'; failing: string[]; output?: string };
  quarantinedOnlyFailures?: string[];
}

/** Spec paths whose assertions guard shared, out-of-change-set symbols. Matched against the
 *  full spec path so `.../source-guard.test.ts`, `...snapshot.test.ts`, `...invariant.test.ts`
 *  all qualify. */
export const SOURCE_GUARD_SWEEP_RE = /source[-_]?guard|snapshot|invariant/i;

/** Floor failure names carry a run-position prefix — "(218/501) src/…/x.test.ts" — whose
 *  numbers differ between runs. Strip it so a branch failure and the same base failure
 *  compare equal. Everything else (including a " > test name" suffix) is left intact. */
export function normalizeFloorTestName(name: string): string {
  return name.replace(/^\s*\(\d+\/\d+\)\s*/, '').trim();
}

/** Tests already failing at `baseSha` on the BASE, from the observation ledger. */
export function baseFailingTests(project: string, baseSha: string | null): Set<string> {
  if (!baseSha) return new Set();
  const out = new Set<string>();
  try {
    // 14 days is well past any base's useful life; rows are keyed by baseSha, so an old
    // window only ever adds rows for OTHER shas, which the filter drops.
    for (const r of listObservations(project, Date.now() - 14 * 24 * 60 * 60_000)) {
      if (r.scope === 'base' && r.failed && r.baseSha === baseSha) {
        out.add(normalizeFloorTestName(r.test));
      }
    }
  } catch { /* fail-open to an empty set: unknown base ⇒ treat every failure as net-new */ }
  return out;
}

/** Split a floor's failing set into net-new regressions vs failures inherited from the base. */
export function partitionFloorAgainstBase(
  project: string,
  baseSha: string | null,
  failing: string[],
): { regressed: string[]; inherited: string[] } {
  const base = baseFailingTests(project, baseSha);
  const regressed: string[] = [];
  const inherited: string[] = [];
  for (const f of failing) {
    (base.has(normalizeFloorTestName(f)) ? inherited : regressed).push(f);
  }
  return { regressed, inherited };
}

/** Wrap a floor failure name as a gate unit so it can populate regressions/inherited. */
function floorUnit(
  command: string,
  file: string,
  classification: 'inherited' | 'regression',
): LandGateUnit {
  return {
    key: `floor:${file}`,
    command,
    laneCwd: '',
    files: [file],
    branch: 'fail',
    baseline: classification === 'inherited' ? 'fail' : 'pass',
    classification,
  };
}

export interface SweepUnit {
  file: string;
  command: string;
  laneCwd: string;
  status: 'pass' | 'fail' | 'error';
  output?: string;
}

export interface SourceGuardSweepResult {
  status: 'pass' | 'fail' | 'error';
  specFiles: string[];
  units: SweepUnit[];
}

export interface EpicLandGateOpts {
  project: string;
  repo: string;
  epicId: string;
  epicBranch: string;
  epicWorktreeCwd: string;
  baseRef?: string;
  decl?: GateDeclaration;
  spawn?: GateSpawn;
  git?: (cwd: string, args: string[]) => { code: number; stdout: string };
  fs?: { exists(p: string): boolean; symlink(target: string, path: string): void };
  skipCache?: boolean;
  snapshot?: { baseSha: string; epicTipSha: string };
  quarantineLookup?: (project: string) => TestQuarantineRow[];
  actor?: LandActor;
}

const MAX_OUTPUT_CHARS = 200_000;

function defaultGit(cwd: string, args: string[]): { code: number; stdout: string } {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    return { code: 0, stdout };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: '' };
  }
}

const defaultFs = {
  exists: (p: string) => existsSync(p),
  symlink: (target: string, path: string) => symlinkSync(target, path),
};

export async function runSourceGuardSweep(o: {
  epicWorktreeCwd: string;
  cfg: LeafGateConfig;
  spawn: GateSpawn;
  git: (cwd: string, args: string[]) => { code: number; stdout: string };
  excludeFiles?: string[];
}): Promise<SourceGuardSweepResult> {
  const lsRes = o.git(o.epicWorktreeCwd, ['ls-files']);
  const exclude = new Set(o.excludeFiles ?? []);
  const specFiles = lsRes.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p && SPEC_FILE_RE.test(p) && SOURCE_GUARD_SWEEP_RE.test(p) && !exclude.has(p));

  if (specFiles.length === 0) return { status: 'pass', specFiles: [], units: [] };

  const lanes = resolveLanes(o.cfg);
  if (!lanes) return { status: 'pass', specFiles, units: [] };

  const { byLane } = routeSpecsToLanes(specFiles, lanes);
  const units: SweepUnit[] = [];
  let status: 'pass' | 'fail' | 'error' = 'pass';

  for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
    const lane = lanes[laneIdx];
    const files = byLane.get(lane);
    if (!files?.length) continue;
    const laneCwd = lane.cwd ? join(o.epicWorktreeCwd, lane.cwd) : o.epicWorktreeCwd;

    // SEQUENTIAL, one file per spawn — never a batch command — to dodge the shared-SQLite
    // flakiness that per-leaf change-set scoping was built to avoid.
    for (const file of files) {
      const command = expandLaneCommands({ ...lane, mode: 'per-file' }, [file])[0];
      const r = await o.spawn(laneCwd, command);
      const u: SweepUnit = { file, command, laneCwd: lane.cwd ?? '', status: 'pass' };
      if (!r.ran) {
        u.status = 'error';
        u.output = lastLines(r.output, 50);
        if (status === 'pass') status = 'error';
      } else if (r.code !== 0) {
        u.status = 'fail';
        u.output = lastLines(r.output, 50);
        status = 'fail';
      }
      units.push(u);
    }
  }

  return { status, specFiles, units };
}

function foldSweepIntoResult(res: EpicLandGateResult, sweep: SourceGuardSweepResult): EpicLandGateResult {
  res.sweep = sweep;
  if (sweep.status === 'pass') {
    res.reasons.push(`source-guard sweep: green (${sweep.specFiles.length} guard spec(s))`);
    return res;
  }
  if (res.status === 'pass') {
    res.status = sweep.status; // 'fail' or 'error'
  }
  for (const u of sweep.units.filter((x) => x.status !== 'pass')) {
    res.reasons.push(`SOURCE-GUARD SWEEP ${u.status.toUpperCase()}: ${u.file}`);
    if (u.output) res.reasons.push(lastLines(u.output, 20));
  }
  return res;
}

function parseFloorFailingNames(output: string): string[] {
  const seen = new Set<string>();
  const matches = output.matchAll(/─{4,}\s+(.+?)\s+─{4,}/g);
  for (const m of matches) {
    seen.add(m[1]);
  }
  return Array.from(seen);
}

export function floorFailureIsQuarantined(
  failingPath: string,
  quarantinedEntries: string[],
  floorOutput: string,
): boolean {
  // Normalize each quarantine entry by stripping a leading bun progress prefix.
  const normalizedQuarantine = new Set(
    quarantinedEntries.map((entry) => entry.replace(/^\(\d+\/\d+\)\s+/, '')),
  );

  // Direct hit: if the normalized set contains failingPath verbatim.
  if (normalizedQuarantine.has(failingPath)) {
    return true;
  }

  // Section hit: extract the output slice for failingPath and parse its test names.
  // Find the section header for this failingPath: ──── path ────
  const headerRegex = new RegExp(`─{4,}\\s+${failingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+─{4,}`);
  const headerMatch = floorOutput.match(headerRegex);

  if (!headerMatch) {
    return false;
  }

  // Find the start index of this header
  const headerStartIndex = floorOutput.indexOf(headerMatch[0]);
  if (headerStartIndex === -1) {
    return false;
  }

  // Find the next header (or end of output) to determine section bounds
  const afterHeaderIndex = headerStartIndex + headerMatch[0].length;
  const remainingText = floorOutput.slice(afterHeaderIndex);
  const nextHeaderMatch = remainingText.match(/\n─{4,}/);
  const sectionEndIndex = nextHeaderMatch
    ? afterHeaderIndex + remainingText.indexOf(nextHeaderMatch[0])
    : floorOutput.length;

  // Extract the section text (from after the header to the next header or EOF)
  const sectionText = floorOutput.slice(afterHeaderIndex, sectionEndIndex);

  // Extract test names from the section.
  const testNames = extractFailingTests(sectionText);

  // Return true only if all test names are in the quarantine set.
  if (testNames.length === 0) {
    return false;
  }

  return testNames.every((name) => normalizedQuarantine.has(name));
}

async function runRegressionFloor(o: {
  epicWorktreeCwd: string;
  floors: GateFloorLane[] | undefined;
  changedFiles: string[];
  spawn: GateSpawn;
}): Promise<EpicLandGateResult['floor'] | undefined> {
  if (!o.floors || o.floors.length === 0) {
    return undefined;
  }

  const results: Array<{ command: string; status: 'pass' | 'fail' | 'error'; failing: string[] }> = [];

  for (const lane of o.floors) {
    const cwd = lane.cwd ? join(o.epicWorktreeCwd, lane.cwd) : o.epicWorktreeCwd;
    const r = await o.spawn(cwd, lane.command);

    if (!r.ran) {
      return { command: lane.command, status: 'error', failing: [], output: r.output };
    }
    if (r.code !== 0) {
      const failing = parseFloorFailingNames(r.output) || extractFailingTests(r.output);
      return { command: lane.command, status: 'fail', failing, output: r.output };
    }
    results.push({ command: lane.command, status: 'pass', failing: [] });
  }

  return { command: o.floors.map((l) => l.command).join('; '), status: 'pass', failing: [] };
}

export async function runEpicLandGate(o: EpicLandGateOpts): Promise<EpicLandGateResult> {
  const spawn = o.spawn ?? defaultGateSpawn;
  const git = o.git ?? defaultGit;
  const lookupQuarantine = o.quarantineLookup ?? activeQuarantine;
  // Resolve the trunk via the injected git runner (main-then-master probe, mockable).
  // Behaviour-preserving on a master-trunk repo: 'main' probe fails → 'master'.
  const resolveTrunk = (): string => {
    for (const cand of ['main', 'master']) {
      const r = git(o.repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${cand}`]);
      if (r.code === 0 && r.stdout.trim()) return cand;
    }
    return 'master';
  };
  const baseRef = o.baseRef ?? resolveTrunk();
  const fs = o.fs ?? defaultFs;
  const decl = o.decl ?? resolveGateDeclaration(loadManifestSource(o.repo));

  // --- declaration check ---
  if (decl.kind === 'misconfigured') {
    return {
      status: 'error',
      declared: false,
      manifestPath: decl.manifestPath,
      units: [],
      regressions: [],
      inherited: [],
      incidents: [],
      reasons: [`land gate misconfigured: ${decl.reason}`],
      specFiles: [],
      epicTipSha: null,
      baseSha: null,
    };
  }

  if (decl.kind === 'absent') {
    return {
      status: 'abstain',
      declared: false,
      manifestPath: decl.manifestPath,
      units: [],
      regressions: [],
      inherited: [],
      incidents: [],
      reasons: [`no gate declared — ${decl.reason}`],
      specFiles: [],
      epicTipSha: null,
      baseSha: null,
    };
  }

  const cfg = decl.cfg;

  // --- tip + base + cache ---
  let epicTipSha: string | null = o.snapshot?.epicTipSha ?? null;
  let baseSha: string | null = o.snapshot?.baseSha ?? null;

  if (!o.snapshot) {
    const tipRes = git(o.epicWorktreeCwd, ['rev-parse', 'HEAD']);
    if (tipRes.code === 0) epicTipSha = tipRes.stdout.trim();

    const baseRes = git(o.repo, ['rev-parse', baseRef]);
    if (baseRes.code === 0) baseSha = baseRes.stdout.trim();
  }

  if (!o.skipCache && o.actor?.kind !== 'human') {
    const cached = getEpicLandGate(o.epicId, epicTipSha, baseSha);
    if (cached && cached.result) {
      const result = JSON.parse(cached.result) as EpicLandGateResult;
      return { ...result, epicTipSha, baseSha };
    }
  }

  // --- typecheck ---
  let typecheck: EpicLandGateResult['typecheck'] | undefined;
  if (cfg.typecheck) {
    const r = await spawn(o.epicWorktreeCwd, cfg.typecheck);
    if (!r.ran) {
      return {
        status: 'error',
        declared: true,
        manifestPath: decl.manifestPath,
        typecheck: { command: cfg.typecheck, status: 'error', output: r.output },
        units: [],
        regressions: [],
        inherited: [],
        incidents: [],
        reasons: ['land gate: typecheck could not run'],
        specFiles: [],
        epicTipSha,
        baseSha,
      };
    }
    if (r.code !== 0) {
      const res: EpicLandGateResult = {
        status: 'fail',
        declared: true,
        manifestPath: decl.manifestPath,
        typecheck: { command: cfg.typecheck, status: 'fail', output: r.output },
        units: [],
        regressions: [],
        inherited: [],
        incidents: [],
        reasons: [`land gate: typecheck failed on ${o.epicBranch}`, lastLines(r.output, 20)],
        specFiles: [],
        epicTipSha,
        baseSha,
      };
      recordEpicLandGate({ epicId: o.epicId, project: o.project, epicTipSha, baseSha, status: 'fail', result: JSON.stringify(res) });
      return res;
    }
    typecheck = { command: cfg.typecheck, status: 'pass', output: '' };
  }

  // --- change-set ---
  const mergeBaseRes = git(o.epicWorktreeCwd, ['merge-base', baseSha ?? baseRef, epicTipSha ?? 'HEAD']);
  if (mergeBaseRes.code !== 0) {
    return {
      status: 'error',
      declared: true,
      manifestPath: decl.manifestPath,
      typecheck,
      units: [],
      regressions: [],
      inherited: [],
      incidents: [],
      reasons: ['land gate: cannot resolve merge-base'],
      specFiles: [],
      epicTipSha,
      baseSha,
    };
  }

  const mergeBase = mergeBaseRes.stdout.trim();

  // If merge-base equals epic tip, the trunk already contains the epic tip and there is
  // nothing to measure — the diff is empty and the gate is unevaluable.
  if (mergeBase === epicTipSha) {
    const res: EpicLandGateResult = {
      status: 'fail',
      declared: true,
      manifestPath: decl.manifestPath,
      typecheck,
      units: [],
      regressions: [],
      inherited: [],
      incidents: [],
      reasons: ['land gate: UNEVALUABLE — merge-base == epic tip; trunk already contains the epic, nothing to measure'],
      specFiles: [],
      epicTipSha,
      baseSha,
    };
    recordEpicLandGate({ epicId: o.epicId, project: o.project, epicTipSha, baseSha, status: 'fail', result: JSON.stringify(res) });
    return res;
  }

  const diffRes = git(o.epicWorktreeCwd, ['diff', '--name-only', '--diff-filter=d', mergeBase, 'HEAD']);
  const changedFiles = diffRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const specFiles = changedFiles.filter((p) => SPEC_FILE_RE.test(p));

  // Floor failures that are pre-existing at the base: carried into every downstream
  // result as `inherited` so the land is reported inheritedRed rather than blocked.
  let floorInherited: LandGateUnit[] = [];

  // --- regression floor ---
  const floor = await runRegressionFloor({ epicWorktreeCwd: o.epicWorktreeCwd, floors: cfg.floors, changedFiles, spawn });
  if (floor?.status === 'error') {
    return {
      status: 'error',
      declared: true,
      manifestPath: decl.manifestPath,
      typecheck,
      floor,
      units: [],
      regressions: [],
      inherited: [...floorInherited],
      incidents: [],
      reasons: [`land gate: regression floor could not run: ${floor.command}`],
      specFiles,
      epicTipSha,
      baseSha,
    };
  }
  // The regression floor runs ONLY in the epic worktree and fails on any non-zero exit —
  // an ABSOLUTE check, not a differential one. So a suite that is already red on the base
  // fails here too, and the short-circuit below reports status:'fail' with EMPTY
  // regressions/inherited/incidents. land-authority.ts then hits its catch-all and blocks
  // with the opaque `gate-failed`, bypassing the regressions-vs-inherited machinery that
  // exists precisely to tell "this branch broke something" from "this was already broken".
  //
  // The consequence is a deadlock: while the base is red NOTHING can land, including the
  // epic whose entire purpose is to green the base. Observed 2026-08-07 — epic a84acd18
  // (the three phantom-'vitest' typecheck fixes) failed to land three times, its branch was
  // lost, and the mission sat stalled for hours with six leaves parked epic-base-red on the
  // very errors that epic would have fixed.
  //
  // So: partition the floor's failing set against what ALREADY fails at this baseSha (the
  // ledger records those as scope:'base'). Failures present on the base are INHERITED —
  // reported, never blocking, exactly as the unit path already treats them. Only failures
  // the branch introduces are regressions. A branch that is merely no-worse-than-base is
  // allowed through, which is what makes a base repair landable.
  let floorQuarantinedOnlyFailures: string[] | undefined;
  let inheritedFloor: { regressed: string[]; inherited: string[] } = { regressed: [], inherited: [] };
  if (floor?.status === 'fail') {
    // Two independent reasons a floor failure is not this branch's fault, checked in order.
    // First: every failing path is already quarantined, so the floor is measuring known-flaky
    // tests. Second: every failing test is already red at baseSha, so the branch is merely
    // no-worse-than-base. Either one downgrades; only a genuinely net-new failure blocks.
    const quarantineTests = lookupQuarantine(o.project).map((q) => q.test);
    const quarantinedOnly =
      floor.failing.length > 0 &&
      floor.failing.every((fp) => floorFailureIsQuarantined(fp, quarantineTests, floor.output ?? ''));
    inheritedFloor = partitionFloorAgainstBase(o.project, baseSha, floor.failing);
    if (quarantinedOnly) {
      // Downgrade: floor failed but all failures are quarantined.
      floorQuarantinedOnlyFailures = [...floor.failing].sort();
    } else if (inheritedFloor.regressed.length === 0 && floor.failing.length > 0) {
      // Every floor failure is pre-existing at the base. Fall THROUGH to the normal unit
      // path with the failures recorded as inherited, so the land is reported inheritedRed
      // rather than blocked. Not a silent pass: land-authority surfaces inheritedRed.
      floorInherited = inheritedFloor.inherited.map((f) => floorUnit(floor.command, f, 'inherited'));
    } else {
      // Floor failed with net-new failures — return immediately.
      const reasons = [
        `REGRESSION FLOOR FAILED: ${floor.command}`,
        ...(inheritedFloor.regressed.length
          ? [`net-new failures (not failing at base ${String(baseSha).slice(0, 8)}):`, ...inheritedFloor.regressed]
          : []),
        ...(inheritedFloor.inherited.length
          ? [`inherited (already failing at base): ${inheritedFloor.inherited.length}`]
          : []),
        ...(floor.failing.length ? floor.failing : [lastLines(floor.output ?? '', 20)]),
      ];
      const res: EpicLandGateResult = {
        status: 'fail',
        declared: true,
        manifestPath: decl.manifestPath,
        typecheck,
        floor,
        units: [],
        // Name the NET-NEW failures as regressions so land-authority reports the accurate
        // `gate-regression` with a count, instead of the opaque catch-all `gate-failed`.
        regressions: inheritedFloor.regressed.map((f) => floorUnit(floor.command, f, 'regression')),
        inherited: inheritedFloor.inherited.map((f) => floorUnit(floor.command, f, 'inherited')),
        incidents: [],
        reasons,
        specFiles,
        epicTipSha,
        baseSha,
      };
      recordEpicLandGate({ epicId: o.epicId, project: o.project, epicTipSha, baseSha, status: 'fail', result: JSON.stringify(res) });
      return res;
    }
  }

  if (specFiles.length === 0) {
    const sweep = await runSourceGuardSweep({ epicWorktreeCwd: o.epicWorktreeCwd, cfg, spawn, git });
    const reasons: string[] = ['land gate: no spec files in the epic diff'];
    if (floorQuarantinedOnlyFailures) {
      reasons.unshift(`quarantined-only floor failure(s), gate downgraded to pass: ${floorQuarantinedOnlyFailures.join(', ')}`);
    }
    if (floor) {
      reasons.push(`land gate: regression floor ${floor.status} (${floor.command})`);
    }
    const res: EpicLandGateResult = {
      status: 'pass',
      declared: true,
      manifestPath: decl.manifestPath,
      typecheck,
      floor,
      units: [],
      regressions: [],
      inherited: [...floorInherited],
      incidents: [],
      reasons,
      specFiles: [],
      epicTipSha,
      baseSha,
      ...(floorQuarantinedOnlyFailures ? { quarantinedOnlyFailures: floorQuarantinedOnlyFailures } : {}),
    };
    foldSweepIntoResult(res, sweep);
    if (res.status !== 'error') {
      recordEpicLandGate({ epicId: o.epicId, project: o.project, epicTipSha, baseSha, status: res.status as 'pass' | 'fail' | 'abstain', result: JSON.stringify(res) });
    }
    return res;
  }

  // --- lane routing ---
  const lanes = resolveLanes(cfg);
  if (!lanes) {
    const res: EpicLandGateResult = {
      status: 'pass',
      declared: true,
      manifestPath: decl.manifestPath,
      typecheck,
      floor,
      units: [],
      regressions: [],
      inherited: [...floorInherited],
      incidents: [],
      reasons: ['land gate: no test lanes declared'],
      specFiles,
      epicTipSha,
      baseSha,
    };
    recordEpicLandGate({ epicId: o.epicId, project: o.project, epicTipSha, baseSha, status: 'pass', result: JSON.stringify(res) });
    return res;
  }

  const { byLane, unmatched } = routeSpecsToLanes(specFiles, lanes);

  if (unmatched.length > 0 && cfg.tests) {
    return {
      status: 'error',
      declared: true,
      manifestPath: decl.manifestPath,
      typecheck,
      floor,
      units: [],
      regressions: [],
      inherited: [...floorInherited],
      incidents: unmatched.map((f, i) => ({
        key: `unmatched:${i}`,
        command: '',
        laneCwd: '',
        files: [f],
        branch: 'error',
        classification: 'incident',
      })),
      reasons: [
        `land gate: ${unmatched.length} spec file(s) match NO test lane`,
        ...unmatched.map((p) => `  unmatched: ${p}`),
      ],
      specFiles,
      epicTipSha,
      baseSha,
    };
  }

  // --- branch pass ---
  const units: LandGateUnit[] = [];
  const unitsByKey = new Map<string, LandGateUnit>();

  for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
    const lane = lanes[laneIdx];
    const files = byLane.get(lane);
    if (!files?.length) continue;

    const laneCwd = lane.cwd ? join(o.epicWorktreeCwd, lane.cwd) : o.epicWorktreeCwd;
    const commands = expandLaneCommands(lane, files);

    // A per-file lane emits one command PER file (commands[i] ↔ files[i]); a batch lane
    // emits ONE command over all files. Key each unit by the file(s) ITS command actually
    // covers — NOT by the whole lane — so the baseline pass can classify each file
    // independently. Keying the whole lane as one unit meant a single NEW file (baseline
    // 'absent') forced the ENTIRE lane to 'regression', masking that the real failure was
    // an INHERITED one in an existing file (audit c11df7d3 / epic 532c48fb).
    const perFile = lane.mode === 'per-file';
    for (let ci = 0; ci < commands.length; ci++) {
      const command = commands[ci];
      const unitFiles = perFile ? [files[ci]] : [...files];
      const key = `${laneIdx}:${unitFiles.join(',')}`;
      let unit = unitsByKey.get(key);
      if (!unit) {
        unit = {
          key,
          command,
          laneCwd: lane.cwd ?? '',
          files: unitFiles,
          branch: 'pass',
          classification: 'ok',
        };
        units.push(unit);
        unitsByKey.set(key, unit);
      }

      const r = await spawn(laneCwd, command);
      if (!r.ran) {
        unit.branch = 'error';
        unit.classification = 'incident';
        unit.output = lastLines(r.output, 50);
      } else if (r.code !== 0) {
        unit.branch = 'fail';
        unit.classification = 'regression'; // tentative, baseline will reclassify
        unit.output = lastLines(r.output, 50);
      }
    }
  }

  // --- baseline pass (only if failures exist) ---
  const failingUnits = units.filter((u) => u.branch !== 'pass');
  if (failingUnits.length > 0) {
    const trial = join(tmpdir(), `collab-land-gate-${process.pid}-${process.hrtime.bigint()}`);
    const teardown = () => {
      try { git(o.repo, ['worktree', 'remove', '--force', trial]); } catch {}
      try { git(o.repo, ['worktree', 'prune']); } catch {}
    };

    const addRes = git(o.repo, ['worktree', 'add', '--detach', trial, baseRef]);
    if (addRes.code !== 0) {
      teardown();
      return {
        status: 'error',
        declared: true,
        manifestPath: decl.manifestPath,
        typecheck,
        units,
        regressions: [],
        inherited: [...floorInherited],
        incidents: failingUnits,
        reasons: ['land gate: baseline worktree setup failed'],
        specFiles,
        epicTipSha,
        baseSha,
      };
    }

    try {
      // --- node_modules symlink ---
      const cwds = new Set<string>([...failingUnits.map((u) => u.laneCwd), '']);
      for (const cwd of cwds) {
        const srcModules = join(cwd ? join(o.repo, cwd) : o.repo, 'node_modules');
        if (!fs.exists(srcModules)) {
          for (const u of failingUnits.filter((u) => u.laneCwd === cwd)) {
            u.baseline = 'error';
            u.classification = 'incident';
            if (!u.output) u.output = `baseline has no node_modules at ${cwd || 'root'}`;
          }
          continue;
        }
        const trialModules = join(trial, cwd, 'node_modules');
        try {
          fs.symlink(srcModules, trialModules);
        } catch {
          for (const u of failingUnits.filter((u) => u.laneCwd === cwd)) {
            u.baseline = 'error';
            u.classification = 'incident';
            if (!u.output) u.output = 'baseline node_modules symlink failed';
          }
        }
      }

      // --- baseline command run ---
      for (const unit of failingUnits) {
        if (unit.branch === 'error' || unit.baseline === 'error' || unit.classification === 'incident') continue;

        // Check for absent files
        const missingFile = unit.files.find((f) => {
          const path_ = unit.laneCwd ? join(trial, unit.laneCwd, f) : join(trial, f);
          return !fs.exists(path_);
        });
        if (missingFile) {
          unit.baseline = 'absent';
          unit.classification = 'regression';
          continue;
        }

        const laneCwd = unit.laneCwd ? join(trial, unit.laneCwd) : trial;
        const r = await spawn(laneCwd, unit.command);

        if (!r.ran) {
          unit.baseline = 'error';
          unit.classification = 'incident';
        } else if (r.code !== 0) {
          unit.baseline = 'fail';
          unit.classification = 'inherited';
        } else {
          unit.baseline = 'pass';
          unit.classification = 'regression';
        }
      }
    } finally {
      teardown();
    }
  }

  // --- verdict ---
  const regressions = units.filter((u) => u.classification === 'regression');
  const inherited = units.filter((u) => u.classification === 'inherited');
  const incidents = units.filter((u) => u.classification === 'incident');

  let status: LandGateStatus = 'pass';
  const reasons: string[] = [];

  // Prepend floor downgrade reason if applicable.
  if (floorQuarantinedOnlyFailures) {
    reasons.push(`quarantined-only floor failure(s), gate downgraded to pass: ${floorQuarantinedOnlyFailures.join(', ')}`);
  }

  if (incidents.length > 0) {
    status = 'error';
    reasons.push(`land gate: ${incidents.length} incident(s) — commands could not run`);
  } else if (regressions.length > 0) {
    status = 'fail';
    for (const u of regressions) {
      const baseStat = u.baseline === 'absent' ? 'new file' : 'fails on master';
      reasons.push(`REGRESSION: ${u.files.join(', ')} fails on ${o.epicBranch}, ${baseStat}`);
      if (u.output) {
        reasons.push(lastLines(u.output, 20));
      }
    }
  } else {
    reasons.push(`land gate: green (${specFiles.length} spec file(s)${inherited.length > 0 ? `; ${inherited.length} also fail on master` : ''})`);
  }

  const res: EpicLandGateResult = {
    status,
    declared: true,
    manifestPath: decl.manifestPath,
    typecheck,
    floor,
    units,
    regressions,
    // Unit-level inherited PLUS any floor failures that were already red at the base —
    // both are "already broken here", and both must be reported rather than blocking.
    inherited: [...inherited, ...floorInherited],
    incidents,
    reasons,
    specFiles,
    epicTipSha,
    baseSha,
    ...(floorQuarantinedOnlyFailures ? { quarantinedOnlyFailures: floorQuarantinedOnlyFailures } : {}),
  };

  if (res.status === 'pass') {
    const sweep = await runSourceGuardSweep({
      epicWorktreeCwd: o.epicWorktreeCwd,
      cfg,
      spawn,
      git,
      excludeFiles: specFiles,
    });
    foldSweepIntoResult(res, sweep);
  }

  if (res.status !== 'error') {
    recordEpicLandGate({ epicId: o.epicId, project: o.project, epicTipSha, baseSha, status: res.status as 'pass' | 'fail' | 'abstain', result: JSON.stringify(res) });
  }

  return res;
}

export function landGateTrailer(r: EpicLandGateResult): string {
  if (r.status === 'fail' || r.status === 'error') {
    return '';
  }

  let trailer = `Land-Gate: ${r.status}`;
  if (r.typecheck) {
    trailer += `\nLand-Gate-Command: ${r.typecheck.command}`;
  }
  trailer += `\nLand-Gate-Specs: ${r.specFiles.length}`;
  if (r.floor) {
    trailer += `\nLand-Gate-Floor: ${r.floor.status} (${r.floor.command})`;
  }
  if (r.sweep && r.sweep.specFiles.length > 0) {
    trailer += `\nLand-Gate-Sweep: ${r.sweep.specFiles.length}`;
  }
  if (r.inherited.length > 0) {
    trailer += `\nLand-Gate-Inherited: ${r.inherited.map((u) => u.files.join(', ')).join(', ')}`;
  }
  return trailer;
}

export function parseTimeoutFromOutput(output: string): { observedMs: number; limitMs: number } | null {
  const limitMatch = output.match(/timed out (?:after|in)\s*(\d+)\s*ms|timeout of\s*(\d+)\s*ms/i);
  const observedMatch = [...output.matchAll(/\[(\d+(?:\.\d+)?)\s*ms\]/g)].pop();
  if (!limitMatch || !observedMatch) return null;
  const limitMs = Number(limitMatch[1] ?? limitMatch[2]);
  const observedMs = Math.round(Number(observedMatch[1]));
  if (!Number.isFinite(limitMs) || !Number.isFinite(observedMs)) return null;
  return { observedMs, limitMs };
}

export function landGateSummary(r: EpicLandGateResult): string {
  if (r.status === 'pass') {
    return `land gate green (${r.specFiles.length} spec file(s)${r.inherited.length > 0 ? `; ${r.inherited.length} also fail on master` : ''})`;
  }
  if (r.status === 'fail') {
    if (r.typecheck?.status === 'fail') {
      return `land gate FAILED: typecheck (${r.typecheck.command})`;
    }
    if (r.floor?.status === 'fail' && r.regressions.length === 0) {
      return `land gate FAILED: regression floor (${r.floor.command})`;
    }
    if (r.regressions.length > 0) {
      return `land gate FAILED: ${r.regressions.length} regression(s) on the branch, pass on master`;
    }
    const sweepUnit = r.sweep?.units.find((u) => u.status !== 'pass');
    if (sweepUnit) {
      const timeout = sweepUnit.output ? parseTimeoutFromOutput(sweepUnit.output) : null;
      const testName = sweepUnit.output ? extractFailingTests(sweepUnit.output)[0] : undefined;
      return `land gate FAILED: source-guard sweep ${sweepUnit.status} on ${sweepUnit.file}` +
        (testName ? ` (${testName})` : '') +
        (timeout ? ` — timeout: observed ${timeout.observedMs}ms vs limit ${timeout.limitMs}ms` : '');
    }
    const incident = r.incidents[0];
    if (incident) {
      return `land gate FAILED: ${incident.files.join(', ')} could not run`;
    }
    return `land gate FAILED: ${r.reasons[0] ?? 'unknown cause'}`;
  }
  if (r.status === 'abstain') {
    return `land gate ABSTAINED (no declared gate)`;
  }
  return `land gate ERROR: ${r.reasons[0] ?? 'unknown'}`;
}
