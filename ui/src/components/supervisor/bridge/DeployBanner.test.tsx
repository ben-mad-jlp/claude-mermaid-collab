/**
 * DeployBanner tests — UI-only; the store is mocked. Covers the load-bearing
 * contract: the banner self-hides when the sidecar is NOT stale, shows + offers
 * Deploy when stale & eligible, and shows a blocked note (no button) when the
 * server says the deploy can't run here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DeployBanner } from './DeployBanner';
import type { DeployStatus } from '../../../stores/supervisorStore';

const fetchDeployStatus = vi.fn();
const deploySelf = vi.fn();

// Mock the zustand selector hook: call the selector against a fake store slice.
vi.mock('../../../stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: unknown) => unknown) => sel({ fetchDeployStatus, deploySelf }),
}));

function status(over: Partial<DeployStatus>): DeployStatus {
  return {
    livePid: 1, liveVersion: '5.101.24', liveStartedAt: '2026-06-17T19:00:00Z',
    repoVersion: '5.101.24', repoHead: 'abc1234', uncommittedCount: 0,
    drift: false, selfLandPending: false, lastSelfLandAt: null,
    stale: false, canDeploy: true, deployBlockedReason: null, ...over,
  };
}

afterEach(() => { vi.clearAllMocks(); });

describe('DeployBanner', () => {
  it('renders nothing when the sidecar is not stale', async () => {
    fetchDeployStatus.mockResolvedValue(status({ stale: false }));
    const { container } = render(<DeployBanner project="p" serverScope="local" />);
    await waitFor(() => expect(fetchDeployStatus).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="deploy-banner"]')).toBeNull();
  });

  it('shows the banner + Deploy button when stale and eligible', async () => {
    fetchDeployStatus.mockResolvedValue(status({ stale: true, selfLandPending: true, canDeploy: true }));
    render(<DeployBanner project="p" serverScope="local" />);
    await waitFor(() => expect(screen.getByTestId('deploy-banner')).toBeTruthy());
    expect(screen.getByTestId('deploy-banner-button')).toBeTruthy();
    expect(screen.getByText(/epic landed after this build started/)).toBeTruthy();
  });

  it('shows a blocked note (no button) when not self-project', async () => {
    fetchDeployStatus.mockResolvedValue(status({ stale: true, canDeploy: false, deployBlockedReason: 'not-self-project' }));
    render(<DeployBanner project="p" serverScope="local" />);
    await waitFor(() => expect(screen.getByTestId('deploy-banner')).toBeTruthy());
    expect(screen.queryByTestId('deploy-banner-button')).toBeNull();
    expect(screen.getByText(/self-project only/)).toBeTruthy();
  });
});
