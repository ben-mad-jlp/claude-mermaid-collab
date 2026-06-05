import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FleetVitals } from './FleetVitals';
import type { SessionTodo } from '@/types/sessionTodo';

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

describe('FleetVitals funnel colors', () => {
  it('colors the in-flight and done segments from the funnel palette', () => {
    render(<FleetVitals running todos={TODOS} readyCount={0} onToggle={vi.fn()} />);
    expect(screen.getByTestId('fleet-funnel-inflight').className).toContain('info');
    expect(screen.getByTestId('fleet-funnel-done').className).toContain('success');
  });

  it('renders the loud blocked segment in amber (warning), not red (danger)', () => {
    render(<FleetVitals running todos={TODOS} readyCount={0} onToggle={vi.fn()} />);
    const blocked = screen.getByTestId('fleet-funnel-blocked');
    expect(blocked.className).toContain('bg-warning-500');
    expect(blocked.className).not.toContain('danger');
  });

  it('an empty blocked segment is not loud (no amber fill)', () => {
    render(<FleetVitals running todos={[todo({ id: 'a', status: 'in_progress' })]} readyCount={0} onToggle={vi.fn()} />);
    const blocked = screen.getByTestId('fleet-funnel-blocked');
    expect(blocked.className).not.toContain('bg-warning-500');
  });
});
