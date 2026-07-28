import { describe, it, expect } from 'vitest';
import { truncate, buildCriterionTagIndex, criterionTagFor } from './criterionTag';
import type { SessionTodo } from '@/types/sessionTodo';
import type { MissionSummary } from '@/stores/supervisorStore';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    kind: 'leaf',
    ownerSession: '',
    assigneeSession: null,
    title: p.id,
    description: null,
    status: 'planned',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    ...p,
  } as SessionTodo;
}

function mission(
  id: string,
  title: string,
  criteriaData: Array<{ id: string; text: string; order: number }>,
): MissionSummary {
  return {
    node: { id, title, status: 'active' },
    ownerSession: null,
    assigneeSession: null,
    mission: {
      todoId: id,
      phase: 'plan',
      iteration: 1,
    },
    rollup: {
      phase: 'plan',
      iteration: 1,
      mechanical: { done: 0, total: 0 },
      capability: { met: 0, total: 0 },
      converged: false,
    },
    criteria: criteriaData.map((c) => ({
      id: c.id,
      text: c.text,
      order: c.order,
      met: false,
    })),
    epics: [],
  };
}

describe('criterionTag', () => {
  describe('truncate', () => {
    it('returns string unchanged if length <= max', () => {
      expect(truncate('hello', 10)).toBe('hello');
      expect(truncate('hello', 5)).toBe('hello');
    });

    it('truncates with ellipsis if length > max', () => {
      expect(truncate('hello world', 8)).toBe('hello w…');
      expect(truncate('this is a long string', 10)).toBe('this is a…');
    });
  });

  describe('buildCriterionTagIndex', () => {
    it('builds an index from missions and criteria', () => {
      const missions = [
        mission('m1', '[MISSION] Feature A', [
          { id: 'crit1', text: 'Criterion 1', order: 1 },
          { id: 'crit2', text: 'Criterion 2', order: 2 },
        ]),
      ];
      const index = buildCriterionTagIndex(missions);

      expect(index.size).toBe(2);
      expect(index.get('crit1')).toEqual({
        missionTitle: 'Feature A',
        criterionOrder: 1,
        criterionText: 'Criterion 1',
      });
      expect(index.get('crit2')).toEqual({
        missionTitle: 'Feature A',
        criterionOrder: 2,
        criterionText: 'Criterion 2',
      });
    });

    it('strips mission kind prefix from title', () => {
      const missions = [
        mission('m1', '[MISSION] My Mission', [{ id: 'crit1', text: 'Test', order: 1 }]),
      ];
      const index = buildCriterionTagIndex(missions);

      expect(index.get('crit1')?.missionTitle).toBe('My Mission');
    });

    it('uses first-write-wins for duplicate criterion ids', () => {
      const missions = [
        mission('m1', '[MISSION] First', [{ id: 'crit1', text: 'Text 1', order: 1 }]),
        mission('m2', '[MISSION] Second', [{ id: 'crit1', text: 'Text 2', order: 2 }]),
      ];
      const index = buildCriterionTagIndex(missions);

      expect(index.get('crit1')?.missionTitle).toBe('First');
      expect(index.get('crit1')?.criterionText).toBe('Text 1');
    });
  });

  describe('criterionTagFor', () => {
    it('returns null when servesCriterionIds is absent', () => {
      const t = todo({ id: 'epic1' });
      const index = new Map();
      expect(criterionTagFor(t, index)).toBeNull();
    });

    it('returns null when servesCriterionIds is empty', () => {
      const t = todo({ id: 'epic1', servesCriterionIds: [] });
      const index = new Map();
      expect(criterionTagFor(t, index)).toBeNull();
    });

    it('returns null when no criterion id resolves in the index', () => {
      const t = todo({ id: 'epic1', servesCriterionIds: ['unknown1', 'unknown2'] });
      const index = new Map([
        [
          'crit1',
          { missionTitle: 'Mission M', criterionOrder: 1, criterionText: 'Criterion 1' },
        ],
      ]);
      expect(criterionTagFor(t, index)).toBeNull();
    });

    it('returns tag for the first resolving criterion id', () => {
      const t = todo({ id: 'epic1', servesCriterionIds: ['crit2', 'crit1'] });
      const index = new Map([
        [
          'crit1',
          { missionTitle: 'Mission M', criterionOrder: 1, criterionText: 'Criterion 1' },
        ],
        [
          'crit2',
          { missionTitle: 'Mission M', criterionOrder: 2, criterionText: 'Criterion 2' },
        ],
      ]);
      const tag = criterionTagFor(t, index);
      expect(tag).toEqual({
        mission: 'Mission M',
        crit: 'C2 Criterion 2',
      });
    });

    it('truncates mission title to 24 chars', () => {
      const t = todo({ id: 'epic1', servesCriterionIds: ['crit1'] });
      const index = new Map([
        [
          'crit1',
          {
            missionTitle: 'This is a very long mission title that exceeds twenty-four chars',
            criterionOrder: 1,
            criterionText: 'Criterion 1',
          },
        ],
      ]);
      const tag = criterionTagFor(t, index);
      expect(tag?.mission).toBe('This is a very long mis…');
      expect(tag?.mission.length).toBe(24);
    });

    it('truncates criterion text to 28 chars', () => {
      const t = todo({ id: 'epic1', servesCriterionIds: ['crit1'] });
      const index = new Map([
        [
          'crit1',
          {
            missionTitle: 'Mission M',
            criterionOrder: 1,
            criterionText:
              'This is a very long criterion text that exceeds the twenty-eight char limit',
          },
        ],
      ]);
      const tag = criterionTagFor(t, index);
      expect(tag?.crit).toBe('C1 This is a very long criteri…');
      expect(tag?.crit).toHaveLength(31); // C + number + space + 28 chars
    });
  });
});
