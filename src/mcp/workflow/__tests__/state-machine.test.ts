import {
  STATE_DISPLAY_NAMES,
  getDisplayName,
  WORKFLOW_STATES,
  getState,
  getSkillForState,
  skillToState,
  findNextPendingItem,
  updateItemStatus,
  getCurrentWorkItem,
  migrateWorkItems,
  getNextState,
  type SessionState,
} from '../state-machine';
import type { WorkItem } from '../types';

describe('State Machine Display Names', () => {
  describe('STATE_DISPLAY_NAMES constant', () => {
    it('should exist and be a non-empty object', () => {
      expect(STATE_DISPLAY_NAMES).toBeDefined();
      expect(typeof STATE_DISPLAY_NAMES).toBe('object');
      expect(Object.keys(STATE_DISPLAY_NAMES).length).toBeGreaterThan(0);
    });

    describe('Entry states', () => {
      it('should have display name for collab-start', () => {
        expect(STATE_DISPLAY_NAMES['collab-start']).toBe('Starting');
      });

      it('should have display name for gather-goals', () => {
        expect(STATE_DISPLAY_NAMES['gather-goals']).toBe('Gathering Goals');
      });
    });

    describe('Brainstorming states', () => {
      it('should have display name for brainstorm-exploring', () => {
        expect(STATE_DISPLAY_NAMES['brainstorm-exploring']).toBe('Exploring');
      });

      it('should have display name for brainstorm-clarifying', () => {
        expect(STATE_DISPLAY_NAMES['brainstorm-clarifying']).toBe(
          'Clarifying'
        );
      });

      it('should have display name for brainstorm-designing', () => {
        expect(STATE_DISPLAY_NAMES['brainstorm-designing']).toBe('Designing');
      });

      it('should have display name for brainstorm-validating', () => {
        expect(STATE_DISPLAY_NAMES['brainstorm-validating']).toBe('Validating');
      });
    });

    describe('Item-specific paths', () => {
      it('should have display name for systematic-debugging', () => {
        expect(STATE_DISPLAY_NAMES['systematic-debugging']).toBe(
          'Investigating'
        );
      });

      it('should have display name for task-planning', () => {
        expect(STATE_DISPLAY_NAMES['task-planning']).toBe('Planning Task');
      });
    });

    describe('Rough-draft states', () => {
      it('should have display name for rough-draft-interface', () => {
        expect(STATE_DISPLAY_NAMES['rough-draft-interface']).toBe(
          'Defining Interfaces'
        );
      });

      it('should have display name for rough-draft-pseudocode', () => {
        expect(STATE_DISPLAY_NAMES['rough-draft-pseudocode']).toBe(
          'Writing Pseudocode'
        );
      });

      it('should have display name for rough-draft-skeleton', () => {
        expect(STATE_DISPLAY_NAMES['rough-draft-skeleton']).toBe(
          'Building Skeleton'
        );
      });

      it('should have display name for build-task-graph', () => {
        expect(STATE_DISPLAY_NAMES['build-task-graph']).toBe('Building Tasks');
      });

      it('should have display name for rough-draft-handoff', () => {
        expect(STATE_DISPLAY_NAMES['rough-draft-handoff']).toBe(
          'Preparing Handoff'
        );
      });
    });

    describe('Execution states', () => {
      it('should have display name for ready-to-implement', () => {
        expect(STATE_DISPLAY_NAMES['ready-to-implement']).toBe('Ready');
      });

      it('should have display name for execute-batch', () => {
        expect(STATE_DISPLAY_NAMES['execute-batch']).toBe('Executing');
      });
    });

    describe('Terminal states', () => {
      it('should have display name for workflow-complete', () => {
        expect(STATE_DISPLAY_NAMES['workflow-complete']).toBe('Finishing');
      });

      it('should have display name for cleanup', () => {
        expect(STATE_DISPLAY_NAMES['cleanup']).toBe('Cleaning Up');
      });

      it('should have display name for done', () => {
        expect(STATE_DISPLAY_NAMES['done']).toBe('Done');
      });
    });

    describe('Routing nodes', () => {
      it('should have display name for work-item-router', () => {
        expect(STATE_DISPLAY_NAMES['work-item-router']).toBe('Routing');
      });

      it('should have display name for item-type-router', () => {
        expect(STATE_DISPLAY_NAMES['item-type-router']).toBe('Routing');
      });

      it('should have display name for batch-router', () => {
        expect(STATE_DISPLAY_NAMES['batch-router']).toBe('Routing');
      });

      it('should have display name for log-batch-complete', () => {
        expect(STATE_DISPLAY_NAMES['log-batch-complete']).toBe('Logging');
      });
    });

    it('should have all values be non-empty strings', () => {
      Object.entries(STATE_DISPLAY_NAMES).forEach(([key, value]) => {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getDisplayName function', () => {
    it('should return direct mapping for known states', () => {
      expect(getDisplayName('brainstorm-exploring')).toBe('Exploring');
      expect(getDisplayName('rough-draft-interface')).toBe('Defining Interfaces');
      expect(getDisplayName('done')).toBe('Done');
    });

    it('should return "Context Check" for clear-* states', () => {
      expect(getDisplayName('clear-pre-item')).toBe('Context Check');
      expect(getDisplayName('clear-bs1')).toBe('Context Check');
      expect(getDisplayName('clear-bs2')).toBe('Context Check');
      expect(getDisplayName('clear-bs3')).toBe('Context Check');
      expect(getDisplayName('clear-pre-rough')).toBe('Context Check');
      expect(getDisplayName('clear-rd1')).toBe('Context Check');
      expect(getDisplayName('clear-rd2')).toBe('Context Check');
      expect(getDisplayName('clear-rd3')).toBe('Context Check');
      expect(getDisplayName('clear-rd4')).toBe('Context Check');
      expect(getDisplayName('clear-post-item')).toBe('Context Check');
      expect(getDisplayName('clear-pre-execute')).toBe('Context Check');
      expect(getDisplayName('clear-post-batch')).toBe('Context Check');
    });

    it('should return state as-is for unknown states', () => {
      expect(getDisplayName('unknown-state')).toBe('unknown-state');
      expect(getDisplayName('some-random-state')).toBe('some-random-state');
    });

    it('should accept optional previousState parameter', () => {
      // The function accepts previousState for future use
      expect(getDisplayName('brainstorm-designing', 'brainstorm-clarifying')).toBe(
        'Designing'
      );
      expect(getDisplayName('clear-bs1', 'brainstorm-exploring')).toBe(
        'Context Check'
      );
    });

    it('should be case-sensitive', () => {
      expect(getDisplayName('BRAINSTORM-EXPLORING')).toBe(
        'BRAINSTORM-EXPLORING'
      );
      expect(getDisplayName('Clear-BS1')).toBe('Clear-BS1');
    });

    it('should handle empty string', () => {
      expect(getDisplayName('')).toBe('');
    });
  });

  describe('Integration with workflow states', () => {
    it('should have display names for all non-null skill states', () => {
      const statesWithSkills = WORKFLOW_STATES.filter((s) => s.skill !== null);
      statesWithSkills.forEach((state) => {
        const displayName = getDisplayName(state.id);
        expect(displayName).toBeDefined();
        expect(displayName.length).toBeGreaterThan(0);
      });
    });

    it('should have display names for all routing node states', () => {
      const routingStates = WORKFLOW_STATES.filter((s) => s.skill === null);
      routingStates.forEach((state) => {
        const displayName = getDisplayName(state.id);
        expect(displayName).toBeDefined();
      });
    });
  });
});

describe('Work Item Helper Functions', () => {
  const createWorkItem = (
    number: number,
    title: string,
    status: 'pending' | 'brainstormed' | 'interface' | 'pseudocode' | 'skeleton' | 'complete' = 'pending'
  ): WorkItem => ({
    number,
    title,
    type: 'code',
    status,
  });

  describe('findNextPendingItem', () => {
    it('should return undefined for empty array', () => {
      expect(findNextPendingItem([])).toBeUndefined();
    });

    it('should return the first non-complete item', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'complete'),
        createWorkItem(2, 'Item 2', 'pending'),
        createWorkItem(3, 'Item 3', 'brainstormed'),
      ];
      const result = findNextPendingItem(items);
      expect(result).toEqual(items[1]);
      expect(result?.number).toBe(2);
    });

    it('should return first non-complete item in array order', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'interface'),
        createWorkItem(2, 'Item 2', 'pending'),
      ];
      const result = findNextPendingItem(items);
      expect(result?.number).toBe(1);
      expect(result?.status).toBe('interface');
    });

    it('should return undefined if all items are complete', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'complete'),
        createWorkItem(2, 'Item 2', 'complete'),
      ];
      expect(findNextPendingItem(items)).toBeUndefined();
    });

    it('should return the first item if all are non-complete', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'pending'),
        createWorkItem(2, 'Item 2', 'brainstormed'),
      ];
      const result = findNextPendingItem(items);
      expect(result?.number).toBe(1);
    });

    it('should find brainstormed items as non-complete', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'complete'),
        createWorkItem(2, 'Item 2', 'brainstormed'),
      ];
      const result = findNextPendingItem(items);
      expect(result?.number).toBe(2);
    });

    it('should find skeleton status items as non-complete', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'complete'),
        createWorkItem(2, 'Item 2', 'skeleton'),
      ];
      const result = findNextPendingItem(items);
      expect(result?.number).toBe(2);
    });
  });

  describe('updateItemStatus', () => {
    it('should update pending to brainstormed', () => {
      const item = createWorkItem(1, 'Item 1', 'pending');
      const updated = updateItemStatus(item, 'brainstormed');
      expect(updated.status).toBe('brainstormed');
      expect(updated.number).toBe(1);
      expect(updated.title).toBe('Item 1');
    });

    it('should update brainstormed to interface', () => {
      const item = createWorkItem(1, 'Item 1', 'brainstormed');
      const updated = updateItemStatus(item, 'interface');
      expect(updated.status).toBe('interface');
    });

    it('should update interface to pseudocode', () => {
      const item = createWorkItem(1, 'Item 1', 'interface');
      const updated = updateItemStatus(item, 'pseudocode');
      expect(updated.status).toBe('pseudocode');
    });

    it('should update pseudocode to skeleton', () => {
      const item = createWorkItem(1, 'Item 1', 'pseudocode');
      const updated = updateItemStatus(item, 'skeleton');
      expect(updated.status).toBe('skeleton');
    });

    it('should update skeleton to complete', () => {
      const item = createWorkItem(1, 'Item 1', 'skeleton');
      const updated = updateItemStatus(item, 'complete');
      expect(updated.status).toBe('complete');
    });

    it('should be immutable (not mutate original)', () => {
      const item = createWorkItem(1, 'Item 1', 'pending');
      const updated = updateItemStatus(item, 'brainstormed');
      expect(item.status).toBe('pending');
      expect(updated.status).toBe('brainstormed');
      expect(item).not.toBe(updated);
    });

    it('should throw on invalid transition from pending to interface', () => {
      const item = createWorkItem(1, 'Item 1', 'pending');
      expect(() => updateItemStatus(item, 'interface')).toThrow(
        /Invalid status transition from 'pending' to 'interface'/
      );
    });

    it('should throw on invalid transition from brainstormed to skeleton', () => {
      const item = createWorkItem(1, 'Item 1', 'brainstormed');
      expect(() => updateItemStatus(item, 'skeleton')).toThrow(
        /Invalid status transition/
      );
    });

    it('should throw on invalid transition from complete to anything', () => {
      const item = createWorkItem(1, 'Item 1', 'complete');
      expect(() => updateItemStatus(item, 'pending')).toThrow(
        /Invalid status transition/
      );
    });

    it('should include item number in error message', () => {
      const item = createWorkItem(5, 'Item 5', 'pending');
      expect(() => updateItemStatus(item, 'skeleton')).toThrow(/item 5/);
    });

    it('should preserve all other item properties', () => {
      const item: WorkItem = {
        number: 3,
        title: 'Complex Item',
        type: 'task',
        status: 'brainstormed',
      };
      const updated = updateItemStatus(item, 'interface');
      expect(updated.number).toBe(3);
      expect(updated.title).toBe('Complex Item');
      expect(updated.type).toBe('task');
      expect(updated.status).toBe('interface');
    });
  });

  describe('getCurrentWorkItem', () => {
    it('should return undefined if no currentItemNumber provided', () => {
      const items = [createWorkItem(1, 'Item 1')];
      expect(getCurrentWorkItem(items)).toBeUndefined();
      expect(getCurrentWorkItem(items, undefined)).toBeUndefined();
    });

    it('should return the matching work item', () => {
      const items = [
        createWorkItem(1, 'Item 1'),
        createWorkItem(2, 'Item 2'),
        createWorkItem(3, 'Item 3'),
      ];
      const result = getCurrentWorkItem(items, 2);
      expect(result).toEqual(items[1]);
      expect(result?.title).toBe('Item 2');
    });

    it('should return undefined if item not found', () => {
      const items = [
        createWorkItem(1, 'Item 1'),
        createWorkItem(2, 'Item 2'),
      ];
      expect(getCurrentWorkItem(items, 5)).toBeUndefined();
    });

    it('should return undefined for empty array', () => {
      expect(getCurrentWorkItem([], 1)).toBeUndefined();
    });

    it('should return the first item when currentItemNumber is 1', () => {
      const items = [
        createWorkItem(1, 'First Item'),
        createWorkItem(2, 'Second Item'),
      ];
      const result = getCurrentWorkItem(items, 1);
      expect(result?.title).toBe('First Item');
    });

    it('should find items regardless of order in array', () => {
      const items = [
        createWorkItem(3, 'Item 3'),
        createWorkItem(1, 'Item 1'),
        createWorkItem(2, 'Item 2'),
      ];
      const result = getCurrentWorkItem(items, 1);
      expect(result?.title).toBe('Item 1');
    });

    it('should work with different item statuses', () => {
      const items: WorkItem[] = [
        { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
        { number: 2, title: 'Item 2', type: 'task', status: 'complete' },
        { number: 3, title: 'Item 3', type: 'bugfix', status: 'brainstormed' },
      ];
      const result = getCurrentWorkItem(items, 2);
      expect(result?.status).toBe('complete');
      expect(result?.type).toBe('task');
    });
  });

  describe('migrateWorkItems', () => {
    it('should return empty array for empty input', () => {
      const result = migrateWorkItems([]);
      expect(result).toEqual([]);
    });

    it('should convert documented status to brainstormed', () => {
      const items = [
        { number: 1, title: 'Item 1', type: 'code', status: 'documented' as any },
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('brainstormed');
      expect(result[0].number).toBe(1);
      expect(result[0].title).toBe('Item 1');
    });

    it('should leave brainstormed status unchanged', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'brainstormed'),
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('brainstormed');
    });

    it('should leave pending status unchanged', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'pending'),
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('pending');
    });

    it('should leave complete status unchanged', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'complete'),
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('complete');
    });

    it('should leave interface status unchanged', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'interface'),
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('interface');
    });

    it('should leave pseudocode status unchanged', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'pseudocode'),
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('pseudocode');
    });

    it('should leave skeleton status unchanged', () => {
      const items = [
        createWorkItem(1, 'Item 1', 'skeleton'),
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('skeleton');
    });

    it('should handle mixed documented and new statuses', () => {
      const items: any[] = [
        { number: 1, title: 'Item 1', type: 'code', status: 'documented' },
        createWorkItem(2, 'Item 2', 'brainstormed'),
        createWorkItem(3, 'Item 3', 'pending'),
        { number: 4, title: 'Item 4', type: 'task', status: 'documented' },
        createWorkItem(5, 'Item 5', 'complete'),
      ];
      const result = migrateWorkItems(items);

      expect(result[0].status).toBe('brainstormed');
      expect(result[1].status).toBe('brainstormed');
      expect(result[2].status).toBe('pending');
      expect(result[3].status).toBe('brainstormed');
      expect(result[4].status).toBe('complete');
    });

    it('should return new array (non-mutating)', () => {
      const items = [
        { number: 1, title: 'Item 1', type: 'code', status: 'documented' as any },
      ];
      const result = migrateWorkItems(items);

      expect(result).not.toBe(items);
      expect(result[0]).not.toBe(items[0]);
      expect(items[0].status).toBe('documented');
      expect(result[0].status).toBe('brainstormed');
    });

    it('should preserve all item properties when migrating', () => {
      const items = [
        { number: 5, title: 'Complex Item', type: 'task', status: 'documented' as any },
      ];
      const result = migrateWorkItems(items);

      expect(result[0].number).toBe(5);
      expect(result[0].title).toBe('Complex Item');
      expect(result[0].type).toBe('task');
      expect(result[0].status).toBe('brainstormed');
    });

    it('should preserve all item properties when not migrating', () => {
      const items = [
        { number: 3, title: 'Another Item', type: 'bugfix', status: 'complete' as const },
      ];
      const result = migrateWorkItems(items);

      expect(result[0].number).toBe(3);
      expect(result[0].title).toBe('Another Item');
      expect(result[0].type).toBe('bugfix');
      expect(result[0].status).toBe('complete');
    });

    it('should work with large arrays', () => {
      const items: any[] = Array.from({ length: 100 }, (_, i) => ({
        number: i + 1,
        title: `Item ${i + 1}`,
        type: 'code',
        status: i % 2 === 0 ? 'documented' : 'brainstormed',
      }));

      const result = migrateWorkItems(items);

      expect(result).toHaveLength(100);
      result.forEach((item, i) => {
        expect(item.number).toBe(i + 1);
        // All documented should be converted to brainstormed
        expect(item.status).toBe('brainstormed');
      });
    });

    it('should handle items with various type combinations', () => {
      const items: any[] = [
        { number: 1, title: 'Code Item', type: 'code', status: 'documented' },
        { number: 2, title: 'Task Item', type: 'task', status: 'documented' },
        { number: 3, title: 'Bugfix Item', type: 'bugfix', status: 'documented' },
      ];

      const result = migrateWorkItems(items);

      result.forEach((item) => {
        expect(item.status).toBe('brainstormed');
      });
      expect(result[0].type).toBe('code');
      expect(result[1].type).toBe('task');
      expect(result[2].type).toBe('bugfix');
    });
  });
});

