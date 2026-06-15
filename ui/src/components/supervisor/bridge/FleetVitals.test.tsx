import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FleetVitals } from './FleetVitals';
import type { SessionTodo } from '@/types/sessionTodo';
import type { UnlandedEpic } from '@/stores/supervisorStore';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: null,
    title: p.id,
    description: null,
    status: 'backlog',
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

const TODOS = [
  todo({ id: 'a', status: 'in_progress' }),
  todo({ id: 'b', status: 'blocked' }),
  todo({ id: 'c', status: 'done' }),
];

describe('FleetVitals', () => {
  it('no longer renders the progress funnel (moved to the Plan view)', () => {
    render(<FleetVitals todos={TODOS} />);
    expect(screen.queryByTestId('fleet-funnel')).toBeNull();
    expect(screen.queryByTestId('fleet-funnel-done')).toBeNull();
  });

  it('still surfaces unlanded epics (the non-redundant safety line kept on the Bridge)', () => {
    const unlanded: UnlandedEpic[] = [
      { id: 'e1', title: 'Epic one', ahead: 3 } as UnlandedEpic,
    ];
    render(<FleetVitals todos={TODOS} unlandedEpics={unlanded} />);
    expect(screen.getByTestId('unlanded-epics')).toBeTruthy();
  });

  it('self-hides the unlanded surface when everything is landed', () => {
    render(<FleetVitals todos={TODOS} unlandedEpics={[]} />);
    expect(screen.queryByTestId('unlanded-epics')).toBeNull();
  });
});
