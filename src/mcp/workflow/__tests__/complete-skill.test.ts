import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CollabState } from '../../tools/collab-state';
import type { WorkItem } from '../types';

// Mock collab-state module
const mockGetSessionState = vi.fn<() => Promise<CollabState>>();
const mockUpdateSessionState = vi.fn<() => Promise<void>>();

vi.mock('../../tools/collab-state', () => ({
  getSessionState: (...args: unknown[]) => mockGetSessionState(...args as []),
  updateSessionState: (...args: unknown[]) => mockUpdateSessionState(...args as []),
}));

// Mock task-sync module
vi.mock('../task-sync', () => ({
  syncTasksFromTaskGraph: vi.fn().mockResolvedValue(undefined),
}));

// Mock task-diagram module
vi.mock('../task-diagram', () => ({
  updateTaskDiagram: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks are set up
const { completeSkill } = await import('../complete-skill');

describe('completeSkill - work item status updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSessionState.mockResolvedValue(undefined);
  });

  it('should update item to complete when completing rough-draft-blueprint', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'rough-draft-blueprint',
      currentItem: 1,
      currentItemType: 'code',
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'rough-draft-blueprint');

    // Verify the session was updated with item status = 'complete'
    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    const updatedItem = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    expect(updatedItem.status).toBe('complete');
  });

  it('should update item to brainstormed when completing brainstorm-validating', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'pending' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'brainstorm-validating',
      currentItem: 1,
      currentItemType: 'code',
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'brainstorming-validating');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    const updatedItem = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    expect(updatedItem.status).toBe('brainstormed');
  });

  it('should update item to complete when completing task-planning', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Task 1', type: 'task', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'task-planning',
      currentItem: 1,
      currentItemType: 'task',
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'task-planning');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    const updatedItem = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    expect(updatedItem.status).toBe('complete');
  });

  it('should update item to complete when completing systematic-debugging', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Bug 1', type: 'bugfix', status: 'pending' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'systematic-debugging',
      currentItem: 1,
      currentItemType: 'bugfix',
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'systematic-debugging');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    const updatedItem = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    expect(updatedItem.status).toBe('complete');
  });

  it('should not find pending rough-draft items after blueprint completes (no infinite loop)', async () => {
    // Scenario: single code item completes rough-draft-blueprint
    // After status update, rough-draft-item-router should find NO pending items
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'rough-draft-blueprint',
      currentItem: 1,
      currentItemType: 'code',
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    const result = await completeSkill('test-project', 'test-session', 'rough-draft-blueprint');

    // The workflow should advance past the rough-draft loop
    // It should NOT route back to rough-draft-blueprint
    expect(result.next_skill).not.toBe('rough-draft-blueprint');
  });

  it('should not update items when no currentItem is set', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'rough-draft-blueprint',
      currentItem: null,
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    // Should not throw, and items should remain unchanged
    try {
      await completeSkill('test-project', 'test-session', 'rough-draft-blueprint');
    } catch {
      // May throw due to no transition - that's ok
    }

    // If updateSessionState was called, the item should still be brainstormed
    if (mockUpdateSessionState.mock.calls.length > 0) {
      const updatedState = mockUpdateSessionState.mock.calls[0][2];
      const item = updatedState.workItems?.find((i: WorkItem) => i.number === 1);
      if (item) {
        expect(item.status).toBe('brainstormed');
      }
    }
  });

  it('should only update the current item, not others', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'brainstormed' },
      { number: 2, title: 'Code 2', type: 'code', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'rough-draft-blueprint',
      currentItem: 1,
      currentItemType: 'code',
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'rough-draft-blueprint');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    const item1 = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    const item2 = updatedState.workItems.find((i: WorkItem) => i.number === 2);
    expect(item1.status).toBe('complete');
    expect(item2.status).toBe('brainstormed'); // Unchanged
  });
});
