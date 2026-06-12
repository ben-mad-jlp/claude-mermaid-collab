import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ProjectRail } from '../ProjectRail';
import type { ProjectRailRowData } from '../ProjectRailRow';
import { useBridgeOrderStore, applyBridgeOrder } from '@/stores/bridgeOrderStore';

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

describe('ProjectRail (manual order)', () => {
  beforeEach(() => useBridgeOrderStore.setState({ order: [] }));

  it('renders all projects in input order when no manual order is set (no urgency re-sort, no fold)', () => {
    render(<ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop} />);
    const rows = screen.getAllByTestId('project-rail-row').map((r) => r.getAttribute('data-project'));
    expect(rows).toEqual(['/code/quietA', '/code/red2', '/code/amber', '/code/red5', '/code/quietB']);
  });

  it('honours the persisted manual order', () => {
    useBridgeOrderStore.setState({ order: ['/code/red5', '/code/quietB', '/code/amber'] });
    render(<ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop} />);
    const rows = screen.getAllByTestId('project-rail-row').map((r) => r.getAttribute('data-project'));
    // ordered ids first, then the rest (unordered) in input order, appended.
    expect(rows).toEqual(['/code/red5', '/code/quietB', '/code/amber', '/code/quietA', '/code/red2']);
  });

  it('rows are draggable to reorder', () => {
    render(<ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop} />);
    const first = screen.getAllByTestId('project-rail-row')[0];
    expect(first.getAttribute('draggable')).toBe('true');
  });

  it('shows the red ▲N badge only for projects with open escalations', () => {
    render(<ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop} />);
    const red5 = screen.getByText('red5').closest('[data-testid="project-rail-row"]')!;
    expect(within(red5 as HTMLElement).getByTestId('project-rail-badge').textContent).toBe('▲5');
    const amber = screen.getByText('amber').closest('[data-testid="project-rail-row"]')!;
    expect(within(amber as HTMLElement).queryByTestId('project-rail-badge')).toBeNull();
  });

  it('filters by name', () => {
    render(<ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop} />);
    fireEvent.change(screen.getByTestId('project-rail-filter'), { target: { value: 'quietB' } });
    const projects = screen.getAllByTestId('project-rail-row').map((r) => r.getAttribute('data-project'));
    expect(projects).toEqual(['/code/quietB']);
  });

  it('calls onSelect with the project path on row click', () => {
    const onSelect = vi.fn();
    render(<ProjectRail projects={PROJECTS} activeProject="" onSelect={onSelect} onAdd={noop} onRemove={noop} />);
    fireEvent.click(screen.getByText('red5'));
    expect(onSelect).toHaveBeenCalledWith('/code/red5');
  });

  it('renders detected projects with a watch+ affordance', () => {
    const onWatch = vi.fn();
    render(
      <ProjectRail projects={PROJECTS} activeProject="" onSelect={noop} onAdd={noop} onRemove={noop}
        detected={['/code/newone']} onWatch={onWatch} />,
    );
    fireEvent.click(screen.getByTestId('project-rail-detected'));
    expect(onWatch).toHaveBeenCalledWith('/code/newone');
  });
});

describe('applyBridgeOrder', () => {
  beforeEach(() => useBridgeOrderStore.setState({ order: [] }));

  it('orders by saved order, appends unordered in input order', () => {
    const out = applyBridgeOrder(PROJECTS, ['/code/red5', '/code/amber']).map((p) => p.project);
    expect(out).toEqual(['/code/red5', '/code/amber', '/code/quietA', '/code/red2', '/code/quietB']);
  });

  it('reorder seeds from the current order then moves dragId before dropId', () => {
    const ids = PROJECTS.map((p) => p.project);
    useBridgeOrderStore.getState().reorder(ids, '/code/red5', '/code/quietA');
    expect(useBridgeOrderStore.getState().order).toEqual(
      ['/code/red5', '/code/quietA', '/code/red2', '/code/amber', '/code/quietB'],
    );
  });
});
