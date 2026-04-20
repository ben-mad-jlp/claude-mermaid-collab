import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import SplitTabBar from '../SplitTabBar';
import {
  useTabsStore,
  sessionKey,
  type TabDescriptor,
  type PaneId,
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

function seedPanes(
  leftTabs: TabDescriptor[],
  rightTabs: TabDescriptor[],
  activePaneId: PaneId = 'left'
) {
  useTabsStore.setState({
    bySession: {
      [KEY]: {
        panes: {
          left: {
            tabs: leftTabs,
            activeTabId: leftTabs[0]?.id ?? null,
          },
          right: {
            tabs: rightTabs,
            activeTabId: rightTabs[0]?.id ?? null,
          },
        },
        activePaneId,
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

  it('renders only left TabBar when right pane is empty', () => {
    seedPanes([makeTab({ id: 'tab1' })], []);
    render(<SplitTabBar />);

    expect(screen.queryByTestId('split-tab-bar')).toBeNull();
    const bars = screen.getAllByTestId('tab-bar');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute('data-pane')).toBe('left');
  });

  it('renders both TabBars when right pane has tabs', () => {
    seedPanes([makeTab({ id: 'l1' })], [makeTab({ id: 'r1' })]);
    render(<SplitTabBar />);

    expect(screen.getByTestId('split-tab-bar')).toBeTruthy();
    const bars = screen.getAllByTestId('tab-bar');
    expect(bars).toHaveLength(2);
    const panes = bars.map((b) => b.getAttribute('data-pane')).sort();
    expect(panes).toEqual(['left', 'right']);
  });

  it("each TabBar renders its own pane's tabs", () => {
    seedPanes(
      [makeTab({ id: 'lt', name: 'Left-Title' })],
      [makeTab({ id: 'rt', name: 'Right-Title' })]
    );
    render(<SplitTabBar />);

    const bars = screen.getAllByTestId('tab-bar');
    const leftBar = bars.find((b) => b.getAttribute('data-pane') === 'left')!;
    const rightBar = bars.find((b) => b.getAttribute('data-pane') === 'right')!;

    expect(within(leftBar).getByText('Left-Title')).toBeTruthy();
    expect(within(leftBar).queryByText('Right-Title')).toBeNull();
    expect(within(rightBar).getByText('Right-Title')).toBeTruthy();
    expect(within(rightBar).queryByText('Left-Title')).toBeNull();
  });
});
