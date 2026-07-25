/**
 * Leaf wall history — derived from worker_ledger node rows and outcome markers.
 * Segments ledger rows into runs, classifies wall reasons, and tracks repeated
 * walls and implement models.
 */
import { queryLedger } from './worker-ledger';
import { RUN_GAP_MS, type LeafRunStats } from './ledger-stats';

const DEFECT_LINE_RE = /\b(?:unmet|fail(?:ed|s|ure)?)\b/i;

/** Compare two review findings texts for substantial overlap (same defect lines).
 *  A DEFECT-line overlap (lines matching /unmet|fail/) ≥50% is a SAME WALL
 *  (too much overlap to be progress). Falls back to full-text overlap for
 *  free-form findings with no explicit UNMET/FAIL marker (so a paraphrased
 *  defect still counts as the same wall). Returns false if either text has no
 *  comparable lines. Used to decide whether a new-attempt review failure is
 *  the same blocker (park) or a different one (retry), and to detect stuck
 *  leaves with a pattern (via priorImplementModels + repeated walls).
 *
 *  ("Reviewed the working tree…") are STABLE across attempts, so including them inflates the
 *  overlap into a FALSE repeat: two attempts that fail for DIFFERENT reasons (real progress —
 *  one defect fixed, a new one surfaced) then read as "same wall" and PARK PREMATURELY, giving
 *  up on still-fixable work. So we compare only the defect lines, falling back to all lines for
 *  a free-form finding that carries no explicit UNMET/FAIL marker. (A fully-paraphrased SAME
 *  defect with no shared line still evades line-overlap — that residual miss is bounded by the
 *  revise cap + node budget, not an infinite thrash.) */
export function sameReviewWall(a: string, b: string): boolean {
  const norm = (t: string): Set<string> => {
    const lines = t.split('\n');
    const defect = lines.filter((l) => DEFECT_LINE_RE.test(l));
    const use = defect.length ? defect : lines; // wall = defect lines; free-form → all lines
    return new Set(
      use.map((l) => l.toLowerCase().replace(/\d+/g, '#').trim()).filter((l) => l.length > 8),
    );
  };
  const A = norm(a);
  const B = norm(b);
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const l of A) if (B.has(l)) inter += 1;
  return inter / Math.min(A.size, B.size) >= 0.5;
}

/** Classification of why a leaf's run hit a wall (terminal reason). */
export type WallReasonClass =
  | 'review-fail' | 'gate-rejected' | 'same-wall-twice' | 'attempt-cap-exhausted'
  | 'suspect-gate'                                   // HARD
  | 'paused' | 'rate-limited' | 'epic-base-moved' | 'aborted' | 'infra'  // TRANSIENT
  | 'none';                                          // accepted / pending / in-flight

export const HARD_WALL_CLASSES: ReadonlySet<WallReasonClass> = new Set([
  'review-fail',
  'gate-rejected',
  'same-wall-twice',
  'attempt-cap-exhausted',
  'suspect-gate',
]);

export function isHardWall(c: WallReasonClass): boolean {
  return HARD_WALL_CLASSES.has(c);
}

/**
 * Classify the reason a leaf's terminal outcome marker has. Decision order is load-bearing:
 * `suspect-gate` MUST precede `gate-rejected`, and every transient arm MUST precede
 * every hard arm. A missing/undefined `terminal` returns `'none'`. Never throws.
 */
export function classifyWallReason(input: {
  terminal?: LeafRunStats['terminal'];
  leafOutcome?: string | null;
}): WallReasonClass {
  const { terminal, leafOutcome } = input;

  // 1. Aborted check
  if (leafOutcome === 'aborted' || terminal?.effectiveOutcome === 'aborted') {
    return 'aborted';
  }

  // 2. Paused / rate-limited check
  if (leafOutcome === 'paused') {
    return terminal?.reason?.startsWith('rate-limited') ? 'rate-limited' : 'paused';
  }

  // 3. Epic base moved
  if (terminal?.reason?.startsWith('epic-base-moved')) {
    return 'epic-base-moved';
  }

  // 4. Infrastructure issues
  if (
    terminal?.reason?.startsWith('node-could-not-start') ||
    terminal?.reason?.startsWith('working-root-escape')
  ) {
    return 'infra';
  }

  // 5. Same wall twice
  if (terminal?.reason?.startsWith('same-wall-twice')) {
    return 'same-wall-twice';
  }

  // 6. Attempt cap exhausted
  if (terminal?.reason?.startsWith('attempt-cap-exhausted')) {
    return 'attempt-cap-exhausted';
  }

  // 7. Suspect gate: green review + red gate (MUST be before gate-rejected)
  if (
    terminal?.reviewVerdict === 'pass' &&
    (terminal?.effectiveOutcome === 'rejected' || (terminal?.gateReasons && terminal.gateReasons.length > 0))
  ) {
    return 'suspect-gate';
  }

  // 8. Gate rejected
  if (terminal?.reason === 'gate-rejected' || terminal?.effectiveOutcome === 'rejected') {
    return 'gate-rejected';
  }

  // 9. Review fail
  if (terminal?.reviewVerdict === 'fail') {
    return 'review-fail';
  }

  // 10. Default (accepted / pending / in-flight)
  return 'none';
}

export interface LeafWallHistory {
  leafId: string;
  priorRuns: number;
  hardWallCount: number;
  lastReasonClass: WallReasonClass;
  repeatedWall: boolean;
  suspectGate: boolean;
  priorImplementModels: string[];
}

/**
 * Segment ledger rows (in ascending chronological order) by run boundaries.
 * A new run begins after an outcome marker or after a gap >= RUN_GAP_MS
 * (accounting for the row's own duration to avoid mis-reading long-running nodes).
 * Returns an array of runs, where each run is a segment of rows.
 */
