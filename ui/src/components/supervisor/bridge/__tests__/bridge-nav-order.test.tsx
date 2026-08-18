import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BridgeRail } from '../rail/BridgeRail';
import { BridgeDashboard } from '../BridgeDashboard';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import type { BridgeCampaign } from '@/types/campaign';

vi.mock('../SplitDeck', () => ({
  SplitDeck: ({ rail, stage }: any) => (
    <div>{rail}{stage}</div>
  ),
}));

vi.mock('../stage/BridgeStage', () => ({
  BridgeStage: ({ activePanel }: any) => (
    <div>{activePanel}</div>
  ),
}));

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: vi.fn(() => false),
}));

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onConnect: () => ({ unsubscribe: () => {} }),
    onMessage: () => ({ unsubscribe: () => {} }),
  }),
}));

describe('BridgeRail navigation order', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false } as any));
  });

  it('the campaign link renders above the missions link', () => {
    render(
      <BridgeRail
        onOpenCampaigns={vi.fn()}
        onOpenMissions={vi.fn()}
      />
    );

    const campaigns = screen.getByTestId('bridge-link-campaigns');
    const missions = screen.getByTestId('bridge-link-missions');

    const position = campaigns.compareDocumentPosition(missions);
    expect((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  it('the missions link renders above the plan section', () => {
    render(
      <BridgeRail
        onOpenCampaigns={vi.fn()}
        onOpenMissions={vi.fn()}
      />
    );

    const missions = screen.getByTestId('bridge-link-missions');
    const planSection = screen.getByTestId('rail-section-home');

    const position = missions.compareDocumentPosition(planSection);
    expect((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  it('the missions link opens the missions view', () => {
    const onOpenMissions = vi.fn();
    render(
      <BridgeRail
        onOpenCampaigns={vi.fn()}
        onOpenMissions={onOpenMissions}
      />
    );

    const missions = screen.getByTestId('bridge-link-missions');
    fireEvent.click(missions);

    expect(onOpenMissions).toHaveBeenCalledTimes(1);
  });

  it('the campaign link opens the campaign view', () => {
    const PROJECT = 'test-project';
    const campaignFixture: BridgeCampaign = {
      id: 'camp-test',
      title: 'Test Campaign',
      goal: 'Test goal',
      createdAt: Date.now(),
      probes: [
        {
          id: 'probe-001',
          campaignId: 'camp-test',
          kind: 'command',
          environment: 'worktree',
          dependsOn: [],
          declaredPaths: ['src/**'],
          verdict: 'pass',
          command: 'npm test',
          createdAt: Date.now(),
          lastEvidenceAt: Date.now(),
          lastEvidence: 'All tests passed',
          lastEvidenceEnvironment: 'worktree',
          lastEvidenceCommitSha: 'abc123def456',
        },
      ],
      ruling: null,
    };

    // Setup stores
    useSupervisorStore.setState({
      campaignsByProject: { [PROJECT]: [campaignFixture] },
      escalations: [],
      supervised: [],
      watchedProjects: [],
      todosByProject: {},
      unlandedEpicsByProject: {},
      requirementsByProject: {},
      coverageByProject: {},
      auditByProject: {},
      loadBridgeSnapshot: vi.fn(),
      loadUnlandedEpics: vi.fn(),
      promoteTodo: vi.fn(),
      loadEscalations: vi.fn(),
      loadAudit: vi.fn(),
      loadRequirements: vi.fn(),
    });

    useUIStore.setState({ activeProject: PROJECT });
    useSessionStore.setState({
      currentSession: { serverId: 'local', project: PROJECT, name: 'test-session', status: 'active', lastUpdate: Date.now() },
    });

    render(<BridgeDashboard />);

    // Click the campaign link
    const campaignLink = screen.getByTestId('bridge-link-campaigns');
    fireEvent.click(campaignLink);

    // Assert the campaign view is rendered in the stage
    expect(screen.getByTestId('campaign-unruled')).toBeTruthy();
    expect(screen.getByText('Test Campaign')).toBeTruthy();
  });
});
