/**
 * leaf-gate.ts — the G2 MECHANICAL gate the EXECUTOR runs.
 *
 * `final = mechanical AND llm`. The LLM produces FINDINGS; the executor computes the
 * VERDICT. A mechanical fail/error is FINAL — the LLM is never consulted (or, if it
 * already spoke, its opinion is overridden). Domain-free, pure-except-`spawn`: every
 * command is read from the project manifest's `gate` block — nothing here is a
 * repo-specific string.
 */
import { join } from 'node:path';
import type { ProjectManifest, ManifestSource } from '../config/project-manifest';
import { lastLines, extractFailingTests, SPEC_FILE_RE, netNewFailures } from './gate-runner';
import type { LeafReviewVerdict } from './leaf-executor';

/** One resolved test lane: a path scope, a command, and the cwd the command runs in. */
export interface GateTestLane {
  /** Compiled from the manifest's `match` RegExp source. Tested against ROOT-relative paths. */
  match: RegExp;
  command: string;
  /** Worktree-relative; also the prefix stripped from spec paths. */
  cwd?: string;
  /** 'per-file' ⇒ command has `{file}`; 'batch' ⇒ `{files}`. */
  mode: 'per-file' | 'batch';
}

/** One resolved typecheck lane: a path scope and a full command (no substitution). */
export interface GateTypecheckLane {
  /** Compiled from the manifest's `match` RegExp source. Tested against ROOT-relative paths. */
  match: RegExp;
  command: string;
  /** Worktree-relative cwd the command runs in. */
  cwd?: string;
}

/** One resolved suite lane: a path scope and a full command (no substitution). */
export interface GateSuiteLane {
  /** Compiled from the manifest's `match` RegExp source. Tested against ROOT-relative paths. */
  match: RegExp;
  command: string;
  /** Worktree-relative cwd the command runs in. */
  cwd?: string;
}

/** One resolved full-suite FLOOR lane: run once at the EPIC LAND gate (never per-leaf)
 *  whenever any change-set path matches. The command owns its own net-new baseline
 *  comparison — the land gate does NOT re-run a master-worktree baseline for it. */
export interface GateFloorLane {
  /** Compiled from the manifest's `match` RegExp source. Tested against ROOT-relative paths. */
  match: RegExp;
  command: string;
  /** Worktree-relative cwd the command runs in. */
  cwd?: string;
}

/** Project-declared mechanical gate. Every command is a shell string run via `sh -c`.
 *  NOTHING here is defaulted to a command — an undeclared gate runs no command. */
export interface LeafGateConfig {
  /** Whole-repo static check, run at leaf HEAD and at the epic base. e.g. `npx tsc --noEmit`. */
  typecheck?: string;
  /** Per-file test command, run ONCE PER change-set spec file. `{file}` is substituted with a
   *  shell-quoted path relative to `testCwd`. One file at a time — `bun test <file>`. */
  test?: string;
  /** cwd for `test`, relative to the worktree root; also the prefix stripped from spec paths. */
  testCwd?: string;
  /** Multi-lane test configuration: each lane matches a path pattern and has its own command/cwd. */
  tests?: GateTestLane[];
  /** Change-set-scoped project typecheck lanes: each lane runs its FULL command when a change-set path matches. */
  typechecks?: GateTypecheckLane[];
  /** Change-set-triggered full-suite lanes: each lane runs its FULL command when a change-set path matches, with NO change-set narrowing of failures (catches regressions in untouched files in the matched subtree). */
  suites?: GateSuiteLane[];
  /** Land-only full-suite lanes: the FULL command runs ONCE at the EPIC LAND gate — never
   *  per-leaf — whenever any change-set path matches `match`. The command owns its own
   *  net-new baseline comparison; the land gate does not re-run a master-worktree baseline
   *  for it. Parsed/validated here; not yet consumed by any gate (config plumbing only). */
  floors?: GateFloorLane[];
  /** OPTIONAL full-suite command run ONLY at the epic base (once per epic), never per leaf.
   *  Absent ⇒ the base check is `typecheck` alone. */
  baseTest?: string;
}

export type GateSpawn = (cwd: string, command: string) => Promise<{ ran: boolean; code?: number; output: string }>;

/** Per-lane baseline failure fingerprints collected at the epic base. Keyed by a stable
 *  per-lane string (`'typecheck'`, `'baseTest'`, `` `typechecks:${match.source}` ``, etc.);
 *  each value is the `string[]` fingerprint set (the shape `netNewFailures` diffs by
 *  substring). Empty map ⇒ a fully-green base. */
export type LaneBaselineMap = Record<string, string[]>;

