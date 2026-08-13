/**
 * land-typecheck-floor.ts — Shared fail-closed typecheck floor for epic-land.
 *
 * Unlike steward-proof.ts which abstrains when a compile check cannot run,
 * this module FAILS when a selected/declared check could not execute.
 * It ships the primitive plus its test; no caller is wired in this leaf.
 */
import type { GateSpawn } from './leaf-gate';
import { defaultGateSpawn, resolveGateDeclaration } from './leaf-gate';
import { loadManifestSource } from '../config/project-manifest';
import { detectCompileCheck } from './compile-gate';

export interface LandTypecheckProof {
  status: 'pass' | 'fail' | 'error' | 'not-applicable';
  command: string | null;
  exitCode: number | null;
  firstError: string | null;
  output: string;
}

/** Regex for TypeScript and generic compiler error lines. */
export const LAND_TYPECHECK_ERROR_RE = /error TS\d+|: error /;

/**
 * Returns true if the proof represents a failure that should refuse a land.
 * pass and not-applicable do not refuse.
 */
export function landTypecheckRefuses(p: LandTypecheckProof): boolean {
  return p.status === 'fail' || p.status === 'error';
}

/**
 * Extract the first error line from compiler output matching LAND_TYPECHECK_ERROR_RE,
 * or fall back to the first non-empty trimmed line. Returns null only if output is empty.
 */
export function firstTypecheckError(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  const lines = trimmed.split('\n');
  for (const line of lines) {
    const trimLine = line.trim();
    if (LAND_TYPECHECK_ERROR_RE.test(trimLine)) {
      return trimLine;
    }
  }

  // Fall back to the first non-empty line
  for (const line of lines) {
    const trimLine = line.trim();
    if (trimLine) return trimLine;
  }

  return null;
}

/**
 * Run the land-gate typecheck floor: resolve command from manifest or detection,
 * execute, and report status with fail-closed semantics for unrunnable checks.
 */
export async function runLandTypecheckFloor(o: {
  repo: string;
  epicWorktreeCwd: string;
  spawn?: GateSpawn;
}): Promise<LandTypecheckProof> {
  const spawn = o.spawn ?? defaultGateSpawn;

  // --- Command resolution (in order) ---

  // 1. Read against the MAIN REPO root, not the worktree
  const decl = resolveGateDeclaration(loadManifestSource(o.repo));

  // 2. If misconfigured, return error immediately
  if (decl.kind === 'misconfigured') {
    return {
      status: 'error',
      command: null,
      exitCode: null,
      firstError: `land gate misconfigured: ${decl.reason}`,
      output: '',
    };
  }

  // 3. Use declared gate.typecheck if present
  let cmd: string | null = null;
  if (decl.kind === 'declared') {
    cmd = decl.cfg.typecheck ?? null;
  }

  // 4. Fall back to detectCompileCheck
  if (!cmd) {
    const detected = detectCompileCheck(o.epicWorktreeCwd);
    cmd = detected?.cmd ?? null;
  }

  // 5. If still nothing, return not-applicable
  if (!cmd) {
    return {
      status: 'not-applicable',
      command: null,
      exitCode: null,
      firstError: null,
      output: '',
    };
  }

  // --- Run semantics ---
  const r = await spawn(o.epicWorktreeCwd, cmd);

  // ran === false: the selected check could not execute → error (fail-closed)
  if (!r.ran) {
    return {
      status: 'error',
      command: cmd,
      exitCode: r.code ?? null,
      firstError: 'typecheck command could not run',
      output: r.output,
    };
  }

  // ran === true && code === 0: success
  if ((r.code ?? 0) === 0) {
    return {
      status: 'pass',
      command: cmd,
      exitCode: 0,
      firstError: null,
      output: r.output,
    };
  }

  // ran === true && code !== 0 && output is empty: execution failure (not an attributable finding)
  if (r.output.trim() === '') {
    return {
      status: 'error',
      command: cmd,
      exitCode: r.code ?? null,
      firstError: 'typecheck failed with no output',
      output: r.output,
    };
  }

  // ran === true && code !== 0 with output: fail with first error
  return {
    status: 'fail',
    command: cmd,
    exitCode: r.code ?? null,
    firstError: firstTypecheckError(r.output),
    output: r.output,
  };
}
