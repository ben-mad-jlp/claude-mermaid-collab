import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import TabBar from '../TabBar';
import { useTabsStore, sessionKey, type TabDescriptor } from '../../../../stores/tabsStore';
import { useSessionStore } from '../../../../stores/sessionStore';

const PROJECT = '/p';
const NAME = 's';
const KEY = sessionKey(PROJECT, NAME);

function makeTab(overrides: Partial<TabDescriptor> & { id: string }): TabDescriptor {
  return {
    id: overrides.id,
    kind: 'artifact',
    artifactType: 'diagram',
    artifactId: overrides.id,
    name: overrides.id,
    isPreview: false,
    isPinned: false,
    order: 0,
    openedAt: 0,
    ...overrides,
  };
}

function seedTabs(descriptors: TabDescriptor[], activeTabId: string | null = null) {
  useTabsStore.setState({
    bySession: {
      [KEY]: { tabs: descriptors, activeTabId },
    },
  });
}

describe('TabBar', () => {
  beforeEach(() => {
    useTabsStore.setState({ bySession: {} });
    localStorage.clear();
    useSessionStore.setState({
      currentSession: { project: PROJECT, name: NAME } as any,
    });
  });

  it('renders non-pinned tabs in order, pinned filtered', () => {
    seedTabs(
      [
        makeTab({ id: 't1', order: 0 }),
        makeTab({ id: 't2', order: 1 }),
        makeTab({ id: 't3', order: 2 }),
        makeTab({ id: 'tp', order: 3, isPinned: true }),
      ],
      't1'
    );
    render(<TabBar />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.queryByText('tp')).toBeNull();
    expect(screen.getByText('t1')).toBeTruthy();
    expect(screen.getByText('t2')).toBeTruthy();
    expect(screen.getByText('t3')).toBeTruthy();
  });

  it('clicking a tab calls setActive', () => {
    seedTabs(
      [
        makeTab({ id: 't1', order: 0 }),
        makeTab({ id: 't2', order: 1 }),
      ],
      't1'
    );
    render(<TabBar />);
    const t2 = screen.getByText('t2');
    fireEvent.click(t2);
    expect(useTabsStore.getState().bySession[KEY].activeTabId).toBe('t2');
  });

  it('clicking close button removes tab', () => {
    seedTabs(
      [
        makeTab({ id: 't1', order: 0 }),
        makeTab({ id: 't2', order: 1 }),
      ],
      't1'
    );
    render(<TabBar />);
    // Two close buttons exist — find the one inside t2's tab.
    const t2Label = screen.getByText('t2');
    const t2TabEl = t2Label.closest('[role="tab"]') as HTMLElement;
    expect(t2TabEl).toBeTruthy();
    const closeBtn = t2TabEl.querySelector('button[aria-label="Close tab"]') as HTMLElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    const remaining = useTabsStore.getState().bySession[KEY].tabs;
    expect(remaining.find((t) => t.id === 't2')).toBeUndefined();
  });

  it('empty regularTabs renders no tabs (only pinned seeded)', () => {
    seedTabs(
      [makeTab({ id: 'tp', order: 0, isPinned: true })],
      null
    );
    render(<TabBar />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByText('t2')).toBeNull();
    expect(screen.getByTestId('tab-bar')).toBeTruthy();
  });

  it('container has overflow-x-auto class', () => {
    seedTabs([makeTab({ id: 't1', order: 0 })], 't1');
    render(<TabBar />);
    const bar = screen.getByTestId('tab-bar');
    expect(bar.className).toContain('overflow-x-auto');
  });

  it('active tab has active styling', () => {
    seedTabs(
      [
        makeTab({ id: 't1', order: 0 }),
        makeTab({ id: 't2', order: 1 }),
      ],
      't2'
    );
    render(<TabBar />);
    const t2Label = screen.getByText('t2');
    const t2TabEl = t2Label.closest('[role="tab"]') as HTMLElement;
    const t1Label = screen.getByText('t1');
    const t1TabEl = t1Label.closest('[role="tab"]') as HTMLElement;
    expect(t2TabEl.className).toContain('bg-accent-100');
    expect(t1TabEl.className).not.toContain('bg-accent-100');
  });
});