export interface LeafGateResult {
  /** 'pass' = every declared command ran and exited 0 (or none were declared).
   *  'fail'  = a command RAN and reported failure  → a FINDING (the leaf's work is bad).
   *  'error' = a command COULD NOT RUN, or its input was undeterminable → an INCIDENT. */
  status: LeafReviewVerdict;
  /** The command that produced the status (the failing/erroring one). */
  command?: string;
  /** Captured stdout+stderr of that command, verbatim (callers truncate for display). */
  output: string;
  /** One-line human reasons, most specific first. */
  reasons: string[];
  /** FALSE when the project declared no gate at all — the mechanical layer abstained.
   *  status is 'pass' in that case, so the LLM verdict alone decides (today's behaviour
   *  for every project that has not opted in). This is the ONLY way to get a `pass`
   *  without a command running, and it is a config fact, not an LLM output. */
  declared: boolean;
  /** For the multi-lane form: change-set spec files that matched no lane (a config gap). */
  unmatchedSpecs?: string[];
  /** Base-gate only: per-lane baseline failure fingerprints for every RAN-but-failed lane.
   *  Present on 'pass' (empty on a green base) and 'fail' results; absent on 'error'. A
   *  new, separately-consumed artifact — it does NOT affect pass/fail/error semantics. */
  baselineFailures?: LaneBaselineMap;
  /** Leaf-gate only: lanes that ran RED at leaf HEAD but reproduced ONLY baseline
   *  fingerprints already failing at the epic base — passed rather than failed. Present
   *  only when at least one lane was baseline-only; does NOT affect pass/fail/error
   *  semantics for lanes whose baseline is empty (the default). */
  baselineOnly?: string[];
}

// --- lane validation and normalization ───────────────────────────────────

/** Escape a string for use in a RegExp, converting all special chars to literals. */
function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalize and validate the `gate.tests` array. Returns { lanes, error } where
 *  exactly one is present. Throws are NOT allowed — errors are returned as strings. */
function normalizeLanes(
  raw: unknown,
): { lanes: GateTestLane[] | null; error: string | null } {
  if (raw === undefined || raw === null) return { lanes: null, error: null };

  if (!Array.isArray(raw)) {
    return { lanes: null, error: 'gate.tests must be a non-empty array' };
  }

  if (raw.length === 0) {
    return { lanes: null, error: 'gate.tests must be a non-empty array' };
  }

  const lanes: GateTestLane[] = [];
  for (let i = 0; i < raw.length; i++) {
    const lane = raw[i];
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
      return { lanes: null, error: `gate.tests[${i}] must declare a non-empty match and command` };
    }

    const { match, command, cwd } = lane as Record<string, unknown>;

    if (typeof match !== 'string' || !match.trim()) {
      return { lanes: null, error: `gate.tests[${i}] must declare a non-empty match and command` };
    }

    if (typeof command !== 'string' || !command.trim()) {
      return { lanes: null, error: `gate.tests[${i}] must declare a non-empty match and command` };
    }

    // Validate regexp.
    let compiledMatch: RegExp;
    try {
      compiledMatch = new RegExp(match);
    } catch {
      return { lanes: null, error: `gate.tests[${i}].match is not a valid regexp: ${match}` };
    }

    // Check for exactly one of {file} or {files}.
    const hasFile = /\{file\}/.test(command);
    const hasFiles = /\{files\}/.test(command);
    if (!(hasFile || hasFiles) || (hasFile && hasFiles)) {
      return {
        lanes: null,
        error: `gate.tests[${i}].command must contain exactly one of {file} or {files}`,
      };
    }

    const mode = hasFile ? 'per-file' : 'batch';
    const cwdTrimmed = (cwd as string | undefined)?.trim() || undefined;

    lanes.push({
      match: compiledMatch,
      command: command.trim(),
      cwd: cwdTrimmed,
      mode,
    });
  }

  return { lanes, error: null };
}

/** Normalize and validate the `gate.typechecks` array. Returns { lanes, error } where
 *  exactly one is present. Throws are NOT allowed — errors are returned as strings. */
function normalizeTypecheckLanes(
  raw: unknown,
): { lanes: GateTypecheckLane[] | null; error: string | null } {
  if (raw === undefined || raw === null) return { lanes: null, error: null };

  if (!Array.isArray(raw)) {
    return { lanes: null, error: 'gate.typechecks must be a non-empty array' };
  }

  if (raw.length === 0) {
    return { lanes: null, error: 'gate.typechecks must be a non-empty array' };
  }

  const lanes: GateTypecheckLane[] = [];
  for (let i = 0; i < raw.length; i++) {
    const lane = raw[i];
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
      return { lanes: null, error: `gate.typechecks[${i}] must declare a non-empty match and command` };
    }

    const { match, command, cwd } = lane as Record<string, unknown>;

    if (typeof match !== 'string' || !match.trim()) {
      return { lanes: null, error: `gate.typechecks[${i}] must declare a non-empty match and command` };
    }

    if (typeof command !== 'string' || !command.trim()) {
      return { lanes: null, error: `gate.typechecks[${i}] must declare a non-empty match and command` };
    }

    // Validate regexp.
    let compiledMatch: RegExp;
    try {
      compiledMatch = new RegExp(match);
    } catch {
      return { lanes: null, error: `gate.typechecks[${i}].match is not a valid regexp: ${match}` };
    }

    const cwdTrimmed = (cwd as string | undefined)?.trim() || undefined;

    lanes.push({
      match: compiledMatch,
      command: command.trim(),
      cwd: cwdTrimmed,
    });
  }

  return { lanes, error: null };
}

