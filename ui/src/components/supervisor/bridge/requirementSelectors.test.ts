/**
 * requirementSelectors — proves the inbox set is project-scoped, filtered to the
 * awaiting-signature statuses, and changed-first (re-signs never buried).
 */

import { describe, it, expect } from 'vitest';
import { selectInboxRequirements, predecessorOf } from './requirementSelectors';
import type { Requirement } from '@/stores/supervisorStore';

function req(p: Partial<Requirement>): Requirement {
  return {
    id: p.id ?? 'r1',
    project: 'P',
    epicId: null,
    kind: 'performance',
    status: 'proposed',
    title: 'latency',
    rationale: null,
    spec: { metric: 'latency', op: '<=', target: 150 },
    supersededBy: null,
    linkedTodos: [],
    approvedBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...p,
  };
}

describe('selectInboxRequirements', () => {
  it('keeps only proposed/changed for this project', () => {
    const reqs = [
      req({ id: 'a', status: 'proposed' }),
      req({ id: 'b', status: 'changed' }),
      req({ id: 'c', status: 'approved' }),
      req({ id: 'd', status: 'proposed', project: 'OTHER' }),
    ];
    const ids = selectInboxRequirements(reqs, 'P').map((r) => r.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).not.toContain('c'); // approved left the inbox
    expect(ids).not.toContain('d'); // other project
  });

  it('floats changed (re-sign) above proposed', () => {
    const reqs = [
      req({ id: 'prop', status: 'proposed', updatedAt: 5 }),
      req({ id: 'chg', status: 'changed', updatedAt: 1 }),
    ];
    expect(selectInboxRequirements(reqs, 'P').map((r) => r.id)).toEqual(['chg', 'prop']);
  });

  it('finds the predecessor a changed requirement supersedes', () => {
    const old = req({ id: 'old', status: 'approved', supersededBy: 'new', spec: { metric: 'latency', op: '<=', target: 200 } });
    const fresh = req({ id: 'new', status: 'changed' });
    expect(predecessorOf(fresh, [old, fresh])?.id).toBe('old');
  });
});
