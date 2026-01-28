import {
  getCurrentWorkItem,
  itemReadyForInterface,
  itemReadyForPseudocode,
  itemReadyForSkeleton,
  readyForHandoff,
  SessionState,
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
});
