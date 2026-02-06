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
      it('should have display name for rough-draft-blueprint', () => {
        expect(STATE_DISPLAY_NAMES['rough-draft-blueprint']).toBe(
          'Creating Blueprint'
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

    describe('Vibe mode states', () => {
      it('should have display name for vibe-active', () => {
        expect(STATE_DISPLAY_NAMES['vibe-active']).toBe('Vibing');
      });
    });

    describe('Routing nodes', () => {
      it('should have display name for work-item-router', () => {
        expect(STATE_DISPLAY_NAMES['work-item-router']).toBe('Routing');
      });

      it('should have display name for brainstorm-item-router', () => {
        expect(STATE_DISPLAY_NAMES['brainstorm-item-router']).toBe('Routing');
      });

      it('should have display name for item-type-router', () => {
        expect(STATE_DISPLAY_NAMES['item-type-router']).toBe('Routing');
      });

      it('should have display name for rough-draft-item-router', () => {
        expect(STATE_DISPLAY_NAMES['rough-draft-item-router']).toBe('Routing');
      });

      it('should have display name for batch-router', () => {
        expect(STATE_DISPLAY_NAMES['batch-router']).toBe('Routing');
      });

      it('should have display name for log-batch-complete', () => {
        expect(STATE_DISPLAY_NAMES['log-batch-complete']).toBe('Logging');
      });
    });

    describe('Phase transition', () => {
      it('should have display name for rough-draft-confirm', () => {
        expect(STATE_DISPLAY_NAMES['rough-draft-confirm']).toBe('Confirming');
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
      expect(getDisplayName('rough-draft-blueprint')).toBe('Creating Blueprint');
      expect(getDisplayName('done')).toBe('Done');
    });

    it('should return "Context Check" for clear-* states', () => {
      expect(getDisplayName('clear-pre-item')).toBe('Context Check');
      expect(getDisplayName('clear-bs1')).toBe('Context Check');
      expect(getDisplayName('clear-bs2')).toBe('Context Check');
      expect(getDisplayName('clear-bs3')).toBe('Context Check');
      expect(getDisplayName('clear-post-brainstorm')).toBe('Context Check');
      expect(getDisplayName('clear-pre-rough-batch')).toBe('Context Check');
      expect(getDisplayName('clear-pre-rough')).toBe('Context Check');
      expect(getDisplayName('clear-post-rough')).toBe('Context Check');
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

describe('Vibe Mode State', () => {
  describe('vibe-active state definition', () => {
    it('should exist in WORKFLOW_STATES', () => {
      const vibeActiveState = getState('vibe-active');
      expect(vibeActiveState).toBeDefined();
    });

    it('should have vibe-active skill', () => {
      const vibeActiveState = getState('vibe-active');
      expect(vibeActiveState?.skill).toBe('vibe-active');
    });

    it('should have correct id', () => {
      const vibeActiveState = getState('vibe-active');
      expect(vibeActiveState?.id).toBe('vibe-active');
    });

    it('should have conditional transition to clear-pre-item when pending brainstorm items', () => {
      const vibeActiveState = getState('vibe-active');
      expect(vibeActiveState?.transitions).toBeDefined();
      expect(vibeActiveState?.transitions.length).toBeGreaterThan(0);

      const convertTransition = vibeActiveState?.transitions.find(
        (t) => t.to === 'clear-pre-item' && t.condition?.type === 'pending_brainstorm_items'
      );
      expect(convertTransition).toBeDefined();
    });

    it('should have fallthrough transition to cleanup', () => {
      const vibeActiveState = getState('vibe-active');
      const cleanupTransition = vibeActiveState?.transitions.find(
        (t) => t.to === 'cleanup' && !t.condition
      );
      expect(cleanupTransition).toBeDefined();
    });

    it('should have exactly two transitions', () => {
      const vibeActiveState = getState('vibe-active');
      expect(vibeActiveState?.transitions.length).toBe(2);
    });
  });

  describe('getDisplayName for vibe-active', () => {
    it('should return Vibing', () => {
      expect(getDisplayName('vibe-active')).toBe('Vibing');
    });
  });

  describe('vibe-active state integration', () => {
    it('should be accessible via getState', () => {
      const state = getState('vibe-active');
      expect(state).toBeDefined();
      expect(state?.id).toBe('vibe-active');
    });

    it('should have a skill mapping', () => {
      const skillId = skillToState('vibe-active');
      expect(skillId).toBe('vibe-active');
    });
  });

  describe('vibe-active transition evaluation', () => {
    it('should have pending_brainstorm_items condition on first transition', () => {
      const vibeActiveState = getState('vibe-active');
      const firstTransition = vibeActiveState?.transitions[0];
      expect(firstTransition?.to).toBe('clear-pre-item');
      expect(firstTransition?.condition?.type).toBe('pending_brainstorm_items');
    });

    it('should have unconditional cleanup as second transition', () => {
      const vibeActiveState = getState('vibe-active');
      const secondTransition = vibeActiveState?.transitions[1];
      expect(secondTransition?.to).toBe('cleanup');
      expect(secondTransition?.condition).toBeUndefined();
    });
  });
});

describe('Work Item Helper Functions', () => {
  const createWorkItem = (
    number: number,
    title: string,
    status: 'pending' | 'brainstormed' | 'complete' = 'pending'
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
        createWorkItem(1, 'Item 1', 'brainstormed'),
        createWorkItem(2, 'Item 2', 'pending'),
      ];
      const result = findNextPendingItem(items);
      expect(result?.number).toBe(1);
      expect(result?.status).toBe('brainstormed');
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
  });

  describe('updateItemStatus', () => {
    it('should update pending to brainstormed', () => {
      const item = createWorkItem(1, 'Item 1', 'pending');
      const updated = updateItemStatus(item, 'brainstormed');
      expect(updated.status).toBe('brainstormed');
      expect(updated.number).toBe(1);
      expect(updated.title).toBe('Item 1');
    });

    it('should update brainstormed to complete', () => {
      const item = createWorkItem(1, 'Item 1', 'brainstormed');
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

    it('should throw on invalid transition from pending to complete', () => {
      const item = createWorkItem(1, 'Item 1', 'pending');
      expect(() => updateItemStatus(item, 'complete')).toThrow(
        /Invalid status transition from 'pending' to 'complete'/
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
      expect(() => updateItemStatus(item, 'complete')).toThrow(/item 5/);
    });

    it('should preserve all other item properties', () => {
      const item: WorkItem = {
        number: 3,
        title: 'Complex Item',
        type: 'task',
        status: 'brainstormed',
      };
      const updated = updateItemStatus(item, 'complete');
      expect(updated.number).toBe(3);
      expect(updated.title).toBe('Complex Item');
      expect(updated.type).toBe('task');
      expect(updated.status).toBe('complete');
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

    it('should convert interface status to complete', () => {
      const items = [
        { number: 1, title: 'Item 1', type: 'code', status: 'interface' as any },
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('complete');
    });

    it('should convert pseudocode status to complete', () => {
      const items = [
        { number: 1, title: 'Item 1', type: 'code', status: 'pseudocode' as any },
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('complete');
    });

    it('should convert skeleton status to complete', () => {
      const items = [
        { number: 1, title: 'Item 1', type: 'code', status: 'skeleton' as any },
      ];
      const result = migrateWorkItems(items);
      expect(result[0].status).toBe('complete');
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

    it('should handle mixed documented and old statuses', () => {
      const items: any[] = [
        { number: 1, title: 'Item 1', type: 'code', status: 'documented' },
        createWorkItem(2, 'Item 2', 'brainstormed'),
        createWorkItem(3, 'Item 3', 'pending'),
        { number: 4, title: 'Item 4', type: 'task', status: 'interface' },
        createWorkItem(5, 'Item 5', 'complete'),
      ];
      const result = migrateWorkItems(items);

      expect(result[0].status).toBe('brainstormed');
      expect(result[1].status).toBe('brainstormed');
      expect(result[2].status).toBe('pending');
      expect(result[3].status).toBe('complete'); // interface -> complete
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

    it('should handle items with various type combinations', () => {
      const items: any[] = [
        { number: 1, title: 'Code Item', type: 'code', status: 'documented' },
        { number: 2, title: 'Task Item', type: 'task', status: 'skeleton' },
        { number: 3, title: 'Bugfix Item', type: 'bugfix', status: 'pseudocode' },
      ];

      const result = migrateWorkItems(items);

      expect(result[0].status).toBe('brainstormed'); // documented -> brainstormed
      expect(result[1].status).toBe('complete'); // skeleton -> complete
      expect(result[2].status).toBe('complete'); // pseudocode -> complete
      expect(result[0].type).toBe('code');
      expect(result[1].type).toBe('task');
      expect(result[2].type).toBe('bugfix');
    });
  });
});

describe('Phase Batching State Routing', () => {
  const createWorkItem = (
    number: number,
    title: string,
    type: 'code' | 'task' | 'bugfix' = 'code',
    status: 'pending' | 'brainstormed' | 'complete' = 'pending'
  ): WorkItem => ({
    number,
    title,
    type,
    status,
  });

  describe('getNextState', () => {
    // Phase batching: all items brainstorm first, then code items go through rough-draft-blueprint

    it('should mark item brainstormed and go to item-type-router after brainstorm-validating', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Item 1', 'code', 'pending')],
      };
      const result = getNextState('brainstorm-validating', state);
      expect(result).toBe('item-type-router');
      expect(state.workItems[0].status).toBe('brainstormed');
    });

    it('should mark item complete after rough-draft-blueprint', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Item 1', 'code', 'brainstormed')],
      };
      const result = getNextState('rough-draft-blueprint', state);
      expect(result).toBe('clear-post-rough');
      expect(state.workItems[0].status).toBe('complete');
    });

    it('should mark task complete after task-planning', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Task 1', 'task', 'brainstormed')],
      };
      const result = getNextState('task-planning', state);
      expect(result).toBe('clear-post-brainstorm');
      expect(state.workItems[0].status).toBe('complete');
    });

    it('should mark bugfix complete after systematic-debugging', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Bug 1', 'bugfix', 'pending')],
      };
      const result = getNextState('systematic-debugging', state);
      expect(result).toBe('clear-post-brainstorm');
      expect(state.workItems[0].status).toBe('complete');
    });

    it('should handle single code item through blueprint', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Code Item', 'code', 'brainstormed')],
      };

      // Blueprint complete - item is done
      const result = getNextState('rough-draft-blueprint', state);
      expect(result).toBe('clear-post-rough');
      expect(state.workItems[0].status).toBe('complete');
    });

    it('should return null for routing states (routing handled by state machine)', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: null,
        workItems: [createWorkItem(1, 'Item 1', 'code', 'pending')],
      };
      // Router states don't update item status
      expect(getNextState('brainstorm-item-router', state)).toBeNull();
      expect(getNextState('rough-draft-item-router', state)).toBeNull();
      expect(getNextState('work-item-router', state)).toBeNull();
    });

    it('should return null for unknown states', () => {
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [createWorkItem(1, 'Item 1', 'code', 'pending')],
      };
      const result = getNextState('unknown-state', state);
      expect(result).toBeNull();
    });

    it('should handle phase batching for mixed items', () => {
      // Phase batching: all brainstorm first, then rough-draft-blueprint for code items only
      const state: SessionState = {
        state: 'test',
        currentItem: 1,
        workItems: [
          createWorkItem(1, 'Code 1', 'code', 'pending'),
          createWorkItem(2, 'Task 1', 'task', 'pending'),
          createWorkItem(3, 'Bug 1', 'bugfix', 'pending'),
        ],
      };

      // Brainstorm Phase:
      // Code item brainstorms
      let result = getNextState('brainstorm-validating', state);
      expect(result).toBe('item-type-router');
      expect(state.workItems[0].status).toBe('brainstormed');

      // Task item brainstorms (simulated: currentItem = 2)
      state.currentItem = 2;
      result = getNextState('brainstorm-validating', state);
      expect(result).toBe('item-type-router');
      expect(state.workItems[1].status).toBe('brainstormed');

      // Task completes via task-planning
      result = getNextState('task-planning', state);
      expect(result).toBe('clear-post-brainstorm');
      expect(state.workItems[1].status).toBe('complete');

      // Bugfix completes via systematic-debugging (simulated: currentItem = 3)
      state.currentItem = 3;
      result = getNextState('systematic-debugging', state);
      expect(result).toBe('clear-post-brainstorm');
      expect(state.workItems[2].status).toBe('complete');

      // Rough-Draft Phase:
      // Only code item goes through rough-draft-blueprint (simulated: currentItem = 1)
      state.currentItem = 1;
      result = getNextState('rough-draft-blueprint', state);
      expect(result).toBe('clear-post-rough');
      expect(state.workItems[0].status).toBe('complete');

      // All items complete
      expect(state.workItems.every((item) => item.status === 'complete')).toBe(true);
    });
  });
});
