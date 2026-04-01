/**
 * Comprehensive tests for Collab State Management
 * Tests state persistence, snippet tracking, and serialization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import * as os from 'os';
import {
  getSessionState,
  updateSessionState,
  recordSnippetCreated,
  recordSnippetUpdated,
  recordSnippetDeleted,
  getSnippetStateSummary,
  archiveSession,
  type CollabState,
} from '../mcp/tools/collab-state';

describe('Collab State Management', () => {
  let tempDir: string;
  let projectPath: string;
  const sessionName = 'test-session';

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = join(os.tmpdir(), `collab-state-test-${Date.now()}`);
    projectPath = join(tempDir, 'test-project');

    // Initialize session structure
    const sessionPath = join(projectPath, '.collab', 'sessions', sessionName);
    await mkdir(join(sessionPath, 'diagrams'), { recursive: true });
    await mkdir(join(sessionPath, 'documents'), { recursive: true });
    await mkdir(join(sessionPath, 'designs'), { recursive: true });
    await mkdir(join(sessionPath, 'spreadsheets'), { recursive: true });
    await mkdir(join(sessionPath, 'snippets'), { recursive: true });

    // Create initial collab-state.json
    const initialState: CollabState = {
      state: 'collab-start',
      lastActivity: new Date().toISOString(),
      useRenderUI: true,
    };
    const statePath = join(sessionPath, 'collab-state.json');
    await writeFile(statePath, JSON.stringify(initialState, null, 2));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  });

  describe('getSessionState()', () => {
    it('should load state from disk correctly', async () => {
      const state = await getSessionState(projectPath, sessionName);

      expect(state.state).toBe('collab-start');
      expect(state.useRenderUI).toBe(true);
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        getSessionState(projectPath, 'non-existent-session')
      ).rejects.toThrow('Session not found');
    });

    it('should compute display name from state', async () => {
      const state = await getSessionState(projectPath, sessionName);
      expect(state.displayName).toBeDefined();
    });

    it('should handle missing snippet state fields', async () => {
      const state = await getSessionState(projectPath, sessionName);

      // These should be undefined if not set
      expect(state.createdSnippets).toBeUndefined();
      expect(state.updatedSnippets).toBeUndefined();
      expect(state.deletedSnippets).toBeUndefined();
    });
  });

  describe('updateSessionState()', () => {
    it('should update session state on disk', async () => {
      await updateSessionState(projectPath, sessionName, {
        state: 'collab-working',
      });

      const state = await getSessionState(projectPath, sessionName);
      expect(state.state).toBe('collab-working');
    });

    it('should preserve existing state when updating', async () => {
      await updateSessionState(projectPath, sessionName, {
        completedTasks: ['task-1'],
      });

      const state = await getSessionState(projectPath, sessionName);
      expect(state.state).toBe('collab-start');
      expect(state.completedTasks).toEqual(['task-1']);
    });

    it('should update state machine state', async () => {
      await updateSessionState(projectPath, sessionName, {
        state: 'collab-working',
      });

      const state = await getSessionState(projectPath, sessionName);
      expect(state.state).toBe('collab-working');
    });

    it('should track multiple updates correctly', async () => {
      await updateSessionState(projectPath, sessionName, {
        completedTasks: ['task-1'],
      });

      await updateSessionState(projectPath, sessionName, {
        pendingTasks: ['task-2'],
      });

      const state = await getSessionState(projectPath, sessionName);
      expect(state.completedTasks).toEqual(['task-1']);
      expect(state.pendingTasks).toEqual(['task-2']);
    });

    it('should update snippet state', async () => {
      await updateSessionState(projectPath, sessionName, {
        createdSnippets: ['snippet-1', 'snippet-2'],
        updatedSnippets: ['snippet-3'],
      });

      const state = await getSessionState(projectPath, sessionName);
      expect(state.createdSnippets).toEqual(['snippet-1', 'snippet-2']);
      expect(state.updatedSnippets).toEqual(['snippet-3']);
    });

    it('should timestamp lastActivity on each update', async () => {
      const state1 = await getSessionState(projectPath, sessionName);
      const time1 = new Date(state1.lastActivity).getTime();

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await updateSessionState(projectPath, sessionName, {
        state: 'collab-working',
      });

      const state2 = await getSessionState(projectPath, sessionName);
      const time2 = new Date(state2.lastActivity).getTime();

      expect(time2).toBeGreaterThanOrEqual(time1);
    });
  });

  describe('recordSnippetCreated()', () => {
    it('should record snippet creation', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.createdSnippets).toContain('snippet-1');
    });

    it('should deduplicate snippet IDs', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.createdSnippets).toEqual(['snippet-1']);
    });

    it('should accumulate multiple created snippets', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetCreated(projectPath, sessionName, 'snippet-2');
      await recordSnippetCreated(projectPath, sessionName, 'snippet-3');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.createdSnippets).toEqual(['snippet-1', 'snippet-2', 'snippet-3']);
    });

    it('should preserve other state fields', async () => {
      await updateSessionState(projectPath, sessionName, {
        state: 'collab-working',
      });

      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.state).toBe('collab-working');
      expect(state.createdSnippets).toContain('snippet-1');
    });
  });

  describe('recordSnippetUpdated()', () => {
    it('should record snippet update', async () => {
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.updatedSnippets).toContain('snippet-1');
    });

    it('should deduplicate updated snippet IDs', async () => {
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-1');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.updatedSnippets).toEqual(['snippet-1']);
    });

    it('should track created and updated separately', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-2');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.createdSnippets).toContain('snippet-1');
      expect(state.updatedSnippets).toContain('snippet-2');
    });

    it('should accumulate multiple updated snippets', async () => {
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-1');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-2');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-3');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.updatedSnippets).toEqual(['snippet-1', 'snippet-2', 'snippet-3']);
    });
  });

  describe('recordSnippetDeleted()', () => {
    it('should record snippet deletion', async () => {
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.deletedSnippets).toContain('snippet-1');
    });

    it('should deduplicate deleted snippet IDs', async () => {
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-1');
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.deletedSnippets).toEqual(['snippet-1']);
    });

    it('should remove snippet from created list when deleted', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.createdSnippets).not.toContain('snippet-1');
      expect(state.deletedSnippets).toContain('snippet-1');
    });

    it('should remove snippet from updated list when deleted', async () => {
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-1');
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.updatedSnippets).not.toContain('snippet-1');
      expect(state.deletedSnippets).toContain('snippet-1');
    });

    it('should handle deletion of snippet in both created and updated', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-1');
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-1');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.createdSnippets).not.toContain('snippet-1');
      expect(state.updatedSnippets).not.toContain('snippet-1');
      expect(state.deletedSnippets).toContain('snippet-1');
    });

    it('should accumulate multiple deleted snippets', async () => {
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-1');
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-2');
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-3');

      const state = await getSessionState(projectPath, sessionName);
      expect(state.deletedSnippets).toEqual(['snippet-1', 'snippet-2', 'snippet-3']);
    });
  });

  describe('getSnippetStateSummary()', () => {
    it('should return empty summary for new session', async () => {
      const summary = await getSnippetStateSummary(projectPath, sessionName);

      expect(summary.created).toBe(0);
      expect(summary.updated).toBe(0);
      expect(summary.deleted).toBe(0);
      expect(summary.snippets).toEqual([]);
    });

    it('should count created snippets', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetCreated(projectPath, sessionName, 'snippet-2');

      const summary = await getSnippetStateSummary(projectPath, sessionName);
      expect(summary.created).toBe(2);
      expect(summary.snippets).toContain('snippet-1');
      expect(summary.snippets).toContain('snippet-2');
    });

    it('should count updated snippets', async () => {
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-1');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-2');

      const summary = await getSnippetStateSummary(projectPath, sessionName);
      expect(summary.updated).toBe(2);
    });

    it('should count deleted snippets', async () => {
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-1');

      const summary = await getSnippetStateSummary(projectPath, sessionName);
      expect(summary.deleted).toBe(1);
    });

    it('should provide combined snippet list (deduplicated)', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-1');
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-2');

      const summary = await getSnippetStateSummary(projectPath, sessionName);
      expect(summary.snippets).toHaveLength(2);
      expect(summary.snippets).toContain('snippet-1');
      expect(summary.snippets).toContain('snippet-2');
    });

    it('should handle complex snippet lifecycle', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetCreated(projectPath, sessionName, 'snippet-2');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-2');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-3');
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-4');

      const summary = await getSnippetStateSummary(projectPath, sessionName);
      expect(summary.created).toBe(2);
      expect(summary.updated).toBe(2);
      expect(summary.deleted).toBe(1);
      expect(summary.snippets).toHaveLength(4);
    });
  });

  describe('archiveSession()', () => {
    it('should archive session with snippets', async () => {
      // Create some snippet files
      const snippetsDir = join(projectPath, '.collab', 'sessions', sessionName, 'snippets');
      await writeFile(join(snippetsDir, 'snippet-1.json'), '{}');
      await writeFile(join(snippetsDir, 'snippet-2.json'), '{}');

      const result = await archiveSession(projectPath, sessionName, { deleteSession: false });

      expect(result.success).toBe(true);
      expect(result.archivedFiles.snippets).toHaveLength(2);
      expect(result.archivedFiles.snippets).toContain('snippet-1.json');
      expect(result.archivedFiles.snippets).toContain('snippet-2.json');
    });

    it('should archive session and delete it', async () => {
      const sessionPath = join(projectPath, '.collab', 'sessions', sessionName);
      const snippetsDir = join(sessionPath, 'snippets');
      await writeFile(join(snippetsDir, 'snippet-1.json'), '{}');

      const result = await archiveSession(projectPath, sessionName, { deleteSession: true });

      expect(result.success).toBe(true);
      // Session directory should be deleted
      const sessionExists = await readFile(join(sessionPath, 'collab-state.json')).catch(() => null);
      expect(sessionExists).toBeNull();
    });

    it('should handle empty snippets directory', async () => {
      const result = await archiveSession(projectPath, sessionName, { deleteSession: false });

      expect(result.success).toBe(true);
      expect(result.archivedFiles.snippets).toEqual([]);
    });

    it('should preserve other artifacts when archiving', async () => {
      // Create artifact files
      const docsDir = join(projectPath, '.collab', 'sessions', sessionName, 'documents');
      const diagramsDir = join(projectPath, '.collab', 'sessions', sessionName, 'diagrams');
      const snippetsDir = join(projectPath, '.collab', 'sessions', sessionName, 'snippets');

      await writeFile(join(docsDir, 'doc-1.md'), '# Doc');
      await writeFile(join(diagramsDir, 'diagram-1.mmd'), 'graph TD');
      await writeFile(join(snippetsDir, 'snippet-1.json'), '{}');

      const result = await archiveSession(projectPath, sessionName, { deleteSession: false });

      expect(result.success).toBe(true);
      expect(result.archivedFiles.documents).toContain('doc-1.md');
      expect(result.archivedFiles.diagrams).toContain('diagram-1.mmd');
      expect(result.archivedFiles.snippets).toContain('snippet-1.json');
    });
  });

  describe('Snippet State Integration', () => {
    it('should maintain snippet state across multiple operations', async () => {
      // Create and update some snippets
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetCreated(projectPath, sessionName, 'snippet-2');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-1');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-3');

      // Check state
      let state = await getSessionState(projectPath, sessionName);
      expect(state.createdSnippets).toEqual(['snippet-1', 'snippet-2']);
      expect(state.updatedSnippets).toEqual(['snippet-1', 'snippet-3']);

      // Delete one
      await recordSnippetDeleted(projectPath, sessionName, 'snippet-1');

      // Verify final state
      state = await getSessionState(projectPath, sessionName);
      expect(state.createdSnippets).toContain('snippet-2');
      expect(state.createdSnippets).not.toContain('snippet-1');
      expect(state.updatedSnippets).toContain('snippet-3');
      expect(state.updatedSnippets).not.toContain('snippet-1');
      expect(state.deletedSnippets).toContain('snippet-1');
    });

    it('should preserve snippet state with other state updates', async () => {
      // Update various state fields
      await updateSessionState(projectPath, sessionName, {
        state: 'collab-working',
      });

      // Record snippet operations
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');

      // Verify all state is preserved
      const state = await getSessionState(projectPath, sessionName);
      expect(state.state).toBe('collab-working');
      expect(state.createdSnippets).toContain('snippet-1');
    });

    it('should handle WebSocket broadcast simulation', async () => {
      const mockBroadcast = vi.fn();
      const mockWSHandler = {
        broadcast: mockBroadcast,
      };

      await recordSnippetCreated(
        projectPath,
        sessionName,
        'snippet-1',
        mockWSHandler as any
      );

      // Verify broadcast was called with snippet data
      expect(mockBroadcast).toHaveBeenCalled();
    });
  });

  describe('State Serialization', () => {
    it('should serialize snippet state to JSON correctly', async () => {
      await recordSnippetCreated(projectPath, sessionName, 'snippet-1');
      await recordSnippetUpdated(projectPath, sessionName, 'snippet-2');

      const state = await getSessionState(projectPath, sessionName);
      const json = JSON.stringify(state);

      // Verify JSON round-trip
      const parsed = JSON.parse(json) as CollabState;
      expect(parsed.createdSnippets).toEqual(['snippet-1']);
      expect(parsed.updatedSnippets).toEqual(['snippet-2']);
    });

    it('should handle null/undefined snippet fields', async () => {
      const state = await getSessionState(projectPath, sessionName);

      // These should be safely undefined
      expect(state.createdSnippets).toBeUndefined();
      expect(state.updatedSnippets).toBeUndefined();
      expect(state.deletedSnippets).toBeUndefined();

      // Should still be serializable
      const json = JSON.stringify(state);
      expect(json).toBeDefined();
    });
  });
});
