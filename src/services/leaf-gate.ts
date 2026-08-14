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
import { existsSync } from 'node:fs';
import { isQuarantined } from './quarantine.js';
import type { ProjectManifest, ManifestSource } from '../config/project-manifest';
import { lastLines, extractFailingTests, synthesizeLaneFailureIdentity, SPEC_FILE_RE, netNewFailures } from './gate-runner';
import type { LeafReviewVerdict } from './leaf-executor';
import type { Todo } from './todo-store';
import { createEscalation } from './supervisor-store';
import { recordEpicBaseGate, getEpicBaseGate, getBaseGateVerdict, shouldHonourCachedBaseGate, recordBaseGateTestRuns, listWatchedTests } from './worker-ledger';
import { baseGateKey, runBaseGateShared, quarantineSetHash, sharedVerdictKey, BASE_GATE_FAIL_VERDICT_TTL_MS } from './base-gate-coalescer.js';
import { extractGateFailingFiles } from './gate-base-attribution';
import { memoizedTsc } from './tsc-memo';
import { planImpactedBaseGate, narrowBaseGateConfig, type ImpactedBaseGateOpts } from './base-gate-impacted.js';
import { activeQuarantine, runQuarantineCeremonies } from './flaky-quarantine';
import { isDepOptimizerCorruption } from './dep-optimizer-corruption.js';
import type { PoisonedCheckout } from './checkout-poison-guard.js';
import { quarantineCoversFailure } from './quarantine-match';

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
  /** Base-gate only, resolveBaseGreen fresh-run path: the sorted union of fail-lane
   *  fingerprints when a 'fail' result was downgraded to 'pass' because every one is
   *  present in the project's active quarantine (flaky-quarantine.ts activeQuarantine).
   *  Reporting only — never affects a lane whose failures are not ALL quarantined — and
   *  present only when a downgrade actually happened. */
  quarantinedOnlyFailures?: string[];
  /** Base-gate only: present when a `checkout` dep was supplied and a poison probe fired.
   *  `paths` = the poisoned files reported by the probe; `restored` = the subset the restore
   *  step actually cleaned (empty when no restore dep or restore failed). Reporting only —
   *  never affects status semantics. */
  poisonedCheckout?: { paths: string[]; restored: string[] };
  /** Leaf-gate only: true when the diff contains ONLY spec (test) files and a lane failed.
   *  A leaf that ships no production change must not be accepted on a red test. */
  hollow?: boolean;
  /** Base-gate only: present when the gate ran an IMPACTED SUBSET of the suite anchored on
   *  a full-suite green of trunk sha `anchor` (base-gate-impacted.ts). Rides into the
   *  persisted shared verdict via resultJson — that is the HONESTY marker: a PASS carrying
   *  this field may be served to leaves, but is never accepted as the green anchor for a
   *  further impacted run (isFullSuiteAnchorVerdict). Reporting/marker only — never affects
   *  pass/fail/error semantics. */
  impactedBase?: { anchor: string; ran: number; candidates: number };
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

/** Detect an unfiltered `scripts/test-backend.ts` invocation in a command.
 *  Returns true iff the command runs the full suite with no change-set narrowing.
 *  - `{file}` or `{files}` template ⇒ false (filtered by file/files)
 *  - Any bare (non-flag) token after the script name ⇒ false (selection present)
 *  - Otherwise ⇒ true (unfiltered) */
export function isUnfilteredFullSuiteCommand(command: string): boolean {
  if (!/scripts\/test-backend\.ts/.test(command)) return false;
  if (/\{files?\}/.test(command)) return false;
  const afterScript = command.split('scripts/test-backend.ts')[1] ?? '';
  const tokens = afterScript.trim().split(/\s+/).filter(Boolean);
  return !tokens.some((t) => !t.startsWith('-'));
}

/** Check if any command in a set of lanes is an unfiltered full-suite command.
 *  Returns a reason string on a hit, or null if all commands are OK. */
