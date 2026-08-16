import { describe, it, expect } from 'bun:test';
import { attributeFloorFailures } from '../epic-land-gate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('attributeFloorFailures', () => {
  it('answers trunk-red with the file list when every floor failure reproduces at the merge-base', () => {
    const result = attributeFloorFailures({
      command: 'bun test',
      failing: ['(218/501) src/foo.test.ts', '(219/501) src/bar.test.ts'],
      regressed: [],
      inherited: ['(218/501) src/foo.test.ts', '(219/501) src/bar.test.ts'],
    });

    expect(result.verdict).toBe('trunk-red');
    expect(result.files).toEqual(['src/bar.test.ts', 'src/foo.test.ts']); // sorted
  });

  it('answers gate-regression naming only the newly failing file', () => {
    const result = attributeFloorFailures({
      command: 'bun test',
      failing: [
        '(218/501) src/foo.test.ts',
        '(219/501) src/bar.test.ts',
        '(220/501) src/new.test.ts',
      ],
      regressed: ['(220/501) src/new.test.ts'],
      inherited: ['(218/501) src/foo.test.ts', '(219/501) src/bar.test.ts'],
    });

    expect(result.verdict).toBe('gate-regression');
    expect(result.files).toEqual(['src/new.test.ts']);
  });

  it('wiring: attributeFloorFailures is called in the floor-fail branch', () => {
    // Read the source file and verify the function is called within the floor?.status === 'fail' branch
    const sourceFile = join(import.meta.dir, '..', 'epic-land-gate.ts');
    const content = readFileSync(sourceFile, 'utf-8');

    // Verify attributeFloorFailures appears in the file
    expect(content).toContain('attributeFloorFailures');

    // Verify it's called within the conditional block by checking the context
    const floorFailBlock = content.match(/if \(floor\?\.status === 'fail'\)[\s\S]*?^  \}/m);
    expect(floorFailBlock).toBeDefined();
    expect(floorFailBlock?.[0]).toContain('attributeFloorFailures');
  });

  it('carries the file list on the job error payload in both cases', () => {
    // Test trunk-red verdict
    const trunkRedGate = {
      status: 'fail' as const,
      declared: true,
      manifestPath: '/test',
      units: [],
      regressions: [],
      inherited: [],
      incidents: [],
      reasons: ['test'],
      specFiles: [],
      epicTipSha: 'abc123',
      baseSha: 'def456',
      floorAttribution: {
        verdict: 'trunk-red' as const,
        files: ['src/bar.test.ts', 'src/foo.test.ts'],
      },
    };

    // Import the necessary helpers
    const coordinatorLand = require('../coordinator-land');
    const landAttributionFields = coordinatorLand.landAttributionFields;

    // Test trunk-red case
    const trunkRedFields = landAttributionFields(trunkRedGate);
    expect(trunkRedFields.attributedFiles).toEqual(['src/bar.test.ts', 'src/foo.test.ts']);
    expect(trunkRedFields.landAttribution).toBe('trunk-red');

    // Simulate the outcome that the proof-failure path returns
    const trunkRedOutcome = {
      ok: false,
      landed: false,
      reason: 'trunk-red',
      epicId: 'epic123',
      epicBranch: 'collab/epic/12345678',
      ...trunkRedFields,
    };

    // Simulate the epic-tools payload spread
    const trunkRedPayload = {
      ...trunkRedOutcome,
      landedBy: 'Landed-By: Human <user@example.com>',
      actor: 'human',
    };

    // Verify the spread includes the attributed files
    const parsed = JSON.parse(JSON.stringify(trunkRedPayload));
    expect(parsed.attributedFiles).toEqual(['src/bar.test.ts', 'src/foo.test.ts']);
    expect(parsed.landAttribution).toBe('trunk-red');

    // Test gate-regression case
    const gateRegressionGate = {
      status: 'fail' as const,
      declared: true,
      manifestPath: '/test',
      units: [],
      regressions: [],
      inherited: [],
      incidents: [],
      reasons: ['test'],
      specFiles: [],
      epicTipSha: 'abc123',
      baseSha: 'def456',
      floorAttribution: {
        verdict: 'gate-regression' as const,
        files: ['src/new.test.ts'],
      },
    };

    const gateRegressionFields = landAttributionFields(gateRegressionGate);
    expect(gateRegressionFields.attributedFiles).toEqual(['src/new.test.ts']);
    expect(gateRegressionFields.landAttribution).toBe('gate-regression');

    // Simulate the outcome and payload for gate-regression
    const gateRegressionOutcome = {
      ok: false,
      landed: false,
      reason: 'gate-regression',
      epicId: 'epic123',
      epicBranch: 'collab/epic/12345678',
      ...gateRegressionFields,
    };

    const gateRegressionPayload = {
      ...gateRegressionOutcome,
      landedBy: 'Landed-By: Human <user@example.com>',
      actor: 'human',
    };

    const parsedRegression = JSON.parse(JSON.stringify(gateRegressionPayload));
    expect(parsedRegression.attributedFiles).toEqual(['src/new.test.ts']);
    expect(parsedRegression.landAttribution).toBe('gate-regression');

    // Verify the wiring: epic-tools.ts line 107 spreads result with ...result
    const epicToolsFile = join(import.meta.dir, '..', '..', 'mcp', 'epic-tools.ts');
    const epicToolsContent = readFileSync(epicToolsFile, 'utf-8');
    // The payload is spread as `{ ...result, landedBy, actor }` at the markJobFailed call
    expect(epicToolsContent).toContain('{ ...result, landedBy: trailer, actor: actor.kind }');
  });
});
