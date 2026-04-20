import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ArtifactTree } from '../ArtifactTree';
import { useSessionStore } from '../../../../stores/sessionStore';
import { useSidebarTreeStore } from '../../../../stores/sidebarTreeStore';
import { useTabsStore } from '../../../../stores/tabsStore';

/**
 * Integration test for ArtifactTree's click handlers (plain / ctrl / shift).
 * Uses the real sessionStore / sidebarTreeStore / tabsStore; swaps in vi.fn
 * spies for a handful of action methods so we can assert call counts without
 * reimplementing the stores.
 */

// ---- spies ---------------------------------------------------------------
const selectDiagramSpy = vi.fn();
const selectDocumentSpy = vi.fn();
const selectDesignSpy = vi.fn();
const selectSpreadsheetSpy = vi.fn();
const selectSnippetSpy = vi.fn();
const openPreviewSpy = vi.fn();
const openPermanentSpy = vi.fn();

function resetStores() {
  useSessionStore.setState({
    sessions: [],
    currentSession: { project: 'proj', name: 'sess' } as any,
    isLoading: false,
    error: null,
    diagrams: [
      { id: 'd1', name: 'D1', content: '', lastModified: 3 } as any,
      { id: 'd2', name: 'D2', content: '', lastModified: 2 } as any,
      { id: 'd3', name: 'D3', content: '', lastModified: 1 } as any,
    ],
    selectedDiagramId: null,
    documents: [],
    selectedDocumentId: null,
    designs: [],
    selectedDesignId: null,
    spreadsheets: [],
    selectedSpreadsheetId: null,
    snippets: [],
    selectedSnippetId: null,
    embeds: [],
    images: [],
    sessionTodos: [],
    sessionTodosShowCompleted: false,
    sessionTodosFetchSeq: 0,
    collabState: null,
    pendingDiff: null,
    selectDiagram: selectDiagramSpy,
    selectDocument: selectDocumentSpy,
    selectDesign: selectDesignSpy,
    selectSpreadsheet: selectSpreadsheetSpy,
    selectSnippet: selectSnippetSpy,
  } as any);

  useSidebarTreeStore.setState({
    collapsedSections: new Set<string>(),
    showDeprecated: false,
    searchQuery: '',
    forceExpandedSections: new Set<string>(),
    multiSelection: { ids: new Set<string>(), anchorId: null },
  });

  // Replace openPreview / openPermanent with spies
  useTabsStore.setState({
    tabs: [],
    activeTabId: null,
    openPreview: openPreviewSpy,
    openPermanent: openPermanentSpy,
  } as any);
}