/** Normalize and validate the `gate.suites` array. Returns { lanes, error } where
 *  exactly one is present. Throws are NOT allowed — errors are returned as strings. */
function normalizeSuiteLanes(
  raw: unknown,
): { lanes: GateSuiteLane[] | null; error: string | null } {
  if (raw === undefined || raw === null) return { lanes: null, error: null };

  if (!Array.isArray(raw)) {
    return { lanes: null, error: 'gate.suites must be a non-empty array' };
  }

  if (raw.length === 0) {
    return { lanes: null, error: 'gate.suites must be a non-empty array' };
  }

  const lanes: GateSuiteLane[] = [];
  for (let i = 0; i < raw.length; i++) {
    const lane = raw[i];
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
      return { lanes: null, error: `gate.suites[${i}] must declare a non-empty match and command` };
    }

    const { match, command, cwd } = lane as Record<string, unknown>;

    if (typeof match !== 'string' || !match.trim()) {
      return { lanes: null, error: `gate.suites[${i}] must declare a non-empty match and command` };
    }

    if (typeof command !== 'string' || !command.trim()) {
      return { lanes: null, error: `gate.suites[${i}] must declare a non-empty match and command` };
    }

    // Validate regexp.
    let compiledMatch: RegExp;
    try {
      compiledMatch = new RegExp(match);
    } catch {
      return { lanes: null, error: `gate.suites[${i}].match is not a valid regexp: ${match}` };
    }

    const cwdTrimmed = (cwd as string | undefined)?.trim() || undefined;

    lanes.push({
      match: compiledMatch,
      command: command.trim(),
      cwd: cwdTrimmed,
    });
  }

  return { lanes, error: null };
}

/** Normalize and validate the `gate.floors` array. Returns { lanes, error } where
 *  exactly one is present. Throws are NOT allowed — errors are returned as strings. */
function normalizeFloorLanes(
  raw: unknown,
): { lanes: GateFloorLane[] | null; error: string | null } {
  if (raw === undefined || raw === null) return { lanes: null, error: null };

  if (!Array.isArray(raw)) {
    return { lanes: null, error: 'gate.floors must be a non-empty array' };
  }

  if (raw.length === 0) {
    return { lanes: null, error: 'gate.floors must be a non-empty array' };
  }

  const lanes: GateFloorLane[] = [];
  for (let i = 0; i < raw.length; i++) {
    const lane = raw[i];
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
      return { lanes: null, error: `gate.floors[${i}] must declare a non-empty match and command` };
    }

    const { match, command, cwd } = lane as Record<string, unknown>;

    if (typeof match !== 'string' || !match.trim()) {
      return { lanes: null, error: `gate.floors[${i}] must declare a non-empty match and command` };
    }

    if (typeof command !== 'string' || !command.trim()) {
      return { lanes: null, error: `gate.floors[${i}] must declare a non-empty match and command` };
    }

    // Validate regexp.
    let compiledMatch: RegExp;
    try {
      compiledMatch = new RegExp(match);
    } catch {
      return { lanes: null, error: `gate.floors[${i}].match is not a valid regexp: ${match}` };
    }

    const cwdTrimmed = (cwd as string | undefined)?.trim() || undefined;

    lanes.push({
      match: compiledMatch,
      command: command.trim(),
      cwd: cwdTrimmed,
    });
  }

  return { lanes, error: null };
}

/** Build a single legacy lane from the old-shape `test`/`testCwd` config. */
function legacyLane(test: string, testCwd: string | undefined): GateTestLane {
  const prefix = testCwd ? escapeRe(testCwd.replace(/\/+$/, '')) : '';
  const pattern = prefix ? `^${prefix}/` : '.';
  const hasFiles = /\{files\}/.test(test);

  return {
    match: new RegExp(pattern),
    command: test,
    cwd: testCwd,
    mode: hasFiles ? 'batch' : 'per-file',
  };
}

/** Bridge legacy top-level manifest keys (`changeSetTestCommand`, `changeSetTestCwd`,
 *  `gateCommand`, `frontendGateCommand`) into a `LeafGateConfig`. Returns null when
 *  no runnable legacy keys are present. Builds `GateTestLane`/`GateSuiteLane` objects
 *  directly without validation (no `normalizeLanes` call). */
export function bridgeLegacyGate(m: ProjectManifest): LeafGateConfig | null {
  const changeSetTestCommand = m.changeSetTestCommand?.trim() || undefined;
  const changeSetTestCwd = m.changeSetTestCwd?.trim() || undefined;
  const gateCommand = m.gateCommand?.trim() || undefined;
  const frontendGateCommand = m.frontendGateCommand?.trim() || undefined;

  const tests: GateTestLane[] | undefined = changeSetTestCommand
    ? [{ match: /./, command: changeSetTestCommand, cwd: changeSetTestCwd, mode: 'batch' }]
    : undefined;

  const suites: GateSuiteLane[] = [];
  if (gateCommand) suites.push({ match: /./, command: gateCommand });
  if (frontendGateCommand) suites.push({ match: /./, command: frontendGateCommand });

  if (!tests && suites.length === 0) return null;
  return { tests, suites: suites.length > 0 ? suites : undefined };
}

