/**
 * SignalsStrip tests — covers the load-bearing contract: zero height when both
 * banners are empty, and full-width when either has content to show. Proves the
 * banner's polling continues even when hidden so staleness can flip visibility.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SignalsStrip } from './SignalsStrip';
import type { DeployStatus, Requirement } from '@/stores/supervisorStore';

const fetchDeployStatus = vi.fn();
const deploySelf = vi.fn();
const decideRequirement = vi.fn();

// Mock the store: zustand selector hook calls the selector against a fake slice.
vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: unknown) => unknown) =>
    sel({ fetchDeployStatus, deploySelf, decideRequirement }),
}));

function status(over: Partial<DeployStatus>): DeployStatus {
  return {
    livePid: 1,
    liveVersion: '5.101.24',
    liveStartedAt: '2026-06-17T19:00:00Z',
    repoVersion: '5.101.24',
    repoHead: 'abc1234',
    uncommittedCount: 0,
    drift: false,
    selfLandPending: false,
    lastSelfLandAt: null,
    versionDrift: false,
    modifiedTrackedCount: 0,
    stale: false,
    canDeploy: true,
    deployBlockedReason: null,
    ...over,
  };
}

function req(p: Partial<Requirement>): Requirement {
  return {
    id: p.id ?? 'r1',
    project: 'P',
    epicId: null,
    kind: 'performance',
    status: 'proposed',
    title: 'latency',
    rationale: null,
    spec: { metric: 'latency', op: '<=', target: 150 },
    supersededBy: null,
    linkedTodos: [],
    approvedBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...p,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SignalsStrip', () => {
  it('renders zero height when both banners are empty', async () => {
    fetchDeployStatus.mockResolvedValue(status({ stale: false }));
    const { container } = render(
      <SignalsStrip requirements={[]} project="P" serverScope="local" />,
    );
    await waitFor(() => expect(fetchDeployStatus).toHaveBeenCalled());

    expect(container.querySelector('[data-testid="signals-strip"]')).toBeNull();
    expect(container.querySelector('[data-testid="deploy-banner"]')).toBeNull();
    expect(container.querySelector('[data-testid="requirements-inbox"]')).toBeNull();

    const idleWrapper = container.querySelector('[data-testid="signals-strip-idle"]');
    expect(idleWrapper).toBeInTheDocument();
    expect(idleWrapper).toHaveAttribute('hidden');
  });

  it('renders full-width when the inbox has requirements', async () => {
    fetchDeployStatus.mockResolvedValue(status({ stale: false }));
    const { container } = render(
      <SignalsStrip requirements={[req({ id: 'a' })]} project="P" serverScope="local" />,
    );
    await waitFor(() => expect(fetchDeployStatus).toHaveBeenCalled());

    const strip = container.querySelector('[data-testid="signals-strip"]');
    expect(strip).toBeInTheDocument();
    expect(strip).toHaveClass('w-full');

    expect(container.querySelector('[data-testid="requirements-inbox"]')).toBeInTheDocument();
  });

  it('renders full-width when the sidecar is stale', async () => {
    fetchDeployStatus.mockResolvedValue(
      status({ stale: true, selfLandPending: true, canDeploy: true }),
    );
    render(
      <SignalsStrip requirements={[]} project="P" serverScope="local" />,
    );

    const strip = await screen.findByTestId('signals-strip');
    expect(strip).toHaveClass('w-full');
    expect(screen.getByTestId('deploy-banner')).toBeInTheDocument();
  });
});