function segmentRuns(asc: any[]): any[][] {
  if (asc.length === 0) return [];

  const runs: any[][] = [];
  let currentRun: any[] = [];
  let runStart = 0;

  for (let i = 0; i < asc.length; i++) {
    const row = asc[i];

    // Detect run boundary: outcome marker from a PRIOR run (not the current one being built)
    if (i > 0 && row.nodeKind === 'outcome') {
      // This is an outcome marker; it ends the current run
      currentRun.push(row);
      runs.push(currentRun);
      currentRun = [];
      runStart = i + 1;
      continue;
    }

    // Detect idle gap boundary (but skip on first row)
    if (i > 0) {
      const prev = asc[i - 1];
      const idleGap = row.ts - (row.durationMs ?? 0) - prev.ts;
      if (idleGap >= RUN_GAP_MS) {
        // Gap detected; start a new run
        if (currentRun.length > 0) {
          runs.push(currentRun);
        }
        currentRun = [row];
        runStart = i;
        continue;
      }
    }

    // No boundary; add to current run
    currentRun.push(row);
  }

  // Flush remaining rows (if any)
  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  return runs;
}

/** Get the wall history for a leaf: prior run count, hard-wall count, repeated walls, etc. */
export function getLeafWallHistory(leafId: string): LeafWallHistory {
  try {
    // Query newest-first; reverse for ascending order
    const allRows = queryLedger({ leafId, limit: 2000 }).slice().reverse();
    if (allRows.length === 0) {
      return {
        leafId,
        priorRuns: 0,
        hardWallCount: 0,
        lastReasonClass: 'none',
        repeatedWall: false,
        suspectGate: false,
        priorImplementModels: [],
      };
    }

    // Segment into runs
    const runs = segmentRuns(allRows);

    // Extract prior runs (those ending in an outcome marker, excluding the trailing marker-less in-flight run)
    const priorRuns: Array<{
      rows: any[];
      terminal?: LeafRunStats['terminal'];
      reviewOutput?: string;
      implementModels: string[];
    }> = [];

    for (const run of runs) {
      // Find the outcome marker in this run
      const outcomeMarker = run.find((r) => r.nodeKind === 'outcome');
      if (!outcomeMarker) {
        // No outcome marker = in-flight run; skip it
        continue;
      }

      // Parse terminal from outcomeDetail
      let terminal: LeafRunStats['terminal'] | undefined;
      if (outcomeMarker.outcomeDetail) {
        try {
          terminal = JSON.parse(outcomeMarker.outcomeDetail);
        } catch {
          terminal = undefined;
        }
      }

      // Find the last review row's outputText (or fall back to outcome marker's outputText)
      const reviewRow = [...run].reverse().find((r) => r.nodeKind === 'review');
      const reviewOutput = reviewRow?.outputText ?? outcomeMarker.outputText ?? '';

      // Find all implement/wimplement rows and collect their models
      const implementModels = run
        .filter((r) => r.nodeKind === 'implement' || r.nodeKind === 'wimplement')
        .map((r) => r.model)
        .filter(Boolean);

      priorRuns.push({
        rows: run,
        terminal,
        reviewOutput,
        implementModels,
      });
    }

    // Compute statistics
    const hardWallCount = priorRuns.filter((r) =>
      isHardWall(classifyWallReason({ terminal: r.terminal, leafOutcome: r.terminal?.effectiveOutcome }))
    ).length;

    const lastReasonClass = priorRuns.length > 0
      ? classifyWallReason({ terminal: priorRuns[priorRuns.length - 1].terminal, leafOutcome: priorRuns[priorRuns.length - 1].terminal?.effectiveOutcome })
      : 'none';

    // Check for repeated hard walls: ≥2 hard-wall runs with same class or sameReviewWall
    let repeatedWall = false;
    if (hardWallCount >= 2) {
      const hardWalls = priorRuns.filter((r) =>
        isHardWall(classifyWallReason({ terminal: r.terminal, leafOutcome: r.terminal?.effectiveOutcome }))
      );
      if (hardWalls.length >= 2) {
        const newest = hardWalls[hardWalls.length - 1];
        const newestClass = classifyWallReason({ terminal: newest.terminal, leafOutcome: newest.terminal?.effectiveOutcome });

        for (let i = hardWalls.length - 2; i >= 0; i--) {
          const older = hardWalls[i];
          const olderClass = classifyWallReason({ terminal: older.terminal, leafOutcome: older.terminal?.effectiveOutcome });

          // Same class or same wall findings
          if (newestClass === olderClass || sameReviewWall(older.reviewOutput ?? '', newest.reviewOutput ?? '')) {
            repeatedWall = true;
            break;
          }
        }
      }
    }

    // Check for any suspect-gate classification
    const suspectGate = priorRuns.some((r) =>
      classifyWallReason({ terminal: r.terminal, leafOutcome: r.terminal?.effectiveOutcome }) === 'suspect-gate'
    );

    // Collect implement models from all prior runs in ascending order (not deduped)
    const priorImplementModels: string[] = [];
    for (const run of priorRuns) {
      priorImplementModels.push(...run.implementModels);
    }

    return {
      leafId,
      priorRuns: priorRuns.length,
      hardWallCount,
      lastReasonClass,
      repeatedWall,
      suspectGate,
      priorImplementModels,
    };
  } catch {
    // Fail gracefully on any ledger read error
    return {
      leafId,
      priorRuns: 0,
      hardWallCount: 0,
      lastReasonClass: 'none',
      repeatedWall: false,
      suspectGate: false,
      priorImplementModels: [],
    };
  }
}
