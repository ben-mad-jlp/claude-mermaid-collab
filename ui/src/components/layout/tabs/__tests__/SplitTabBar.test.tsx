import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import SplitTabBar from '../SplitTabBar';
import {
  useTabsStore,
  sessionKey,
  type TabDescriptor,
} from '../../../../stores/tabsStore';
import { useSessionStore } from '../../../../stores/sessionStore';

const PROJECT = '/p';
const NAME = 's1';
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

// Single-pane model: flat tab list with an optional rightPaneTabId selecting
// which tab is split off into the right pane (and thus hidden from the main bar).
function seedSession(
  tabs: TabDescriptor[],
  rightPaneTabId: string | null = null
) {
  useTabsStore.setState({
    bySession: {
      [KEY]: {
        tabs,
        activeTabId: tabs[0]?.id ?? null,
        rightPaneTabId,
        activePaneId: 'left',
      },
    },
  } as any);
}

describe('SplitTabBar', () => {
  beforeEach(() => {
    useTabsStore.setState({ bySession: {} } as any);
    localStorage.clear();
    useSessionStore.setState({
      currentSession: { project: PROJECT, name: NAME } as any,
    });
  });

  it('renders a single tab bar wrapper with one TabBar', () => {
    seedSession([makeTab({ id: 'tab1' })]);
    render(<SplitTabBar />);

    expect(screen.getByTestId('single-tab-bar')).toBeTruthy();
    const bars = screen.getAllByTestId('tab-bar');
    expect(bars).toHaveLength(1);
  });

  it('renders all regular tabs in the main TabBar', () => {
    seedSession([
      makeTab({ id: 'l1', name: 'Left-Title' }),
      makeTab({ id: 'r1', name: 'Right-Title', order: 1 }),
    ]);
    render(<SplitTabBar />);

    const bar = screen.getByTestId('tab-bar');
    expect(within(bar).getByText('Left-Title')).toBeTruthy();
    expect(within(bar).getByText('Right-Title')).toBeTruthy();
  });

  it('excludes the right-pane tab from the main TabBar', () => {
    seedSession(
      [
        makeTab({ id: 'lt', name: 'Left-Title' }),
        makeTab({ id: 'rt', name: 'Right-Title', order: 1 }),
      ],
      'rt'
    );
    render(<SplitTabBar />);

    const bar = screen.getByTestId('tab-bar');
    expect(within(bar).getByText('Left-Title')).toBeTruthy();
    // The tab assigned to the right pane is not shown in the main bar.
    expect(within(bar).queryByText('Right-Title')).toBeNull();
  });
});