function findUnfilteredFullSuiteLane(kind: string, commands: readonly string[]): string | null {
  for (const command of commands) {
    if (isUnfilteredFullSuiteCommand(command)) {
      return `gate.${kind}[] declares an unfiltered scripts/test-backend.ts command: ${command} — move it to gate.floors[] (epic base + land only)`;
    }
  }
  return null;
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
    if (bridged) {
      // Check legacy-bridged commands for unfiltered full-suite.
      const testCmds = bridged.tests?.map((lane) => lane.command) ?? [];
      const suiteCmds = bridged.suites?.map((lane) => lane.command) ?? [];
      const legacyTestReason = findUnfilteredFullSuiteLane('tests', testCmds);
      if (legacyTestReason) return { kind: 'misconfigured', manifestPath: src.path, reason: legacyTestReason };
      const legacySuiteReason = findUnfilteredFullSuiteLane('suites', suiteCmds);
      if (legacySuiteReason) return { kind: 'misconfigured', manifestPath: src.path, reason: legacySuiteReason };
      return { kind: 'declared', cfg: bridged, manifestPath: src.path };
    }
    return { kind: 'absent', manifestPath: src.path, reason: 'manifest declares no gate block' };
  }
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: 'gate must be an object' };
  }

  // Check for both test and tests declared.
  if (gate.test && gate.tests) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: 'gate declares both test and tests' };
  }

  // Check lane validity and capture lanes.
  const { lanes: testLanes, error: laneError } = normalizeLanes(gate.tests);
  if (laneError) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: laneError };
  }

  // Check typecheck lane validity and capture lanes.
  const { lanes: typecheckLanes, error: typecheckLaneError } = normalizeTypecheckLanes(gate.typechecks);
  if (typecheckLaneError) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: typecheckLaneError };
  }

  // Check suite lane validity and capture lanes.
  const { lanes: suiteLanes, error: suiteLaneError } = normalizeSuiteLanes(gate.suites);
  if (suiteLaneError) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: suiteLaneError };
  }

  // Check floor lane validity (floors are exempt from the unfiltered-full-suite check).
  const { error: floorLaneError } = normalizeFloorLanes(gate.floors);
  if (floorLaneError) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: floorLaneError };
  }

  // Check for unfiltered full-suite commands in tests, typechecks, and suites (not floors).
  const testCmds = testLanes?.map((lane) => lane.command) ?? [];
  const testReason = findUnfilteredFullSuiteLane('tests', testCmds);
  if (testReason) return { kind: 'misconfigured', manifestPath: src.path, reason: testReason };

  const typecheckCmds = typecheckLanes?.map((lane) => lane.command) ?? [];
  const typecheckReason = findUnfilteredFullSuiteLane('typechecks', typecheckCmds);
  if (typecheckReason) return { kind: 'misconfigured', manifestPath: src.path, reason: typecheckReason };

  const suiteCmds = suiteLanes?.map((lane) => lane.command) ?? [];
  const suiteReason = findUnfilteredFullSuiteLane('suites', suiteCmds);
  if (suiteReason) return { kind: 'misconfigured', manifestPath: src.path, reason: suiteReason };

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
export const DEFAULT_GATE_NICE = 10;

/**
 * Scheduling niceness for gate/build children. 0 disables the wrapper entirely.
 *
 * A NEGATIVE value is refused rather than honoured: it would RAISE these children above the
 * sidecar, which is the exact opposite of the point, and it needs privilege it will not have.
 */
export function gateNiceness(): number {
  const raw = process.env.MERMAID_GATE_NICE;
  if (raw === undefined || raw === '') return DEFAULT_GATE_NICE;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_GATE_NICE;
  return Math.floor(n);
}

/**
 * Argv for a gate lane, deprioritised below the sidecar.
 *
 * MEASURED 2026-08-10. The sidecar was SIGKILLed three times in fifteen minutes with ZERO gate
 * runners active and the concurrency cap holding. The box was at load 15 on 14 cores, and the
 * dominant consumer was a single `vite` build inside an epic worktree at 659% CPU — a leaf's own
 * UI build, six and a half cores of it.
 *
 * The tell that this is starvation rather than blocking: the watchdog's probe latencies were a
 * MIXTURE (1818, 5000, 746, 1536, 515 ms), not pinned at the timeout. A blocked event loop times
 * out consistently. A ragged spread means the process was ready to answer and simply was not
 * scheduled. So the sidecar was not stuck inside its own query — it was losing the CPU to
 * children it had spawned itself.
 *
 * Priority is the proportionate fix. The sidecar must answer a health probe every 15 seconds or
 * be killed; a build has no deadline at all, and finishing it a little slower costs nothing.
 * `nice` is inherited, so wrapping the lane covers its whole process tree — the vite workers
 * included, which is what actually matters here.
 *
 * What this does NOT do: nice governs CPU only, not I/O or memory, and it cannot help if the
 * competing load comes from outside this process tree (on the measured box, a separate Electron
 * app held ~210%). It removes the self-inflicted share, which is the share we control.
 */
/** The resident timeout warden (see gateSpawnArgv): own pgroup, group-KILL on alarm,
 *  exit-status passthrough otherwise. Exposed for the argv test. */
export const GATE_WARDEN_PERL =
  'setpgrp(0,0); $SIG{ALRM}=sub{warn "gate hard-timeout\\n"; kill "KILL", -$$}; ' +
  'alarm(shift @ARGV); my $rc = system(@ARGV); ' +
  'exit($rc == -1 ? 127 : ($rc & 127) ? 128 + ($rc & 127) : $rc >> 8);';

export const DEFAULT_TASKPOLICY_PATH = '/usr/sbin/taskpolicy';

/** Resolve the absolute path to taskpolicy on darwin, honouring MERMAID_TASKPOLICY_PATH
 *  override. Returns null if the path does not exist, allowing graceful skip of the QoS layer.
 *  No caching — the env override must be honoured per-call for tests. */
