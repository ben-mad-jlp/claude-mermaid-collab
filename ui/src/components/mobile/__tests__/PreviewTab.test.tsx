/**
 * PreviewTab Component Integration Tests
 *
 * Additional integration tests for the mobile full-screen preview tab component.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewTab, PreviewTabProps } from '../PreviewTab';
import { useSessionStore } from '@/stores/sessionStore';
import { useDataLoader } from '@/hooks/useDataLoader';
import { Item } from '@/types';

// Mock the preview components
vi.mock('@/components/editors/MermaidPreview', () => ({
  MermaidPreview: ({ content }: { content: string }) => (
    <div data-testid="mermaid-preview-mock">Mermaid: {content}</div>
  ),
}));

vi.mock('@/components/editors/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview-mock">Markdown: {content}</div>
  ),
}));

vi.mock('../ItemDrawer', () => ({
  ItemDrawer: ({
    isOpen,
    onClose,
    items,
    selectedItemId,
    onItemSelect,
  }: {
    isOpen: boolean;
    onClose: () => void;
    items: Item[];
    selectedItemId: string | null;
    onItemSelect: (item: Item) => void;
  }) => (
    <div data-testid="item-drawer-mock">
      {isOpen && (
        <>
          <button onClick={onClose} data-testid="drawer-close-btn">
            Close
          </button>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onItemSelect(item)}
              data-testid={`drawer-item-${item.id}`}
            >
              {item.name}
            </button>
          ))}
        </>
      )}
    </div>
  ),
}));

vi.mock('@/hooks/useDataLoader', () => ({
  useDataLoader: () => ({
    selectDiagramWithContent: vi.fn(),
    selectDocumentWithContent: vi.fn(),
  }),
}));

describe('PreviewTab Integration', () => {
  const mockDiagram1 = {
    id: 'diagram-1',
    name: 'Flow Chart',
    content: 'flowchart LR; A --> B',
    lastModified: Date.now() - 3600000,
  };

  const mockDiagram2 = {
    id: 'diagram-2',
    name: 'State Machine',
    content: 'stateDiagram-v2; [*] --> A; A --> B',
    lastModified: Date.now() - 7200000,
  };

  const mockDoc1 = {
    id: 'doc-1',
    name: 'README',
    content: '# Project README\n\nThis is the README.',
    lastModified: Date.now(),
  };

  const mockDoc2 = {
    id: 'doc-2',
    name: 'Design Notes',
    content: '# Design Notes\n\nSome notes.',
    lastModified: Date.now() - 1800000,
  };

  const mockSession = {
    project: 'test-project',
    name: 'Test Session',
    phase: 'executing' as const,
    lastActivity: new Date().toISOString(),
    itemCount: 4,
    id: 'test-session',
    displayName: 'Test Session',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      diagrams: [],
      documents: [],
      selectedDiagramId: null,
      selectedDocumentId: null,
      currentSession: null,
    });
  });

  describe('Workflow: Browse and Select Items', () => {
    it('should allow browsing and selecting multiple items in sequence', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram1, mockDiagram2],
        documents: [mockDoc1, mockDoc2],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });

      render(<PreviewTab />);

      // Start with diagram-1
      expect(screen.getByTestId('mermaid-preview-mock')).toHaveTextContent('flowchart LR; A --> B');

      // Open drawer
      fireEvent.click(screen.getByTestId('preview-browse-button'));
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-diagram-2')).toBeInTheDocument();
      });

      // Select diagram-2
      fireEvent.click(screen.getByTestId('drawer-item-diagram-2'));

      // Update selection in store
      useSessionStore.setState({
        selectedDiagramId: 'diagram-2',
      });

      // Should now show diagram-2 content
      await waitFor(() => {
        expect(screen.getByTestId('mermaid-preview-mock')).toHaveTextContent('stateDiagram-v2; [*] --> A; A --> B');
      });

      // Open drawer again
      fireEvent.click(screen.getByTestId('preview-browse-button'));
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-doc-1')).toBeInTheDocument();
      });

      // Select document
      fireEvent.click(screen.getByTestId('drawer-item-doc-1'));

      // Update selection in store
      useSessionStore.setState({
        selectedDiagramId: null,
        selectedDocumentId: 'doc-1',
      });

      // Should now show document content
      await waitFor(() => {
        expect(screen.getByTestId('markdown-preview-mock')).toHaveTextContent('# Project README');
      });
    });
  });

  describe('State Management', () => {
    it('should maintain drawer state independently from item selection', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram1, mockDiagram2],
        documents: [mockDoc1, mockDoc2],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });

      render(<PreviewTab />);

      // Drawer should be closed initially
      expect(screen.queryByTestId('drawer-close-btn')).not.toBeInTheDocument();

      // Open drawer
      fireEvent.click(screen.getByTestId('preview-browse-button'));
      await waitFor(() => {
        expect(screen.getByTestId('drawer-close-btn')).toBeInTheDocument();
      });

      // Change selected item in store
      useSessionStore.setState({
        selectedDiagramId: 'diagram-2',
      });

      // Drawer should remain open
      expect(screen.getByTestId('drawer-close-btn')).toBeInTheDocument();

      // Close drawer
      fireEvent.click(screen.getByTestId('drawer-close-btn'));
      await waitFor(() => {
        expect(screen.queryByTestId('drawer-close-btn')).not.toBeInTheDocument();
      });
    });

    it('should handle rapid open/close of drawer', async () => {
      const user = userEvent.setup();
      useSessionStore.setState({
        diagrams: [mockDiagram1],
        documents: [mockDoc1],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });

      render(<PreviewTab />);

      const browseButton = screen.getByTestId('preview-browse-button');

      // Open
      await user.click(browseButton);
      expect(screen.getByTestId('drawer-close-btn')).toBeInTheDocument();

      // Close
      await user.click(screen.getByTestId('drawer-close-btn'));
      await waitFor(() => {
        expect(screen.queryByTestId('drawer-close-btn')).not.toBeInTheDocument();
      });

      // Open again
      await user.click(browseButton);
      expect(screen.getByTestId('drawer-close-btn')).toBeInTheDocument();

      // Close again
      await user.click(screen.getByTestId('drawer-close-btn'));
      await waitFor(() => {
        expect(screen.queryByTestId('drawer-close-btn')).not.toBeInTheDocument();
      });
    });
  });

  describe('Empty State Handling', () => {
    it('should auto-open drawer when initialized with no selection', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram1],
        documents: [mockDoc1],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });

      render(<PreviewTab />);

      // Drawer should auto-open
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-diagram-1')).toBeInTheDocument();
      });

      // Empty state should be visible
      expect(screen.getByTestId('preview-empty-state')).toBeInTheDocument();
    });

    it('should handle empty items list with no selection', () => {
      useSessionStore.setState({
        diagrams: [],
        documents: [],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });

      render(<PreviewTab />);

      // Should show empty state
      expect(screen.getByTestId('preview-empty-state')).toBeInTheDocument();

      // Drawer should be visible but empty
      expect(screen.getByTestId('item-drawer-mock')).toBeInTheDocument();
    });

    it('should transition from empty state to preview when item is selected', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram1],
        documents: [mockDoc1],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });

      render(<PreviewTab />);

      // Initially in empty state
      expect(screen.getByTestId('preview-empty-state')).toBeInTheDocument();
      expect(screen.queryByTestId('mermaid-preview-mock')).not.toBeInTheDocument();

      // Select an item
      fireEvent.click(screen.getByTestId('drawer-item-diagram-1'));

      // Update selection in store
      useSessionStore.setState({
        selectedDiagramId: 'diagram-1',
      });

      // Should now show preview
      await waitFor(() => {
        expect(screen.queryByTestId('preview-empty-state')).not.toBeInTheDocument();
        expect(screen.getByTestId('mermaid-preview-mock')).toBeInTheDocument();
        expect(screen.getByTestId('preview-top-bar')).toBeInTheDocument();
      });
    });
  });

  describe('Content Type Switching', () => {
    it('should correctly render both diagram and document types', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram1],
        documents: [mockDoc1],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });

      render(<PreviewTab />);

      // Should show diagram
      expect(screen.getByTestId('mermaid-preview-mock')).toBeInTheDocument();
      expect(screen.queryByTestId('markdown-preview-mock')).not.toBeInTheDocument();

      // Switch to document
      useSessionStore.setState({
        selectedDiagramId: null,
        selectedDocumentId: 'doc-1',
      });

      // Should show document
      await waitFor(() => {
        expect(screen.getByTestId('markdown-preview-mock')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mermaid-preview-mock')).not.toBeInTheDocument();

      // Switch back to diagram
      useSessionStore.setState({
        selectedDiagramId: 'diagram-1',
        selectedDocumentId: null,
      });

      // Should show diagram again
      await waitFor(() => {
        expect(screen.getByTestId('mermaid-preview-mock')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('markdown-preview-mock')).not.toBeInTheDocument();
    });
  });

  describe('Store Updates', () => {
    it('should update preview content when diagram content changes in store', async () => {
      const updatedDiagram = {
        ...mockDiagram1,
        content: 'graph TD; X[New] --> Y[Content]',
      };

      useSessionStore.setState({
        diagrams: [mockDiagram1],
        documents: [],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });

      render(<PreviewTab />);

      expect(screen.getByTestId('mermaid-preview-mock')).toHaveTextContent('flowchart LR; A --> B');

      // Update diagram in store
      useSessionStore.setState({
        diagrams: [updatedDiagram],
      });

      // Should update content
      await waitFor(() => {
        expect(screen.getByTestId('mermaid-preview-mock')).toHaveTextContent('graph TD; X[New] --> Y[Content]');
      });
    });

    it('should update drawer items list when diagrams/documents are added to store', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram1],
        documents: [mockDoc1],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });

      render(<PreviewTab />);

      fireEvent.click(screen.getByTestId('preview-browse-button'));
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-diagram-1')).toBeInTheDocument();
      });

      // Add new items to store
      useSessionStore.setState({
        diagrams: [mockDiagram1, mockDiagram2],
        documents: [mockDoc1, mockDoc2],
      });

      // Drawer should show new items
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-diagram-2')).toBeInTheDocument();
      });
      expect(screen.getByTestId('drawer-item-doc-2')).toBeInTheDocument();
    });
  });
});
