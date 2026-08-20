import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';
import CampaignStrip from '../CampaignStrip';
import { MissionStrip } from '../MissionStrip';

let mockMissions: any[] = [];

vi.mock('../rail/useMissions', () => ({
  useMissions: () => ({
    missions: mockMissions,
    hasLoadedOnce: true,
    status: 'success',
    setMissions: vi.fn(),
    run: vi.fn(),
    busy: false,
  }),
}));

const liveMission = {
  node: { id: 'm-live', title: '[MISSION] Live Mission' },
  mission: { active: true, phase: 'execute', iteration: 1, maxIterations: null, description: '', procedure: '' },
  rollup: { phase: 'execute', stopped: false, status: 'building', criteriaMet: 0, criteriaTotal: 2, mechDone: 0, mechTotal: 1 },
  criteria: [{ id: 'c1', text: 'C1', met: false, order: 0 }],
  epics: [],
};

describe('strip nav icons', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ campaignsByProject: {} });
    mockMissions = [];
  });

  it('renders the campaign nav icon as the first child of the campaign strip line, ahead of the title', () => {
    const fixture: BridgeCampaign[] = [
      {
        id: 'camp-1',
        title: 'Integration Tests',
        goal: null,
        createdAt: 1629801600000,
        droppedAt: null,
        probes: [],
        ruling: null,
      },
    ];

    act(() => {
      useSupervisorStore.setState({ campaignsByProject: { P: fixture } });
    });
    render(<CampaignStrip project="P" onOpenCampaigns={() => {}} />);

    const icon = screen.getByTestId('campaign-nav-icon');
    const line = screen.getByTestId('campaign-strip-line');
    expect(line.firstElementChild).toBe(icon);

    const titleEl = line.querySelector('.font-semibold');
    expect(titleEl).toBeTruthy();
    expect(icon.compareDocumentPosition(titleEl!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the mission nav icon as the first child of the mission strip button, ahead of mission-strip-title', () => {
    mockMissions = [liveMission];
    render(<MissionStrip serverId="s" project="/p" onOpenMissions={() => {}} />);

    const icon = screen.getByTestId('mission-nav-icon');
    const strip = screen.getByTestId('mission-strip');
    expect(strip.firstElementChild).toBe(icon);

    const titleEl = screen.getByTestId('mission-strip-title');
    expect(icon.compareDocumentPosition(titleEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
