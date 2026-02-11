/**
 * Display Name Tests for Collab State
 *
 * Tests that displayName field is computed correctly from state
 * and returned in getSessionState response.
 */

import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getSessionState } from '../collab-state';

describe('getSessionState - Display Name Computation', () => {
  let testProject: string;
  let testSession: string;

  beforeEach(async () => {
    testProject = join(tmpdir(), `test-project-${Date.now()}`);
    testSession = 'test-session';

    // Create test session directory
    const sessionDir = join(testProject, '.collab', 'sessions', testSession);
    await mkdir(sessionDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await rm(testProject, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('displayName Computation', () => {
    test('should include displayName in response when state is set', async () => {
      const stateData = {
        state: 'brainstorm-exploring',
        phase: 'brainstorming',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.displayName).toBeDefined();
      expect(typeof result.displayName).toBe('string');
    });

    test('should compute correct displayName for brainstorm-exploring state', async () => {
      const stateData = {
        state: 'brainstorm-exploring',
        phase: 'brainstorming',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.displayName).toBe('Exploring');
    });

    test('should compute correct displayName for brainstorm-clarifying state', async () => {
      const stateData = {
        state: 'brainstorm-clarifying',
        phase: 'brainstorming',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.displayName).toBe('Clarifying');
    });

    test('should compute correct displayName for brainstorm-designing state', async () => {
      const stateData = {
        state: 'brainstorm-designing',
        phase: 'brainstorming',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.displayName).toBe('Designing');
    });

    test('should compute correct displayName for rough-draft-interface state', async () => {
      const stateData = {
        state: 'rough-draft-interface',
        phase: 'rough-draft',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.displayName).toBe('Defining Interfaces');
    });

    test('should compute correct displayName for ready-to-implement state', async () => {
      const stateData = {
        state: 'ready-to-implement',
        phase: 'ready',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.displayName).toBe('Ready');
    });

    test('should compute correct displayName for execute-batch state', async () => {
      const stateData = {
        state: 'execute-batch',
        phase: 'executing',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.displayName).toBe('Executing');
    });

    test('should not set displayName when state is undefined', async () => {
      const stateData = {
        phase: 'brainstorming',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      // displayName should not be set if state is not in the data
      expect(result.displayName).toBeUndefined();
    });

    test('should preserve other state fields when adding displayName', async () => {
      const stateData = {
        state: 'brainstorm-exploring',
        phase: 'brainstorming',
        lastActivity: '2025-01-28T10:00:00Z',
        currentItem: 1,
        totalItems: 5,
        documentedItems: 2,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.displayName).toBe('Exploring');
      expect(result.phase).toBe('brainstorming');
      expect(result.currentItem).toBe(1);
      expect(result.totalItems).toBe(5);
      expect(result.documentedItems).toBe(2);
    });
  });

  describe('Phase Derivation', () => {
    test('should derive phase from state when phase is not set', async () => {
      const stateData = {
        state: 'brainstorm-exploring',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.phase).toBe('brainstorming');
    });

    test('should not override existing phase', async () => {
      const stateData = {
        state: 'brainstorm-exploring',
        phase: 'custom-phase',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.phase).toBe('custom-phase');
    });

    test('should derive phase as "rough-draft" for rough-draft states', async () => {
      const stateData = {
        state: 'rough-draft-interface',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const statePath = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      await writeFile(statePath, JSON.stringify(stateData));

      const result = await getSessionState(testProject, testSession);

      expect(result.phase).toBe('rough-draft');
    });

  });
});