function getNode(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-node-id="${id}"]`);
  if (!el) throw new Error(`node with data-node-id="${id}" not found`);
  return el as HTMLElement;
}

describe('ArtifactTree click handling', () => {
  beforeEach(() => {
    selectDiagramSpy.mockClear();
    selectDocumentSpy.mockClear();
    selectDesignSpy.mockClear();
    selectSpreadsheetSpy.mockClear();
    selectSnippetSpy.mockClear();
    openPreviewSpy.mockClear();
    openPermanentSpy.mockClear();
    resetStores();
  });

  it('plain click selects single node, calls selectDiagram + openPreview', () => {
    const { container } = render(<ArtifactTree />);
    fireEvent.click(getNode(container, 'd1'));

    const sel = useSidebarTreeStore.getState().multiSelection;
    expect(Array.from(sel.ids).sort()).toEqual(['d1']);
    expect(sel.anchorId).toBe('d1');
    expect(selectDiagramSpy).toHaveBeenCalledWith('d1');
    expect(openPreviewSpy).toHaveBeenCalledTimes(1);
  });

  it('ctrl-click adds to selection without invoking selectDiagram/openPreview', () => {
    const { container } = render(<ArtifactTree />);
    fireEvent.click(getNode(container, 'd1'));
    expect(openPreviewSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(getNode(container, 'd2'), { ctrlKey: true });

    const sel = useSidebarTreeStore.getState().multiSelection;
    expect(Array.from(sel.ids).sort()).toEqual(['d1', 'd2']);
    // selectDiagram was only called once (for d1), not for d2.
    expect(selectDiagramSpy).toHaveBeenCalledTimes(1);
    expect(selectDiagramSpy).toHaveBeenCalledWith('d1');
    // openPreview only fired once (from the plain click on d1).
    expect(openPreviewSpy).toHaveBeenCalledTimes(1);
  });

  it('ctrl-click on an already-selected node removes it from selection', () => {
    const { container } = render(<ArtifactTree />);
    fireEvent.click(getNode(container, 'd1'));
    fireEvent.click(getNode(container, 'd2'), { ctrlKey: true });
    expect(
      Array.from(useSidebarTreeStore.getState().multiSelection.ids).sort(),
    ).toEqual(['d1', 'd2']);

    fireEvent.click(getNode(container, 'd1'), { ctrlKey: true });

    const sel = useSidebarTreeStore.getState().multiSelection;
    expect(Array.from(sel.ids).sort()).toEqual(['d2']);
  });

  it('shift-click extends from anchor without invoking selectDiagram', () => {
    const { container } = render(<ArtifactTree />);
    // plain click d1: selection={d1}, anchor=d1
    fireEvent.click(getNode(container, 'd1'));
    expect(selectDiagramSpy).toHaveBeenCalledTimes(1);

    // shift-click d3: extend from anchor d1 → d3 in visible order
    fireEvent.click(getNode(container, 'd3'), { shiftKey: true });

    const sel = useSidebarTreeStore.getState().multiSelection;
    expect(Array.from(sel.ids).sort()).toEqual(['d1', 'd2', 'd3']);
    expect(sel.anchorId).toBe('d1');
    // selectDiagram was NOT called again for d3.
    expect(selectDiagramSpy).toHaveBeenCalledTimes(1);
    // openPreview was NOT called again for d3 either.
    expect(openPreviewSpy).toHaveBeenCalledTimes(1);
  });

  it('multi-selected nodes get the ring class applied via isInMultiSelection', () => {
    const { container } = render(<ArtifactTree />);
    fireEvent.click(getNode(container, 'd1'));
    fireEvent.click(getNode(container, 'd2'), { ctrlKey: true });

    const d1 = getNode(container, 'd1');
    const d2 = getNode(container, 'd2');
    const d3 = getNode(container, 'd3');

    expect(d1.className).toContain('ring-2');
    expect(d2.className).toContain('ring-2');
    expect(d3.className).not.toContain('ring-2');
  });
});

describe('ArtifactTree context menu + summary bar', () => {
  beforeEach(() => {
    selectDiagramSpy.mockClear();
    selectDocumentSpy.mockClear();
    selectDesignSpy.mockClear();
    selectSpreadsheetSpy.mockClear();
    selectSnippetSpy.mockClear();
    openPreviewSpy.mockClear();
    openPermanentSpy.mockClear();
    resetStores();
    // Remove lastModified so diagrams don't also appear in the "Recent"
    // section — that would duplicate nodes in allVisibleTreeNodes and
    // inflate the context-menu title count.
    useSessionStore.setState({
      diagrams: [
        { id: 'd1', name: 'D1', content: '' } as any,
        { id: 'd2', name: 'D2', content: '' } as any,
        { id: 'd3', name: 'D3', content: '' } as any,
      ],
    } as any);
  });

  it('right-click on node inside multi-selection opens menu with nodes=selection', () => {
    const { container, queryByTestId } = render(<ArtifactTree />);
    fireEvent.click(getNode(container, 'd1'));
    fireEvent.click(getNode(container, 'd2'), { ctrlKey: true });

    fireEvent.contextMenu(getNode(container, 'd1'));

    const title = queryByTestId('sidebar-node-context-menu-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('2 items selected');
  });

  it('right-click outside selection collapses to single', () => {
    const { container, queryByTestId } = render(<ArtifactTree />);
    fireEvent.click(getNode(container, 'd1'));
    fireEvent.click(getNode(container, 'd2'), { ctrlKey: true });

    fireEvent.contextMenu(getNode(container, 'd3'));

    const sel = useSidebarTreeStore.getState().multiSelection;
    expect(Array.from(sel.ids).sort()).toEqual(['d3']);

    const title = queryByTestId('sidebar-node-context-menu-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('D3');
  });

  it('selection summary bar renders when size > 1 and Clear resets', () => {
    const { container, queryByTestId, getByTestId } = render(<ArtifactTree />);
    fireEvent.click(getNode(container, 'd1'));
    fireEvent.click(getNode(container, 'd2'), { ctrlKey: true });

    const bar = queryByTestId('selection-summary-bar');
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toContain('2 selected');

    const clearBtn = getByTestId('selection-summary-bar').querySelector('button');
    expect(clearBtn).not.toBeNull();
    fireEvent.click(clearBtn!);

    expect(useSidebarTreeStore.getState().multiSelection.ids.size).toBe(0);
    expect(queryByTestId('selection-summary-bar')).toBeNull();
  });

  it('selection summary bar hidden when size <= 1', () => {
    const { container, queryByTestId } = render(<ArtifactTree />);
    fireEvent.click(getNode(container, 'd1'));

    expect(queryByTestId('selection-summary-bar')).toBeNull();
  });
});
