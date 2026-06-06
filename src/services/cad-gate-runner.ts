/**
 * Deterministic CAD gate-runner (CAD-VERIF·collab — P1 as CODE).
 *
 * The authoritative pass/fail gate for a CAD part/assembly. It takes the metrics
 * the bsync analyzers produced (validity, workspace volume, Jacobian condition
 * number, DOF, min wall, min clearance, joint-axis directions) PLUS the build
 * contract's spec, compares them to VERSIONED thresholds, and returns a verdict.
 *
 * Why it exists (the #6/#7 lesson): take judgment away from the agent on anything
 * COMPUTABLE. A worker must not be able to self-certify "looks good enough" on a
 * mechanism whose fitness is a number. The worker INVOKES this runner and the
 * returned verdict is AUTHORITATIVE — the agent cannot override a failed code
 * invariant. The VLM fitness judge (#7b, cad-fitness-review) runs AFTER this and
 * is advisory-only; it never flips a `false` here to a pass.
 *
 * Thresholds and the joint-axis-diversity rule live HERE, in code/config, and are
 * VERSIONED (CAD_GATE_THRESHOLDS_VERSION) — they are not re-decided per run by an
 * agent. A project tunes the numeric floors via its spec/contract (required DOF,
 * required distinct axes, declared envelope); the structural invariants (a
 * near-singular Jacobian is degenerate, coaxial axes have no workspace) are fixed.
 *
 * Acceptance oracle (see cad-gate-runner.test.ts): given the RUN-1 coaxial arm's
 * metrics → FAIL (workspace, condition-number, axis-diversity); given the RUN-2
 * arm's metrics → PASS. Deterministically, regardless of what a worker self-reports.
 *
 * This module is PURE (no I/O, no kernel calls) — the analyzer invocation that
 * produces `CadMetrics` is the project's own `gateCommand` (see project-manifest);
 * this runner is the deterministic comparator that turns those numbers into a verdict.
 */

/** Thresholds schema version. Bump when the rubric/numeric floors change so a
 *  recorded verdict is attributable to the rule-set that produced it. */
export const CAD_GATE_THRESHOLDS_VERSION = 1;

/** The analyzer outputs the gate consumes — one mechanism, posed. Field names
 *  mirror the project metric vocabulary (workspace_vol_cm3 / median_cond /
 *  n_dims_moved; see ProjectManifest.metricRefs). */
export interface CadMetrics {
  /** validate_geometry: a valid, non-empty solid (bbox present, volume > 0). */
  valid: boolean;
  /** analyze_dof: free DOF the mechanism actually moves (n_dims_moved). */
  dof: number;
  /** Reachable workspace volume in cm³ (workspace_vol_cm3). Near-zero on a
   *  coaxial/degenerate chain. */
  workspaceVolCm3: number;
  /** Median Jacobian condition number over the workspace (median_cond). Blows up
   *  toward singularity — a degenerate chain reads very high / non-finite. */
  medianCond: number;
  /** Thinnest wall in mm (DfM). */
  minWallMm: number;
  /** Smallest signed clearance in mm across the declared pose(s); < 0 = interference
   *  (self / ground / table collision). */
  minClearanceMm: number;
  /** Each joint's axis as a 3-vector (need not be unit; normalized internally).
   *  Drives the joint-axis-diversity invariant — the RUN-1 coaxial failure. */
  jointAxes: ReadonlyArray<readonly [number, number, number]>;
}

/** The contract-derived requirements the metrics are judged against. These come
 *  from the E0 build contract (per-mechanism), NOT re-decided by the worker. */
export interface CadGateSpec {
  /** Exact free DOF the contract declares (e.g. 5 for the arm; gripper counted
   *  separately). */
  requiredDof: number;
  /** Minimum count of DISTINCT joint axes the chain must have — the anti-coaxial
   *  rule. Default 2 (any non-degenerate articulated chain). */
  minDistinctAxes?: number;
  /** Minimum reachable workspace the mechanism must cover (cm³). */
  minWorkspaceVolCm3: number;
}

/** Versioned numeric floors that are NOT per-mechanism — structural invariants. */
export interface CadGateThresholds {
  version: number;
  /** Above this median Jacobian condition number the chain is treated as
   *  near-singular / degenerate (no usable workspace). Non-finite always fails. */
  maxMedianCond: number;
  /** DfM floor: thinnest printable/machinable wall (mm). */
  minWallMm: number;
  /** Two joint axes counting as "the same" direction when the angle between them
   *  is within this many degrees (parallel OR anti-parallel). */
  axisParallelToleranceDeg: number;
}

/** The shipped, versioned default thresholds. A project tunes per-mechanism specs
 *  (DOF, workspace, distinct-axes) via the contract; these structural floors are
 *  fixed in code. */
export const DEFAULT_CAD_GATE_THRESHOLDS: CadGateThresholds = {
  version: CAD_GATE_THRESHOLDS_VERSION,
  maxMedianCond: 100,
  minWallMm: 2,
  axisParallelToleranceDeg: 10,
};

