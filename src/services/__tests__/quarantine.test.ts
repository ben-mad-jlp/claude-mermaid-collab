/**
 * Quarantine — the exclusion that lets a red-by-design repro be COMMITTED without redding the
 * base gate for every epic project-wide.
 *
 * MUTATION CONTRACT: Test D is the one that matters. Remove the `isQuarantined` filter from
 * `routeSpecsToLanes` and D reds — it proves the shared lane chokepoint actually drops the spec,
 * which is what keeps the per-file leaf gate AND the epic land gate off it. The segment tests
 * (A–C) guard against the lazy substring implementation, which would wrongly quarantine a file
 * merely NAMED like one.
 */
import { describe, it, expect } from 'bun:test';
import { isQuarantined, partitionQuarantined, QUARANTINE_SEGMENT } from '../quarantine';
import { routeSpecsToLanes } from '../leaf-gate';

describe('isQuarantined', () => {
  it('Test A: matches a path SEGMENT, on either separator, absolute or relative', () => {
    expect(isQuarantined('ui/src/x/__tests__/__quarantine__/a.test.ts')).toBe(true);
    expect(isQuarantined('/abs/src/services/__tests__/__quarantine__/a.test.ts')).toBe(true);
    expect(isQuarantined('src\\services\\__quarantine__\\a.test.ts')).toBe(true);
    expect(isQuarantined(`${QUARANTINE_SEGMENT}/a.test.ts`)).toBe(true);
  });

  it('Test B: does NOT match a mere substring — a lookalike name is not quarantined', () => {
    // The lazy implementation (`path.includes('__quarantine__')`) would wrongly pass these.
    expect(isQuarantined('src/services/my__quarantine__helper.test.ts')).toBe(false);
    expect(isQuarantined('src/not__quarantine__ed/a.test.ts')).toBe(false);
  });

  it('Test C: ordinary paths and empty input are not quarantined', () => {
    expect(isQuarantined('src/services/__tests__/real.test.ts')).toBe(false);
    expect(isQuarantined('')).toBe(false);
  });

  it('partitionQuarantined returns BOTH halves so a caller can report what it skipped', () => {
    const { run, quarantined } = partitionQuarantined([
      'src/a.test.ts',
      'src/__quarantine__/b.test.ts',
      'ui/src/c.test.ts',
    ]);
    expect(run).toEqual(['src/a.test.ts', 'ui/src/c.test.ts']);
    expect(quarantined).toEqual(['src/__quarantine__/b.test.ts']);
  });
});

describe('routeSpecsToLanes — the shared gate chokepoint', () => {
  const lanes = [
    { match: /^src\//, command: 'bun test {file}' },
    { match: /^ui\//, command: 'bunx vitest --run {files}', cwd: 'ui' },
  ] as any;

  it('Test D: a quarantined spec is routed to NO lane and is not reported unmatched', () => {
    const { byLane, unmatched } = routeSpecsToLanes(
      [
        'src/services/__tests__/real.test.ts',
        'src/services/__tests__/__quarantine__/repro.test.ts',
        'ui/src/components/__tests__/__quarantine__/repro.test.ts',
      ],
      lanes,
    );

    const routed = [...byLane.values()].flat();
    expect(routed).toEqual(['src/services/__tests__/real.test.ts']);

    // `unmatched` means "no lane claims this" and surfaces as a gate-config warning.
    // A quarantined spec is deliberately laneless — it must not be reported as misconfiguration.
    expect(unmatched).toEqual([]);
  });

  it('Test E: a lane that matches ONLY quarantined specs runs nothing at all', () => {
    const { byLane } = routeSpecsToLanes(['src/__quarantine__/a.test.ts'], lanes);
    expect([...byLane.values()].flat()).toEqual([]);
  });
});
