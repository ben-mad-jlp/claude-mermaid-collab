/**
 * Campaign store snapshot test — campaigns fold into campaignsByProject from the bridge snapshot.
 *
 * Validates that the store's campaignsByProject state field is correctly populated
 * from a single bridge-snapshot request, and that no additional fetches are made.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';

describe('supervisorStore loadBridgeSnapshot campaigns fold', () => {
  beforeEach(() => {
    useSupervisorStore.setState({
      campaignsByProject: {},
      bridgeSnapshotStateByProject: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fixture: BridgeCampaign[] = [
    {
      id: 'camp-001',
      title: 'Test Campaign',
      goal: 'Test goal',
      createdAt: 1629801600000,
      probes: [
        {
          id: 'probe-001',
          campaignId: 'camp-001',
          kind: 'command',
          environment: 'worktree',
          dependsOn: [],
          declaredPaths: ['src/**'],
          verdict: 'pass',
          command: 'npm test',
          createdAt: 1629801600000,
          lastEvidenceAt: 1629802000000,
          lastEvidence: 'All tests passed',
          lastEvidenceEnvironment: 'worktree',
          lastEvidenceCommitSha: 'abc123def456',
        },
      ],
      ruling: null,
    },
  ];

  it('folds body.campaigns into campaignsByProject from the single bridge-snapshot request', async () => {
    const okJson = (body: unknown) => ({
      ok: true,
      status: 200,
      json: async () => body,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okJson({ campaigns: fixture }),
      ),
    );

    await useSupervisorStore.getState().loadBridgeSnapshot('local', 'P');

    const state = useSupervisorStore.getState();
    expect(state.campaignsByProject.P).toEqual(fixture);
  });

  it('fetch stub records exactly one call to the bridge-snapshot route', async () => {
    const okJson = (body: unknown) => ({
      ok: true,
      status: 200,
      json: async () => body,
    });

    const fetchStub = vi.fn().mockResolvedValue(
      okJson({ campaigns: fixture }),
    );
    vi.stubGlobal('fetch', fetchStub);

    await useSupervisorStore.getState().loadBridgeSnapshot('local', 'P');

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url] = fetchStub.mock.calls[0];
    expect(String(url)).toContain('/api/supervisor/bridge-snapshot');
  });

  it('preserves prior campaignsByProject state when snapshot lacks campaigns', async () => {
    const priorCampaigns: BridgeCampaign[] = [
      {
        id: 'camp-prior',
        title: 'Prior Campaign',
        goal: null,
        createdAt: 1629801000000,
        probes: [],
        ruling: null,
      },
    ];

    useSupervisorStore.setState({ campaignsByProject: { Q: priorCampaigns } });

    const okJson = (body: unknown) => ({
      ok: true,
      status: 200,
      json: async () => body,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okJson({ campaigns: undefined }),
      ),
    );

    await useSupervisorStore.getState().loadBridgeSnapshot('local', 'P');

    const state = useSupervisorStore.getState();
    expect(state.campaignsByProject.P).toBeUndefined();
    expect(state.campaignsByProject.Q).toEqual(priorCampaigns);
  });
});