/** One checked invariant in the verdict. */
export interface VerdictReason {
  /** Stable check id (e.g. 'workspace', 'condition-number', 'axis-diversity'). */
  check: string;
  pass: boolean;
  /** Human-readable explanation including the actual vs the threshold. */
  detail: string;
}

export interface CadGateVerdict {
  /** AUTHORITATIVE: true iff every invariant passed. The agent cannot override. */
  pass: boolean;
  /** Per-invariant results (both passes and failures), in evaluation order. */
  reasons: VerdictReason[];
  /** The thresholds version that produced this verdict (for attribution). */
  thresholdsVersion: number;
}

/** Count distinct joint-axis directions, treating parallel AND anti-parallel axes
 *  (within tolerance) as the same direction. Zero-length axis vectors are ignored
 *  (a malformed axis is not a "distinct" direction). Pure + deterministic. */
export function countDistinctAxes(
  axes: ReadonlyArray<readonly [number, number, number]>,
  toleranceDeg: number,
): number {
  const cosTol = Math.cos((toleranceDeg * Math.PI) / 180);
  const unit: Array<[number, number, number]> = [];
  for (const a of axes) {
    const m = Math.hypot(a[0], a[1], a[2]);
    if (m === 0 || !Number.isFinite(m)) continue;
    unit.push([a[0] / m, a[1] / m, a[2] / m]);
  }
  const reps: Array<[number, number, number]> = [];
  for (const u of unit) {
    const same = reps.some((r) => {
      const dot = r[0] * u[0] + r[1] * u[1] + r[2] * u[2];
      return Math.abs(dot) >= cosTol; // abs → parallel or anti-parallel both collapse
    });
    if (!same) reps.push(u);
  }
  return reps.length;
}

/**
 * Run the deterministic CAD gate. Pure: same inputs → same verdict, always.
 *
 * The verdict is AUTHORITATIVE — a worker invokes this and must honor `pass`; it
 * is not allowed to self-certify a mechanism the runner failed.
 */
export function runCadGate(
  metrics: CadMetrics,
  spec: CadGateSpec,
  thresholds: CadGateThresholds = DEFAULT_CAD_GATE_THRESHOLDS,
): CadGateVerdict {
  const reasons: VerdictReason[] = [];
  const minDistinctAxes = spec.minDistinctAxes ?? 2;

  // 1. Validity — a valid, non-empty solid. Everything else is moot if false.
  reasons.push({
    check: 'validity',
    pass: metrics.valid === true,
    detail: metrics.valid ? 'valid non-empty solid' : 'invalid or empty solid',
  });

  // 2. DOF — exactly the contract's declared free DOF.
  reasons.push({
    check: 'dof',
    pass: metrics.dof === spec.requiredDof,
    detail: `dof=${metrics.dof} required=${spec.requiredDof}`,
  });

  // 3. Workspace volume — the chain actually sweeps the required work volume.
  reasons.push({
    check: 'workspace',
    pass: Number.isFinite(metrics.workspaceVolCm3) && metrics.workspaceVolCm3 >= spec.minWorkspaceVolCm3,
    detail: `workspace_vol_cm3=${metrics.workspaceVolCm3} min=${spec.minWorkspaceVolCm3}`,
  });

  // 4. Condition number — a near-singular Jacobian is a degenerate mechanism.
  //    Non-finite (Inf/NaN) is an automatic fail (fully singular).
  reasons.push({
    check: 'condition-number',
    pass: Number.isFinite(metrics.medianCond) && metrics.medianCond <= thresholds.maxMedianCond,
    detail: `median_cond=${metrics.medianCond} max=${thresholds.maxMedianCond}`,
  });

  // 5. Joint-axis diversity — the anti-coaxial rule (the RUN-1 failure). Coaxial
  //    axes collapse to one distinct direction → no workspace.
  const distinct = countDistinctAxes(metrics.jointAxes, thresholds.axisParallelToleranceDeg);
  reasons.push({
    check: 'axis-diversity',
    pass: distinct >= minDistinctAxes,
    detail: `distinctAxes=${distinct} required>=${minDistinctAxes}`,
  });

  // 6. Min wall — DfM floor.
  reasons.push({
    check: 'min-wall',
    pass: Number.isFinite(metrics.minWallMm) && metrics.minWallMm >= thresholds.minWallMm,
    detail: `min_wall_mm=${metrics.minWallMm} min=${thresholds.minWallMm}`,
  });

  // 7. Collision — zero interference across the declared pose(s) (min clearance ≥ 0).
  reasons.push({
    check: 'collision',
    pass: Number.isFinite(metrics.minClearanceMm) && metrics.minClearanceMm >= 0,
    detail: `min_clearance_mm=${metrics.minClearanceMm} (>=0 required)`,
  });

  return {
    pass: reasons.every((r) => r.pass),
    reasons,
    thresholdsVersion: thresholds.version,
  };
}