/** Returns the project's declared gate, normalised (trim; drop empty strings; `null`
 *  when neither `typecheck` nor `test` nor `baseTest` nor `tests` nor `typechecks` survives). */
export function resolveLeafGate(m: ProjectManifest | null): LeafGateConfig | null {
  const g = m?.gate;
  if (!g) return m ? bridgeLegacyGate(m) : null;
  const typecheck = g.typecheck?.trim() || undefined;
  const test = g.test?.trim() || undefined;
  const testCwd = g.testCwd?.trim() || undefined;
  const baseTest = g.baseTest?.trim() || undefined;

  // Parse and validate lanes (will return null error if any).
  const { lanes, error: laneError } = normalizeLanes(g.tests);
  // If there's a lane error, resolveLeafGate returns null; the error is reported
  // by resolveGateDeclaration.
  if (laneError) return null;

  // Parse and validate typechecks lanes (will return null error if any).
  const { lanes: typecheckLanes, error: typecheckLaneError } = normalizeTypecheckLanes(g.typechecks);
  if (typecheckLaneError) return null;

  // Parse and validate suite lanes (will return null error if any).
  const { lanes: suiteLanes, error: suiteLaneError } = normalizeSuiteLanes(g.suites);
  if (suiteLaneError) return null;

  // Parse and validate floor lanes (will return null error if any).
  const { lanes: floorLanes, error: floorLaneError } = normalizeFloorLanes(g.floors);
  if (floorLaneError) return null;

  // Neither single-test nor multi-lane form nor typecheck lanes nor typecheck nor suite lanes
  // nor floor lanes survives — fall back to the legacy top-level bridge (empty gate block).
  if (!typecheck && !test && !baseTest && !lanes && !typecheckLanes && !suiteLanes && !floorLanes) return bridgeLegacyGate(m);

  return { typecheck, test, testCwd, baseTest, tests: lanes || undefined, typechecks: typecheckLanes || undefined, suites: suiteLanes || undefined, floors: floorLanes || undefined };
}

/** Why the mechanical layer will or will not run. Three outcomes, not two: an ABSENT gate is
 *  an abstention (the leaf runs, the LLM alone decides, and we say so); a MISCONFIGURED one is
 *  an INFRA error (G1) — a malformed manifest must never read as "no gate wanted". */
export type GateDeclaration =
  | { kind: 'declared'; cfg: LeafGateConfig; manifestPath: string }
  | { kind: 'absent'; manifestPath: string; reason: string }
  | { kind: 'misconfigured'; manifestPath: string; reason: string };

/** Classify a manifest source into a gate declaration. `gate === undefined` is checked
 *  BEFORE {@link resolveLeafGate}, because that function collapses "no gate block" and
 *  "empty gate block" into the same null — here they must read differently (absent vs
 *  misconfigured). */
export function resolveGateDeclaration(src: ManifestSource): GateDeclaration {
  if (src.state === 'absent') {
    return { kind: 'absent', manifestPath: src.path, reason: 'no .collab/project.json — no mechanical gate declared' };
  }
  if (src.state === 'malformed') {
    return { kind: 'misconfigured', manifestPath: src.path, reason: '.collab/project.json exists but is not valid JSON' };
  }
  const manifest = src.manifest;
  const gate = manifest?.gate;
  if (gate === undefined) {
    const bridged = manifest ? bridgeLegacyGate(manifest) : null;
    if (bridged) return { kind: 'declared', cfg: bridged, manifestPath: src.path };
    return { kind: 'absent', manifestPath: src.path, reason: 'manifest declares no gate block' };
  }
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: 'gate must be an object' };
  }

  // Check for both test and tests declared.
  if (gate.test && gate.tests) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: 'gate declares both test and tests' };
  }

  // Check lane validity.
  const { error: laneError } = normalizeLanes(gate.tests);
  if (laneError) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: laneError };
  }

  // Check typecheck lane validity.
  const { error: typecheckLaneError } = normalizeTypecheckLanes(gate.typechecks);
  if (typecheckLaneError) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: typecheckLaneError };
  }

  // Check suite lane validity.
  const { error: suiteLaneError } = normalizeSuiteLanes(gate.suites);
  if (suiteLaneError) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: suiteLaneError };
  }

  // Check floor lane validity.
  const { error: floorLaneError } = normalizeFloorLanes(gate.floors);
  if (floorLaneError) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: floorLaneError };
  }

  const cfg = resolveLeafGate(manifest);
  if (!cfg) {
    return {
      kind: 'misconfigured',
      manifestPath: src.path,
      reason: 'gate block declares no usable command (typecheck/test/baseTest/tests/typechecks/suites/floors all empty)',
    };
  }
  return { kind: 'declared', cfg, manifestPath: src.path };
}

/** The LeafGateResult a misconfigured declaration produces WITHOUT running anything, or null when
 *  the gate should proceed (declared → run it; absent → abstain). `status:'error'` routes through
 *  the executor's existing INFRA arm: park blocked + escalate, never 'fail', never 'pass'.
 *  Carries NO `command` — nothing is defaulted to a command. */
