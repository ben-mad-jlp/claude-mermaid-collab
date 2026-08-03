/**
 * Unit tests for runLandedEpicStartupBackfill in orchestrator-live.ts.
 *
 * Verifies:
 * - Each configured project's sweep runs exactly once on first call
 * - Partial failures don't halt iteration or cause the call to reject
 * - Multiple calls re-use the startupBackfillDone latch for idempotency
 * - Source-level guard: startOrchestrator wires the backfill
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'startup-backfill-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { runLandedEpicStartupBackfill, _resetStartupBackfillForTesting } from '../orchestrator-live';
import { _closeDb as closeConfigDb } from '../orchestrator-config';
import { _closeDb as closeSupervisorDb } from '../supervisor-store';

beforeAll(() => {
  closeConfigDb();
  closeSupervisorDb();
});

afterAll(() => {
  closeConfigDb();
  closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('runLandedEpicStartupBackfill', () => {
  beforeEach(() => {
    _resetStartupBackfillForTesting();
  });

  it('sweeps each configured project exactly once and returns their ids', async () => {
    const sweepCalls: string[] = [];
    const projectList = [
      { project: '/proj/a' },
      { project: '/proj/b' },
      { project: '/proj/c' },
    ];

    const result = await runLandedEpicStartupBackfill({
      listConfigured: () => projectList,
      sweep: async (project: string) => {
        sweepCalls.push(project);
      },
    });

    expect(sweepCalls).toEqual(['/proj/a', '/proj/b', '/proj/c']);
    expect(result).toEqual(['/proj/a', '/proj/b', '/proj/c']);
  });

  it("one project's sweep rejecting does not stop the others or reject the call", async () => {
    const sweepCalls: string[] = [];
    const projectList = [
      { project: '/proj/x' },
      { project: '/proj/y' },
      { project: '/proj/z' },
    ];

    const result = await runLandedEpicStartupBackfill({
      listConfigured: () => projectList,
      sweep: async (project: string) => {
        sweepCalls.push(project);
        if (project === '/proj/y') throw new Error('simulated sweep failure');
      },
    });

    // All three sweeps should run despite the failure for /proj/y
    expect(sweepCalls).toEqual(['/proj/x', '/proj/y', '/proj/z']);
    // Only the successful ones are returned
    expect(result).toEqual(['/proj/x', '/proj/z']);
  });

  it('a second call after the first is a no-op', async () => {
    const sweepCalls: string[] = [];
    const projectList = [
      { project: '/proj/1' },
      { project: '/proj/2' },
    ];

    const deps = {
      listConfigured: () => projectList,
      sweep: async (project: string) => {
        sweepCalls.push(project);
      },
    };

    // First call
    const result1 = await runLandedEpicStartupBackfill(deps);
    expect(sweepCalls).toEqual(['/proj/1', '/proj/2']);
    expect(result1).toEqual(['/proj/1', '/proj/2']);

    // Second call with same deps — should be a no-op
    const result2 = await runLandedEpicStartupBackfill(deps);
    expect(sweepCalls).toEqual(['/proj/1', '/proj/2']); // no additional calls
    expect(result2).toEqual([]); // latch prevents re-entry
  });

  it('startOrchestrator references runLandedEpicStartupBackfill', () => {
    const repoRoot = join(import.meta.dir, '..', '..', '..');
    const orchestratorLiveContent = readFileSync(
      join(repoRoot, 'src/services/orchestrator-live.ts'),
      'utf8'
    );

    // Extract startOrchestrator function body
    const startOrchestratorMatch = orchestratorLiveContent.match(
      /export function startOrchestrator\([^)]*\):[^{]*\{([\s\S]*?)\n\}/
    );
    expect(startOrchestratorMatch).toBeTruthy();

    if (startOrchestratorMatch) {
      const startOrchestratorBody = startOrchestratorMatch[0];
      expect(startOrchestratorBody).toContain('runLandedEpicStartupBackfill');
    }
  });
});
