export const DEPENDENCY_RESOLUTION_CODES = new Set(['TS2307', 'TS7016', 'TS2503']);
export const CASCADE_CODES = new Set(['TS7006']);

export type TscClassification = 'infra-degraded' | 'real' | 'unparsed';

/** Classify tsc output into categories based on error codes.
 *
 *  Decision order (contract):
 *  1. No diagnostics parse → 'unparsed' (fail-closed: NOT an infra signal)
 *  2. Every code in DEPENDENCY_RESOLUTION_CODES ∪ CASCADE_CODES → 'infra-degraded'
 *  3. Otherwise → 'real'
 *
 *  'unparsed' is NOT treated as an infra signal. Callers must treat 'unparsed' as a real red.
 *  Only 'infra-degraded' is the strict infra-only classification.
 */
export function classifyTscOutput(output: string): TscClassification {
  const reParen = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+)/;
  const reColon = /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+)/;
  const codes = new Set<string>();

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    const m = reParen.exec(line) ?? reColon.exec(line);
    if (m) {
      const code = m[4];
      codes.add(code);
    }
  }

  if (codes.size === 0) {
    return 'unparsed';
  }

  const allCodes = new Set([...DEPENDENCY_RESOLUTION_CODES, ...CASCADE_CODES]);
  for (const code of codes) {
    if (!allCodes.has(code)) {
      return 'real';
    }
  }

  return 'infra-degraded';
}

/** Convenience helper: returns true only for 'infra-degraded' classification.
 *  Note: 'unparsed' is NOT treated as infra-degraded — only strict 'infra-degraded' qualifies. */
export function isDependencyResolutionOnly(output: string): boolean {
  return classifyTscOutput(output) === 'infra-degraded';
}
