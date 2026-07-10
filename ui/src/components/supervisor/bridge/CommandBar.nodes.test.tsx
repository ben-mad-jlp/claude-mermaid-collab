/**
 * CommandBar — ⚙ nodes panel toggle and rendering test. Verifies the panel
 * is absent when closed and renders the expected components when open.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CommandBar } from './CommandBar';

const NODE_PROFILES_BODY = {
  project: '/abs/p',
  claudeModels: ['opus', 'sonnet', 'haiku'],
  grokModels: ['grok-build', 'grok-composer-2.5-fast'],
  providers: ['claude', 'grok-build'],
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  groups: [
    {
      key: 'floor',
      label: 'Floor',
      firesWhen: 'Always — the default code-leaf path.',
      kinds: ['implement', 'blueprint'],
      defaultCollapsed: false,
    },
    {
      key: 'waves',
      label: 'Waves',
      firesWhen: 'Only for multi-file manifests.',
      kinds: ['report', 'review'],
      defaultCollapsed: true,
    },
  ],
  rows: [
    {
      kind: 'implement',
      desc: 'edit code',
      defaultModel: 'sonnet',
      defaultEffort: 'medium',
      modelOverride: null,
      effortOverride: null,
      providerOverride: 'grok-build',
      effectiveModel: 'sonnet',
      effectiveEffort: 'medium',
      effectiveProvider: 'grok-build',
      mcpForced: false,
    },
    {
      kind: 'report',
      desc: 'file findings',
      defaultModel: 'sonnet',
      defaultEffort: 'medium',
      modelOverride: null,
      effortOverride: null,
      providerOverride: null,
      effectiveModel: 'sonnet',
      effectiveEffort: 'medium',
      effectiveProvider: 'claude',
      mcpForced: true,
    },
    {
      kind: 'blueprint',
      desc: 'plan work',
      defaultModel: 'sonnet',
      defaultEffort: 'medium',
      modelOverride: null,
      effortOverride: null,
      providerOverride: null,
      effectiveModel: 'sonnet',
      effectiveEffort: 'medium',
      effectiveProvider: 'claude',
      mcpForced: false,
    },
    {
      kind: 'review',
      desc: 'review changes',
      defaultModel: 'sonnet',
      defaultEffort: 'medium',
      modelOverride: null,
      effortOverride: null,
      providerOverride: 'grok-api',
      effectiveModel: 'grok-4.3',
      effectiveEffort: 'medium',
      effectiveProvider: 'grok-api',
      mcpForced: false,
    },
  ],
};

function mockFetch(url: string): Promise<{ ok: boolean; json: () => Promise<any> }> {
  if (url.includes('/api/orchestrator/node-profiles')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(NODE_PROFILES_BODY) });
  }
  if (url.includes('/api/orchestrator/node-provider')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ nodeProvider: 'claude', choices: ['claude', 'grok-build'] }) });
  }
  if (url.includes('/api/leaf-executor/inflight-caps')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ globalMax: 4, projectMax: 2 }) });
  }
  if (url.includes('/api/orchestrator/health')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }
  if (url.includes('/api/orchestrator/level')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'off' }) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
}

afterEach(() => vi.restoreAllMocks());

describe('CommandBar — ⚙ nodes panel', () => {
  it('closed by default', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<CommandBar liveCount={1} inflightCount={0} needsYouCount={0} project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('bridge-nodes-toggle')).toBeTruthy());

    expect(screen.queryByTestId('daemon-nodes-matrix')).toBeNull();
    expect(screen.queryByTestId('daemon-provider-control')).toBeNull();
    expect(screen.queryByTestId('node-profiles-broadcast')).toBeNull();
    expect(screen.getByTestId('bridge-nodes-toggle').getAttribute('data-open')).toBe('false');
  });

  it('opens on click', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<CommandBar liveCount={1} inflightCount={0} needsYouCount={0} project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('bridge-nodes-toggle')).toBeTruthy());

    fireEvent.click(screen.getByTestId('bridge-nodes-toggle'));

    await waitFor(() => expect(screen.getByTestId('daemon-nodes-matrix')).toBeTruthy());
    expect(screen.getByTestId('bridge-nodes-toggle').getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('daemon-provider-control')).toBeTruthy();
    expect(screen.getByTestId('daemon-provider-select')).toBeTruthy();
    expect(screen.getByTestId('node-provider-implement')).toBeTruthy();

    // Expand the collapsed "Waves" group to see the MCP-forced report row
    fireEvent.click(screen.getByTestId('node-group-header-waves'));
    await waitFor(() => expect(screen.getByTestId('node-provider-report-locked')).toBeTruthy());
    expect(screen.queryByTestId('node-provider-report')).toBeNull();

    const broadcastBtn = screen.getByTestId('node-profiles-broadcast');
    expect(broadcastBtn).toBeTruthy();
    expect(broadcastBtn.textContent).toContain('Push to all projects');
    expect(broadcastBtn.className).toContain('border-danger-300');
    expect(broadcastBtn.className).toContain('text-danger-700');
  });

  it('toggles back closed', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<CommandBar liveCount={1} inflightCount={0} needsYouCount={0} project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('bridge-nodes-toggle')).toBeTruthy());

    fireEvent.click(screen.getByTestId('bridge-nodes-toggle'));
    await waitFor(() => expect(screen.getByTestId('daemon-nodes-matrix')).toBeTruthy());

    fireEvent.click(screen.getByTestId('bridge-nodes-toggle'));
    await waitFor(() => expect(screen.getByTestId('bridge-nodes-toggle').getAttribute('data-open')).toBe('false'));
    expect(screen.queryByTestId('daemon-nodes-matrix')).toBeNull();
  });

  it('no toggle without a project', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<CommandBar liveCount={1} inflightCount={0} needsYouCount={0} />);
    // Wait for the component to render
    await waitFor(() => expect(screen.getByTestId('bridge-command-bar')).toBeTruthy());

    expect(screen.queryByTestId('bridge-nodes-toggle')).toBeNull();
    expect(screen.queryByTestId('daemon-nodes-matrix')).toBeNull();
  });
});