export function gateResultForDeclaration(d: GateDeclaration): LeafGateResult | null {
  if (d.kind !== 'misconfigured') return null;
  return { status: 'error', output: '', reasons: [`gate misconfigured: ${d.reason} (${d.manifestPath})`], declared: false };
}

/** The lattice: `AND` over `error < fail < pass`, restricted so `pass` requires BOTH.
 *  This is NOT "whichever spoke last" — a mechanical fail/error is FINAL and the LLM
 *  is never consulted (or its verdict is overridden); an LLM that was never asked
 *  (llm === null) cannot RATIFY a mechanical pass into a final pass. */
export function composeVerdict(mech: LeafReviewVerdict, llm: LeafReviewVerdict | null): LeafReviewVerdict {
  if (mech !== 'pass') return mech; // a mechanical fail/error is FINAL. LLM never consulted.
  return llm ?? 'error'; // an unconsulted LLM cannot RATIFY.
}

/** Real GateSpawn: `sh -c <command>` in `cwd`. A spawn error or a signal-killed
 *  process (null status — e.g. OOM) both read as `ran:false` (INFRA, never a finding).
 *  MUST stay a真 async spawn: a gate run (bun test / tsc / bunx vitest) takes tens of
 *  seconds to minutes, and the old spawnSync here held the sidecar's event loop for the
 *  full duration — once the ui-vitest lane pushed gate time past the Electron liveness
 *  watchdog's 45s threshold, the sidecar was silently kill+respawned on every gate run
 *  (2026-07-22 20:05-20:45 crash-loop). */
