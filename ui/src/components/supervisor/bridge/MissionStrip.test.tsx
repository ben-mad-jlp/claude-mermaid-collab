import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MissionStrip } from './MissionStrip';

let mockMissions: any[] = [];

vi.mock('./rail/useMissions', () => ({
  useMissions: () => ({ missions: mockMissions, setMissions: vi.fn(), run: vi.fn(), busy: false }),
}));

const liveMission = {
  node: { id: 'm-live', title: '[MISSION] Live Mission' },
  mission: { active: true, phase: 'execute', iteration: 1, maxIterations: null, description: '', procedure: '' },
  rollup: { phase: 'execute', stopped: false, status: 'building', criteriaMet: 0, criteriaTotal: 2, mechDone: 0, mechTotal: 1 },
  criteria: [{ id: 'c1', text: 'C1', met: false, order: 0 }],
  epics: [],
};

const convergedActiveMission = {
  node: { id: 'm-conv', title: '[MISSION] Converged Mission' },
  mission: { active: true, phase: 'converged', iteration: 3, maxIterations: null, description: '', procedure: '' },
  rollup: { phase: 'converged', stopped: false, status: 'converged', criteriaMet: 2, criteriaTotal: 2, mechDone: 1, mechTotal: 1 },
  criteria: [{ id: 'c2', text: 'C2', met: true, order: 0 }],
  epics: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  mockMissions = [];
});

describe('MissionStrip — terminal-skip selection', () => {
  it('selects the live mission over a converged-but-active mission', () => {
    mockMissions = [convergedActiveMission, liveMission];
    const onOpenMissions = vi.fn();
    render(<MissionStrip serverId="s" project="/p" onOpenMissions={onOpenMissions} />);
    expect(screen.getByText('Live Mission')).toBeTruthy();
    expect(screen.queryByText('Converged Mission')).toBeNull();
  });

  it('renders the clickable idle state when only terminal missions exist', () => {
    mockMissions = [convergedActiveMission];
    const onOpenMissions = vi.fn();
    render(<MissionStrip serverId="s" project="/p" onOpenMissions={onOpenMissions} />);
    const btn = screen.getByTestId('mission-strip');
    expect(screen.getByTestId('mission-strip-idle-label').textContent).toMatch(/No active mission/);
    fireEvent.click(btn);
    expect(onOpenMissions).toHaveBeenCalledTimes(1);
  });

  it('renders the clickable idle state when there are zero missions', () => {
    mockMissions = [];
    const onOpenMissions = vi.fn();
    render(<MissionStrip serverId="s" project="/p" onOpenMissions={onOpenMissions} />);
    const btn = screen.getByTestId('mission-strip');
    expect(screen.getByTestId('mission-strip-idle-label').textContent).toMatch(/No active mission/);
    fireEvent.click(btn);
    expect(onOpenMissions).toHaveBeenCalledTimes(1);
  });
});
