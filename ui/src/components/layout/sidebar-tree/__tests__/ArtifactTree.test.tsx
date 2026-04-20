import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArtifactTree } from '../ArtifactTree';
import { useSessionStore } from '../../../../stores/sessionStore';
import { useSidebarTreeStore } from '../../../../stores/sidebarTreeStore';

function resetStores() {
  useSessionStore.setState({
    sessions: [],
    currentSession: null,
    isLoading: false,
    error: null,
    diagrams: [],
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
  });
  useSidebarTreeStore.setState({
    collapsedSections: new Set<string>(),
    showDeprecated: false,
    searchQuery: '',
    forceExpandedSections: new Set<string>(),
  });
}

function seedSession() {
  useSessionStore.setState({
    currentSession: {
      project: 'proj',
      name: 'sess',
    } as any,
  });
}

describe('ArtifactTree', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders empty state when no session', () => {
    render(<ArtifactTree />);
    expect(screen.getByTestId('sidebar-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('artifact-tree')).toBeNull();
  });

  it('renders tree root and search input', () => {
    seedSession();
    render(<ArtifactTree />);
    expect(screen.getByTestId('artifact-tree')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-search')).toBeInTheDocument();
  });

  it('typing in search updates store', () => {
    seedSession();
    render(<ArtifactTree />);
    const input = screen.getByTestId('sidebar-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(useSidebarTreeStore.getState().searchQuery).toBe('hello');
  });

  it('checkbox toggles showDeprecated', () => {
    seedSession();
    const { container } = render(<ArtifactTree />);
    const checkbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox);
    expect(useSidebarTreeStore.getState().showDeprecated).toBe(true);
  });
});
