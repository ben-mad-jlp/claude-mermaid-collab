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
import { lastLines, extractFailingTests, SPEC_FILE_RE } from './gate-runner';
import type { LeafGateConfig, GateTestLane, GateSpawn, GateFloorLane } from './leaf-gate';
import { resolveLanes, routeSpecsToLanes, expandLaneCommands } from './leaf-gate';
import type { GateDeclaration } from './leaf-gate';
import { resolveGateDeclaration } from './leaf-gate';
import { loadManifestSource } from '../config/project-manifest';
import { defaultGateSpawn } from './leaf-gate';
import { recordEpicLandGate, getEpicLandGate } from './worker-ledger';

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
}

/** Spec paths whose assertions guard shared, out-of-change-set symbols. Matched against the
 *  full spec path so `.../source-guard.test.ts`, `...snapshot.test.ts`, `...invariant.test.ts`
 *  all qualify. */
export const SOURCE_GUARD_SWEEP_RE = /source[-_]?guard|snapshot|invariant/i;

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

async function runRegressionFloor(o: {
  epicWorktreeCwd: string;
  floors: GateFloorLane[] | undefined;
  changedFiles: string[];
  spawn: GateSpawn;
}): Promise<EpicLandGateResult['floor'] | undefined> {
  if (!o.floors || o.floors.length === 0) {
    return undefined;
  }

  const matched = o.floors.filter((lane) => o.changedFiles.some((f) => lane.match.test(f)));
  if (matched.length === 0) {
    return undefined;
  }

  const results: Array<{ command: string; status: 'pass' | 'fail' | 'error'; failing: string[] }> = [];

  for (const lane of matched) {
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

  return { command: matched.map((l) => l.command).join('; '), status: 'pass', failing: [] };
}

export async function runEpicLandGate(o: EpicLandGateOpts): Promise<EpicLandGateResult> {
  const baseRef = o.baseRef ?? 'master';
  const spawn = o.spawn ?? defaultGateSpawn;
  const git = o.git ?? defaultGit;
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
  let epicTipSha: string | null = null;
  let baseSha: string | null = null;

  const tipRes = git(o.epicWorktreeCwd, ['rev-parse', 'HEAD']);
  if (tipRes.code === 0) epicTipSha = tipRes.stdout.trim();

  const baseRes = git(o.repo, ['rev-parse', baseRef]);
  if (baseRes.code === 0) baseSha = baseRes.stdout.trim();

  if (!o.skipCache) {
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
  const mergeBaseRes = git(o.epicWorktreeCwd, ['merge-base', baseRef, 'HEAD']);
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
  const diffRes = git(o.epicWorktreeCwd, ['diff', '--name-only', '--diff-filter=d', mergeBase, 'HEAD']);
  const changedFiles = diffRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const specFiles = changedFiles.filter((p) => SPEC_FILE_RE.test(p));

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
      inherited: [],
      incidents: [],
      reasons: [`land gate: regression floor could not run: ${floor.command}`],
      specFiles,
      epicTipSha,
      baseSha,
    };
  }
  if (floor?.status === 'fail') {
    const reasons = [
      `REGRESSION FLOOR FAILED: ${floor.command}`,
      ...(floor.failing.length ? floor.failing : [lastLines(floor.output ?? '', 20)]),
    ];
    const res: EpicLandGateResult = {
      status: 'fail',
      declared: true,
      manifestPath: decl.manifestPath,
      typecheck,
      floor,
      units: [],
      regressions: [],
      inherited: [],
      incidents: [],
      reasons,
      specFiles,
      epicTipSha,
      baseSha,
    };
    recordEpicLandGate({ epicId: o.epicId, project: o.project, epicTipSha, baseSha, status: 'fail', result: JSON.stringify(res) });
    return res;
  }

  if (specFiles.length === 0) {
    const sweep = await runSourceGuardSweep({ epicWorktreeCwd: o.epicWorktreeCwd, cfg, spawn, git });
    const res: EpicLandGateResult = {
      status: 'pass',
      declared: true,
      manifestPath: decl.manifestPath,
      typecheck,
      floor,
      units: [],
      regressions: [],
      inherited: [],
      incidents: [],
      reasons: ['land gate: no spec files in the epic diff'],
      specFiles: [],
      epicTipSha,
      baseSha,
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
      inherited: [],
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
      inherited: [],
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
        inherited: [],
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
    inherited,
    incidents,
    reasons,
    specFiles,
    epicTipSha,
    baseSha,
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

export function landGateSummary(r: EpicLandGateResult): string {
  if (r.status === 'pass') {
    return `land gate green (${r.specFiles.length} spec file(s)${r.inherited.length > 0 ? `; ${r.inherited.length} also fail on master` : ''})`;
  }
  if (r.status === 'fail') {
    if (r.floor?.status === 'fail' && r.regressions.length === 0) {
      return `land gate FAILED: regression floor (${r.floor.command})`;
    }
    return `land gate FAILED: ${r.regressions.length} regression(s) on the branch, pass on master`;
  }
  if (r.status === 'abstain') {
    return `land gate ABSTAINED (no declared gate)`;
  }
  return `land gate ERROR: ${r.reasons[0] ?? 'unknown'}`;
}
