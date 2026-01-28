import {
  getCurrentWorkItem,
  itemReadyForInterface,
  itemReadyForPseudocode,
  itemReadyForSkeleton,
  readyForHandoff,
  SessionState,
  findNextPendingItemInSession,
  getNextStateForPhaseBatching,
} from '../transitions';
import { WorkItem } from '../types';

describe('Transition condition functions', () => {
  describe('getCurrentWorkItem', () => {
    it('should return null when currentItem is null', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'pending',
          },
        ],
      };
      expect(getCurrentWorkItem(state)).toBeNull();
    });

    it('should return null when currentItem is undefined', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: undefined,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'pending',
          },
        ],
      };
      expect(getCurrentWorkItem(state)).toBeNull();
    });

    it('should return the current work item when found', () => {
      const item: WorkItem = {
        number: 2,
        title: 'Item 2',
        type: 'code',
        status: 'brainstormed',
      };
      const state: SessionState = {
        state: 'test',
        currentItem: 2,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'pending',
          },
          item,
        ],
      };
      expect(getCurrentWorkItem(state)).toEqual(item);
    });

    it('should return null when current item number does not exist in workItems', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 99,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'pending',
          },
        ],
      };
      expect(getCurrentWorkItem(state)).toBeNull();
    });
  });

  describe('itemReadyForInterface', () => {
    it('should return true when current item status is brainstormed', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'brainstormed',
          },
        ],
      };
      expect(itemReadyForInterface(state)).toBe(true);
    });

    it('should return false when current item status is not brainstormed', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'pending',
          },
        ],
      };
      expect(itemReadyForInterface(state)).toBe(false);
    });

    it('should return false when current item is null', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'brainstormed',
          },
        ],
      };
      expect(itemReadyForInterface(state)).toBe(false);
    });

    it('should return false for other statuses', () => {
      const statuses = ['pending', 'interface', 'pseudocode', 'skeleton', 'complete'] as const;
      statuses.forEach((status) => {
        const state: SessionState = {
          state: 'test',
          currentItem: 1,
          workItems: [
            {
              number: 1,
              title: 'Item 1',
              type: 'code',
              status,
            },
          ],
        };
        expect(itemReadyForInterface(state)).toBe(false);
      });
    });
  });

  describe('itemReadyForPseudocode', () => {
    it('should return true when current item status is interface', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'interface',
          },
        ],
      };
      expect(itemReadyForPseudocode(state)).toBe(true);
    });

    it('should return false when current item status is not interface', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'brainstormed',
          },
        ],
      };
      expect(itemReadyForPseudocode(state)).toBe(false);
    });

    it('should return false when current item is null', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'interface',
          },
        ],
      };
      expect(itemReadyForPseudocode(state)).toBe(false);
    });

    it('should return false for other statuses', () => {
      const statuses = ['pending', 'brainstormed', 'pseudocode', 'skeleton', 'complete'] as const;
      statuses.forEach((status) => {
        const state: SessionState = {
          state: 'test',
          currentItem: 1,
          workItems: [
            {
              number: 1,
              title: 'Item 1',
              type: 'code',
              status,
            },
          ],
        };
        expect(itemReadyForPseudocode(state)).toBe(false);
      });
    });
  });

  describe('itemReadyForSkeleton', () => {
    it('should return true when current item status is pseudocode', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'pseudocode',
          },
        ],
      };
      expect(itemReadyForSkeleton(state)).toBe(true);
    });

    it('should return false when current item status is not pseudocode', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'interface',
          },
        ],
      };
      expect(itemReadyForSkeleton(state)).toBe(false);
    });

    it('should return false when current item is null', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'pseudocode',
          },
        ],
      };
      expect(itemReadyForSkeleton(state)).toBe(false);
    });

    it('should return false for other statuses', () => {
      const statuses = ['pending', 'brainstormed', 'interface', 'skeleton', 'complete'] as const;
      statuses.forEach((status) => {
        const state: SessionState = {
          state: 'test',
          currentItem: 1,
          workItems: [
            {
              number: 1,
              title: 'Item 1',
              type: 'code',
              status,
            },
          ],
        };
        expect(itemReadyForSkeleton(state)).toBe(false);
      });
    });
  });

  describe('readyForHandoff', () => {
    it('should return true when all items are complete', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'complete',
          },
          {
            number: 2,
            title: 'Item 2',
            type: 'code',
            status: 'complete',
          },
        ],
      };
      expect(readyForHandoff(state)).toBe(true);
    });

    it('should return true with single complete item', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'complete',
          },
        ],
      };
      expect(readyForHandoff(state)).toBe(true);
    });

    it('should return false when not all items are complete', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'brainstormed',
          },
          {
            number: 2,
            title: 'Item 2',
            type: 'code',
            status: 'complete',
          },
        ],
      };
      expect(readyForHandoff(state)).toBe(false);
    });

    it('should return false when one item is incomplete', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          {
            number: 1,
            title: 'Item 1',
            type: 'code',
            status: 'complete',
          },
          {
            number: 2,
            title: 'Item 2',
            type: 'code',
            status: 'pending',
          },
        ],
      };
      expect(readyForHandoff(state)).toBe(false);
    });

    it('should return false when items are in intermediate statuses', () => {
      const statuses = ['pending', 'brainstormed', 'interface', 'pseudocode', 'skeleton'] as const;
      statuses.forEach((status) => {
        const state: SessionState = {
          state: 'test',
          currentItem: null,
          workItems: [
            {
              number: 1,
              title: 'Item 1',
              type: 'code',
              status,
            },
          ],
        };
        expect(readyForHandoff(state)).toBe(false);
      });
    });

    it('should return true with empty workItems array', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [],
      };
      expect(readyForHandoff(state)).toBe(true);
    });
  });

  describe('findNextPendingItemInSession', () => {
    it('should return null for empty array', () => {
      expect(findNextPendingItemInSession([])).toBeNull();
    });

    it('should return null when all items are complete', () => {
      const items: WorkItem[] = [
        { number: 1, title: 'Item 1', type: 'code', status: 'complete' },
        { number: 2, title: 'Item 2', type: 'code', status: 'complete' },
      ];
      expect(findNextPendingItemInSession(items)).toBeNull();
    });

    it('should return first non-complete item', () => {
      const items: WorkItem[] = [
        { number: 1, title: 'Item 1', type: 'code', status: 'complete' },
        { number: 2, title: 'Item 2', type: 'code', status: 'brainstormed' },
        { number: 3, title: 'Item 3', type: 'code', status: 'pending' },
      ];
      const result = findNextPendingItemInSession(items);
      expect(result?.number).toBe(2);
    });

    it('should return first item if all are non-complete', () => {
      const items: WorkItem[] = [
        { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
        { number: 2, title: 'Item 2', type: 'code', status: 'brainstormed' },
      ];
      const result = findNextPendingItemInSession(items);
      expect(result?.number).toBe(1);
    });

    it('should find items in any status except complete', () => {
      const statuses: WorkItem['status'][] = ['pending', 'brainstormed', 'interface', 'pseudocode', 'skeleton'];
      statuses.forEach((status) => {
        const items: WorkItem[] = [
          { number: 1, title: 'Item 1', type: 'code', status: 'complete' },
          { number: 2, title: 'Item 2', type: 'code', status },
        ];
        expect(findNextPendingItemInSession(items)?.status).toBe(status);
      });
    });
  });

  describe('getNextStateForPhaseBatching', () => {
    // Phase batching: all items brainstorm first, then code items go through rough-draft
    // Routing is handled by the state machine, this function only handles status updates

    it('should mark item brainstormed and go to item-type-router after brainstorm-validating', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
        ],
      };
      const result = getNextStateForPhaseBatching('brainstorm-validating', state);
      expect(result).toBe('item-type-router');
      expect(state.workItems[0].status).toBe('brainstormed');
    });

    it('should mark task complete and go to clear-post-brainstorm after task-planning', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Task 1', type: 'task', status: 'brainstormed' },
        ],
      };
      const result = getNextStateForPhaseBatching('task-planning', state);
      expect(result).toBe('clear-post-brainstorm');
      expect(state.workItems[0].status).toBe('complete');
    });

    it('should mark bugfix complete and go to clear-post-brainstorm after systematic-debugging', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Bug 1', type: 'bugfix', status: 'pending' },
        ],
      };
      const result = getNextStateForPhaseBatching('systematic-debugging', state);
      expect(result).toBe('clear-post-brainstorm');
      expect(state.workItems[0].status).toBe('complete');
    });

    it('should mark item interface and go to clear-rd1 after rough-draft-interface', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'brainstormed' },
        ],
      };
      const result = getNextStateForPhaseBatching('rough-draft-interface', state);
      expect(result).toBe('clear-rd1');
      expect(state.workItems[0].status).toBe('interface');
    });

    it('should mark item pseudocode and go to clear-rd2 after rough-draft-pseudocode', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'interface' },
        ],
      };
      const result = getNextStateForPhaseBatching('rough-draft-pseudocode', state);
      expect(result).toBe('clear-rd2');
      expect(state.workItems[0].status).toBe('pseudocode');
    });

    it('should mark item skeleton and go to clear-rd3 after rough-draft-skeleton', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'pseudocode' },
        ],
      };
      const result = getNextStateForPhaseBatching('rough-draft-skeleton', state);
      expect(result).toBe('clear-rd3');
      expect(state.workItems[0].status).toBe('skeleton');
    });

    it('should mark item complete and go to clear-post-rough after rough-draft-handoff', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'skeleton' },
        ],
      };
      const result = getNextStateForPhaseBatching('rough-draft-handoff', state);
      expect(result).toBe('clear-post-rough');
      expect(state.workItems[0].status).toBe('complete');
    });

    it('should return null for unknown states (routing handled by state machine)', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
        ],
      };
      const result = getNextStateForPhaseBatching('unknown-state', state);
      expect(result).toBeNull();
    });

    it('should return null for router states (routing handled by state machine)', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
        ],
      };
      // Router states don't update item status - they just route
      expect(getNextStateForPhaseBatching('brainstorm-item-router', state)).toBeNull();
      expect(getNextStateForPhaseBatching('rough-draft-item-router', state)).toBeNull();
      expect(getNextStateForPhaseBatching('work-item-router', state)).toBeNull();
    });

    it('should return null when no current item', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
        ],
      };
      // Status updates require a current item
      expect(getNextStateForPhaseBatching('brainstorm-validating', state)).toBeNull();
      expect(getNextStateForPhaseBatching('rough-draft-interface', state)).toBeNull();
    });

    it('should handle full brainstorm phase for mixed items', () => {
      // Phase batching: all items go through brainstorm first
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Code 1', type: 'code', status: 'pending' },
          { number: 2, title: 'Task 1', type: 'task', status: 'pending' },
          { number: 3, title: 'Bug 1', type: 'bugfix', status: 'pending' },
        ],
      };

      // Code item completes brainstorming -> brainstormed status, routes to item-type-router
      let result = getNextStateForPhaseBatching('brainstorm-validating', state);
      expect(result).toBe('item-type-router');
      expect(state.workItems[0].status).toBe('brainstormed');

      // Simulate: router sends code item to clear-post-brainstorm, then back to brainstorm-item-router
      // which picks up task item (currentItem = 2)
      state.currentItem = 2;

      // Task completes brainstorming -> routes to task-planning
      result = getNextStateForPhaseBatching('brainstorm-validating', state);
      expect(result).toBe('item-type-router');
      expect(state.workItems[1].status).toBe('brainstormed');

      // Task-planning completes -> task is complete
      result = getNextStateForPhaseBatching('task-planning', state);
      expect(result).toBe('clear-post-brainstorm');
      expect(state.workItems[1].status).toBe('complete');

      // Bugfix is next (currentItem = 3) - goes directly to systematic-debugging
      state.currentItem = 3;
      result = getNextStateForPhaseBatching('systematic-debugging', state);
      expect(result).toBe('clear-post-brainstorm');
      expect(state.workItems[2].status).toBe('complete');

      // At this point:
      // - Code item: brainstormed (needs rough-draft)
      // - Task item: complete
      // - Bugfix item: complete
    });
  });
});
