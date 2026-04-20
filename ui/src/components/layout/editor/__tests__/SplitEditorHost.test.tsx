import { describe, it, expect, vi } from 'vitest';
import { buildDragEndHandler } from '../SplitEditorHost';

const makeEvent = (activeId: string, activeData: any, over: any): any => ({
  active: { id: activeId, data: { current: activeData } },
  over,
});

describe('buildDragEndHandler', () => {
  const makeDeps = () => ({
    getPaneTabs: vi.fn(() => ({
      left: [{ id: 't1' } as any, { id: 't2' } as any, { id: 't3' } as any],
      right: [{ id: 'r1' } as any],
    })),
    moveTabBetweenPanes: vi.fn(),
    reorderTabs: vi.fn(),
  });

  it('no-op when over is null', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(makeEvent('t1', { tab: { id: 't1' }, pane: 'left' }, null));
    expect(deps.moveTabBetweenPanes).not.toHaveBeenCalled();
    expect(deps.reorderTabs).not.toHaveBeenCalled();
  });

  it('no-op when active has no pane data', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(makeEvent('t1', {}, { id: 'editor-half-right', data: { current: { zone: 'editor-half-right' } } }));
    expect(deps.moveTabBetweenPanes).not.toHaveBeenCalled();
  });

  it('dispatches moveTabBetweenPanes for cross-pane drop on right half', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(
      makeEvent('t1', { tab: { id: 't1' }, pane: 'left' }, {
        id: 'editor-half-right',
        data: { current: { zone: 'editor-half-right' } },
      }),
    );
    expect(deps.moveTabBetweenPanes).toHaveBeenCalledWith('t1', 'left', 'right');
    expect(deps.reorderTabs).not.toHaveBeenCalled();
  });

  it('no-op when dropping on the same-pane half zone', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(
      makeEvent('t1', { tab: { id: 't1' }, pane: 'left' }, {
        id: 'editor-half-left',
        data: { current: { zone: 'editor-half-left' } },
      }),
    );
    expect(deps.moveTabBetweenPanes).not.toHaveBeenCalled();
  });

  it('dispatches reorderTabs for intra-pane sortable drop', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(
      makeEvent('t1', { tab: { id: 't1' }, pane: 'left' }, {
        id: 't3',
        data: { current: {} },
      }),
    );
    expect(deps.reorderTabs).toHaveBeenCalledWith(['t2', 't3', 't1'], 'left');
    expect(deps.moveTabBetweenPanes).not.toHaveBeenCalled();
  });

  it('no-op when sortable drop has same active and over id', () => {
    const deps = makeDeps();
    buildDragEndHandler(deps)(
      makeEvent('t1', { tab: { id: 't1' }, pane: 'left' }, {
        id: 't1',
        data: { current: {} },
      }),
    );
    expect(deps.reorderTabs).not.toHaveBeenCalled();
  });
});
