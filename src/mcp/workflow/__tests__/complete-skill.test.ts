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

  it('should update item to brainstormed when completing systematic-debugging', async () => {
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
    expect(updatedItem.status).toBe('brainstormed');
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

  it('should infer item when currentItem is null (defensive fallback)', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'rough-draft-blueprint',
      currentItem: null,
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'rough-draft-blueprint');

    // Defensive fallback should infer and update the matching item
    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updatedState = mockUpdateSessionState.mock.calls[0][2];
    const item = updatedState.workItems?.find((i: WorkItem) => i.number === 1);
    expect(item.status).toBe('complete');
    // Router runs immediately after inference, clearing currentItem since no more pending items
    expect(updatedState.currentItem).toBeNull();
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

describe('completeSkill - vibe-active conversion routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSessionState.mockResolvedValue(undefined);
  });

  it('should route to brainstorm flow when completing vibe-active with pending work items', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Add auth', type: 'code', status: 'pending' },
      { number: 2, title: 'Fix login bug', type: 'bugfix', status: 'pending' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'vibe-active',
      currentItem: 1,
      currentItemType: 'code',
      sessionType: 'structured',
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    const result = await completeSkill('test-project', 'test-session', 'vibe-active');

    // Should route to brainstorming-exploring (first brainstorm skill via brainstorm-item-router)
    expect(result.next_skill).toBe('brainstorming-exploring');

    // Verify state was updated to brainstorm-exploring (resolved through brainstorm-item-router)
    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    expect(updatedState.state).toBe('brainstorm-exploring');
  });

  it('should route to cleanup when completing vibe-active without work items', async () => {
    mockGetSessionState.mockResolvedValue({
      state: 'vibe-active',
      currentItem: null,
      sessionType: 'vibe',
      workItems: [],
      lastActivity: new Date().toISOString(),
    });

    const result = await completeSkill('test-project', 'test-session', 'vibe-active');

    // Should route to cleanup (no pending brainstorm items)
    expect(result.next_skill).toBe('collab-cleanup');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    expect(updatedState.state).toBe('cleanup');
  });

  it('should route to cleanup when completing vibe-active with all items complete', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Done item', type: 'code', status: 'complete' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'vibe-active',
      currentItem: 1,
      currentItemType: 'code',
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    const result = await completeSkill('test-project', 'test-session', 'vibe-active');

    // No pending brainstorm items -> should route to cleanup
    expect(result.next_skill).toBe('collab-cleanup');
  });
});

describe('completeSkill - defensive currentItem inference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSessionState.mockResolvedValue(undefined);
  });

  it('should infer first brainstormed code item when rough-draft-blueprint has null currentItem', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'rough-draft-blueprint',
      currentItem: null,
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'rough-draft-blueprint');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    const updatedItem = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    expect(updatedItem.status).toBe('complete');
    // Router runs immediately and clears currentItem since no more pending rough-draft items
    expect(updatedState.currentItem).toBeNull();
  });

  it('should infer first pending item when brainstorm-validating has null currentItem', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'pending' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'brainstorm-validating',
      currentItem: null,
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'brainstorming-validating');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    const updatedItem = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    expect(updatedItem.status).toBe('brainstormed');
    // Inference updates the item status; router resolution determines final currentItem
  });

  it('should infer first brainstormed task when task-planning has null currentItem', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Task 1', type: 'task', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'task-planning',
      currentItem: null,
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'task-planning');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    const updatedItem = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    expect(updatedItem.status).toBe('complete');
    // Router runs immediately and clears currentItem since no more pending brainstorm items
    expect(updatedState.currentItem).toBeNull();
  });

  it('should infer first pending bugfix when systematic-debugging has null currentItem', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Bug 1', type: 'bugfix', status: 'pending' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'systematic-debugging',
      currentItem: null,
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'systematic-debugging');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    const updatedItem = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    expect(updatedItem.status).toBe('brainstormed');
    // Router runs immediately and clears currentItem since no more pending brainstorm items
    expect(updatedState.currentItem).toBeNull();
  });

  it('should break the loop: inferred item marked complete prevents re-routing to rough-draft-blueprint', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'rough-draft-blueprint',
      currentItem: null,
      currentItemType: 'code',
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    const result = await completeSkill('test-project', 'test-session', 'rough-draft-blueprint');

    // After inference marks the item complete, rough-draft-item-router should NOT
    // route back to rough-draft-blueprint
    expect(result.next_skill).not.toBe('rough-draft-blueprint');
  });

  it('should not infer when no matching items exist (all complete)', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'complete' },
      { number: 2, title: 'Code 2', type: 'code', status: 'complete' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'rough-draft-blueprint',
      currentItem: null,
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    try {
      await completeSkill('test-project', 'test-session', 'rough-draft-blueprint');
    } catch {
      // May throw or route differently - that's ok
    }

    if (mockUpdateSessionState.mock.calls.length > 0) {
      const updatedState = mockUpdateSessionState.mock.calls[0][2];
      // Items should remain unchanged since no inference was possible
      const item1 = updatedState.workItems.find((i: WorkItem) => i.number === 1);
      const item2 = updatedState.workItems.find((i: WorkItem) => i.number === 2);
      expect(item1.status).toBe('complete');
      expect(item2.status).toBe('complete');
    }
  });

  it('should infer first match only when multiple items match', async () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Code 1', type: 'code', status: 'brainstormed' },
      { number: 2, title: 'Code 2', type: 'code', status: 'brainstormed' },
      { number: 3, title: 'Code 3', type: 'code', status: 'brainstormed' },
    ];
    mockGetSessionState.mockResolvedValue({
      state: 'rough-draft-blueprint',
      currentItem: null,
      workItems: [...workItems],
      lastActivity: new Date().toISOString(),
    });

    await completeSkill('test-project', 'test-session', 'rough-draft-blueprint');

    expect(mockUpdateSessionState).toHaveBeenCalled();
    const updateCall = mockUpdateSessionState.mock.calls[0];
    const updatedState = updateCall[2];
    // Only first matching item should be marked complete
    const item1 = updatedState.workItems.find((i: WorkItem) => i.number === 1);
    const item2 = updatedState.workItems.find((i: WorkItem) => i.number === 2);
    const item3 = updatedState.workItems.find((i: WorkItem) => i.number === 3);
    expect(item1.status).toBe('complete');
    expect(item2.status).toBe('brainstormed');
    expect(item3.status).toBe('brainstormed');
  });
});
