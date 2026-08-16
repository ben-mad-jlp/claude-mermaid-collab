import { describe, it, expect } from 'bun:test';
import { classifyProbe } from '../mutation-probe.js';

describe('classifyProbe consistency', () => {
  it('throwArm FAILED with markerSeen false does not yield never-called', () => {
    const green = { ran: true, passed: true, exitCode: 0 };
    const throwArmFailed = { ran: true, passed: false, exitCode: 1 };

    const result = classifyProbe(green, green, throwArmFailed, false);

    // The result must NOT be never-called since the throw arm ran
    expect(result.execution).not.toBe('never-called');

    // The result must be EITHER a graded called-state OR unknown with
    // a reason naming both the marker and the throw arm
    if (result.verdict === 'unknown') {
      expect(result.reason).toBeDefined();
      expect(result.reason!.toLowerCase()).toContain('marker');
      expect(result.reason!.toLowerCase()).toContain('throw arm');
    } else if (result.verdict === 'graded') {
      expect(result.execution).toMatch(/^called-/);
    } else {
      throw new Error(`Unexpected verdict: ${result.verdict}`);
    }
  });

  it('probe verdict agrees with a hand mutation on a load-bearing guard', () => {
    // Simulate a real load-bearing guard: control passes, neutered passes,
    // throw fails (the guard fires), marker is seen
    const control = { ran: true, passed: true, exitCode: 0 };
    const neutered = { ran: true, passed: true, exitCode: 0 };
    const throwFailed = { ran: true, passed: false, exitCode: 1 };

    const result = classifyProbe(control, neutered, throwFailed, true);

    expect(result.verdict).toBe('graded');
    expect(result.execution).toBe('called-observed');
  });
});
