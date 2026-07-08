/**
 * compile-gate.ts — language-aware compile/typecheck detection for the build gates.
 *
 * The daemon's correctness gates (the worker review/verify nodes and the epic-land
 * `steward-proof.tscClean`) historically ran `npx tsc --noEmit` unconditionally, which
 * FALSE-REJECTS clean work on non-TypeScript repos (C#/.NET, Python) — a leaf whose
 * code is correct but whose language has no tsc gets a bogus compile failure.
 *
 * This picks the right compile check by language. CONSERVATIVE by design: the risk is
 * asymmetric — a false-REJECT is merely toil (override-accept), but flipping to a
 * false-ACCEPT silently lands broken work. So we only ever REDIRECT on a positively
 * detected language, and on any inspection failure we fail SAFE toward the strict tsc
 * default (never toward "skip the gate").
 */
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export interface CompileCheck {
  /** Shell command to run from the repo root. */
  cmd: string;
  /** Human label (TypeScript / C#/.NET). */
  label: string;
}

/**
 * The compile check for a project dir, or `null` when the language has NO static
 * compile step (e.g. Python) — in which case correctness rests on the review's reading
 * + the project's own tests, and running tsc would be pure false-fail noise.
 *
 * Detection order: tsconfig.json → TS (unchanged prior behaviour); .sln/.csproj → .NET;
 * else null. If the dir can't be read, fail SAFE to tsc (strict), never to null.
 */
export function detectCompileCheck(dir: string): CompileCheck | null {
  let entries: string[];
  try {
    if (existsSync(join(dir, 'tsconfig.json'))) {
      return { cmd: 'npx tsc --noEmit -p tsconfig.json', label: 'TypeScript' };
    }
    entries = readdirSync(dir);
  } catch {
    // Can't inspect → keep the strict default rather than silently skipping a gate.
    return { cmd: 'npx tsc --noEmit -p tsconfig.json', label: 'TypeScript' };
  }
  if (entries.some((f) => f.endsWith('.sln') || f.endsWith('.csproj'))) {
    return { cmd: 'dotnet build -clp:ErrorsOnly --nologo -v q', label: 'C#/.NET' };
  }
  return null; // no static compile gate for this language (e.g. Python)
}

/**
 * Language-aware compile instruction for the worker node prompts (review/implement/
 * verify). Replaces the hard-wired `npx tsc --noEmit -p tsconfig.json` line so a node
 * on a non-TS repo doesn't false-fail on a missing tsconfig. The node has Bash + Read,
 * so it self-detects; we keep the tsc guardrails (project config, never bare-file).
 */
export const COMPILE_CHECK_INSTRUCTION =
  'To check compilation, use the PROJECT\'s OWN build from the repo root, by language: '
  + 'if `tsconfig.json` exists → `npx tsc --noEmit -p tsconfig.json` (the PROJECT config, '
  + 'NEVER `tsc <file>` on a bare path — that drops the project lib/options and yields '
  + 'false errors); if a `.csproj`/`.sln` exists → `dotnet build`; if the project has NO '
  + 'static compile step (e.g. Python) → SKIP the compile check and judge correctness by '
  + 'reading the code + running the project\'s own tests. NEVER run tsc on a project that '
  + 'has no tsconfig — a "config not found" error is NOT a code failure.';
