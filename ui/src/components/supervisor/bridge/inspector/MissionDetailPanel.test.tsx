/**
 * MissionDetailPanel — the daemon-controls block has MOVED OUT to the
 * ProjectSettingsModal (gear button in the CommandBar header). The mission pane
 * now holds only the mission cards + New mission + show-completed toggle, so this
 * test covers just those surfaces.
 *
 * serverId="" makes useMissions' fetchMissions short-circuit to [] (store guard),
 * so the panel renders the empty missions state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MissionDetailPanel } from './MissionDetailPanel';

function mockFetch(): Promise<{ ok: boolean; json: () => Promise<any> }> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
}

afterEach(() => vi.restoreAllMocks());

describe('MissionDetailPanel — mission list', () => {
  it('renders the missions header + New mission and the empty state', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('inspector-missions')).toBeTruthy());

    expect(screen.getByTestId('mission-new-btn')).toBeTruthy();
    // With no missions the empty prompt shows.
    expect(screen.getByText(/No missions yet/i)).toBeTruthy();
  });

  it('no longer renders the daemon-controls toggle or nodes matrix (moved to settings modal)', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('inspector-missions')).toBeTruthy());

    expect(screen.queryByTestId('mission-controls-toggle')).toBeNull();
    expect(screen.queryByTestId('daemon-nodes-matrix')).toBeNull();
    expect(screen.queryByTestId('daemon-provider-control')).toBeNull();
  });
});