export function taskpolicyPath(): string | null {
  const override = process.env.MERMAID_TASKPOLICY_PATH;
  const path = override && override.trim() ? override.trim() : DEFAULT_TASKPOLICY_PATH;
  return existsSync(path) ? path : null;
}

export function gateSpawnArgv(
  command: string,
  niceness: number = gateNiceness(),
  opts: { platform?: NodeJS.Platform; timeoutSecs?: number } = {},
): string[] {
  const platform = opts.platform ?? process.platform;
  const timeoutSecs = opts.timeoutSecs ?? gateTimeoutSecs();
  let argv: string[] = ['sh', '-c', command];
  if (niceness > 0) argv = ['nice', '-n', String(niceness), ...argv];
  // Hard wall-clock cap that SURVIVES parent death: the perl warden stays resident,
  // puts the gate in its OWN process group, and on alarm KILLs the whole group — so
  // the cap holds even if the sidecar was SIGKILLed mid-run, and it takes the full
  // descendant tree (sh -> bun test -> workers), not just the shell. MEASURED
  // 2026-08-12: two orphaned `bun test` gates ran for 16h47m and 1d00h10m at ~25-40%
  // CPU each — their in-process kill timers died with their parent and nothing ever
  // reaped them.
  if (timeoutSecs > 0) argv = ['perl', '-e', GATE_WARDEN_PERL, String(timeoutSecs), ...argv];
  // Darwin: nice is nearly advisory under the macOS scheduler — MEASURED 2026-08-12:
  // four nice-10 vitest suites at 200%+ CPU each drove load to 82 and starved the
  // sidecar's health responses anyway (read as "daemon died" in the UI). taskpolicy's
  // utility band is an actual QoS demotion the scheduler honours; it inherits to the
  // whole child tree. Utility (not background): background also throttles I/O so hard
  // that gate wall-clocks blow their own timeouts. Absolute path required (bugfix
  // 7dc5f49a): bare name + stripped PATH ⇒ {ran:false}.
  const tp = platform === 'darwin' ? taskpolicyPath() : null;
  if (tp) argv = [tp, '-c', 'utility', ...argv];
  return argv;
}

export const DEFAULT_GATE_TIMEOUT_SECS = 20 * 60;

/** Hard wall-clock cap for one gate command. 0 disables (tests). */
export function gateTimeoutSecs(): number {
  const raw = process.env.MERMAID_GATE_TIMEOUT_SECS;
  if (raw === undefined || raw === '') return DEFAULT_GATE_TIMEOUT_SECS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_GATE_TIMEOUT_SECS;
  return Math.floor(n);
}

export const DEFAULT_GATE_CONCURRENCY = 2;

/** Max gate commands running at once across THIS server process (all consumers of
 *  defaultGateSpawn: leaf gates, epic base gates, land gates, quarantine, probes).
 *  MEASURED 2026-08-12: with no cap, three gating epics ran four full vitest suites
 *  simultaneously (two epic worktrees + two main-checkout lanes) — load 82, sidecar
 *  starved, every UI surface read "dead". Suites have no deadline; queueing them
 *  costs wall-clock and saves the box. */
export function gateConcurrency(): number {
  const raw = process.env.MERMAID_GATE_CONCURRENCY;
  if (raw === undefined || raw === '') return DEFAULT_GATE_CONCURRENCY;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_GATE_CONCURRENCY;
  return Math.floor(n);
}

// FIFO semaphore state for defaultGateSpawn. Module-level on purpose: every gate
// consumer imports this one seam, so one process = one queue.
let gateSlotsInUse = 0;
const gateWaiters: Array<() => void> = [];
/** Test-only visibility. */
export function _gateSemaphoreState(): { inUse: number; queued: number } {
  return { inUse: gateSlotsInUse, queued: gateWaiters.length };
}

async function acquireGateSlot(): Promise<void> {
  if (gateSlotsInUse < gateConcurrency()) {
    gateSlotsInUse += 1;
    return;
  }
  await new Promise<void>((resolve) => gateWaiters.push(resolve));
  gateSlotsInUse += 1;
}

function releaseGateSlot(): void {
  gateSlotsInUse -= 1;
  const next = gateWaiters.shift();
  if (next) next();
}

