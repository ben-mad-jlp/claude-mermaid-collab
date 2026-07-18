/**
 * DaemonNodesMatrix — per-node hybrid PROVIDER column. A non-MCP row gets a provider
 * selector (claude / grok-build); an MCP-forced row is locked to claude; changing a
 * provider POSTs it to node-profiles.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { DaemonNodesMatrix } from './DaemonNodesMatrix';

const GET_BODY = {
  project: '/abs/p',
  claudeModels: ['opus', 'sonnet', 'haiku'],
  grokModels: ['grok-build', 'grok-composer-2.5-fast'],
  providers: ['claude', 'grok-build'],
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  rows: [
    {
      kind: 'implement', desc: 'edit code', defaultModel: 'sonnet', defaultEffort: 'medium',
      modelOverride: null, effortOverride: null, providerOverride: 'grok-build',
      effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'grok-build', mcpForced: false,
    },
    {
      kind: 'report', desc: 'file findings', defaultModel: 'sonnet', defaultEffort: 'medium',
      modelOverride: null, effortOverride: null, providerOverride: null,
      effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'claude', mcpForced: true,
    },
    {
      kind: 'blueprint', desc: 'plan work', defaultModel: 'sonnet', defaultEffort: 'medium',
      modelOverride: null, effortOverride: null, providerOverride: null,
      effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'claude', mcpForced: false,
    },
    {
      kind: 'review', desc: 'review changes', defaultModel: 'sonnet', defaultEffort: 'medium',
      modelOverride: null, effortOverride: null, providerOverride: 'grok-api',
      effectiveModel: 'grok-4.3', effectiveEffort: 'medium', effectiveProvider: 'grok-api', mcpForced: false,
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('DaemonNodesMatrix — provider column', () => {
  it('renders a provider selector for a non-MCP row and locks the MCP-forced row', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(GET_BODY) }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-provider-implement')).toBeTruthy());
    // implement: a real <select> defaulting to its grok override
    expect((screen.getByTestId('node-provider-implement') as HTMLSelectElement).value).toBe('grok-build');
    // report: MCP-forced → locked label, no selector
    expect(screen.getByTestId('node-provider-report-locked')).toBeTruthy();
    expect(screen.queryByTestId('node-provider-report')).toBeNull();
  });

  it('changing a provider POSTs provider to node-profiles', async () => {
    const calls: Array<{ url: string; body?: any }> = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GET_BODY) });
    }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-provider-implement')).toBeTruthy());
    fireEvent.change(screen.getByTestId('node-provider-implement'), { target: { value: 'claude' } });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/node-profiles') && c.body?.kind === 'implement' && c.body?.provider === 'claude')).toBe(true),
    );
  });
});

describe('DaemonNodesMatrix — effort gating', () => {
  it('hides effort select and shows n/a for grok-build and grok-api rows; shows effort select for claude rows', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(GET_BODY) }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    // grok-build row (implement): no effort select, n/a present
    await waitFor(() => expect(screen.getByTestId('node-effort-implement-na')).toBeTruthy());
    expect(screen.queryByTestId('node-effort-implement')).toBeNull();
    // grok-api row (review): no effort select, n/a present
    await waitFor(() => expect(screen.getByTestId('node-effort-review-na')).toBeTruthy());
    expect(screen.queryByTestId('node-effort-review')).toBeNull();
    // claude non-MCP row (blueprint): effort select present
    await waitFor(() => expect(screen.getByTestId('node-effort-blueprint')).toBeTruthy());
    // report (MCP-forced claude) still renders a normal effort select (mcpForced only locks provider)
    expect(screen.getByTestId('node-effort-report')).toBeTruthy();
  });
});

describe('DaemonNodesMatrix — grouped by pipeline', () => {
  const GROUPS_GET_BODY = {
    project: '/abs/p',
    claudeModels: ['opus', 'sonnet', 'haiku'],
    grokModels: ['grok-build', 'grok-composer-2.5-fast'],
    providers: ['claude', 'grok-build'],
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],
    groups: [
      { key: 'floor', label: 'Floor', firesWhen: 'Always — the default code-leaf path.', kinds: ['blueprint', 'implement', 'review'], defaultCollapsed: false },
      { key: 'waves', label: 'Waves', firesWhen: 'Only for multi-file manifests.', kinds: ['research', 'wimplement', 'verify', 'fix'], defaultCollapsed: true },
      { key: 'verify-cad', label: 'Verify / CAD', firesWhen: 'Only for verify/cad leaves.', kinds: ['driveplan', 'driveexec', 'report'], defaultCollapsed: true },
      { key: 'zen', label: 'Zen', firesWhen: 'Session-summary loop.', kinds: ['summary'], defaultCollapsed: true },
    ],
    rows: [
      {
        kind: 'blueprint', desc: 'plan', defaultModel: 'opus', defaultEffort: 'high',
        modelOverride: null, effortOverride: null, providerOverride: null,
        effectiveModel: 'opus', effectiveEffort: 'high', effectiveProvider: 'claude', mcpForced: false,
      },
      {
        kind: 'implement', desc: 'code', defaultModel: 'sonnet', defaultEffort: 'medium',
        modelOverride: null, effortOverride: null, providerOverride: null,
        effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'claude', mcpForced: false,
      },
      {
        kind: 'review', desc: 'review', defaultModel: 'opus', defaultEffort: 'high',
        modelOverride: null, effortOverride: null, providerOverride: null,
        effectiveModel: 'opus', effectiveEffort: 'high', effectiveProvider: 'claude', mcpForced: false,
      },
      {
        kind: 'research', desc: 'investigate', defaultModel: 'sonnet', defaultEffort: 'medium',
        modelOverride: null, effortOverride: null, providerOverride: null,
        effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'claude', mcpForced: false,
      },
    ],
  };

  it('renders all 4 group headers and seeds default collapse (Floor expanded, others collapsed)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(GROUPS_GET_BODY) }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-group-header-floor')).toBeTruthy());
    expect(screen.getByTestId('node-group-header-waves')).toBeTruthy();
    expect(screen.getByTestId('node-group-header-verify-cad')).toBeTruthy();
    expect(screen.getByTestId('node-group-header-zen')).toBeTruthy();
    // Floor rows visible (defaultCollapsed: false)
    expect(screen.getByTestId('node-row-blueprint')).toBeTruthy();
    // Waves row absent (collapsed by default)
    expect(screen.queryByTestId('node-row-research')).toBeNull();
    // Verify/CAD and Zen rows absent (collapsed + no summary row for Zen)
    expect(screen.queryByTestId('node-row-driveplan')).toBeNull();
  });

  it('clicking a collapsed header reveals its rows', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(GROUPS_GET_BODY) }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-group-header-waves')).toBeTruthy());
    expect(screen.queryByTestId('node-row-research')).toBeNull();
    fireEvent.click(screen.getByTestId('node-group-header-waves'));
    await waitFor(() => expect(screen.getByTestId('node-row-research')).toBeTruthy());
  });

  it('Zen header renders the "(not configurable here)" hint when no summary row exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(GROUPS_GET_BODY) }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-group-header-zen')).toBeTruthy());
    // Scope to the Zen group: with a partial rows mock other empty groups also render the
    // hint, so a bare getByText would match multiple. In production node-profiles returns
    // every configurable kind, leaving only Zen (summary) without a row.
    expect(within(screen.getByTestId('node-group-zen')).getByText(/not configurable here/)).toBeTruthy();
  });
});

describe('DaemonNodesMatrix — orchestration group (forge/conductor/planner)', () => {
  const ORCH_GET_BODY = {
    project: '/abs/p',
    claudeModels: ['opus', 'sonnet', 'haiku'],
    grokModels: ['grok-build', 'grok-composer-2.5-fast'],
    providers: ['claude', 'grok-build'],
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],
    groups: [
      { key: 'orchestration', label: 'Orchestration',
        firesWhen: 'Runs ABOVE the per-leaf pipeline, not per-leaf: mission forge (doc → mission), the autonomous conductor (drives a mission tick), and the criterion planner (decomposes a criterion into an epic).',
        kinds: ['forge', 'conductor', 'planner'], defaultCollapsed: false },
    ],
    rows: [
      {
        kind: 'forge', desc: "Derives a mission's acceptance criteria from a design doc.",
        defaultModel: 'opus', defaultEffort: 'high',
        modelOverride: null, effortOverride: null, providerOverride: null,
        effectiveModel: 'opus', effectiveEffort: 'high', effectiveProvider: 'claude', mcpForced: false,
      },
      {
        kind: 'conductor', desc: 'Drives a mission to done — plans, builds, verifies, lands.',
        defaultModel: 'opus', defaultEffort: 'high',
        modelOverride: null, effortOverride: null, providerOverride: null,
        effectiveModel: 'opus', effectiveEffort: 'high', effectiveProvider: 'claude', mcpForced: true,
      },
      {
        kind: 'planner', desc: 'Decomposes a mission criterion into one epic and its leaves.',
        defaultModel: 'opus', defaultEffort: 'high',
        modelOverride: null, effortOverride: null, providerOverride: null,
        effectiveModel: 'opus', effectiveEffort: 'high', effectiveProvider: 'claude', mcpForced: true,
      },
    ],
  };

  it('renders forge/conductor/planner rows under the orchestration group and toggles them on header click', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(ORCH_GET_BODY) }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-group-header-orchestration')).toBeTruthy());
    expect(screen.getByTestId('node-row-forge')).toBeTruthy();
    expect(screen.getByTestId('node-row-conductor')).toBeTruthy();
    expect(screen.getByTestId('node-row-planner')).toBeTruthy();
    fireEvent.click(screen.getByTestId('node-group-header-orchestration'));
    await waitFor(() => expect(screen.queryByTestId('node-row-forge')).toBeNull());
    expect(screen.queryByTestId('node-row-conductor')).toBeNull();
    expect(screen.queryByTestId('node-row-planner')).toBeNull();
  });

  it('model/effort selects render inherit option text sourced from defaults', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(ORCH_GET_BODY) }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-model-forge')).toBeTruthy());
    expect(within(screen.getByTestId('node-model-forge')).getByText('inherit (opus)')).toBeTruthy();
    expect(within(screen.getByTestId('node-effort-forge')).getByText('inherit (high)')).toBeTruthy();
    expect(within(screen.getByTestId('node-model-conductor')).getByText('inherit (opus)')).toBeTruthy();
    expect(within(screen.getByTestId('node-effort-conductor')).getByText('inherit (high)')).toBeTruthy();
    expect(within(screen.getByTestId('node-model-planner')).getByText('inherit (opus)')).toBeTruthy();
    expect(within(screen.getByTestId('node-effort-planner')).getByText('inherit (high)')).toBeTruthy();
  });

  it('changing the forge model POSTs to node-profiles and re-pulls', async () => {
    const calls: Array<{ url: string; body?: any }> = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(ORCH_GET_BODY) });
    }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-model-forge')).toBeTruthy());
    const getCallsBefore = calls.filter((c) => !c.body).length;
    fireEvent.change(screen.getByTestId('node-model-forge'), { target: { value: 'sonnet' } });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.includes('/api/orchestrator/node-profiles') &&
            c.body?.project === '/abs/p' &&
            c.body?.kind === 'forge' &&
            c.body?.model === 'sonnet' &&
            c.body?.effort === null &&
            c.body?.provider === null,
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(calls.filter((c) => !c.body).length).toBeGreaterThan(getCallsBefore));
  });

  it('conductor/planner providers are locked while forge remains an editable select', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(ORCH_GET_BODY) }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-provider-conductor-locked')).toBeTruthy());
    expect(screen.getByTestId('node-provider-planner-locked')).toBeTruthy();
    expect(screen.queryByTestId('node-provider-conductor')).toBeNull();
    expect(screen.queryByTestId('node-provider-planner')).toBeNull();
    const forgeProvider = screen.getByTestId('node-provider-forge') as HTMLSelectElement;
    expect(forgeProvider.tagName).toBe('SELECT');
  });
});

describe('DaemonNodesMatrix — broadcast confirmation dialog', () => {
  it('declining the dialog does not POST the broadcast', async () => {
    const calls: Array<{ url: string; body?: any }> = [];
    const confirmSpy = vi.spyOn(window, 'confirm');
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes('/api/projects')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ projects: [{ path: '/abs/p' }, { path: '/abs/a' }, { path: '/abs/b' }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GET_BODY) });
    }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-profiles-broadcast')).toBeTruthy());
    fireEvent.click(screen.getByTestId('node-profiles-broadcast'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.every((c) => !c.url.includes('/node-profiles/broadcast'))).toBe(true);
  });

  it('the dialog names the affected projects and their count', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/api/projects')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ projects: [{ path: '/abs/p' }, { path: '/abs/a' }, { path: '/abs/b' }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GET_BODY) });
    }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-profiles-broadcast')).toBeTruthy());
    fireEvent.click(screen.getByTestId('node-profiles-broadcast'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('broadcast-confirm-count')).toHaveTextContent('2');
    const targetsSpan = within(dialog).getByTestId('broadcast-confirm-targets');
    expect(targetsSpan.textContent).toContain('/abs/a');
    expect(targetsSpan.textContent).toContain('/abs/b');
    expect(targetsSpan.textContent).not.toContain('/abs/p');
  });

  it('confirming issues the broadcast POST', async () => {
    const calls: Array<{ url: string; body?: any }> = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes('/api/projects')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ projects: [{ path: '/abs/p' }, { path: '/abs/a' }, { path: '/abs/b' }] }) });
      }
      if (url.includes('/node-profiles/broadcast')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ applied: 2 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GET_BODY) });
    }) as any;
    render(<DaemonNodesMatrix project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('node-profiles-broadcast')).toBeTruthy());
    fireEvent.click(screen.getByTestId('node-profiles-broadcast'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByText('Overwrite all projects'));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/node-profiles/broadcast') && c.body?.project === '/abs/p')).toBe(true),
    );
    await waitFor(() => expect(screen.getByText('Applied to 2 projects.')).toBeTruthy());
  });
});
