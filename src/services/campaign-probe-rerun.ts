/**
 * campaign-probe-rerun.ts — reset probe verdicts when a land touches declared paths.
 *
 * Consuming half of the resetProbeVerdict primitive (campaign-store.ts:524) and the
 * declaredPaths field (campaign-store.ts:52), this module detects when a code change
 * (land) touches a file or directory that a probe declares, and resets the probe's
 * verdict back to 'not-run' so it can be re-evaluated.
 */

import type { CampaignProbe } from './campaign-store';
import { listProbes, resetProbeVerdict } from './campaign-store';

/** Injectable dependencies for resetProbesForLand. */
export interface CampaignProbeRerunDeps {
  /** List probes for a campaign. Defaults to the live listProbes implementation. */
  listProbes?: typeof listProbes;
  /** Reset a probe's verdict. Defaults to the live resetProbeVerdict implementation. */
  resetProbeVerdict?: typeof resetProbeVerdict;
}

/** Result of resetProbesForLand: partitions probes into reset and kept. */
export interface CampaignProbeRerunResult {
  /** Probe IDs whose verdicts were reset to 'not-run'. */
  reset: string[];
  /** Probe IDs left unchanged (no declared-path match or error). */
  kept: string[];
}

/**
 * Normalize a path by stripping leading './' and trailing '/'.
 * Returns the normalized path, or empty string if the input is already empty or becomes empty.
 */
function normalizePath(path: string): string {
  if (typeof path !== 'string') {
    return '';
  }
  let normalized = path;
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Test whether a land touches any of a probe's declared paths.
 *
 * True iff any touched path equals a declared path or sits under it as a directory prefix.
 * Paths are normalized (leading './' and trailing '/' stripped) before comparison.
 * Prefix matching is segment-aware: 'src/services' matches 'src/services/campaign-pass.ts'
 * but not 'src/services-old/x.ts' — i.e., either exact match or touched starts with declared + '/'.
 *
 * Returns false unconditionally if:
 * - declaredPaths is empty or becomes empty after normalization.
 * - touchedPaths is empty or becomes empty after normalization.
 * - Any entry in either array is not a string (handled defensively).
 */
export function landTouchesDeclaredPaths(declaredPaths: unknown, touchedPaths: unknown): boolean {
  // Defensive check: both must be arrays.
  if (!Array.isArray(declaredPaths) || !Array.isArray(touchedPaths)) {
    return false;
  }

  // Normalize and filter empty entries from both sides.
  const normalizedDeclared = declaredPaths
    .map((p) => normalizePath(p))
    .filter((p) => p !== '');

  const normalizedTouched = touchedPaths
    .map((p) => normalizePath(p))
    .filter((p) => p !== '');

  // Empty after normalization → no match possible.
  if (normalizedDeclared.length === 0 || normalizedTouched.length === 0) {
    return false;
  }

  // Check if any touched path matches or sits under any declared path.
  for (const touched of normalizedTouched) {
    for (const declared of normalizedDeclared) {
      // Exact match.
      if (touched === declared) {
        return true;
      }
      // Prefix match with segment boundary (touched is under declared).
      if (touched.startsWith(declared + '/')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Reset probes for a campaign when a land touches their declared paths.
 *
 * For each probe in the campaign (via listProbes):
 * - If landTouchesDeclaredPaths(probe.declaredPaths, touchedPaths) returns true:
 *   - Call resetProbeVerdict(project, probe.id) and push probe.id into reset.
 * - Otherwise push probe.id into kept.
 *
 * Per-probe error handling: a throw while resetting one probe lands that probe
 * into kept and the loop continues (fail-open). Outermost try/catch returns
 * { reset: [], kept: [] } on catastrophic failure (e.g., listProbes throwing).
 *
 * Dependencies are injectable (matching CampaignReconcileDeps pattern) and default
 * to the live implementations.
 */
export async function resetProbesForLand(
  project: string,
  campaignId: string,
  touchedPaths: string[],
  deps?: CampaignProbeRerunDeps,
): Promise<CampaignProbeRerunResult> {
  try {
    const listProbesFn = deps?.listProbes ?? listProbes;
    const resetVerdictFn = deps?.resetProbeVerdict ?? resetProbeVerdict;

    const reset: string[] = [];
    const kept: string[] = [];

    const probes = listProbesFn(project, campaignId);

    for (const probe of probes) {
      try {
        if (landTouchesDeclaredPaths(probe.declaredPaths, touchedPaths)) {
          // Reset this probe's verdict.
          resetVerdictFn(project, probe.id);
          reset.push(probe.id);
        } else {
          // Declared paths do not match; keep unchanged.
          kept.push(probe.id);
        }
      } catch {
        // Per-probe error: land in kept and continue the loop.
        kept.push(probe.id);
      }
    }

    return { reset, kept };
  } catch {
    // Outermost catch: catastrophic failure (e.g., listProbes threw).
    return { reset: [], kept: [] };
  }
}
