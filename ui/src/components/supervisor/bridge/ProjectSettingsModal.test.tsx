/**
 * ProjectSettingsModal — the single home for all per-project daemon settings.
 * Verifies open/close gating and the prompt-injection toggles' GET-seed +
 * POST-on-change round-trip. Embedded controls (autonomy ladder, concurrency,
 * nodes matrix/provider, watchdog, context-recycle) hit their own routes, all
 * mocked here so the modal mounts cleanly.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProjectSettingsModal } from './ProjectSettingsModal';

const NODE_PROFILES_BODY = {
  project: '/abs/p',
  claudeModels: ['opus', 'sonnet', 'haiku'],
  grokModels: ['grok-build', 'grok-composer-2.5-fast'],
  providers: ['claude', 'grok-build'],
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  groups: [
    { key: 'floor', label: 'Floor', firesWhen: 'Always.', kinds: ['implement', 'blueprint'], defaultCollapsed: false },
    { key: 'waves', label: 'Waves', firesWhen: 'Multi-file.', kinds: ['report', 'review'], defaultCollapsed: true },
  ],
  rows: [
    { kind: 'implement', desc: 'edit code', defaultModel: 'sonnet', defaultEffort: 'medium', modelOverride: null, effortOverride: null, providerOverride: 'grok-build', effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'grok-build', mcpForced: false },
    { kind: 'blueprint', desc: 'plan work', defaultModel: 'sonnet', defaultEffort: 'medium', modelOverride: null, effortOverride: null, providerOverride: null, effectiveModel: 'sonnet', effectiveEffort: 'medium', effectiveProvider: 'claude', mcpForced: false },
  ],
};

// Mutable server-side injection-flag state; POST mutates it and echoes it back.
let flagState = { digest: false, retryContext: false, activeConstraints: false };
let conductorEnabled = false;
let conductorTargetMissionId: string | null = null;

function mockFetch(url: string, init?: any): Promise<{ ok: boolean; json: () => Promise<any> }> {
  const method = init?.method ?? 'GET';
  const json = (body: any) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

  if (url.includes('/api/orchestrator/node-profiles')) return json(NODE_PROFILES_BODY);
  if (url.includes('/api/orchestrator/node-provider')) return json({ nodeProvider: 'claude', choices: ['claude', 'grok-build'] });
  if (url.includes('/api/leaf-executor/inflight-caps')) return json({ globalMax: 4, projectMax: 2 });
  if (url.includes('/api/orchestrator/health')) return json({ running: true });
  if (url.includes('/api/orchestrator/level')) return json({ level: 'off' });
  if (url.includes('/api/supervisor/watchdog-threshold')) return json({ project: '/abs/p', thresholdPercent: null, default: 80 });
  if (url.includes('/api/supervisor/context-recycle')) return json({ project: '/abs/p', mode: 'off' });
  if (url.includes('/api/supervisor/injection-flags')) {
    if (method === 'POST') {
      const { flag, value } = JSON.parse(init.body);
      flagState = { ...flagState, [flag]: value };
      return json({ ok: true, project: '/abs/p', ...flagState });
    }
    return json({ project: '/abs/p', ...flagState });
  }
  if (url.includes('/api/supervisor/conductor')) {
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      if ('enabled' in body) conductorEnabled = body.enabled;
      if ('targetMissionId' in body) conductorTargetMissionId = body.targetMissionId;
      return json({ ok: true, project: '/abs/p', enabled: conductorEnabled, targetMissionId: conductorTargetMissionId });
    }
    return json({ project: '/abs/p', enabled: conductorEnabled, targetMissionId: conductorTargetMissionId });
  }
  return json({});
}

afterEach(() => {
  vi.restoreAllMocks();
  flagState = { digest: false, retryContext: false, activeConstraints: false };
  conductorEnabled = false;
  conductorTargetMissionId = null;
});

describe('ProjectSettingsModal', () => {
  it('renders nothing when open=false', () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<ProjectSettingsModal project="/abs/p" open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('project-settings-modal')).toBeNull();
  });

  it('renders the modal + the three injection toggles when open', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<ProjectSettingsModal project="/abs/p" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('project-settings-modal')).toBeTruthy());
    expect(screen.getByTestId('inject-flag-digest')).toBeTruthy();
    expect(screen.getByTestId('inject-flag-retryContext')).toBeTruthy();
    expect(screen.getByTestId('inject-flag-activeConstraints')).toBeTruthy();
  });

  it('toggling inject-flag-digest POSTs and reflects the new value', async () => {
    const fetchMock = vi.fn(mockFetch as any);
    global.fetch = fetchMock as any;
    render(<ProjectSettingsModal project="/abs/p" open onClose={() => {}} />);

    const digest = await screen.findByTestId('inject-flag-digest');
    expect((digest as HTMLInputElement).checked).toBe(false);

    fireEvent.click(digest);

    await waitFor(() => expect((screen.getByTestId('inject-flag-digest') as HTMLInputElement).checked).toBe(true));

    // A POST to injection-flags with the digest flag fired.
    const posted = fetchMock.mock.calls.some(
      ([u, init]: any[]) =>
        typeof u === 'string' &&
        u.includes('/api/supervisor/injection-flags') &&
        init?.method === 'POST' &&
        JSON.parse(init.body).flag === 'digest' &&
        JSON.parse(init.body).value === true,
    );
    expect(posted).toBe(true);
  });

  it('renders the conductor toggle unchecked and POSTs on click', async () => {
    const fetchMock = vi.fn(mockFetch as any);
    global.fetch = fetchMock as any;
    render(<ProjectSettingsModal project="/abs/p" open onClose={() => {}} />);

    const toggle = await screen.findByTestId('conductor-toggle');
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle);

    await waitFor(() => expect((screen.getByTestId('conductor-toggle') as HTMLInputElement).checked).toBe(true));

    const posted = fetchMock.mock.calls.some(
      ([u, init]: any[]) =>
        typeof u === 'string' &&
        u.includes('/api/supervisor/conductor') &&
        init?.method === 'POST' &&
        JSON.parse(init.body).project === '/abs/p' &&
        JSON.parse(init.body).enabled === true,
    );
    expect(posted).toBe(true);
  });

  it('shows "none" when no conductor target is pinned', async () => {
    global.fetch = vi.fn(mockFetch as any);
    render(<ProjectSettingsModal project="/abs/p" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('conductor-target-value')).toBeTruthy());
    expect(screen.getByTestId('conductor-target-value').textContent).toBe('none');
  });

  it('shows the short mission id when a conductor target is pinned', async () => {
    conductorTargetMissionId = 'm1234567-89ab-cdef';
    global.fetch = vi.fn(mockFetch as any);
    render(<ProjectSettingsModal project="/abs/p" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('conductor-target-value').textContent).toBe('m1234567'));
  });

  it('Clear invokes setConductorTarget with null and reverts the value to "none"', async () => {
    conductorTargetMissionId = 'm1234567-89ab-cdef';
    const fetchMock = vi.fn(mockFetch as any);
    global.fetch = fetchMock as any;
    render(<ProjectSettingsModal project="/abs/p" open onClose={() => {}} />);

    const clearBtn = await screen.findByTestId('conductor-target-clear');
    await waitFor(() => expect((clearBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(clearBtn);

    await waitFor(() => expect(screen.getByTestId('conductor-target-value').textContent).toBe('none'));

    const posted = fetchMock.mock.calls.some(
      ([u, init]: any[]) =>
        typeof u === 'string' &&
        u.includes('/api/supervisor/conductor') &&
        init?.method === 'POST' &&
        JSON.parse(init.body).project === '/abs/p' &&
        JSON.parse(init.body).targetMissionId === null,
    );
    expect(posted).toBe(true);
  });
});