export const defaultGateSpawn: GateSpawn = async (cwd, command) => {
  await acquireGateSlot();
  try {
    const proc = Bun.spawn(gateSpawnArgv(command), { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (proc.signalCode != null) {
      return { ran: false, code: -1, output: `${stdout}${stderr}` };
    }
    // A hard-timeout gate dies of the warden's group-KILL: the warden kills its own
    // group including itself, so signalCode is set and the generic ran:false INFRA
    // branch above catches it — stderr carries the "gate hard-timeout" marker.
    return { ran: true, code, output: `${stdout}${stderr}` };
  } catch (e) {
    return { ran: false, code: -1, output: e instanceof Error ? (e.message ?? String(e)) : String(e) };
  } finally {
    releaseGateSlot();
  }
};

/** Strip the run-positional "(N/M) " prefix a test-backend failing entry carries, so a
 *  fingerprint can be compared against a stored quarantine row (bare path or case title).
 *  The ordinal is an artifact of ONE run's file ordering — never identity. */
export function normalizeGateFingerprint(fp: string): string {
  return fp.replace(/^\(\d+\/\d+\)\s+/, '').trim();
}

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
  opts?: { testOnlyTyped?: boolean },
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
  const hollow = normalizedChangeSet !== null
    && normalizedChangeSet.some((p) => SPEC_FILE_RE.test(p))
    && normalizedChangeSet.every((p) => SPEC_FILE_RE.test(p));

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
        // A hollow diff (test-only) with net-new failing tests must be rejected. This is
        // distinct from citability (blueprint-prose validation); a hollow verdict always
        // resolves 'rejected' in the completion layer as well.
        if (hollow && !opts?.testOnlyTyped) {
          return {
            status: 'fail',
            command: laneFailures[0].command,
            output,
            reasons: [
              'hollow-test-only-diff: the diff changes only test files and its tests fail; a leaf that ships no production change may not be accepted on a red test',
              `${laneFailures.length} failing spec file(s)`,
              ...netNew.slice(0, 20),
            ],
            declared: true,
            hollow: true,
          };
        }
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
export async function runBaseGate(
  cwd: string, cfg: LeafGateConfig | null, spawn: GateSpawn,
  observe?: { project: string; baseSha: string },
  checkout?: {
    probe: (cwd: string) => Promise<PoisonedCheckout>;
    restore?: (cwd: string, paths: string[]) => Promise<{ restored: string[]; failed: string[] }>;
  },
  impacted?: ImpactedBaseGateOpts,
): Promise<LeafGateResult> {
  if (!cfg) return { status: 'pass', output: '', reasons: [], declared: false };

  let poisonedCheckout: { paths: string[]; restored: string[] } | undefined;
  if (checkout) {
    const initial = await checkout.probe(cwd);
    if (initial.poisoned) {
      if (checkout.restore) {
        const { restored, failed } = await checkout.restore(cwd, initial.paths);
        const reprobe = await checkout.probe(cwd);
        if (!reprobe.poisoned) {
          poisonedCheckout = { paths: initial.paths, restored };
          // fall through to normal lane measurement below
        } else {
          return {
            status: 'error', output: '', declared: true,
            reasons: ['poisoned-checkout', ...initial.detail, `restore left poisoned: ${failed.join(', ')}`],
            poisonedCheckout: { paths: initial.paths, restored },
          };
        }
      } else {
        return {
          status: 'error', output: '', declared: true,
          reasons: ['poisoned-checkout', ...initial.detail],
          poisonedCheckout: { paths: initial.paths, restored: [] },
        };
      }
    }
  }

  // Impacted-set narrowing (opt-in via `impacted`): when trunk sha M reachable from this
  // base carries a stored FULL-SUITE green in the shared-verdict layer, only the impacted
  // set of the diff M..base needs to run — the anchor already proves the rest. Any doubt
  // (no anchor, planner fallback trigger, git failure) runs the full suite exactly as
  // before. Safety net: ensureTrunkAnchor (trunk-anchor.ts) produces full-suite trunk
  // greens — after every land and lazily on anchor-miss — so anchors keep being produced
  // and an impacted miss self-surfaces on the next full run. See base-gate-impacted.ts.
  let effCfg = cfg;
  let impactedMeta: LeafGateResult['impactedBase'];
  let impactedNote: string | undefined;
  if (impacted) {
    const plan = await planImpactedBaseGate(cwd, cfg, impacted);
    if (plan.mode === 'impacted') {
      effCfg = narrowBaseGateConfig(cfg, plan.tests);
      impactedMeta = { anchor: plan.anchor, ran: plan.tests.length, candidates: plan.candidateCount };
      impactedNote = `impacted base gate: ran ${plan.tests.length} of ${plan.candidateCount} candidates (anchor ${plan.anchor.slice(0, 8)})`;
    } else {
      impactedNote = `impacted base gate: full suite (fallback: ${plan.reason})`;
    }
  }

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
    cwd?: string;
  };
  const lanes: BaseLane[] = [];
  if (effCfg.typecheck) {
    lanes.push({ key: 'typecheck', command: effCfg.typecheck, kind: 'typecheck', reason: (c) => `typecheck failed: ${c}` });
  }
  for (const l of effCfg.typechecks ?? []) {
    lanes.push({ key: `typechecks:${l.match.source}`, command: l.command, kind: 'typecheck', reason: (c) => `typecheck lane failed: ${c}`, cwd: l.cwd });
  }
  for (const l of effCfg.suites ?? []) {
    lanes.push({ key: `suites:${l.match.source}`, command: l.command, kind: 'tests', reason: (c) => `suite lane failed: ${c}`, cwd: l.cwd });
  }
  for (const l of effCfg.floors ?? []) {
    lanes.push({ key: `floors:${l.match.source}`, command: l.command, kind: 'tests', reason: (c) => `floor lane failed: ${c}`, cwd: l.cwd });
  }
  if (effCfg.baseTest) {
    lanes.push({ key: 'baseTest', command: effCfg.baseTest, kind: 'tests', reason: (c) => `base test failed: ${c}` });
  }

  for (const lane of lanes) {
    const laneCwd = lane.cwd ? join(cwd, lane.cwd) : cwd;
    // Typecheck lanes consult the durable tree-keyed verdict (tsc-memo.ts): a clean tree
    // already measured by ANY runner (steward tscClean, land gate, another epic's base
    // gate, test-backend's desktop preamble) is served without a spawn. Test lanes never
    // route through it — only typechecks are pure functions of the tree.
    const r = lane.kind === 'typecheck'
      ? await memoizedTsc(laneCwd, lane.command, { runner: spawn })
      : await spawn(laneCwd, lane.command);
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
    let fingerprints = lane.kind === 'typecheck'
      ? (parseTypecheckFiles(r.output) ?? [])
      : extractFailingTests(r.output);
    if (r.code !== 0 && lane.kind === 'tests' && fingerprints.length === 0) {
      const synthetic = synthesizeLaneFailureIdentity(lane.key, r.output);
      if (synthetic) fingerprints = [synthetic];
    }
    if (r.code !== 0) {
      // RAN-but-failed: memoize this lane's fingerprints and CONTINUE — every red lane
      // must be recorded, so no short-circuit.
      baselineFailures[lane.key] = fingerprints;
      if (firstFailCommand === undefined) {
        firstFailCommand = lane.command;
        firstFailOutput = r.output;
        firstFailReason = lane.reason(lane.command);
      }
    }
    if (observe) {
      const WINDOW_MS = 7 * 24 * 60 * 60_000; // matches promoteQuarantineCandidates's default window (flaky-quarantine.ts)
      const watched = new Set(fingerprints);
      // Ask SQLite for exactly the distinct names on THIS lane. The previous form loaded
      // every observation in the window and filtered by lane in JS — 1.38M rows and ~8.7s of
      // blocked event loop per lane once the table had grown, which is what drove the
      // watchdog kill loop.
      for (const test of listWatchedTests(observe.project, lane.key, Date.now() - WINDOW_MS)) {
        watched.add(test);
      }
      for (const q of activeQuarantine(observe.project)) watched.add(q.test);
      recordBaseGateTestRuns({
        project: observe.project, baseSha: observe.baseSha, lane: lane.key,
        ranTests: Array.from(watched), failingTests: fingerprints, scope: 'base',
      });
    }
  }

  if (firstFailCommand !== undefined) {
    return {
      status: 'fail',
      command: firstFailCommand,
      output: firstFailOutput,
      reasons: [firstFailReason!, lastLines(firstFailOutput, 20), ...(impactedNote ? [impactedNote] : [])],
      declared: true,
      baselineFailures,
      ...(poisonedCheckout ? { poisonedCheckout } : {}),
      ...(impactedMeta ? { impactedBase: impactedMeta } : {}),
    };
  }

  return {
    status: 'pass', output: '', reasons: impactedNote ? [impactedNote] : [], declared: true, baselineFailures,
    ...(poisonedCheckout ? { poisonedCheckout } : {}),
    ...(impactedMeta ? { impactedBase: impactedMeta } : {}),
  };
}

/** A base-gate verdict is a durable BASE FACT only when the gate actually RAN.
 *  status==='error' means the gate could not run (missing npx, OOM, signal kill) — an
 *  INCIDENT, not a fact about the base. Caching it under the tip-less epicId key would
 *  silently block every later leaf on the epic (they read fresh:false ⇒ no escalation).
 *  Re-check on the next leaf instead. */
export function isCacheableBaseGateStatus(
  status: 'pass' | 'fail' | 'error',
): status is 'pass' | 'fail' {
  return status !== 'error';
}

/** Marker the perl timeout warden writes (stderr, folded into `output`) when it group-KILLs
 *  a gate run at the hard wall-clock cap — see {@link GATE_WARDEN_PERL}. */
export const GATE_HARD_TIMEOUT_MARKER = 'gate hard-timeout';

/** The failing-test names a base-red actually cites: parsed from the output first, falling
 *  back to the fail-lane fingerprints recorded in `baselineFailures` (normalized — the
 *  positional "(N/M) " prefix is a run artifact, never identity). */
function namedBaseRedFailures(r: Pick<LeafGateResult, 'output' | 'baselineFailures'>): string[] {
  const fromOutput = extractGateFailingFiles(r.output ?? '');
  if (fromOutput.length > 0) return fromOutput;
  const union = new Set<string>();
  for (const fps of Object.values(r.baselineFailures ?? {})) {
    for (const fp of fps) union.add(normalizeGateFingerprint(fp));
  }
  return [...union];
}

/** ADVISORY BASE GATE (2026-08-14): the gate can no longer STORE a vague red. A 'fail' that
 *  died of the warden's hard-timeout group-KILL, or whose run names ZERO failing tests, is
 *  an INCIDENT (contention, OOM, runner death) — not a fact about the base. Stored as
 *  'fail' it would hold every sibling leaf for the FAIL TTL with nothing actionable to
 *  repair; demoted to 'error' it is never persisted (recordEpicBaseGate and the coalescer's
 *  verdict write both skip 'error') and never serves as a hold. Real reds — named failing
 *  tests — pass through untouched. */
export function demoteVagueBaseRed(r: LeafGateResult): LeafGateResult {
  if (r.status !== 'fail') return r;
  if ((r.output ?? '').includes(GATE_HARD_TIMEOUT_MARKER)) {
    return { ...r, status: 'error', reasons: ['gate died at the hard timeout — a killed run measured nothing, not a base fact', ...r.reasons] };
  }
  if (namedBaseRedFailures(r).length === 0) {
    return { ...r, status: 'error', reasons: ['gate red names zero failing tests — vague red, an incident, not a citable base fact', ...r.reasons] };
  }
  return r;
}

/** ADVISORY BASE GATE dispatch consult (2026-08-14): a STORED-verdict-only read — never a
 *  live run, never an await on one (serial 10–20min base gates starved every leaf on the
 *  box all morning, and empirically almost every base-red is a flake; the LAND gate is the
 *  real correctness wall). Read order mirrors {@link resolveBaseGreen}: the epic's own
 *  cached row first (honoured via shouldHonourCachedBaseGate — so a FIRST red still never
 *  holds), then the durable shared verdict for the same (project, baseSha, lanes,
 *  quarantine) key.
 *
 *  HOLD rule — only a RECENT REAL red holds: status 'fail', younger than
 *  BASE_GATE_FAIL_VERDICT_TTL_MS, AND naming at least one failing test. Anything else
 *  (no row, stale, vague, pending, error — never stored anyway) is a MISS: the caller
 *  releases the leaf and kicks a background measurement through the coalescer. */
export function consultStoredBaseGreen(io: {
  epicId: string;
  targetProject: string;
  epicBaseSha: string | null | undefined;
  gateCfg: LeafGateConfig | null;
  now?: () => number;
}): (LeafGateResult & { fresh: boolean }) | null {
  const { epicId, targetProject, epicBaseSha, gateCfg } = io;
  if (!gateCfg) return null; // absent → abstain (unchanged)
  const nowMs = io.now?.() ?? Date.now();
  const holdableFail = (r: Pick<LeafGateResult, 'output' | 'baselineFailures'>, measuredAt: number): boolean =>
    nowMs - measuredAt <= BASE_GATE_FAIL_VERDICT_TTL_MS && namedBaseRedFailures(r).length > 0;

  const cached = getEpicBaseGate(epicId, epicBaseSha);
  if (cached && shouldHonourCachedBaseGate(cached, nowMs) === 'honour') {
    if (cached.status === 'pass'
      || holdableFail({ output: cached.output ?? '', baselineFailures: cached.baselineFailures ?? undefined }, cached.checkedAt)) {
      return {
        status: cached.status,
        command: cached.command ?? undefined,
        output: cached.output ?? '',
        reasons: [],
        declared: true,
        baselineFailures: cached.baselineFailures ?? undefined,
        fresh: false,
      };
    }
    // Honoured-but-stale/vague fail: a MISS for dispatch, never a hold.
  }
  if (epicBaseSha) {
    const qHash = quarantineSetHash(activeQuarantine(targetProject, io.now?.()).map((q) => q.test));
    const stored = getBaseGateVerdict(sharedVerdictKey(baseGateKey(targetProject, epicBaseSha, gateCfg), qHash));
    if (stored) {
      let replay: LeafGateResult | null = null;
      try {
        const parsed = stored.resultJson == null ? null : JSON.parse(stored.resultJson) as LeafGateResult;
        if (parsed && typeof parsed === 'object' && parsed.status === stored.status) replay = parsed;
      } catch { /* corrupt row reads as a MISS */ }
      if (replay && (stored.status === 'pass' || holdableFail(replay, stored.measuredAt))) {
        return { ...replay, fresh: false };
      }
    }
  }
  return null;
}

/** Injectable core of `ensureBaseGreen`: read the epic_base_gate cache, honour it via
 *  {@link shouldHonourCachedBaseGate} (a cached `pass` is terminal for its sha; a cached
 *  `fail` is re-verified until the attempt/TTL bounds are exhausted), and otherwise
 *  actually run the base gate and record the result. Extracted so the policy is
 *  unit-testable without a live worktree/git (see `defaultEpicBaseProbe` in
 *  conductor-infra-arm.ts for the sibling seam). */
export async function resolveBaseGreen(io: {
  epicId: string;
  project: string;
  targetProject: string;
  epicBaseSha: string | null | undefined;
  gateCfg: LeafGateConfig | null;
  ensureEpicWorktree: () => Promise<{ path: string } | null>;
  /** The second arg (present only when a base sha exists) lets the gate try the impacted
   *  path — production closures thread it into runBaseGate; injected test fakes may ignore it. */
  runGate: (cwd: string, impacted?: ImpactedBaseGateOpts) => Promise<LeafGateResult>;
  now?: () => number;
  resolveTestFile?: (project: string, test: string) => string | null;
}): Promise<(LeafGateResult & { fresh: boolean }) | null> {
  const { epicId, project, epicBaseSha, gateCfg } = io;
  if (!gateCfg) return null; // absent → abstain (unchanged)
  const cached = getEpicBaseGate(epicId, epicBaseSha);
  if (cached && shouldHonourCachedBaseGate(cached, io.now?.()) === 'honour') {
    return {
      status: cached.status,
      command: cached.command ?? undefined,
      output: cached.output ?? '',
      reasons: [],
      declared: true,
      baselineFailures: cached.baselineFailures ?? undefined,
      fresh: false,
    };
  }
  const wt = await io.ensureEpicWorktree();
  if (!wt) return null; // non-git fallback ⇒ no base gate
  // ONE quarantine-hash computation feeds both the shared-verdict scope and the impacted
  // anchor lookup — the anchor must be keyed under the SAME active set this run is.
  const qHash = quarantineSetHash(activeQuarantine(io.targetProject, io.now?.()).map((q) => q.test));
  const r = await runBaseGateShared(
    baseGateKey(io.targetProject, epicBaseSha, gateCfg),
    // demoteVagueBaseRed INSIDE the closure, so the coalescer's shared-verdict write sees
    // the demoted 'error' (which it never stores) — a vague red must not be persisted for
    // siblings any more than for this epic's own row below.
    () => io.runGate(wt.path, epicBaseSha
      ? { project: io.targetProject, baseSha: epicBaseSha, quarantineHash: qHash }
      : undefined).then(demoteVagueBaseRed),
    {
      project: io.targetProject,
      // Recorded so listInflightBaseGates() can name the epics waiting on this run —
      // the In-flight UI's leaf↔gate join is this exact id, not an inferred match.
      epicId: io.epicId,
      // Durable shared verdict: sibling epics forward-integrated to the same base sha
      // consume ONE measurement. The quarantine hash keeps the key honest — the downgrade
      // below judges against the same active set the measuring run was keyed under. No
      // base sha ⇒ nothing citable to key a shared verdict to (mirrors the fail→error
      // guard further down), so such runs stay out of the shared layer.
      ...(epicBaseSha ? {
        verdict: {
          project: io.targetProject,
          baseSha: epicBaseSha,
          quarantineHash: qHash,
          now: io.now,
          // Reaching this point WITH a cached row for the same sha means the re-verify
          // policy above decided a fresh measure is due — a stored sibling FAIL must not
          // answer it (the shared serve budget would outlive the attempt budget and the
          // re-run would never happen). A true sibling (no own row) still consumes it.
          allowStoredFail: !cached,
        },
      } : {}),
    },
  );
  // ALL quarantine bookkeeping (expiry-sweep → promote → close-on-green → prune) behind one
  // per-project 5-minute clock, and deliberately AFTER the honoured-cache early-return above:
  // a fully-cached hit must pay ZERO quarantine-store reads. Moving the expiry sweep behind
  // the throttle (it used to run before the cache read) is safe because activeQuarantine's
  // own TTL filter already stops expired rows from matching — the sweep only renews/announces,
  // it never gates correctness. The observation-WRITE path (recordBaseGateTestRuns inside
  // runBaseGate) is untouched.
  try {
    await runQuarantineCeremonies(io.targetProject, io.now?.());
  } catch { /* best-effort: quarantine bookkeeping must never break the gate */ }
  let result: LeafGateResult = r;
  if (r.status === 'fail' && r.baselineFailures) {
    // Fingerprint normalization is load-bearing here. MEASURED 2026-08-12: the gate's
    // failing fingerprints carry a POSITIONAL prefix — "(500/600) src/…/x.test.ts" —
    // whose ordinal changes run to run as the file count moves, while quarantine rows
    // store bare paths/titles. Raw set-membership therefore NEVER matched: six
    // actively-quarantined load-fragile files kept redding every epic base all day
    // with the downgrade structurally dead. Both sides normalize before comparing.
    const union = new Set<string>();
    for (const fps of Object.values(r.baselineFailures)) for (const fp of fps) union.add(fp);
    if (union.size > 0) {
      const quarantineTests = activeQuarantine(io.targetProject, io.now?.()).map((q) => q.test);
      if ([...union].every((fp) => quarantineCoversFailure(normalizeGateFingerprint(fp), quarantineTests, r.output ?? '', { project: io.targetProject, resolveTestFile: io.resolveTestFile }))) {
        const sorted = [...union].sort();
        result = {
          ...r,
          status: 'pass',
          quarantinedOnlyFailures: sorted,
          reasons: [`quarantined-only failure(s), gate downgraded to pass: ${sorted.join(', ')}`, ...r.reasons],
        };
      }
    }
  }
  if (result.status === 'fail' && isDepOptimizerCorruption(result.output)) {
    result = {
      ...result,
      status: 'error',
      reasons: ['dep-optimizer cache corruption (stale vitest/vite deps cache), not a base defect', ...result.reasons],
    };
  }
  if (result.status === 'fail' && !epicBaseSha) {
    result = {
      ...result,
      status: 'error',
      reasons: ['no epic base sha to key a cached verdict to — cannot record a citable base-gate fact', ...result.reasons],
    };
  }
  if (isCacheableBaseGateStatus(result.status)) {
    // Stamp checkedAt from the SAME clock the TTL is later measured against
    // (shouldHonourCachedBaseGate above). Letting the write default to real Date.now()
    // while the read uses io.now() makes the TTL window depend on how long the gate
    // took to run — the window silently shrinks by that elapsed time.
    recordEpicBaseGate({
      epicId,
      project,
      baseSha: epicBaseSha ?? null,
      status: result.status,
      command: result.command ?? null,
      output: result.output || null,
      baselineFailures: result.baselineFailures ?? null,
    }, io.now?.());
  }
  return { ...result, fresh: true };
}

const LEGACY_GATE_KEYS = ['gateCommand', 'frontendGateCommand', 'changeSetTestCommand',
  'changeSetTestCwd', 'frontendBaselineFailures'] as const;

function findResidualLegacyGateKeys(m: ProjectManifest): string[] {
  return LEGACY_GATE_KEYS.filter((k) => {
    const v = (m as Record<string, unknown>)[k];
    return typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) && v.length > 0;
  });
}

