/**
 * Collab State SessionType Tests (TDD)
 *
 * These tests specify that updateSessionState should handle the sessionType field,
 * persisting it to disk and broadcasting it via WebSocket.
 *
 * Tests guide implementation of sessionType support.
 */

import { test, expect, describe, beforeEach, vi, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { WebSocketHandler } from '../../websocket/handler';
import { updateSessionState, getSessionState, type StateUpdateParams, type CollabState } from '../collab-state';

describe('updateSessionState - SessionType Field', () => {
  let testProject: string;
  let testSession: string;
  let mockWsHandler: WebSocketHandler;

  beforeEach(async () => {
    testProject = join(tmpdir(), `test-project-${Date.now()}`);
    testSession = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Create test session directory
    const sessionDir = join(testProject, '.collab', 'sessions', testSession);
    await mkdir(sessionDir, { recursive: true });

    // Mock WebSocketHandler
    mockWsHandler = {
      broadcast: vi.fn(),
    } as any;
  });

  describe('Persistence - sessionType field', () => {
    test('should persist sessionType to file when provided as "vibe"', async () => {
      const updates: StateUpdateParams = {
        sessionType: 'vibe',
        phase: 'initialize',
      };

      await updateSessionState(testProject, testSession, updates);

      // Read state file directly
      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const content = await readFile(stateFile, 'utf-8');
      const state = JSON.parse(content) as CollabState;

      expect(state.sessionType).toBe('vibe');
    });

    test('should persist sessionType to file when provided as "structured"', async () => {
      const updates: StateUpdateParams = {
        sessionType: 'structured',
        phase: 'initialize',
      };

      await updateSessionState(testProject, testSession, updates);

      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const content = await readFile(stateFile, 'utf-8');
      const state = JSON.parse(content) as CollabState;

      expect(state.sessionType).toBe('structured');
    });

    test('should preserve sessionType when updating other fields', async () => {
      // First update: set sessionType
      let updates: StateUpdateParams = {
        sessionType: 'vibe',
        phase: 'initialize',
      };
      await updateSessionState(testProject, testSession, updates);

      // Second update: update phase without providing sessionType
      updates = {
        phase: 'brainstorming',
        currentItem: 1,
      };
      await updateSessionState(testProject, testSession, updates);

      // Verify sessionType is still vibe
      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const content = await readFile(stateFile, 'utf-8');
      const state = JSON.parse(content) as CollabState;

      expect(state.sessionType).toBe('vibe');
      expect(state.phase).toBe('brainstorming');
    });

    test('should allow changing sessionType in subsequent updates', async () => {
      // First update: set to vibe
      let updates: StateUpdateParams = {
        sessionType: 'vibe',
      };
      await updateSessionState(testProject, testSession, updates);

      let stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      let content = await readFile(stateFile, 'utf-8');
      let state = JSON.parse(content) as CollabState;
      expect(state.sessionType).toBe('vibe');

      // Second update: change to structured
      updates = {
        sessionType: 'structured',
      };
      await updateSessionState(testProject, testSession, updates);

      content = await readFile(stateFile, 'utf-8');
      state = JSON.parse(content) as CollabState;
      expect(state.sessionType).toBe('structured');
    });
  });

  describe('Backwards Compatibility - Missing sessionType', () => {
    test('should handle old sessions without sessionType (defaults to undefined)', async () => {
      // Manually create state file without sessionType (old session)
      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const oldState: CollabState = {
        phase: 'brainstorming',
        lastActivity: new Date().toISOString(),
        currentItem: 1,
      };
      await writeFile(stateFile, JSON.stringify(oldState, null, 2));

      // Update without providing sessionType
      const updates: StateUpdateParams = {
        phase: 'rough-draft',
      };
      await updateSessionState(testProject, testSession, updates);

      // Verify sessionType is undefined (not set)
      const content = await readFile(stateFile, 'utf-8');
      const state = JSON.parse(content) as CollabState;

      expect(state.sessionType).toBeUndefined();
      expect(state.phase).toBe('rough-draft');
    });

    test('should add sessionType when updating old session without it', async () => {
      // Manually create old state file
      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const oldState: CollabState = {
        phase: 'brainstorming',
        lastActivity: new Date().toISOString(),
        currentItem: 1,
      };
      await writeFile(stateFile, JSON.stringify(oldState, null, 2));

      // Update with sessionType
      const updates: StateUpdateParams = {
        sessionType: 'vibe',
      };
      await updateSessionState(testProject, testSession, updates);

      // Verify sessionType is now set
      const content = await readFile(stateFile, 'utf-8');
      const state = JSON.parse(content) as CollabState;

      expect(state.sessionType).toBe('vibe');
    });
  });

  describe('WebSocket Broadcast - sessionType', () => {
    test('should include sessionType in broadcast when set to "vibe"', async () => {
      const updates: StateUpdateParams = {
        sessionType: 'vibe',
        phase: 'initialize',
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.sessionType).toBe('vibe');
    });

    test('should include sessionType in broadcast when set to "structured"', async () => {
      const updates: StateUpdateParams = {
        sessionType: 'structured',
        phase: 'initialize',
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.sessionType).toBe('structured');
    });

    test('should not include sessionType in broadcast when undefined', async () => {
      const updates: StateUpdateParams = {
        phase: 'initialize',
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.sessionType).toBeUndefined();
    });

    test('should preserve sessionType in broadcast across multiple updates', async () => {
      // First update: set sessionType
      let updates: StateUpdateParams = {
        sessionType: 'vibe',
      };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      // Verify first broadcast includes sessionType
      let broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.sessionType).toBe('vibe');

      // Second update: change other field without touching sessionType
      vi.clearAllMocks();
      updates = {
        phase: 'brainstorming',
        currentItem: 1,
      };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      // Verify sessionType is still broadcast
      broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.sessionType).toBe('vibe');
    });

    test('should broadcast updated sessionType value', async () => {
      // First update: set to vibe
      let updates: StateUpdateParams = {
        sessionType: 'vibe',
      };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      // Second update: change to structured
      vi.clearAllMocks();
      updates = {
        sessionType: 'structured',
      };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.sessionType).toBe('structured');
    });
  });

  describe('getSessionState - sessionType field', () => {
    test('should read sessionType from file', async () => {
      // First set the state
      const updates: StateUpdateParams = {
        sessionType: 'vibe',
        phase: 'initialize',
      };
      await updateSessionState(testProject, testSession, updates);

      // Then read it back
      const state = await getSessionState(testProject, testSession);

      expect(state.sessionType).toBe('vibe');
    });

    test('should handle missing sessionType gracefully', async () => {
      // Manually create old state file without sessionType
      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const oldState: CollabState = {
        phase: 'brainstorming',
        lastActivity: new Date().toISOString(),
        currentItem: 1,
      };
      await writeFile(stateFile, JSON.stringify(oldState, null, 2));

      // Read it back
      const state = await getSessionState(testProject, testSession);

      expect(state.sessionType).toBeUndefined();
      expect(state.phase).toBe('brainstorming');
    });
  });

  describe('Integration - Full lifecycle', () => {
    test('should handle complete vibe session workflow', async () => {
      // 1. Create session with vibe type
      let updates: StateUpdateParams = {
        sessionType: 'vibe',
        state: 'initialize',
      };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      // Verify persisted and broadcast
      let state = await getSessionState(testProject, testSession);
      expect(state.sessionType).toBe('vibe');
      expect((mockWsHandler.broadcast as any).mock.calls[0][0].sessionType).toBe('vibe');

      // 2. Update to vibe-active state
      vi.clearAllMocks();
      updates = {
        state: 'vibe-active',
      };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      // Verify sessionType preserved
      state = await getSessionState(testProject, testSession);
      expect(state.sessionType).toBe('vibe');
      expect(state.state).toBe('vibe-active');
      expect((mockWsHandler.broadcast as any).mock.calls[0][0].sessionType).toBe('vibe');

      // 3. Update to cleanup
      vi.clearAllMocks();
      updates = {
        state: 'cleanup',
      };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      // Verify sessionType still preserved
      state = await getSessionState(testProject, testSession);
      expect(state.sessionType).toBe('vibe');
      expect(state.state).toBe('cleanup');
      expect((mockWsHandler.broadcast as any).mock.calls[0][0].sessionType).toBe('vibe');
    });

    test('should handle complete structured session workflow', async () => {
      // 1. Create session with structured type
      let updates: StateUpdateParams = {
        sessionType: 'structured',
        state: 'collab-start',
      };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      // Verify
      let state = await getSessionState(testProject, testSession);
      expect(state.sessionType).toBe('structured');

      // 2. Progress through states
      vi.clearAllMocks();
      updates = {
        state: 'gather-goals',
      };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      state = await getSessionState(testProject, testSession);
      expect(state.sessionType).toBe('structured');
    });
  });
});
