/**
 * Tests for fallback task generation in syncTasksFromTaskGraph.
 * When no blueprints or task-graph documents exist, tasks should be
 * generated from work items so execution can proceed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateFallbackTasks, syncTasksFromTaskGraph } from '../task-sync.js';
import type { WorkItem } from '../types.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  access: vi.fn(),
}));

// Mock collab-state
vi.mock('../../tools/collab-state.js', () => ({
  getSessionState: vi.fn(),
  updateSessionState: vi.fn(),
}));

import { readFile, writeFile, readdir, access } from 'fs/promises';
import { getSessionState, updateSessionState } from '../../tools/collab-state.js';

const mockAccess = vi.mocked(access);
const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockGetSessionState = vi.mocked(getSessionState);
const mockUpdateSessionState = vi.mocked(updateSessionState);

describe('generateFallbackTasks', () => {
  it('should generate tasks for code and bugfix items only', () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Add login page', type: 'code', status: 'ready' as any },
      { number: 2, title: 'Set up CI', type: 'task', status: 'ready' as any },
      { number: 3, title: 'Fix auth bug', type: 'bugfix', status: 'ready' as any },
    ];

    const tasks = generateFallbackTasks(workItems);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      id: 'item-1',
      files: [],
      description: 'Add login page',
    });
    expect(tasks[1]).toEqual({
      id: 'item-3',
      files: [],
      description: 'Fix auth bug',
    });
  });

  it('should return empty array when no code/bugfix items exist', () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Set up CI', type: 'task', status: 'ready' as any },
    ];

    const tasks = generateFallbackTasks(workItems);
    expect(tasks).toHaveLength(0);
  });

  it('should return empty array for empty work items', () => {
    const tasks = generateFallbackTasks([]);
    expect(tasks).toHaveLength(0);
  });
});

describe('syncTasksFromTaskGraph fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate fallback tasks when no task-graph or blueprints exist', async () => {
    // No task-graph.md
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    // No blueprint files
    mockReaddir.mockResolvedValue([] as any);
    // Session state has work items
    mockGetSessionState.mockResolvedValue({
      workItems: [
        { number: 1, title: 'Add feature X', type: 'code', status: 'ready' },
        { number: 2, title: 'Fix bug Y', type: 'bugfix', status: 'ready' },
      ],
    } as any);
    mockUpdateSessionState.mockResolvedValue(undefined as any);
    mockWriteFile.mockResolvedValue(undefined);

    const batches = await syncTasksFromTaskGraph('/project', 'test-session');

    // Should produce a single batch with 2 tasks
    expect(batches).toHaveLength(1);
    expect(batches[0].tasks).toHaveLength(2);
    expect(batches[0].tasks[0].id).toBe('item-1');
    expect(batches[0].tasks[1].id).toBe('item-2');

    // Should update session state with batches
    expect(mockUpdateSessionState).toHaveBeenCalledWith('/project', 'test-session', expect.objectContaining({
      batches: expect.any(Array),
      currentBatch: 0,
      pendingTasks: ['item-1', 'item-2'],
    }));

    // Should create consolidated task-graph document
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('should throw when no work items produce executable tasks', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReaddir.mockResolvedValue([] as any);
    mockGetSessionState.mockResolvedValue({
      workItems: [
        { number: 1, title: 'Set up CI', type: 'task', status: 'ready' },
      ],
    } as any);

    await expect(syncTasksFromTaskGraph('/project', 'test-session'))
      .rejects.toThrow('No task-graph, blueprint documents, or executable work items found');
  });

  it('should fall back when blueprints exist but have no valid YAML', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReaddir.mockResolvedValue(['blueprint-item-1.md'] as any);
    // Blueprint has no YAML block
    mockReadFile.mockResolvedValue('# Blueprint\n\nSome design notes without YAML.');
    mockGetSessionState.mockResolvedValue({
      workItems: [
        { number: 1, title: 'Add feature', type: 'code', status: 'ready' },
      ],
    } as any);
    mockUpdateSessionState.mockResolvedValue(undefined as any);
    mockWriteFile.mockResolvedValue(undefined);

    const batches = await syncTasksFromTaskGraph('/project', 'test-session');

    expect(batches).toHaveLength(1);
    expect(batches[0].tasks).toHaveLength(1);
    expect(batches[0].tasks[0].id).toBe('item-1');
  });
});