export const defaultGateSpawn: GateSpawn = async (cwd, command) => {
  try {
    const proc = Bun.spawn(['sh', '-c', command], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (proc.signalCode != null) {
      return { ran: false, code: -1, output: `${stdout}${stderr}` };
    }
    return { ran: true, code, output: `${stdout}${stderr}` };
  } catch (e) {
    return { ran: false, code: -1, output: e instanceof Error ? (e.message ?? String(e)) : String(e) };
  }
};

/** Diff a lane's RAN-red failure fingerprints against its epic-base baseline. Fail-closed:
 *  an unparsed lane failure (`failing.length === 0`) is always treated as net-new — a lane
 *  that reported failure but produced no attributable fingerprints must never pass silently
 *  by "matching" an empty baseline. */
function classifyRedLane(failing: string[], baseline: string[]): { netNew: string[] } {
  if (failing.length === 0) return { netNew: ['(unparsed lane failure)'] };
  return { netNew: netNewFailures(failing, baseline) };
}

/** Run the project-declared gate in a leaf worktree, at this leaf's HEAD, scoped to
 *  its own change-set for the per-file test command. Never guesses: an unreadable
 *  change-set with a declared `test` command is 'error', not 'fail'. */
export async function runLeafGate(
  cwd: string,
  cfg: LeafGateConfig | null,
  changeSet: readonly string[] | null,
  spawn: GateSpawn,
  baselines?: LaneBaselineMap | null,
  resolveLaneBaseline?: (laneKey: string, commands: readonly string[], laneCwd?: string) => Promise<string[] | null>,
): Promise<LeafGateResult> {
  if (!cfg) return { status: 'pass', output: '', reasons: ['gate: none declared'], declared: false };

  const baselineOnly: string[] = [];

  if (cfg.typecheck) {
    const r = await spawn(cwd, cfg.typecheck);
    if (!r.ran) {
      return {
        status: 'error',
        command: cfg.typecheck,
        output: r.output,
        reasons: [`gate could not run: ${cfg.typecheck}`],
        declared: true,
      };
    }
    if (r.code !== 0) {
      // Attribute the diagnostics: a whole-tree typecheck can report errors in files this
      // leaf never touched (a stale base, a foreign leaf's half-landed work). Only fail the
      // leaf when at least one error is INSIDE its own change-set; errors confined entirely
      // to files outside it are an INFRA incident, not this leaf's finding. Fail-closed when
      // the changeSet is unknown (null) or the diagnostics don't parse into file paths at all.
      const foreignFiles = changeSet !== null ? foreignOnlyTypecheckFiles(r.output, changeSet) : null;
      if (foreignFiles) {
        return {
          status: 'error',
          command: cfg.typecheck,
          output: r.output,
          reasons: [
            `foreign-typecheck-errors: typecheck failed only in file(s) outside this leaf's change-set: ${foreignFiles.join(', ')}`,
            lastLines(r.output, 20),
          ],
          declared: true,
        };
      }
      const failing = parseTypecheckFiles(r.output);
      if (failing === null) {
        return {
          status: 'fail',
          command: cfg.typecheck,
          output: r.output,
          reasons: [`typecheck failed: ${cfg.typecheck}`, lastLines(r.output, 20)],
          declared: true,
        };
      }
      const { netNew } = classifyRedLane(failing, baselines?.['typecheck'] ?? []);
      if (netNew.length === 0) {
        baselineOnly.push(...failing);
      } else {
        return {
          status: 'fail',
          command: cfg.typecheck,
          output: r.output,
          reasons: [`typecheck failed: ${cfg.typecheck}`, ...netNew.slice(0, 20)],
          declared: true,
        };
      }
    }
  }

  const normalizedChangeSet = changeSet !== null ? changeSet.map(normPathLocal) : null;

  // Test section: either multi-lane or legacy single-test form.
  const lanes = resolveLanes(cfg);
  if (lanes) {
    if (normalizedChangeSet === null) {
      return {
        status: 'error',
        output: '',
        reasons: ['gate: change-set unreadable'],
        declared: true,
      };
    }

    // Normalize paths to root-relative (no leading ./, no quotes).
    const allSpecs = normalizedChangeSet.filter((p) => SPEC_FILE_RE.test(p));

    // Route each spec to the first matching lane, or track unmatched.
    const { byLane, unmatched } = routeSpecsToLanes(allSpecs, lanes);

    // CONFIG GAP: unmatched specs in the multi-lane form (not the legacy form).
    if (unmatched.length > 0 && cfg.tests) {
      const reasons = [
        `gate: ${unmatched.length} change-set spec file(s) match NO test lane — the gate cannot verify them`,
        ...unmatched.map((p) => `  unmatched spec: ${p}`),
        'add a lane to gate.tests in .collab/project.json',
      ];
      console.warn(...reasons);
      return {
        status: 'error',
        output: '',
        reasons,
        declared: true,
        unmatchedSpecs: unmatched,
      };
    }

    // Execute commands for each lane, in order, tracking failures PER LANE so each
    // diffs against its own baseline (a lane's red is only "known" against ITS base run).
    const laneRuns: Array<{ lane: GateTestLane; commands: string[]; failures: Array<{ command: string; output: string }> }> = [];
    for (const lane of lanes) {
      const files = byLane.get(lane);
      if (!files?.length) continue;

      const laneCwd = lane.cwd ? join(cwd, lane.cwd) : cwd;

      // Expand {file} or {files} based on the mode.
      const commands = expandLaneCommands(lane, files);
      const failures: Array<{ command: string; output: string }> = [];

      for (const command of commands) {
        const r = await spawn(laneCwd, command);
        if (!r.ran) {
          return {
            status: 'error',
            command,
            output: r.output,
            reasons: [`gate could not run: ${command}`],
            declared: true,
          };
        }
        if (r.code !== 0) failures.push({ command, output: r.output });
      }

      laneRuns.push({ lane, commands, failures });
    }

    for (const { lane, commands, failures: laneFailures } of laneRuns) {
      if (laneFailures.length === 0) continue;

      const laneKey = `tests:${lane.match.source}`;
      const resolved = resolveLaneBaseline ? await resolveLaneBaseline(laneKey, commands, lane.cwd) : null;

      const output = laneFailures.map((f) => f.output).join('\n').slice(0, 8000);
      const failing = laneFailures.flatMap((f) => extractFailingTests(f.output));
      const { netNew } = classifyRedLane(failing, resolved ?? []);
      if (netNew.length === 0) {
        baselineOnly.push(...failing);
      } else {
        return {
          status: 'fail',
          command: laneFailures[0].command,
          output,
          reasons: [`${laneFailures.length} failing spec file(s)`, ...netNew.slice(0, 20)],
          declared: true,
        };
      }
    }
  }

  if (cfg.typechecks && cfg.typechecks.length > 0) {
    if (normalizedChangeSet === null) {
      return { status: 'error', output: '', reasons: ['gate: change-set unreadable'], declared: true };
    }
    for (const lane of cfg.typechecks) {
      const matching = normalizedChangeSet.filter((p) => lane.match.test(p));
      if (matching.length === 0) continue;

      const laneCwd = lane.cwd ? join(cwd, lane.cwd) : cwd;
      const r = await spawn(laneCwd, lane.command);
      if (!r.ran) {
        return { status: 'error', command: lane.command, output: r.output,
          reasons: [`gate could not run: ${lane.command}`], declared: true };
      }
      if (r.code !== 0) {
        // tsc run from laneCwd reports paths relative to laneCwd, not repo root — strip the
        // lane's cwd prefix the same way routeSpecsToLanes does (leaf-gate.ts:464-467) before
        // attributing, or every in-scope failure misreads as foreign.
        const relChangeSet = lane.cwd
          ? matching.map((p) => p.slice(lane.cwd!.replace(/\/+$/, '').length + 1))
          : matching;
        const foreignFiles = foreignOnlyTypecheckFiles(r.output, relChangeSet);
        if (foreignFiles) {
          return { status: 'error', command: lane.command, output: r.output,
            reasons: [`foreign-typecheck-errors: typecheck failed only in file(s) outside this leaf's change-set: ${foreignFiles.join(', ')}`, lastLines(r.output, 20)],
            declared: true };
        }
        const failing = parseTypecheckFiles(r.output);
        if (failing === null) {
          return { status: 'fail', command: lane.command, output: r.output,
            reasons: [`typecheck failed: ${lane.command}`, lastLines(r.output, 20)], declared: true };
        }
        const { netNew } = classifyRedLane(failing, baselines?.[`typechecks:${lane.match.source}`] ?? []);
        if (netNew.length === 0) {
          baselineOnly.push(...failing);
          continue;
        }
        return { status: 'fail', command: lane.command, output: r.output,
          reasons: [`typecheck failed: ${lane.command}`, ...netNew.slice(0, 20)], declared: true };
      }
    }
  }

  if (cfg.suites && cfg.suites.length > 0) {
    if (normalizedChangeSet === null) {
      return { status: 'error', output: '', reasons: ['gate: change-set unreadable'], declared: true };
    }
    for (const lane of cfg.suites) {
      const matching = normalizedChangeSet.filter((p) => lane.match.test(p));
      if (matching.length === 0) continue;

      const laneCwd = lane.cwd ? join(cwd, lane.cwd) : cwd;
      const r = await spawn(laneCwd, lane.command);
      if (!r.ran) {
        return { status: 'error', command: lane.command, output: r.output,
          reasons: [`gate could not run: ${lane.command}`], declared: true };
      }
      if (r.code !== 0) {
        const failing = extractFailingTests(r.output);
        const { netNew } = classifyRedLane(failing, baselines?.[`suites:${lane.match.source}`] ?? []);
        if (netNew.length === 0) {
          baselineOnly.push(...failing);
          continue;
        }
        return { status: 'fail', command: lane.command, output: r.output,
          reasons: netNew[0] === '(unparsed lane failure)'
            ? [`suite failed: ${lane.command}`, lastLines(r.output, 20)]
            : [`suite failed: ${lane.command}`, ...netNew.slice(0, 20)],
          declared: true };
      }
    }
  }

  return { status: 'pass', output: '', reasons: [], declared: true, baselineOnly: baselineOnly.length ? baselineOnly : undefined };
}

/** The string handed to the `implement` fix node. Deliberately parallel to a review's
 *  findings prose (so the fix node needs no new instruction), and ends with a
 *  `VERDICT: FAIL` line so the existing repeated-finding stuck-detector still fires
 *  on a repeated identical gate failure. */
export function gateFindingsText(r: LeafGateResult): string {
  return [
    'MECHANICAL GATE FAILED — this is not an opinion, it is the project\'s own gate.',
    `command: ${r.command ?? '(unknown)'}`,
    '--- output (tail) ---',
    lastLines(r.output, 60),
    '---',
    'VERDICT: FAIL — mechanical gate',
  ].join('\n');
}

/** The once-per-epic base check: every configured lane kind — `typecheck`, each
 *  `typechecks[]`, each `suites[]`, each `floors[]`, then `baseTest` — run in that fixed
 *  order with the same ran/exit semantics as {@link runLeafGate}. Never runs the per-file
 *  `test` lanes (no change-set at a base) nor substitutes `{file}`/`{files}`.
 *
 *  ADDITIVE vs. the old typecheck→baseTest short-circuit: pass/fail/error verdicts are
 *  unchanged (any RAN failure ⇒ 'fail'; any `ran:false` ⇒ 'error', never cached), but the
 *  gate no longer stops at the first red lane — it runs ALL lanes and memoizes each
 *  RAN-but-failed lane's normalized failure-fingerprint set into `baselineFailures`. That
 *  map rides the 'pass' (empty on a green base) and 'fail' results; it is absent on 'error'.
 *  Lane order keeps `typecheck` before `baseTest` so existing tests still hold. */
export async function runBaseGate(cwd: string, cfg: LeafGateConfig | null, spawn: GateSpawn): Promise<LeafGateResult> {
  if (!cfg) return { status: 'pass', output: '', reasons: [], declared: false };

  const baselineFailures: LaneBaselineMap = {};
  let firstFailCommand: string | undefined;
  let firstFailOutput = '';
  let firstFailReason: string | undefined;

  // Fixed lane order: typecheck → typechecks[] → suites[] → floors[] → baseTest.
  type BaseLane = {
    key: string;
    command: string;
    kind: 'typecheck' | 'tests';
    reason: (cmd: string) => string;
  };
  const lanes: BaseLane[] = [];
  if (cfg.typecheck) {
    lanes.push({ key: 'typecheck', command: cfg.typecheck, kind: 'typecheck', reason: (c) => `typecheck failed: ${c}` });
  }
  for (const l of cfg.typechecks ?? []) {
    lanes.push({ key: `typechecks:${l.match.source}`, command: l.command, kind: 'typecheck', reason: (c) => `typecheck lane failed: ${c}` });
  }
  for (const l of cfg.suites ?? []) {
    lanes.push({ key: `suites:${l.match.source}`, command: l.command, kind: 'tests', reason: (c) => `suite lane failed: ${c}` });
  }
  for (const l of cfg.floors ?? []) {
    lanes.push({ key: `floors:${l.match.source}`, command: l.command, kind: 'tests', reason: (c) => `floor lane failed: ${c}` });
  }
  if (cfg.baseTest) {
    lanes.push({ key: 'baseTest', command: cfg.baseTest, kind: 'tests', reason: (c) => `base test failed: ${c}` });
  }

  for (const lane of lanes) {
    const r = await spawn(cwd, lane.command);
    if (!r.ran) {
      // A lane that COULD NOT RUN is an incident — unchanged semantics: return immediately,
      // no blob (an error is never cached).
      return {
        status: 'error',
        command: lane.command,
        output: r.output,
        reasons: [`gate could not run: ${lane.command}`],
        declared: true,
      };
    }
    if (r.code !== 0) {
      // RAN-but-failed: memoize this lane's fingerprints and CONTINUE — every red lane
      // must be recorded, so no short-circuit.
      baselineFailures[lane.key] = lane.kind === 'typecheck'
        ? (parseTypecheckFiles(r.output) ?? [])
        : extractFailingTests(r.output);
      if (firstFailCommand === undefined) {
        firstFailCommand = lane.command;
        firstFailOutput = r.output;
        firstFailReason = lane.reason(lane.command);
      }
    }
  }

  if (firstFailCommand !== undefined) {
    return {
      status: 'fail',
      command: firstFailCommand,
      output: firstFailOutput,
      reasons: [firstFailReason!, lastLines(firstFailOutput, 20)],
      declared: true,
      baselineFailures,
    };
  }

  return { status: 'pass', output: '', reasons: [], declared: true, baselineFailures };
}

// --- lane primitives (exported for land-gate reuse) --------------------

/** cfg.tests, or the single legacy lane, or null. */
export function resolveLanes(cfg: LeafGateConfig): GateTestLane[] | null {
  return cfg.tests ?? (cfg.test ? [legacyLane(cfg.test, cfg.testCwd)] : null);
}

/** First-match routing + lane-cwd prefix stripping. */
export function routeSpecsToLanes(specs: readonly string[], lanes: readonly GateTestLane[]):
  { byLane: Map<GateTestLane, string[]>; unmatched: string[] } {
  const unmatched: string[] = [];
  const byLane = new Map<GateTestLane, string[]>();
  for (const spec of [...new Set(specs)]) {
    const lane = lanes.find((l) => l.match.test(spec));
    if (!lane) {
      unmatched.push(spec);
      continue;
    }
    // Strip the lane's cwd prefix from the spec path.
    const rel = lane.cwd
      ? spec.slice(lane.cwd.replace(/\/+$/, '').length + 1)
      : spec;
    const laneSpecs = byLane.get(lane) ?? [];
    laneSpecs.push(rel);
    byLane.set(lane, laneSpecs);
  }
  return { byLane, unmatched };
}

/** {file}/{files} expansion for one lane. */
export function expandLaneCommands(lane: GateTestLane, files: readonly string[]): string[] {
  return lane.mode === 'per-file'
    ? files.map((f) => lane.command.replace(/\{file\}/g, shellQuote(f)))
    : [lane.command.replace(/\{files\}/g, files.map(shellQuote).join(' '))];
}

// --- local helpers (kept private — no new cross-module surface) --------------------

/** Single-quote a path for `sh -c`, escaping any embedded single quotes. */
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

/** Normalize a path by dropping leading `./` and surrounding quotes. Mirrors gate-runner's normPath. */
function normPathLocal(p: string): string {
  return p.trim().replace(/^"(.*)"$/, '$1').replace(/^\.\//, '');
}

/** tsc's two diagnostic line shapes: `path/file.ts(12,5): error TS1234: ...` (the default
 *  pretty-less format) and `path/file.ts:12:5 - error TS1234: ...` (`--pretty` format).
 *  Returns the DISTINCT file paths named by every `error TS` line, or null when NOTHING
 *  parses — the caller must fail-closed (treat as an ordinary in-scope failure) rather
 *  than guess at attribution from unrecognised output. */
export function parseTypecheckFiles(output: string): string[] | null {
  const reParen = /^(.+?)\((\d+),(\d+)\):\s*error\s+TS\d+/;
  const reColon = /^(.+?):(\d+):(\d+)\s*-\s*error\s+TS\d+/;
  const files = new Set<string>();
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    const m = reParen.exec(line) ?? reColon.exec(line);
    if (m) files.add(normPathLocal(m[1]));
  }
  return files.size > 0 ? Array.from(files) : null;
}

/** Attribute a failed typecheck's diagnostics against the leaf's change-set. Returns the
 *  list of offending files ONLY when EVERY parsed error file is OUTSIDE the change-set
 *  (a pure foreign/base-drift incident); returns null when any error is in-scope (the leaf
 *  owns at least one of the failures — a normal fail, mixed dominates in-set) OR when the
 *  output didn't parse into any file paths at all (fail-closed on the unparseable case). */
function foreignOnlyTypecheckFiles(output: string, changeSet: readonly string[]): string[] | null {
  const parsed = parseTypecheckFiles(output);
  if (!parsed) return null;
  const inSet = new Set(changeSet.map(normPathLocal));
  const inScope = parsed.filter((f) => inSet.has(f));
  return inScope.length === 0 ? parsed : null;
}
