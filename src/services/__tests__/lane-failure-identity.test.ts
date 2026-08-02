import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The ledger recorder hits the real worker-ledger DB (worker-ledger.openDb, keyed off
// MERMAID_SUPERVISOR_DIR and memoized on first open) — point it at a fresh temp
// dir BEFORE anything opens it, so this test never touches the real ledger.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'lane-failure-identity-'));

const { synthesizeLaneFailureIdentity, extractFailingTests } = await import('../gate-runner');
const { recordBaseGateTestRuns, listObservations, listTestQuarantine } = await import('../worker-ledger');
const { classifyFlakyCandidates, promoteQuarantineCandidates } = await import('../flaky-quarantine');

describe('synthesizeLaneFailureIdentity', () => {
  it('produces the same synthetic identity for two nameless unhandled-rejection transcripts differing only in paths, timings and pids', () => {
    const laneKey = 'suites:ui';

    const transcript1 = `
      Unhandled Rejection at /Users/alice/code/build123d-ocp-mcp/src/components/x.ts:42:7
      TypeError: Cannot read property 'foo' of undefined (pid 1234, duration 152ms)
      at Object.<anonymous> (/Users/alice/code/build123d-ocp-mcp/src/utils/helper.ts:10:3)
    `;

    const transcript2 = `
      Unhandled Rejection at /home/bob/projects/build123d-ocp-mcp/src/components/x.ts:42:7
      TypeError: Cannot read property 'foo' of undefined (pid 5678, duration 145.2ms)
      at Object.<anonymous> (/home/bob/projects/build123d-ocp-mcp/src/utils/helper.ts:10:3)
    `;

    const id1 = synthesizeLaneFailureIdentity(laneKey, transcript1);
    const id2 = synthesizeLaneFailureIdentity(laneKey, transcript2);

    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull();
    expect(id1).toBe(id2);
    expect(id1).toContain('suites:ui::unhandled-rejection:');
    expect(id1).toContain('Cannot read property');
  });

  it('extractFailingTests still returns real names and synthesizeLaneFailureIdentity returns null for a transcript with a marked failure line', () => {
    const laneKey = 'tests:unit';

    // A normal vitest transcript with test names, no unhandled rejection.
    const normalTranscript = `
      ✕ suite > test one 5 ms
      ✕ suite > test two 3 ms
      FAIL src/index.test.ts
    `;

    const failingTests = extractFailingTests(normalTranscript);
    const synthetic = synthesizeLaneFailureIdentity(laneKey, normalTranscript);

    expect(failingTests).toContain('suite > test one');
    expect(failingTests).toContain('suite > test two');
    expect(failingTests).toContain('src/index.test.ts');
    expect(synthetic).toBeNull();
  });

  it('a synthesized identity is classifiable by classifyFlakyCandidates and promotable by promoteQuarantineCandidates', () => {
    const project = '/lane-fail-e2e';
    const laneKey = 'suites:e2e-tests';
    const now = Date.now();

    // Generate a synthetic id from an unhandled rejection.
    const syntheticTranscript = `
      Unhandled Rejection at /code/test.ts:10:5
      Error: Connection timeout
    `;
    const syntheticId = synthesizeLaneFailureIdentity(laneKey, syntheticTranscript);
    expect(syntheticId).not.toBeNull();
    const testId = syntheticId!;

    // Record three base-gate test runs at three distinct shas with mixed results.
    const sha1 = 'sha-abc-123';
    const sha2 = 'sha-def-456';

    // Sha1: mixed pass/fail (flaky evidence)
    recordBaseGateTestRuns({
      project,
      baseSha: sha1,
      lane: laneKey,
      ranTests: [testId],
      failingTests: [testId],
      scope: 'base',
    });
    recordBaseGateTestRuns({
      project,
      baseSha: sha1,
      lane: laneKey,
      ranTests: [testId],
      failingTests: [],
      scope: 'base',
    });
    recordBaseGateTestRuns({
      project,
      baseSha: sha1,
      lane: laneKey,
      ranTests: [testId],
      failingTests: [testId],
      scope: 'base',
    });

    // Sha2: all pass (proves it's not a sha-correlated failure)
    recordBaseGateTestRuns({
      project,
      baseSha: sha2,
      lane: laneKey,
      ranTests: [testId],
      failingTests: [],
      scope: 'base',
    });

    // Classify flaky candidates from the observations.
    const observations = listObservations(project, 0);
    expect(observations.length).toBeGreaterThan(0);

    const candidates = classifyFlakyCandidates(observations, now);

    // The synthetic id should be classified as flaky (mixed pass/fail at sha1).
    const flakyCandidate = candidates.find((c) => c.test === testId);
    expect(flakyCandidate).toBeDefined();
    expect(flakyCandidate!.evidence.runs).toBeGreaterThan(1);
    expect(flakyCandidate!.evidence.passRuns).toBeGreaterThan(0);
    expect(flakyCandidate!.evidence.failRuns).toBeGreaterThan(0);

    // Promote quarantine candidates — the synthetic id should be written to the quarantine table.
    promoteQuarantineCandidates(project, now);

    const quarantined = listTestQuarantine(project);

    const quarantineEntry = quarantined.find((q) => q.test === testId);
    expect(quarantineEntry).toBeDefined();
    expect(quarantineEntry!.test).toBe(testId);
  });

  it('returns null for a red lane output with no recognised unhandled-rejection markers', () => {
    const laneKey = 'tests:unknown';
    const output = `
      Some random error output
      A line that mentions nothing of interest
      Exit code 1
    `;

    const result = synthesizeLaneFailureIdentity(laneKey, output);
    expect(result).toBeNull();
  });

  it('still returns a stable identity even when only the marker line is present', () => {
    const laneKey = 'tests:edge-case';
    const output1 = `
      Unhandled Rejection at /path/to/file.ts:1:1

    `;
    const output2 = `
      Unhandled Rejection at /different/path/here.ts:5:10

    `;

    const result1 = synthesizeLaneFailureIdentity(laneKey, output1);
    const result2 = synthesizeLaneFailureIdentity(laneKey, output2);

    // Both should produce the same identity since they have the same marker type and structure
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1).toBe(result2);
  });

  it('recognises all three marker variants: Unhandled Rejection, Unhandled Error, ERR_UNHANDLED_REJECTION', () => {
    const laneKey = 'tests:markers';

    const unhandledRejection = `Unhandled Rejection at /path.ts:1:1\nError: test`;
    const unhandledError = `Unhandled Error at /path.ts:1:1\nError: test`;
    const errCode = `ERR_UNHANDLED_REJECTION at /path.ts:1:1\nError: test`;

    expect(synthesizeLaneFailureIdentity(laneKey, unhandledRejection)).not.toBeNull();
    expect(synthesizeLaneFailureIdentity(laneKey, unhandledError)).not.toBeNull();
    expect(synthesizeLaneFailureIdentity(laneKey, errCode)).not.toBeNull();
  });
});
