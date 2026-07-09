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
import { specFilesInChangeSet, lastLines, extractFailingTests } from './gate-runner';
import type { LeafReviewVerdict } from './leaf-executor';

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
  /** OPTIONAL full-suite command run ONLY at the epic base (once per epic), never per leaf.
   *  Absent ⇒ the base check is `typecheck` alone. */
  baseTest?: string;
}

export type GateSpawn = (cwd: string, command: string) => Promise<{ ran: boolean; code: number; output: string }>;

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
}

/** Returns the project's declared gate, normalised (trim; drop empty strings; `null`
 *  when neither `typecheck` nor `test` nor `baseTest` survives). */
export function resolveLeafGate(m: ProjectManifest | null): LeafGateConfig | null {
  const g = m?.gate;
  if (!g) return null;
  const typecheck = g.typecheck?.trim() || undefined;
  const test = g.test?.trim() || undefined;
  const testCwd = g.testCwd?.trim() || undefined;
  const baseTest = g.baseTest?.trim() || undefined;
  if (!typecheck && !test && !baseTest) return null;
  return { typecheck, test, testCwd, baseTest };
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
    return { kind: 'absent', manifestPath: src.path, reason: 'manifest declares no gate block' };
  }
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    return { kind: 'misconfigured', manifestPath: src.path, reason: 'gate must be an object' };
  }
  const cfg = resolveLeafGate(manifest);
  if (!cfg) {
    return {
      kind: 'misconfigured',
      manifestPath: src.path,
      reason: 'gate block declares no usable command (typecheck/test/baseTest all empty)',
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
 *  process (null status — e.g. OOM) both read as `ran:false` (INFRA, never a finding). */
export const defaultGateSpawn: GateSpawn = async (cwd, command) => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status === null) {
    return { ran: false, code: -1, output: r.error ? String(r.error.message ?? r.error) : `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }
  return { ran: true, code: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** Run the project-declared gate in a leaf worktree, at this leaf's HEAD, scoped to
 *  its own change-set for the per-file test command. Never guesses: an unreadable
 *  change-set with a declared `test` command is 'error', not 'fail'. */
export async function runLeafGate(
  cwd: string,
  cfg: LeafGateConfig | null,
  changeSet: readonly string[] | null,
  spawn: GateSpawn,
): Promise<LeafGateResult> {
  if (!cfg) return { status: 'pass', output: '', reasons: ['gate: none declared'], declared: false };

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
      return {
        status: 'fail',
        command: cfg.typecheck,
        output: r.output,
        reasons: [`typecheck failed: ${cfg.typecheck}`, lastLines(r.output, 20)],
        declared: true,
      };
    }
  }

  if (cfg.test) {
    if (changeSet === null) {
      return {
        status: 'error',
        output: '',
        reasons: ['gate: change-set unreadable'],
        declared: true,
      };
    }
    const specs = specFilesInChangeSet(changeSet, cfg.testCwd);
    if (specs.length > 0) {
      const testCwd = cfg.testCwd ? join(cwd, cfg.testCwd) : cwd;
      const failures: Array<{ command: string; output: string }> = [];
      for (const spec of specs) {
        const command = cfg.test.replace(/\{file\}/g, shellQuote(spec));
        const r = await spawn(testCwd, command);
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
      if (failures.length > 0) {
        const output = failures.map((f) => f.output).join('\n').slice(0, 8000);
        return {
          status: 'fail',
          command: failures[0].command,
          output,
          reasons: [`${failures.length} failing spec file(s)`, ...extractFailingTests(output).slice(0, 20)],
          declared: true,
        };
      }
    }
  }

  return { status: 'pass', output: '', reasons: [], declared: true };
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

/** The once-per-epic base check: `typecheck` then `baseTest` (if declared), with the
 *  same ran/exit semantics as {@link runLeafGate}. Never runs the per-file `test`
 *  command — there is no change-set at a base. */
export async function runBaseGate(cwd: string, cfg: LeafGateConfig | null, spawn: GateSpawn): Promise<LeafGateResult> {
  if (!cfg) return { status: 'pass', output: '', reasons: [], declared: false };

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
      return {
        status: 'fail',
        command: cfg.typecheck,
        output: r.output,
        reasons: [`typecheck failed: ${cfg.typecheck}`, lastLines(r.output, 20)],
        declared: true,
      };
    }
  }

  if (cfg.baseTest) {
    const r = await spawn(cwd, cfg.baseTest);
    if (!r.ran) {
      return {
        status: 'error',
        command: cfg.baseTest,
        output: r.output,
        reasons: [`gate could not run: ${cfg.baseTest}`],
        declared: true,
      };
    }
    if (r.code !== 0) {
      return {
        status: 'fail',
        command: cfg.baseTest,
        output: r.output,
        reasons: [`base test failed: ${cfg.baseTest}`, lastLines(r.output, 20)],
        declared: true,
      };
    }
  }

  return { status: 'pass', output: '', reasons: [], declared: true };
}

// --- local helpers (kept private — no new cross-module surface) --------------------

/** Single-quote a path for `sh -c`, escaping any embedded single quotes. */
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}
