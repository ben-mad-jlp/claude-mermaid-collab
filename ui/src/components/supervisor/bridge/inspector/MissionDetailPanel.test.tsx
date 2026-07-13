/**
 * MissionDetailPanel — the daemon-controls (⚙ nodes / provider) panel now lives
 * here, behind the "Daemon controls" toggle, having moved out of the CommandBar
 * header (design feedback 2026-07-13). This test relocates the former
 * CommandBar.nodes coverage: matrix + provider control are absent until the
 * toggle is opened, and present after.
 *
 * serverId="" makes useMissions' fetchMissions short-circuit to [] (store guard),
 * so the panel renders the empty missions state and we focus on the controls.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MissionDetailPanel } from './MissionDetailPanel';

const NODE_PROFILES_BODY = {
  project: '/abs/p',
  claudeModels: ['opus', 'sonnet', 'haiku'],
  grokModels: ['grok-build', 'grok-composer-2.5-fast'],
  providers: ['claude', 'grok-build'],
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  groups: [
    { key: 'floor', label: 'Floor', firesWhen: 'Always — the default code-leaf path.', kinds: ['implement', 'blueprint'], defaultCollapsed: false },
    { key: 'waves', label: 'Waves', firesWhen: 'Only for multi-file manifests.', kinds: ['report', 'review'], defaultCollapsed: true },
  ],
  rows: [
    { kind: 'implement', desc: 'edit code', defaultModel: 'sonnet', defaultEffort: 'medium', modelOverride: null, effortOverride: null, providerOverride: 'grok-build', effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'grok-build', mcpForced: false },
    { kind: 'report', desc: 'file findings', defaultModel: 'sonnet', defaultEffort: 'medium', modelOverride: null, effortOverride: null, providerOverride: null, effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'claude', mcpForced: true },
    { kind: 'blueprint', desc: 'plan work', defaultModel: 'sonnet', defaultEffort: 'medium', modelOverride: null, effortOverride: null, providerOverride: null, effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'claude', mcpForced: false },
    { kind: 'review', desc: 'review changes', defaultModel: 'sonnet', defaultEffort: 'medium', modelOverride: null, effortOverride: null, providerOverride: 'grok-api', effectiveModel: 'grok-4.3', effectiveEffort: 'medium', effectiveProvider: 'grok-api', mcpForced: false },
  ],
};

function mockFetch(url: string): Promise<{ ok: boolean; json: () => Promise<any> }> {
  if (url.includes('/api/orchestrator/node-profiles')) return Promise.resolve({ ok: true, json: () => Promise.resolve(NODE_PROFILES_BODY) });
  if (url.includes('/api/orchestrator/node-provider')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ nodeProvider: 'claude', choices: ['claude', 'grok-build'] }) });
  if (url.includes('/api/leaf-executor/inflight-caps')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ globalMax: 4, projectMax: 2 }) });
  if (url.includes('/api/orchestrator/health')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  if (url.includes('/api/orchestrator/level')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'off' }) });
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
}

afterEach(() => vi.restoreAllMocks());

describe('MissionDetailPanel — daemon controls', () => {
  it('renders the missions header + New mission, controls collapsed by default', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('inspector-missions')).toBeTruthy());

    expect(screen.getByTestId('mission-new-btn')).toBeTruthy();
    expect(screen.getByTestId('mission-controls-toggle')).toBeTruthy();
    // Controls collapsed → matrix + provider control absent.
    expect(screen.queryByTestId('daemon-nodes-matrix')).toBeNull();
    expect(screen.queryByTestId('daemon-provider-control')).toBeNull();
    expect(screen.getByTestId('mission-controls-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('reveals the nodes matrix + provider control on toggle', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('mission-controls-toggle')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mission-controls-toggle'));

    await waitFor(() => expect(screen.getByTestId('daemon-nodes-matrix')).toBeTruthy());
    expect(screen.getByTestId('mission-controls-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('daemon-provider-control')).toBeTruthy();
    expect(screen.getByTestId('daemon-provider-select')).toBeTruthy();
    expect(screen.getByTestId('node-provider-implement')).toBeTruthy();

    // Expand the collapsed "Waves" group to see the MCP-forced (locked) report row.
    fireEvent.click(screen.getByTestId('node-group-header-waves'));
    await waitFor(() => expect(screen.getByTestId('node-provider-report-locked')).toBeTruthy());
    expect(screen.queryByTestId('node-provider-report')).toBeNull();
  });

  it('toggles the controls back closed', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('mission-controls-toggle')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mission-controls-toggle'));
    await waitFor(() => expect(screen.getByTestId('daemon-nodes-matrix')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mission-controls-toggle'));
    await waitFor(() => expect(screen.getByTestId('mission-controls-toggle').getAttribute('aria-expanded')).toBe('false'));
    expect(screen.queryByTestId('daemon-nodes-matrix')).toBeNull();
  });
});