const escalatedLegacyGateResidual = new Set<string>();
export function escalateLegacyGateResidual(
  project: string, targetProject: string, leaf: Pick<Todo, 'id'>, manifestSource: ManifestSource,
): void {
  if (escalatedLegacyGateResidual.has(targetProject)) return;
  const manifest = manifestSource.manifest;
  if (!manifest) return;
  const keys = findResidualLegacyGateKeys(manifest);
  if (keys.length === 0) return;
  escalatedLegacyGateResidual.add(targetProject);
  try {
    createEscalation({
      project,
      session: `legacy-gate-migration::${targetProject}`,
      kind: 'operator-gated',
      operatorGated: true,
      todoId: leaf.id,
      audience: 'human',
      questionText:
        `Project ${targetProject} sets legacy gate key(s) [${keys.join(', ')}] in ` +
        `${manifestSource.path} but no mechanical gate resolves — leaves run gateless. ` +
        `Migrate to gate:{}: gateCommand/frontendGateCommand -> gate.suites[] ` +
        `({match,command,cwd}); changeSetTestCommand+changeSetTestCwd -> gate.tests[] ` +
        `({match,command,cwd}); frontendBaselineFailures entries are seeded once into ` +
        `the project's auto-maintained quarantine set (flaky-quarantine.ts ` +
        `activeQuarantine, keyed by ctx.gateProject), which is what the gate now judges ` +
        `against — the manifest array can be deleted once seeded.`,
    });
  } catch { /* best-effort: never let escalation failure block the leaf */ }
}

