import { describe, it, expect } from 'bun:test';
import { oi1ReconcileLandStep, type Oi1LandWorktree, type Oi1LandDeps } from '../coordinator-live';
import type { LandTypecheckProof } from '../land-typecheck-floor';

describe('oi1ReconcileLandStep', () => {
  describe('typecheck floor fail case', () => {
    it('refuses the land and records the proof when the typecheck floor fails', async () => {
      const recordAttemptCalls: any[] = [];
      let landEpicToMasterCalled = false;

      const fakeWorktree: Oi1LandWorktree = {
        ensureEpic: async () => ({ path: '/fake/worktree' }),
        landEpicToMaster: async () => {
          landEpicToMasterCalled = true;
          return { landed: false, conflict: false, reason: 'not-landed' };
        },
        epicHeadSha: async () => null,
      };

      const failProof: LandTypecheckProof = {
        status: 'fail',
        command: 'npm run tsc',
        exitCode: 1,
        firstError: 'error TS2345: Argument of type not assignable',
        output: 'error TS2345: ...\n',
      };

      const deps: Oi1LandDeps = {
        typecheckFloor: async () => failProof,
        recordAttempt: (proj, a) => recordAttemptCalls.push({ proj, a }),
      };

      const result = await oi1ReconcileLandStep({
        project: 'test-proj',
        todoId: 'todo-123',
        epicId: 'epic-abc',
        intRef: 'origin/master',
        session: 'test-session',
        targetProject: '/target/proj',
        wm: fakeWorktree,
        deps,
      });

      expect(result.landConflict).toBe(false);
      expect(landEpicToMasterCalled).toBe(false);
      expect(recordAttemptCalls).toHaveLength(1);
      expect(recordAttemptCalls[0].a.outcome).toBe('refused');
      expect(recordAttemptCalls[0].a.reason).toContain('land-typecheck-red');
      expect(recordAttemptCalls[0].a.typecheckCommand).toBe('npm run tsc');
      expect(recordAttemptCalls[0].a.typecheckExitCode).toBe(1);
      expect(recordAttemptCalls[0].a.typecheckFirstError).toBe('error TS2345: Argument of type not assignable');
    });

    it('refuses the land when the typecheck compiler could not run', async () => {
      const recordAttemptCalls: any[] = [];
      let landEpicToMasterCalled = false;

      const fakeWorktree: Oi1LandWorktree = {
        ensureEpic: async () => ({ path: '/fake/worktree' }),
        landEpicToMaster: async () => {
          landEpicToMasterCalled = true;
          return { landed: false, conflict: false, reason: 'not-landed' };
        },
        epicHeadSha: async () => null,
      };

      const errorProof: LandTypecheckProof = {
        status: 'error',
        command: 'npm run tsc',
        exitCode: null,
        firstError: 'typecheck command could not run',
        output: '',
      };

      const deps: Oi1LandDeps = {
        typecheckFloor: async () => errorProof,
        recordAttempt: (proj, a) => recordAttemptCalls.push({ proj, a }),
      };

      const result = await oi1ReconcileLandStep({
        project: 'test-proj',
        todoId: 'todo-123',
        epicId: 'epic-abc',
        intRef: 'origin/master',
        session: 'test-session',
        targetProject: '/target/proj',
        wm: fakeWorktree,
        deps,
      });

      expect(result.landConflict).toBe(false);
      expect(landEpicToMasterCalled).toBe(false);
      expect(recordAttemptCalls).toHaveLength(1);
      expect(recordAttemptCalls[0].a.outcome).toBe('refused');
      expect(recordAttemptCalls[0].a.reason).toBe('land-typecheck-could-not-run');
      expect(recordAttemptCalls[0].a.typecheckCommand).toBe('npm run tsc');
    });
  });

  describe('typecheck floor pass case', () => {
    it('lands once and records outcome merged when the typecheck floor passes', async () => {
      const recordAttemptCalls: any[] = [];
      const afterLandedCalls: any[] = [];
      let landEpicToMasterCalled = false;

      const fakeWorktree: Oi1LandWorktree = {
        ensureEpic: async () => ({ path: '/fake/worktree' }),
        landEpicToMaster: async (epicId, opts) => {
          landEpicToMasterCalled = true;
          return {
            landed: true,
            conflict: false,
            reason: 'ok',
            masterSha: 'abc123def456',
            baseRef: 'origin/master',
          };
        },
        epicHeadSha: async () => null,
      };

      const passProof: LandTypecheckProof = {
        status: 'pass',
        command: 'npm run tsc',
        exitCode: 0,
        firstError: null,
        output: '',
      };

      const deps: Oi1LandDeps = {
        typecheckFloor: async () => passProof,
        recordAttempt: (proj, a) => recordAttemptCalls.push({ proj, a }),
        afterLanded: async (land) => {
          afterLandedCalls.push({ land });
        },
      };

      const result = await oi1ReconcileLandStep({
        project: 'test-proj',
        todoId: 'todo-123',
        epicId: 'epic-abc',
        intRef: 'origin/master',
        session: 'test-session',
        targetProject: '/target/proj',
        wm: fakeWorktree,
        deps,
      });

      expect(result.landConflict).toBe(false);
      expect(landEpicToMasterCalled).toBe(true);
      expect(afterLandedCalls).toHaveLength(1);
      expect(recordAttemptCalls).toHaveLength(1);
      expect(recordAttemptCalls[0].a.outcome).toBe('merged');
      expect(recordAttemptCalls[0].a.reason).toBe('ok');
      expect(recordAttemptCalls[0].a.typecheckCommand).toBe('npm run tsc');
      expect(recordAttemptCalls[0].a.typecheckExitCode).toBe(0);
      expect(recordAttemptCalls[0].a.typecheckFirstError).toBeNull();
      expect(recordAttemptCalls[0].a.mergeSha).toBe('abc123def456');
    });

    it('lands with not-applicable proof and records merged outcome', async () => {
      const recordAttemptCalls: any[] = [];
      let landEpicToMasterCalled = false;

      const fakeWorktree: Oi1LandWorktree = {
        ensureEpic: async () => ({ path: '/fake/worktree' }),
        landEpicToMaster: async (epicId, opts) => {
          landEpicToMasterCalled = true;
          return {
            landed: true,
            conflict: false,
            reason: 'ok',
            masterSha: 'abc123def456',
            baseRef: 'origin/master',
          };
        },
        epicHeadSha: async () => null,
      };

      const notApplicableProof: LandTypecheckProof = {
        status: 'not-applicable',
        command: null,
        exitCode: null,
        firstError: null,
        output: '',
      };

      const deps: Oi1LandDeps = {
        typecheckFloor: async () => notApplicableProof,
        recordAttempt: (proj, a) => recordAttemptCalls.push({ proj, a }),
        afterLanded: async () => {},
      };

      const result = await oi1ReconcileLandStep({
        project: 'test-proj',
        todoId: 'todo-123',
        epicId: 'epic-abc',
        intRef: 'origin/master',
        session: 'test-session',
        targetProject: '/target/proj',
        wm: fakeWorktree,
        deps,
      });

      expect(result.landConflict).toBe(false);
      expect(landEpicToMasterCalled).toBe(true);
      expect(recordAttemptCalls).toHaveLength(1);
      expect(recordAttemptCalls[0].a.outcome).toBe('merged');
      expect(recordAttemptCalls[0].a.typecheckCommand).toBeNull();
      expect(recordAttemptCalls[0].a.typecheckExitCode).toBeNull();
      expect(recordAttemptCalls[0].a.typecheckFirstError).toBeNull();
    });
  });

  describe('land conflict case', () => {
    it('returns landConflict true when land returns conflict and skips recording merged outcome', async () => {
      const recordAttemptCalls: any[] = [];

      const fakeWorktree: Oi1LandWorktree = {
        ensureEpic: async () => ({ path: '/fake/worktree' }),
        landEpicToMaster: async (epicId, opts) => ({
          landed: false,
          conflict: true,
          reason: undefined,
          masterSha: null,
          baseRef: 'origin/master',
        }),
        epicHeadSha: async () => null,
      };

      const passProof: LandTypecheckProof = {
        status: 'pass',
        command: 'npm run tsc',
        exitCode: 0,
        firstError: null,
        output: '',
      };

      const deps: Oi1LandDeps = {
        typecheckFloor: async () => passProof,
        recordAttempt: (proj, a) => recordAttemptCalls.push({ proj, a }),
      };

      const result = await oi1ReconcileLandStep({
        project: 'test-proj',
        todoId: 'todo-123',
        epicId: 'epic-abc',
        intRef: 'origin/master',
        session: 'test-session',
        targetProject: '/target/proj',
        wm: fakeWorktree,
        deps,
      });

      expect(result.landConflict).toBe(true);
      expect(recordAttemptCalls).toHaveLength(1);
      expect(recordAttemptCalls[0].a.outcome).toBe('refused');
      expect(recordAttemptCalls[0].a.reason).toBe('conflict');
    });
  });

  describe('error handling', () => {
    it('records errored outcome and returns false landConflict when floor throws', async () => {
      const recordAttemptCalls: any[] = [];

      const fakeWorktree: Oi1LandWorktree = {
        ensureEpic: async () => ({ path: '/fake/worktree' }),
        landEpicToMaster: async (epicId, opts) => ({ landed: false, conflict: false, reason: 'not-landed' }),
        epicHeadSha: async () => null,
      };

      const deps: Oi1LandDeps = {
        typecheckFloor: async () => {
          throw new Error('Floor execution failed');
        },
        recordAttempt: (proj, a) => recordAttemptCalls.push({ proj, a }),
      };

      const result = await oi1ReconcileLandStep({
        project: 'test-proj',
        todoId: 'todo-123',
        epicId: 'epic-abc',
        intRef: 'origin/master',
        session: 'test-session',
        targetProject: '/target/proj',
        wm: fakeWorktree,
        deps,
      });

      expect(result.landConflict).toBe(false);
      expect(recordAttemptCalls).toHaveLength(1);
      expect(recordAttemptCalls[0].a.outcome).toBe('errored');
      expect(recordAttemptCalls[0].a.reason).toBe('Floor execution failed');
    });

    it('records errored outcome when land throws', async () => {
      const recordAttemptCalls: any[] = [];

      const fakeWorktree: Oi1LandWorktree = {
        ensureEpic: async () => ({ path: '/fake/worktree' }),
        landEpicToMaster: async (epicId, opts) => {
          throw new Error('Land failed');
        },
        epicHeadSha: async () => null,
      };

      const passProof: LandTypecheckProof = {
        status: 'pass',
        command: 'npm run tsc',
        exitCode: 0,
        firstError: null,
        output: '',
      };

      const deps: Oi1LandDeps = {
        typecheckFloor: async () => passProof,
        recordAttempt: (proj, a) => recordAttemptCalls.push({ proj, a }),
      };

      const result = await oi1ReconcileLandStep({
        project: 'test-proj',
        todoId: 'todo-123',
        epicId: 'epic-abc',
        intRef: 'origin/master',
        session: 'test-session',
        targetProject: '/target/proj',
        wm: fakeWorktree,
        deps,
      });

      expect(result.landConflict).toBe(false);
      expect(recordAttemptCalls).toHaveLength(1);
      expect(recordAttemptCalls[0].a.outcome).toBe('errored');
      expect(recordAttemptCalls[0].a.reason).toBe('Land failed');
    });
  });
});
