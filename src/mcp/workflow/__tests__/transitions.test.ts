import {
  getCurrentWorkItem,
  itemReadyForInterface,
  itemReadyForPseudocode,
  itemReadyForSkeleton,
  readyForHandoff,
  SessionState,
  findNextPendingItemInSession,
  getNextStateForPerItemPipeline,
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

  describe('getNextStateForPerItemPipeline', () => {
    it('should return brainstorm-exploring when no current item and next item exists', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
        ],
      };
      const result = getNextStateForPerItemPipeline('work-item-router', state);
      expect(result).toBe('brainstorm-exploring');
    });

    it('should return ready-to-implement when no pending items', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'complete' },
        ],
      };
      const result = getNextStateForPerItemPipeline('work-item-router', state);
      expect(result).toBe('ready-to-implement');
    });

    it('should mark item brainstormed and go to rough-draft-interface after brainstorm-validating', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
        ],
      };
      const result = getNextStateForPerItemPipeline('brainstorm-validating', state);
      expect(result).toBe('rough-draft-interface');
      expect(state.workItems[0].status).toBe('brainstormed');
    });

    it('should mark item interface and go to rough-draft-pseudocode after rough-draft-interface', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'brainstormed' },
        ],
      };
      const result = getNextStateForPerItemPipeline('rough-draft-interface', state);
      expect(result).toBe('rough-draft-pseudocode');
      expect(state.workItems[0].status).toBe('interface');
    });

    it('should mark item pseudocode and go to rough-draft-skeleton after rough-draft-pseudocode', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'interface' },
        ],
      };
      const result = getNextStateForPerItemPipeline('rough-draft-pseudocode', state);
      expect(result).toBe('rough-draft-skeleton');
      expect(state.workItems[0].status).toBe('pseudocode');
    });

    it('should mark item skeleton and go to build-task-graph after rough-draft-skeleton', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'pseudocode' },
        ],
      };
      const result = getNextStateForPerItemPipeline('rough-draft-skeleton', state);
      expect(result).toBe('build-task-graph');
      expect(state.workItems[0].status).toBe('skeleton');
    });

    it('should mark item complete and go to ready-to-implement after build-task-graph when no more items', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'skeleton' },
        ],
      };
      const result = getNextStateForPerItemPipeline('build-task-graph', state);
      expect(result).toBe('ready-to-implement');
      expect(state.workItems[0].status).toBe('complete');
      expect(state.currentItem).toBeNull();
    });

    it('should mark item complete and go to brainstorm-exploring after build-task-graph when next item pending', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'skeleton' },
          { number: 2, title: 'Item 2', type: 'code', status: 'pending' },
        ],
      };
      const result = getNextStateForPerItemPipeline('build-task-graph', state);
      expect(result).toBe('brainstorm-exploring');
      expect(state.workItems[0].status).toBe('complete');
      expect(state.currentItem).toBe(2);
    });

    it('should handle multiple items in sequence', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'skeleton' },
          { number: 2, title: 'Item 2', type: 'code', status: 'pending' },
          { number: 3, title: 'Item 3', type: 'code', status: 'pending' },
        ],
      };

      // Item 1 completes, goes to Item 2
      let result = getNextStateForPerItemPipeline('build-task-graph', state);
      expect(result).toBe('brainstorm-exploring');
      expect(state.workItems[0].status).toBe('complete');
      expect(state.currentItem).toBe(2);

      // Simulate item 2 going through pipeline
      state.workItems[1].status = 'skeleton';

      result = getNextStateForPerItemPipeline('build-task-graph', state);
      expect(result).toBe('brainstorm-exploring');
      expect(state.workItems[1].status).toBe('complete');
      expect(state.currentItem).toBe(3);

      // Item 3 is the last one
      state.workItems[2].status = 'skeleton';

      result = getNextStateForPerItemPipeline('build-task-graph', state);
      expect(result).toBe('ready-to-implement');
      expect(state.workItems[2].status).toBe('complete');
      expect(state.currentItem).toBeNull();
    });

    it('should return null for unknown states (not in per-item pipeline)', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
        ],
      };
      const result = getNextStateForPerItemPipeline('unknown-state', state);
      expect(result).toBeNull();
    });
  });
});
