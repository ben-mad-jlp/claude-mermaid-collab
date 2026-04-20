import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import PinnedTabBar from '../PinnedTabBar';
import { useTabsStore, sessionKey, type TabDescriptor } from '../../../../stores/tabsStore';
import { useSessionStore } from '../../../../stores/sessionStore';

vi.mock('../TabContextMenu', () => ({
  default: (props: { tab: TabDescriptor }) => (
    <div data-testid="tab-context-menu">Tab {props.tab.id}</div>
  ),
}));

function makeTab(
  id: string,
  overrides: Partial<TabDescriptor> = {}
): TabDescriptor {
  return {
    id,
    kind: 'artifact',
    artifactType: 'diagram',
    artifactId: id,
    name: `Tab ${id}`,
    isPreview: false,
    isPinned: false,
    order: 0,
    openedAt: 0,
    ...overrides,
  };
}

function seed(tabs: TabDescriptor[], activeTabId: string | null = null) {
  const cs = useSessionStore.getState().currentSession!;
  const key = sessionKey(cs.project, cs.name);
  useTabsStore.setState({
    bySession: { [key]: { tabs, activeTabId } },
  });
}

describe('PinnedTabBar', () => {
  beforeEach(() => {
    useTabsStore.setState({ bySession: {} });
    localStorage.clear();
    useSessionStore.setState({
      currentSession: { project: '/p', name: 's1' } as any,
    });
  });

  it('renders nothing when no pinned tabs', () => {
    seed([makeTab('t1', { order: 0 })]);
    const { container } = render(<PinnedTabBar />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('pinned-tab-bar')).toBeNull();
  });

  it('renders only pinned tabs', () => {
    seed([
      makeTab('tp1', { isPinned: true, order: 0, name: 'Pinned One' }),
      makeTab('tp2', { isPinned: true, order: 1, name: 'Pinned Two' }),
      makeTab('t1', { isPinned: false, order: 2, name: 'Regular One' }),
    ]);
    render(<PinnedTabBar />);
    expect(screen.getByText('Pinned One')).toBeInTheDocument();
    expect(screen.getByText('Pinned Two')).toBeInTheDocument();
    expect(screen.queryByText('Regular One')).toBeNull();
  });

  it('pinned tabs have no close button', () => {
    seed([
      makeTab('tp1', { isPinned: true, order: 0 }),
      makeTab('tp2', { isPinned: true, order: 1 }),
    ]);
    render(<PinnedTabBar />);
    const bar = screen.getByTestId('pinned-tab-bar');
    const closeButtons = within(bar).queryAllByRole('button', {
      name: /close/i,
    });
    expect(closeButtons).toHaveLength(0);
  });

  it('clicking a pinned tab calls setActive', () => {
    seed(
      [
        makeTab('tp1', { isPinned: true, order: 0, name: 'Pinned One' }),
        makeTab('tp2', { isPinned: true, order: 1, name: 'Pinned Two' }),
      ],
      'tp2'
    );
    render(<PinnedTabBar />);
    fireEvent.click(screen.getByText('Pinned One'));
    const cs = useSessionStore.getState().currentSession!;
    const key = sessionKey(cs.project, cs.name);
    expect(useTabsStore.getState().bySession[key].activeTabId).toBe('tp1');
  });

  it('right-click opens context menu', () => {
    seed([
      makeTab('tp1', { isPinned: true, order: 0, name: 'Pinned One' }),
    ]);
    render(<PinnedTabBar />);
    expect(screen.queryByTestId('tab-context-menu')).toBeNull();
    fireEvent.contextMenu(screen.getByText('Pinned One'));
    const menu = screen.getByTestId('tab-context-menu');
    expect(menu).toBeInTheDocument();
    expect(menu.textContent).toBe('Tab tp1');
  });

  it('ordering preserved by .order', () => {
    // Seed with reversed order numbers: tp1 has order=2, tp2 has order=1, tp3 has order=0
    seed([
      makeTab('tp1', { isPinned: true, order: 2, name: 'Tab tp1' }),
      makeTab('tp2', { isPinned: true, order: 1, name: 'Tab tp2' }),
      makeTab('tp3', { isPinned: true, order: 0, name: 'Tab tp3' }),
    ]);
    render(<PinnedTabBar />);
    const bar = screen.getByTestId('pinned-tab-bar');
    const names = within(bar)
      .getAllByText(/^Tab tp\d$/)
      .map((n) => n.textContent);
    expect(names).toEqual(['Tab tp3', 'Tab tp2', 'Tab tp1']);
  });
});