/** Compose the terminal reason for a gate that could not run (mech.status==='error').
 *  The misconfigured-declaration path (leaf-gate.gateResultForDeclaration) puts its whole
 *  explanation in `reasons`, with NO `command` and an empty `output` — so formatting from
 *  command+output alone produced the opaque `gate-could-not-run: gate — ` that stranded leaf
 *  41718cf0 with nothing recorded. Include `reasons` when present; otherwise fall back to the
 *  exact command+output shape (do not regress the legible messages). */
export function formatGateErrorReason(mech: LeafGateResult): string {
  const head = `gate-could-not-run: ${mech.command ?? 'gate'} — ${lastLines(mech.output, 5)}`;
  const reasons = (mech.reasons ?? []).filter((r) => r && r.trim());
  return reasons.length ? `${head} [${reasons.join('; ')}]` : head;
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
  // QUARANTINE: repros committed red on purpose (see services/quarantine.ts). They are excluded
  // here rather than per-caller because this is the ONE routing point every lane-based gate uses
  // — the per-file leaf gate and the epic land gate both flow through it. They are dropped, not
  // reported unmatched: `unmatched` means "no lane claims this", which would surface as a gate
  // config warning, and a quarantined spec is deliberately laneless.
  for (const spec of [...new Set(specs)].filter((sp) => !isQuarantined(sp))) {
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
    // Per-file mode substitutes the single file for EITHER placeholder. A lane whose
    // template uses {files} (a batch lane) is legitimately FORCED to per-file by the epic
    // land gate (epic-land-gate.ts runs the epic's touched files one-per-spawn). The old
    // /\{file\}/ regex left a {files} template literal → a malformed command (e.g.
    // `cd ui && bunx vitest {files}`) that errors and reads as a false regression →
    // gate-failed, wedging every UI-touching land. Matching {files?} substitutes the one
    // file for {file} OR {files}; the batch arm below is unchanged.
    ? files.map((f) => lane.command.replace(/\{files?\}/g, shellQuote(f)))
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
