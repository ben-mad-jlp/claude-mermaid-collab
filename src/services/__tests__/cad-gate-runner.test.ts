import { describe, it, expect } from 'vitest';
import {
  runCadGate,
  countDistinctAxes,
  DEFAULT_CAD_GATE_THRESHOLDS,
  CAD_GATE_THRESHOLDS_VERSION,
  type CadMetrics,
  type CadGateSpec,
} from '../cad-gate-runner';

// The arm contract (E0): 5 free DOF, must sweep a real workspace, must have
// genuinely distinct joint axes (anti-coaxial).
const ARM_SPEC: CadGateSpec = {
  requiredDof: 5,
  minDistinctAxes: 2,
  minWorkspaceVolCm3: 500,
};

// RUN-1 — the coaxial-arm failure: geometry is valid and DOF count is right, but
// every joint shares the Z axis, so the Jacobian is near-singular, the workspace
// collapses to ~0, and the chain has only ONE distinct axis. Valid + right-DOF,
// yet useless — exactly the mechanism the mechanical gate let through.
const RUN1_COAXIAL: CadMetrics = {
  valid: true,
  dof: 5,
  workspaceVolCm3: 8, // collapsed — coaxial chain has no reach
  medianCond: 1.0e6, // near-singular Jacobian
  minWallMm: 3,
  minClearanceMm: 2,
  jointAxes: [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ],
};

// RUN-2 — the good arm: diverse axes (J1 yaw-Z, J2/J3/J4 pitch-Y, J5 roll-X), real
// link lengths giving a real workspace, a well-conditioned Jacobian, no collision.
const RUN2_GOOD: CadMetrics = {
  valid: true,
  dof: 5,
  workspaceVolCm3: 8500,
  medianCond: 12,
  minWallMm: 3,
  minClearanceMm: 4,
  jointAxes: [
    [0, 0, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 0, 0],
  ],
};

describe('cad-gate-runner — acceptance oracle', () => {
  it('FAILS the RUN-1 coaxial arm on workspace, condition-number, and axis-diversity', () => {
    const v = runCadGate(RUN1_COAXIAL, ARM_SPEC);
    expect(v.pass).toBe(false);
    const failed = v.reasons.filter((r) => !r.pass).map((r) => r.check).sort();
    expect(failed).toEqual(['axis-diversity', 'condition-number', 'workspace']);
  });

  it('PASSES the RUN-2 good arm', () => {
    const v = runCadGate(RUN2_GOOD, ARM_SPEC);
    expect(v.pass).toBe(true);
    expect(v.reasons.every((r) => r.pass)).toBe(true);
  });

  it('is deterministic — same input yields an identical verdict', () => {
    expect(runCadGate(RUN1_COAXIAL, ARM_SPEC)).toEqual(runCadGate(RUN1_COAXIAL, ARM_SPEC));
    expect(runCadGate(RUN2_GOOD, ARM_SPEC)).toEqual(runCadGate(RUN2_GOOD, ARM_SPEC));
  });

  it('stamps the thresholds version for attribution', () => {
    expect(runCadGate(RUN2_GOOD, ARM_SPEC).thresholdsVersion).toBe(CAD_GATE_THRESHOLDS_VERSION);
    expect(DEFAULT_CAD_GATE_THRESHOLDS.version).toBe(CAD_GATE_THRESHOLDS_VERSION);
  });
});

describe('cad-gate-runner — individual invariants', () => {
  it('fails validity on an empty/invalid solid', () => {
    const v = runCadGate({ ...RUN2_GOOD, valid: false }, ARM_SPEC);
    expect(v.pass).toBe(false);
    expect(v.reasons.find((r) => r.check === 'validity')?.pass).toBe(false);
  });

  it('fails DOF when the chain moves the wrong number of dimensions', () => {
    const v = runCadGate({ ...RUN2_GOOD, dof: 4 }, ARM_SPEC);
    expect(v.reasons.find((r) => r.check === 'dof')?.pass).toBe(false);
  });

  it('treats a non-finite condition number as singular (fail)', () => {
    const v = runCadGate({ ...RUN2_GOOD, medianCond: Number.POSITIVE_INFINITY }, ARM_SPEC);
    expect(v.reasons.find((r) => r.check === 'condition-number')?.pass).toBe(false);
  });

  it('fails collision on negative clearance (link below the table)', () => {
    const v = runCadGate({ ...RUN2_GOOD, minClearanceMm: -87 }, ARM_SPEC);
    expect(v.reasons.find((r) => r.check === 'collision')?.pass).toBe(false);
  });

  it('fails min-wall below the DfM floor', () => {
    const v = runCadGate({ ...RUN2_GOOD, minWallMm: 0.5 }, ARM_SPEC);
    expect(v.reasons.find((r) => r.check === 'min-wall')?.pass).toBe(false);
  });
});

describe('countDistinctAxes', () => {
  const tol = DEFAULT_CAD_GATE_THRESHOLDS.axisParallelToleranceDeg;

  it('collapses coaxial axes to one direction', () => {
    expect(countDistinctAxes(RUN1_COAXIAL.jointAxes, tol)).toBe(1);
  });

  it('counts anti-parallel as the same direction', () => {
    expect(
      countDistinctAxes(
        [
          [0, 0, 1],
          [0, 0, -1],
        ],
        tol,
      ),
    ).toBe(1);
  });

  it('counts genuinely distinct axes', () => {
    expect(countDistinctAxes(RUN2_GOOD.jointAxes, tol)).toBe(3); // Z, Y, X
  });

  it('normalizes non-unit axes and ignores zero-length vectors', () => {
    expect(
      countDistinctAxes(
        [
          [0, 0, 5],
          [0, 0, 0],
          [3, 0, 0],
        ],
        tol,
      ),
    ).toBe(2);
  });
});