describe('Per-Item Pipeline State Routing', () => {
  const createWorkItem = (
    number: number,
    title: string,
    status: 'pending' | 'brainstormed' | 'interface' | 'pseudocode' | 'skeleton' | 'complete' = 'pending'
  ): WorkItem => ({
    number,
    title,
    type: 'code',
    status,
  });

  describe('getNextState', () => {
    it('should route to brainstorm-exploring when no current item', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [createWorkItem(1, 'Item 1')],
      };
      const result = getNextState('work-item-router', state);
      expect(result).toBe('brainstorm-exploring');
    });

    it('should route to ready-to-implement when all items complete', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [createWorkItem(1, 'Item 1', 'complete')],
      };
      const result = getNextState('work-item-router', state);
      expect(result).toBe('ready-to-implement');
    });

    it('should mark item brainstormed after brainstorm-validating', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Item 1', 'pending')],
      };
      const result = getNextState('brainstorm-validating', state);
      expect(result).toBe('rough-draft-interface');
      expect(state.workItems[0].status).toBe('brainstormed');
    });

    it('should mark item interface after rough-draft-interface', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Item 1', 'brainstormed')],
      };
      const result = getNextState('rough-draft-interface', state);
      expect(result).toBe('rough-draft-pseudocode');
      expect(state.workItems[0].status).toBe('interface');
    });

    it('should mark item pseudocode after rough-draft-pseudocode', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Item 1', 'interface')],
      };
      const result = getNextState('rough-draft-pseudocode', state);
      expect(result).toBe('rough-draft-skeleton');
      expect(state.workItems[0].status).toBe('pseudocode');
    });

    it('should mark item skeleton after rough-draft-skeleton', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Item 1', 'pseudocode')],
      };
      const result = getNextState('rough-draft-skeleton', state);
      expect(result).toBe('build-task-graph');
      expect(state.workItems[0].status).toBe('skeleton');
    });

    it('should complete item and move to next after build-task-graph', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          createWorkItem(1, 'Item 1', 'skeleton'),
          createWorkItem(2, 'Item 2', 'pending'),
        ],
      };
      const result = getNextState('build-task-graph', state);
      expect(result).toBe('brainstorm-exploring');
      expect(state.workItems[0].status).toBe('complete');
      expect(state.currentItem).toBe(2);
    });

    it('should route to ready-to-implement when last item completes', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Item 1', 'skeleton')],
      };
      const result = getNextState('build-task-graph', state);
      expect(result).toBe('ready-to-implement');
      expect(state.workItems[0].status).toBe('complete');
      expect(state.currentItem).toBeNull();
    });

    it('should handle full pipeline for single item', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Single Item', 'pending')],
      };

      // Brainstorm complete
      let result = getNextState('brainstorm-validating', state);
      expect(result).toBe('rough-draft-interface');
      expect(state.workItems[0].status).toBe('brainstormed');

      // Interface complete
      result = getNextState('rough-draft-interface', state);
      expect(result).toBe('rough-draft-pseudocode');
      expect(state.workItems[0].status).toBe('interface');

      // Pseudocode complete
      result = getNextState('rough-draft-pseudocode', state);
      expect(result).toBe('rough-draft-skeleton');
      expect(state.workItems[0].status).toBe('pseudocode');

      // Skeleton complete
      result = getNextState('rough-draft-skeleton', state);
      expect(result).toBe('build-task-graph');
      expect(state.workItems[0].status).toBe('skeleton');

      // Task graph complete
      result = getNextState('build-task-graph', state);
      expect(result).toBe('ready-to-implement');
      expect(state.workItems[0].status).toBe('complete');
      expect(state.currentItem).toBeNull();
    });

    it('should handle pipeline for multiple items sequentially', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          createWorkItem(1, 'Item 1', 'pending'),
          createWorkItem(2, 'Item 2', 'pending'),
          createWorkItem(3, 'Item 3', 'pending'),
        ],
      };

      // Process item 1
      getNextState('brainstorm-validating', state);
      state.workItems[0].status = 'brainstormed';
      getNextState('rough-draft-interface', state);
      state.workItems[0].status = 'interface';
      getNextState('rough-draft-pseudocode', state);
      state.workItems[0].status = 'pseudocode';
      getNextState('rough-draft-skeleton', state);
      state.workItems[0].status = 'skeleton';

      // Item 1 complete, move to item 2
      let result = getNextState('build-task-graph', state);
      expect(result).toBe('brainstorm-exploring');
      expect(state.currentItem).toBe(2);

      // Process item 2
      state.workItems[1].status = 'pending'; // Reset for next brainstorm
      getNextState('brainstorm-validating', state);
      state.workItems[1].status = 'brainstormed';
      getNextState('rough-draft-interface', state);
      state.workItems[1].status = 'interface';
      getNextState('rough-draft-pseudocode', state);
      state.workItems[1].status = 'pseudocode';
      getNextState('rough-draft-skeleton', state);
      state.workItems[1].status = 'skeleton';

      // Item 2 complete, move to item 3
      result = getNextState('build-task-graph', state);
      expect(result).toBe('brainstorm-exploring');
      expect(state.currentItem).toBe(3);

      // Process item 3
      state.workItems[2].status = 'pending'; // Reset for next brainstorm
      getNextState('brainstorm-validating', state);
      state.workItems[2].status = 'brainstormed';
      getNextState('rough-draft-interface', state);
      state.workItems[2].status = 'interface';
      getNextState('rough-draft-pseudocode', state);
      state.workItems[2].status = 'pseudocode';
      getNextState('rough-draft-skeleton', state);
      state.workItems[2].status = 'skeleton';

      // Item 3 complete, all done
      result = getNextState('build-task-graph', state);
      expect(result).toBe('ready-to-implement');
      expect(state.currentItem).toBeNull();
      expect(state.workItems.every((item) => item.status === 'complete')).toBe(true);
    });

    it('should return null for unknown states', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Item 1', 'pending')],
      };
      const result = getNextState('unknown-state', state);
      expect(result).toBeNull();
    });
  });
});
