import {
  STATE_DISPLAY_NAMES,
  getDisplayName,
  WORKFLOW_STATES,
  getState,
  getSkillForState,
  skillToState,
} from '../state-machine';

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
