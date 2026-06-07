import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ProjectRail } from '../ProjectRail';
import type { ProjectRailRowData } from '../ProjectRailRow';

const row = (name: string, escalationCount: number, idleWithWork = false): ProjectRailRowData => ({
  project: `/code/${name}`,
  name,
  escalationCount,
  idleWithWork,
});

const PROJECTS: ProjectRailRowData[] = [
  row('quietA', 0),
  row('red2', 2),
  row('amber', 0, true),
  row('red5', 5),
  row('quietB', 0),
];

const noop = () => {};

describe('ProjectRail', () => {
  it('sorts needs-you first: red (most escalations) → amber → quiet folded', () => {
    render(
      <ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop} />,
    );
    // Quiet projects are folded by default (2 quiet), so only needs-you rows show.
    const rows = screen.getAllByTestId('project-rail-row');
    expect(rows.map((r) => r.getAttribute('data-project'))).toEqual([
      '/code/red5', // 5 escalations
      '/code/red2', // 2 escalations
      '/code/amber', // idle-with-work
    ]);
    expect(screen.getByTestId('project-rail-quiet-toggle').textContent).toContain('2 quiet');
  });

  it('reveals quiet projects when the fold is toggled', () => {
    render(
      <ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop} />,
    );
    fireEvent.click(screen.getByTestId('project-rail-quiet-toggle'));
    const projects = screen.getAllByTestId('project-rail-row').map((r) => r.getAttribute('data-project'));
    expect(projects).toContain('/code/quietA');
    expect(projects).toContain('/code/quietB');
  });

  it('shows the red ▲N badge only for projects with open escalations', () => {
    render(
      <ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop} />,
    );
    const red5 = screen.getByText('red5').closest('[data-testid="project-rail-row"]')!;
    expect(within(red5 as HTMLElement).getByTestId('project-rail-badge').textContent).toBe('▲5');
    const amber = screen.getByText('amber').closest('[data-testid="project-rail-row"]')!;
    expect(within(amber as HTMLElement).queryByTestId('project-rail-badge')).toBeNull();
  });

  it('filters by name and surfaces quiet matches without the fold', () => {
    render(
      <ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop} />,
    );
    fireEvent.change(screen.getByTestId('project-rail-filter'), { target: { value: 'quietB' } });
    const projects = screen.getAllByTestId('project-rail-row').map((r) => r.getAttribute('data-project'));
    expect(projects).toEqual(['/code/quietB']);
  });

  it('calls onSelect with the project path on row click', () => {
    const onSelect = vi.fn();
    render(
      <ProjectRail projects={PROJECTS} activeProject="" onSelect={onSelect} onAdd={noop} onRemove={noop} />,
    );
    fireEvent.click(screen.getByText('red5'));
    expect(onSelect).toHaveBeenCalledWith('/code/red5');
  });

  it('renders detected projects with a watch+ affordance', () => {
    const onWatch = vi.fn();
    render(
      <ProjectRail
        projects={PROJECTS}
        activeProject=""
        onSelect={noop}
        onAdd={noop}
        onRemove={noop}
        detected={['/code/newone']}
        onWatch={onWatch}
      />,
    );
    fireEvent.click(screen.getByTestId('project-rail-detected'));
    expect(onWatch).toHaveBeenCalledWith('/code/newone');
  });
});
