/**
 * DaemonNodesMatrix — per-node hybrid PROVIDER column. A non-MCP row gets a provider
 * selector (claude / grok-build); an MCP-forced row is locked to claude; changing a
 * provider POSTs it to node-profiles.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
