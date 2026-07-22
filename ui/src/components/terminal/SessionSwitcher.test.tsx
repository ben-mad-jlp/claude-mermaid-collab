/**
 * SessionSwitcher — lists every OPEN terminal session across servers with a
 * liveness dot derived inline from existing subscription freshness, and flips the
 * console (onSelect) on click. No new WS/polling is introduced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionSwitcher } from './SessionSwitcher';
import type { TerminalTab } from '@/stores/terminalStore';

// Fake store state driven per-test.
let subscriptions: Record<string, any> = {};
let todosByProject: Record<string, any[]> = {};
let servers: any[] = [];

vi.mock('@/stores/subscriptionStore', () => ({
  useSubscriptionStore: (sel: (s: any) => any) => sel({ subscriptions }),
}));
vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: any) => any) => sel({ todosByProject }),
}));
vi.mock('@/contexts/ServerContext', () => ({
  useServers: () => ({ servers }),
}));
vi.mock('@/components/ServerIcon', () => ({
  ServerIcon: () => <span data-testid="server-icon" />,
}));

const tab = (over: Partial<TerminalTab>): TerminalTab => ({
  id: 'id-' + (over.session ?? 's'),
  title: over.session ?? 's',
  session: 's',
  project: '/repo',
  tmuxName: 'tmux',
  serverId: 'local',
  serverLabel: 'Local',
  ...over,
});

beforeEach(() => {
  subscriptions = {};
  todosByProject = {};
  servers = [{ id: 'local', label: 'Local', source: 'local', host: '127.0.0.1' }];
});

describe('SessionSwitcher', () => {
  it('lists open sessions across servers', () => {
    render(
      <SessionSwitcher
        tabs={[
          tab({ session: 'backend-1', title: 'backend-1' }),
          tab({ session: 'ui-1', title: 'ui-1', serverId: 'remote', serverLabel: 'Remote' }),
        ]}
        activeTabId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('switcher-row-backend-1')).toBeTruthy();
    expect(screen.getByTestId('switcher-row-ui-1')).toBeTruthy();
  });

  it('derives the dot from the matching subscription status (amber when active)', () => {
    subscriptions = {
      'local:/repo:backend-1': {
        serverId: 'local', project: '/repo', session: 'backend-1',
        status: 'active', lastUpdate: Date.now(),
      },
    };
    render(
      <SessionSwitcher
        tabs={[tab({ session: 'backend-1', title: 'backend-1' })]}
        activeTabId={null}
        onSelect={() => {}}
      />,
    );
    const dot = screen.getByTestId('switcher-row-backend-1').querySelector('span[aria-hidden="true"]');
    expect(dot?.className).toContain('bg-warning-500');
  });

  it('shows a grey dot for a session with no subscription', () => {
    render(
      <SessionSwitcher
        tabs={[tab({ session: 'backend-1', title: 'backend-1' })]}
        activeTabId={null}
        onSelect={() => {}}
      />,
    );
    const dot = screen.getByTestId('switcher-row-backend-1').querySelector('span[aria-hidden="true"]');
    expect(dot?.className).toContain('bg-gray-300');
  });

  it('flips the console (onSelect with the tab id) on click', () => {
    const onSelect = vi.fn();
    render(
      <SessionSwitcher
        tabs={[tab({ id: 'tab-be', session: 'backend-1', title: 'backend-1' })]}
        activeTabId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('switcher-row-backend-1'));
    expect(onSelect).toHaveBeenCalledWith('tab-be');
  });
});
