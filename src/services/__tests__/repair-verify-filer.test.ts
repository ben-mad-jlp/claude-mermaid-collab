import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveVerifyExplore,
  extractNamedAnchor,
  runRepairVerifyFilerPass,
  shouldRunRepairVerifyFilerPass,
  _resetRepairVerifyFilerThrottle,
} from '../repair-verify-filer';
import type { RepairVerifyFilerDeps, RepairVerifyFilerResult } from '../repair-verify-filer';
import type { Todo } from '../todo-store';

describe('repair-verify-filer', () => {
  beforeEach(() => {
    _resetRepairVerifyFilerThrottle();
  });

  describe('extractNamedAnchor', () => {
    it('extracts dotted notation', () => {
      expect(extractNamedAnchor('check that myModule.myFunction is called')).toBe('myModule.myFunction');
    });

    it('extracts camelCase', () => {
      expect(extractNamedAnchor('verify that myCamelCase works properly')).toBe('myCamelCase');
    });

    it('extracts snake_case', () => {
      expect(extractNamedAnchor('verify my_snake_case never crashes')).toBe('my_snake_case');
    });

    it('extracts path:line', () => {
      expect(extractNamedAnchor('src/services/foo.ts:42 should not throw')).toBe('src/services/foo.ts:42');
    });

    it('extracts hash/golden', () => {
      expect(extractNamedAnchor('golden ref a1b2c3d4e5f6c7d')).toBe('a1b2c3d4e5f6c7d');
    });

    it('returns null for pure prose', () => {
      expect(extractNamedAnchor('this is just text with no symbols')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractNamedAnchor('')).toBeNull();
    });
  });

  describe('deriveVerifyExplore', () => {
    it('returns spec when criterion has named anchor', () => {
      const spec = deriveVerifyExplore(
        { id: 'crit_1', text: 'myFunction should never throw on invalid input' },
        'Repair mission: fix crash',
      );
      expect(spec).toBeTruthy();
      expect(spec!.oracle).toBe('myFunction should never throw on invalid input');
      expect(spec!.target).toBe('myFunction');
      expect(spec!.scope).toBe('Repair mission: fix crash');
    });

    it('returns null when criterion has no named anchor', () => {
      const spec = deriveVerifyExplore(
        { id: 'crit_1', text: 'the fix should work correctly' },
        'Repair mission: fix something',
      );
      expect(spec).toBeNull();
    });

    it('oracle is verbatim criterion text', () => {
      const text = 'myFunc must not throw with special characters like @#$%';
      const spec = deriveVerifyExplore(
        { id: 'crit_1', text },
        'Test mission',
      );
      expect(spec?.oracle).toBe(text);
    });
  });

  describe('shouldRunRepairVerifyFilerPass', () => {
    it('runs on first call', () => {
      expect(shouldRunRepairVerifyFilerPass('project1', 1000)).toBe(true);
    });

    it('blocks within interval', () => {
      shouldRunRepairVerifyFilerPass('project1', 1000);
      expect(shouldRunRepairVerifyFilerPass('project1', 1100)).toBe(false);
    });

    it('runs after interval expires', () => {
      shouldRunRepairVerifyFilerPass('project1', 1000);
      expect(shouldRunRepairVerifyFilerPass('project1', 1000 + 300_001)).toBe(true);
    });

    it('has independent timers per project', () => {
      shouldRunRepairVerifyFilerPass('project1', 1000);
      expect(shouldRunRepairVerifyFilerPass('project2', 1000)).toBe(true);
    });
  });

  describe('runRepairVerifyFilerPass', () => {
    it('files exactly one explore per anchored met criterion and none for pure prose', async () => {
      const filedExplores: Array<{ scope: string; target: string; oracle: string; description: string }> = [];

      const deps: RepairVerifyFilerDeps = {
        listTodos: () => [],
        listMissions: () => [
          {
            node: { id: 'mission1', title: 'Repair: fix crash' },
            mission: { status: 'converged' },
            ownerSession: '__auto_repair_forge__',
          } as any,
        ],
        listCriteria: () => [
          { id: 'crit_1', text: 'myFunction should never crash', met: true, status: 'active' },
          { id: 'crit_2', text: 'pure prose without any symbols or references', met: true, status: 'active' },
        ],
        fileExplore: async (project, session, opts) => {
          filedExplores.push(opts);
          return { leaf: { id: `leaf_${filedExplores.length}` } as Todo };
        },
      };

      const result = await runRepairVerifyFilerPass('project', deps);

      // Should file 1 explore (crit_1 has anchor), skip 1 (crit_2 has no anchor)
      expect(result.filed).toHaveLength(1);
      expect(result.skipped).toBe(1);
      expect(result.missionsScanned).toBe(1);

      expect(filedExplores).toHaveLength(1);
      expect(filedExplores[0]!.oracle).toBe('myFunction should never crash');
      expect(filedExplores[0]!.target).toBe('myFunction');
      expect(filedExplores[0]!.description).toContain('criterion:crit_1');
    });

    it('a second pass over the same mission files zero', async () => {
      let callCount = 0;

      const deps: RepairVerifyFilerDeps = {
        listTodos: () => [
          {
            id: 'explore_1',
            exploreSpec: { scope: '', target: '', oracle: '' },
            description: 'criterion:crit_1 — myFunction should never crash',
          } as Todo,
        ],
        listMissions: () => [
          {
            node: { id: 'mission1', title: 'Repair: fix crash' },
            mission: { status: 'converged' },
            ownerSession: '__auto_repair_forge__',
          } as any,
        ],
        listCriteria: () => [
          { id: 'crit_1', text: 'myFunction should never crash', met: true, status: 'active' },
        ],
        fileExplore: async () => {
          callCount++;
          return { leaf: { id: 'leaf_1' } as Todo };
        },
      };

      const result = await runRepairVerifyFilerPass('project', deps);

      // Should skip because crit_1's tag already exists in the explore
      expect(result.filed).toHaveLength(0);
      expect(result.skipped).toBe(1);
      expect(callCount).toBe(0);
    });

    it('a converged mission that is not auto-forged files zero', async () => {
      let callCount = 0;

      const deps: RepairVerifyFilerDeps = {
        listTodos: () => [],
        listMissions: () => [
          {
            node: { id: 'mission1', title: 'Manual mission' },
            mission: { status: 'converged' },
            ownerSession: 'human_session', // NOT auto-forged
          } as any,
        ],
        listCriteria: () => [
          { id: 'crit_1', text: 'myFunction should work', met: true, status: 'active' },
        ],
        fileExplore: async () => {
          callCount++;
          return { leaf: { id: 'leaf_1' } as Todo };
        },
      };

      const result = await runRepairVerifyFilerPass('project', deps);

      // Should not file because mission is not auto-forged
      expect(result.filed).toHaveLength(0);
      expect(result.skipped).toBe(0);
      expect(result.missionsScanned).toBe(0);
      expect(callCount).toBe(0);
    });

    it('deriveVerifyExplore returns null for a criterion with no named anchor', () => {
      const spec = deriveVerifyExplore(
        { id: 'crit_1', text: 'the system should work correctly' },
        'Test mission',
      );
      expect(spec).toBeNull();
    });

    it('handles filing errors gracefully', async () => {
      let callCount = 0;

      const deps: RepairVerifyFilerDeps = {
        listTodos: () => [],
        listMissions: () => [
          {
            node: { id: 'mission1', title: 'Repair: fix' },
            mission: { status: 'converged' },
            ownerSession: '__auto_repair_forge__',
          } as any,
        ],
        listCriteria: () => [
          { id: 'crit_1', text: 'myFunc should work', met: true, status: 'active' },
          { id: 'crit_2', text: 'myOtherFunc should succeed', met: true, status: 'active' },
        ],
        fileExplore: async (project, session, opts) => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Filing failed unexpectedly');
          }
          return { leaf: { id: `leaf_${callCount}` } as Todo };
        },
      };

      const result = await runRepairVerifyFilerPass('project', deps);

      // Should file one and skip one (error on first, succeeds on second)
      expect(result.filed).toHaveLength(1);
      expect(result.skipped).toBe(1);
      expect(callCount).toBe(2);
    });

    it('skips criteria that are dropped', async () => {
      let callCount = 0;

      const deps: RepairVerifyFilerDeps = {
        listTodos: () => [],
        listMissions: () => [
          {
            node: { id: 'mission1', title: 'Repair: fix' },
            mission: { status: 'converged' },
            ownerSession: '__auto_repair_forge__',
          } as any,
        ],
        listCriteria: () => [
          { id: 'crit_1', text: 'myFunc should work', met: true, status: 'dropped' },
        ],
        fileExplore: async () => {
          callCount++;
          return { leaf: { id: 'leaf_1' } as Todo };
        },
      };

      const result = await runRepairVerifyFilerPass('project', deps);

      // Should not process because criterion is dropped (filtered out before loop)
      expect(result.filed).toHaveLength(0);
      expect(result.skipped).toBe(0);
      expect(callCount).toBe(0);
    });

    it('skips criteria that are not met', async () => {
      let callCount = 0;

      const deps: RepairVerifyFilerDeps = {
        listTodos: () => [],
        listMissions: () => [
          {
            node: { id: 'mission1', title: 'Repair: fix' },
            mission: { status: 'converged' },
            ownerSession: '__auto_repair_forge__',
          } as any,
        ],
        listCriteria: () => [
          { id: 'crit_1', text: 'myFunc should work', met: false, status: 'active' },
        ],
        fileExplore: async () => {
          callCount++;
          return { leaf: { id: 'leaf_1' } as Todo };
        },
      };

      const result = await runRepairVerifyFilerPass('project', deps);

      // Should not process because criterion is not met (filtered out before loop)
      expect(result.filed).toHaveLength(0);
      expect(result.skipped).toBe(0);
      expect(callCount).toBe(0);
    });
  });
});
