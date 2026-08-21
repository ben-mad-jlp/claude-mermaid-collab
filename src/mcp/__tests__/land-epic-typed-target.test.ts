// Tests that land_epic's background dispatch passes a TYPED LandTarget object
// ({ epicId } or { escalationId }) to landEpic, not the untyped string form.
// Isolates the supervisor.db BEFORE any store module is imported, and stubs
// coordinator-land.landEpic to record what it was called with.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-typed-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import * as coordLand from '../../services/coordinator-land.js';
import { mock } from 'bun:test';

const recorded: any[] = [];
mock.module('../../services/coordinator-land.js', () => ({
  ...coordLand,
  landEpic: async (...args: any[]) => {
    recorded.push(args);
    return { ok: false, landed: false, reason: 'stub' };
  },
  resolveLandTarget: coordLand.resolveLandTarget,
}));

import { handleEpicTool } from '../epic-tools.js';
import { _closeDb as _closeSupervisorDb } from '../../services/supervisor-store.js';
import { _resetAsyncJobDbCache } from '../../services/async-job-store.js';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('land_epic typed target dispatch', () => {
  it('land_epic dispatches a typed LandTarget object to landEpic for both id forms', async () => {
    // Case A: epicId-only call.
    const projectA = mkdtempSync(join(tmpdir(), 'land-typed-repo-a-'));
    try {
      const epicId = 'epic-only-id';
      const resultA = await handleEpicTool('land_epic', { project: projectA, epicId });
      if (!resultA) throw new Error('handler returned null');
      JSON.parse(resultA);

      await Bun.sleep(0);
      await Bun.sleep(0);

      const callA = recorded[recorded.length - 1];
      expect(callA).toBeTruthy();
      const [, targetA] = callA;
      expect(typeof targetA).not.toBe('string');
      expect(targetA.epicId).toBe(epicId);
      expect('escalationId' in targetA).toBe(false);
    } finally {
      _resetAsyncJobDbCache(projectA);
      try { rmSync(projectA, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // Case B: escalationId-only call.
    const projectB = mkdtempSync(join(tmpdir(), 'land-typed-repo-b-'));
    try {
      const escalationId = 'escalation-only-id';
      const resultB = await handleEpicTool('land_epic', { project: projectB, escalationId });
      if (!resultB) throw new Error('handler returned null');
      JSON.parse(resultB);

      await Bun.sleep(0);
      await Bun.sleep(0);

      const callB = recorded[recorded.length - 1];
      expect(callB).toBeTruthy();
      const [, targetB] = callB;
      expect(typeof targetB).not.toBe('string');
      expect(targetB.escalationId).toBe(escalationId);
      expect('epicId' in targetB).toBe(false);
    } finally {
      _resetAsyncJobDbCache(projectB);
      try { rmSync(projectB, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
