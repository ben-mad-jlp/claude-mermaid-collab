import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FleetStatusGrid, type FleetGridRow } from '../FleetStatusGrid';

const rows: FleetGridRow[] = [
  { project: '/code/a', name: 'a', escalationCount: 2, coordinatorRunning: true, readyCount: 3, workerCount: 1 },
  { project: '/code/b', name: 'b', escalationCount: 0, coordinatorRunning: false, readyCount: 5, workerCount: 0 }, // idle-with-work
  { project: '/code/c', name: 'c', escalationCount: 0, coordinatorRunning: false, readyCount: 0, workerCount: 0 }, // quiet off
];

describe('FleetStatusGrid', () => {
  it('renders one row per project with the escalation count', () => {
    render(<FleetStatusGrid rows={rows} onSelectProject={() => {}} onStartCoordinator={() => {}} />);
    expect(screen.getAllByTestId('fleet-grid-row')).toHaveLength(3);
    const a = screen.getByText('a').closest('tr')!;
    expect(within(a as HTMLElement).getByText('▲2')).toBeTruthy();
  });

  it('shows an inline "start" only for an idle-with-work project (coord off & ready>0)', () => {
    render(<FleetStatusGrid rows={rows} onSelectProject={() => {}} onStartCoordinator={() => {}} />);
    const starts = screen.getAllByTestId('fleet-start-coordinator');
    expect(starts).toHaveLength(1); // only row b
  });

  it('start-coordinator fires without selecting the row; row click selects', () => {
    const onSelect = vi.fn();
    const onStart = vi.fn();
    render(<FleetStatusGrid rows={rows} onSelectProject={onSelect} onStartCoordinator={onStart} />);
    fireEvent.click(screen.getByTestId('fleet-start-coordinator'));
    expect(onStart).toHaveBeenCalledWith('/code/b');
    expect(onSelect).not.toHaveBeenCalled(); // stopPropagation
    fireEvent.click(screen.getByText('a'));
    expect(onSelect).toHaveBeenCalledWith('/code/a');
  });
});
