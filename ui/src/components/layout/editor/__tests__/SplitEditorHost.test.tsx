import { describe, it, expect, vi } from 'vitest';
import { buildDragEndHandler } from '../SplitEditorHost';

const makeEvent = (activeId: string, activeData: any, over: any): any => ({
  active: { id: activeId, data: { current: activeData } },
  over,
});

describe('buildDragEndHandler', () => {
  const makeDeps = () => ({
    getTabs: vi.fn(() => [
      { id: 't1' } as any,
      { id: 't2' } as any,
      { id: 't3' } as any,
    ]),
    getRightPaneTabId: vi.fn(() => null as string | null),
    pinTabRight: vi.fn(),
    unpinTabRight: vi.fn(),
    reorderTabs: vi.fn(),
  });

  it('no-op when over is null', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(makeEvent('t1', { tab: { id: 't1' } }, null));
    expect(deps.pinTabRight).not.toHaveBeenCalled();
    expect(deps.reorderTabs).not.toHaveBeenCalled();
  });

  it('no-op when active has no tab data', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(makeEvent('t1', {}, { id: 'editor-half-right', data: { current: { zone: 'editor-half-right' } } }));
    expect(deps.pinTabRight).not.toHaveBeenCalled();
  });

  it('dispatches pinTabRight for cross-pane drop on right half', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(
      makeEvent('t1', { tab: { id: 't1' } }, {
        id: 'editor-half-right',
        data: { current: { zone: 'editor-half-right' } },
      }),
    );
    expect(deps.pinTabRight).toHaveBeenCalledWith('t1');
    expect(deps.reorderTabs).not.toHaveBeenCalled();
  });

  it('no-op when dropping on the same-pane half zone (left) and tab is not right-pinned', () => {
    const deps = makeDeps();
    deps.getRightPaneTabId.mockReturnValue('r1'); // t1 is not the right-pane tab
    buildDragEndHandler(deps)(
      makeEvent('t1', { tab: { id: 't1' } }, {
        id: 'editor-half-left',
        data: { current: { zone: 'editor-half-left' } },
      }),
    );
    expect(deps.unpinTabRight).not.toHaveBeenCalled();
    expect(deps.reorderTabs).not.toHaveBeenCalled();
  });

  it('dispatches unpinTabRight when dropping right-pinned tab on left half', () => {
    const deps = makeDeps();
    deps.getRightPaneTabId.mockReturnValue('t1'); // t1 is the right-pane tab
    buildDragEndHandler(deps)(
      makeEvent('t1', { tab: { id: 't1' } }, {
        id: 'editor-half-left',
        data: { current: { zone: 'editor-half-left' } },
      }),
    );
    expect(deps.unpinTabRight).toHaveBeenCalledWith('t1');
  });

  it('dispatches reorderTabs for intra-pane sortable drop', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(
      makeEvent('t1', { tab: { id: 't1' } }, {
        id: 't3',
        data: { current: {} },
      }),
    );
    expect(deps.reorderTabs).toHaveBeenCalledWith(['t2', 't3', 't1']);
    expect(deps.pinTabRight).not.toHaveBeenCalled();
  });

  it('no-op when sortable drop has same active and over id', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(
      makeEvent('t1', { tab: { id: 't1' } }, {
        id: 't1',
        data: { current: {} },
      }),
    );
    expect(deps.reorderTabs).not.toHaveBeenCalled();
  });
});
