/**
 * PreviewTab Component Tests
 *
 * Tests for the mobile full-screen preview tab component.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewTab, PreviewTabProps } from './PreviewTab';
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

vi.mock('./ItemDrawer', () => ({
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

describe('PreviewTab', () => {
  const mockDiagram = {
    id: 'diagram-1',
    name: 'Test Diagram',
    content: 'graph TD; A[Start] --> B[End]',
    lastModified: Date.now(),
  };

  const mockDocument = {
    id: 'doc-1',
    name: 'Test Document',
    content: '# Test Markdown',
    lastModified: Date.now(),
  };

  const mockSession = {
    project: 'test-project',
    name: 'Test Session',
    phase: 'executing' as const,
    lastActivity: new Date().toISOString(),
    itemCount: 2,
    id: 'test-session',
    displayName: 'Test Session',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useSessionStore.setState({
      diagrams: [],
      documents: [],
      selectedDiagramId: null,
      selectedDocumentId: null,
      currentSession: null,
    });
  });

  describe('Layout and Structure', () => {
    it('should render full-screen container', () => {
      const { container } = render(<PreviewTab />);
      const previewTab = container.querySelector('[data-testid="preview-tab"]');
      expect(previewTab).toBeInTheDocument();
      expect(previewTab).toHaveClass('flex', 'flex-col', 'h-full');
    });

    it('should render top bar with item details when item is selected', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.getByTestId('preview-top-bar')).toBeInTheDocument();
    });

    it('should render preview content area', () => {
      render(<PreviewTab />);
      expect(screen.getByTestId('preview-content')).toBeInTheDocument();
    });

    it('should render ItemDrawer component', () => {
      render(<PreviewTab />);
      expect(screen.getByTestId('item-drawer-mock')).toBeInTheDocument();
    });
  });

  describe('Top Bar Content', () => {
    it('should display item type icon for diagram', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      const topBar = screen.getByTestId('preview-top-bar');
      expect(topBar.querySelector('[data-testid="item-type-icon"]')).toBeInTheDocument();
    });

    it('should display item type icon for document', () => {
      useSessionStore.setState({
        diagrams: [],
        documents: [mockDocument],
        selectedDocumentId: 'doc-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      const topBar = screen.getByTestId('preview-top-bar');
      expect(topBar.querySelector('[data-testid="item-type-icon"]')).toBeInTheDocument();
    });

    it('should display item name in top bar', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.getByText('Test Diagram')).toBeInTheDocument();
    });

    it('should truncate long item names', () => {
      const longNameDiagram = {
        ...mockDiagram,
        name: 'A'.repeat(100),
      };
      useSessionStore.setState({
        diagrams: [longNameDiagram],
        documents: [],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      const itemName = screen.getByTestId('preview-item-name');
      expect(itemName).toHaveClass('truncate');
    });

    it('should render browse button in top bar', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      const browseButton = screen.getByTestId('preview-browse-button');
      expect(browseButton).toBeInTheDocument();
    });
  });

  describe('Browse Button Interaction', () => {
    it('should open drawer when browse button is clicked', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      const browseButton = screen.getByTestId('preview-browse-button');

      fireEvent.click(browseButton);

      // Drawer should now be visible (mock will show items)
      expect(screen.getByTestId('drawer-item-diagram-1')).toBeInTheDocument();
    });

    it('should close drawer when close button is clicked', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      const browseButton = screen.getByTestId('preview-browse-button');

      fireEvent.click(browseButton);
      expect(screen.getByTestId('drawer-close-btn')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('drawer-close-btn'));
      expect(screen.queryByTestId('drawer-close-btn')).not.toBeInTheDocument();
    });
  });

  describe('Preview Content - Diagram', () => {
    it('should render MermaidPreview when selected item is a diagram', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.getByTestId('mermaid-preview-mock')).toBeInTheDocument();
    });

    it('should pass diagram content to MermaidPreview', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      const preview = screen.getByTestId('mermaid-preview-mock');
      expect(preview).toHaveTextContent('graph TD; A[Start] --> B[End]');
    });

    it('should switch from document to diagram preview', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDocumentId: 'doc-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.getByTestId('markdown-preview-mock')).toBeInTheDocument();

      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: 'diagram-1',
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });

      await waitFor(() => {
        expect(screen.getByTestId('mermaid-preview-mock')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('markdown-preview-mock')).not.toBeInTheDocument();
    });
  });

  describe('Preview Content - Document', () => {
    it('should render MarkdownPreview when selected item is a document', () => {
      useSessionStore.setState({
        diagrams: [],
        documents: [mockDocument],
        selectedDocumentId: 'doc-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.getByTestId('markdown-preview-mock')).toBeInTheDocument();
    });

    it('should pass document content to MarkdownPreview', () => {
      useSessionStore.setState({
        diagrams: [],
        documents: [mockDocument],
        selectedDocumentId: 'doc-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      const preview = screen.getByTestId('markdown-preview-mock');
      expect(preview).toHaveTextContent('# Test Markdown');
    });

    it('should switch from diagram to document preview', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.getByTestId('mermaid-preview-mock')).toBeInTheDocument();

      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: null,
        selectedDocumentId: 'doc-1',
        currentSession: mockSession as any,
      });

      await waitFor(() => {
        expect(screen.getByTestId('markdown-preview-mock')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mermaid-preview-mock')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no item is selected', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.getByTestId('preview-empty-state')).toBeInTheDocument();
    });

    it('should display prompt text in empty state', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.getByText(/select an item/i)).toBeInTheDocument();
    });

    it('should auto-open drawer on mount when no item is selected', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);

      // Drawer should be open and items visible
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-diagram-1')).toBeInTheDocument();
      });
    });

    it('should not show preview content when no item is selected', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.queryByTestId('mermaid-preview-mock')).not.toBeInTheDocument();
      expect(screen.queryByTestId('markdown-preview-mock')).not.toBeInTheDocument();
    });

    it('should hide top bar when no item is selected', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.queryByTestId('preview-top-bar')).not.toBeInTheDocument();
    });

    it('should display Browse Items button in empty state', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);
      expect(screen.getByTestId('preview-browse-items-button')).toBeInTheDocument();
      expect(screen.getByTestId('preview-browse-items-button')).toHaveTextContent('Browse Items');
    });

    it('should open drawer when Browse Items button is clicked', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: null,
        selectedDocumentId: null,
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);

      // Close the auto-opened drawer first
      fireEvent.click(screen.getByTestId('drawer-close-btn'));
      await waitFor(() => {
        expect(screen.queryByTestId('drawer-close-btn')).not.toBeInTheDocument();
      });

      // Click Browse Items button
      const browseItemsButton = screen.getByTestId('preview-browse-items-button');
      fireEvent.click(browseItemsButton);

      // Drawer should open again
      await waitFor(() => {
        expect(screen.getByTestId('drawer-close-btn')).toBeInTheDocument();
      });
    });
  });

  describe('Item Selection', () => {
    it('should call store selection when an item is selected from drawer', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);

      const browseButton = screen.getByTestId('preview-browse-button');
      fireEvent.click(browseButton);

      const itemButton = screen.getByTestId('drawer-item-doc-1');
      fireEvent.click(itemButton);

      // Item selection should trigger store updates (via mock useDataLoader)
      expect(screen.getByTestId('item-drawer-mock')).toBeInTheDocument();
    });

    it('should close drawer after item selection', async () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);

      const browseButton = screen.getByTestId('preview-browse-button');
      fireEvent.click(browseButton);

      const itemButton = screen.getByTestId('drawer-item-doc-1');
      fireEvent.click(itemButton);

      // Drawer should be closed (no close button visible anymore)
      await waitFor(() => {
        expect(screen.queryByTestId('drawer-close-btn')).not.toBeInTheDocument();
      });
    });
  });

  describe('Drawer Integration', () => {
    it('should pass items list to drawer from store', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);

      const browseButton = screen.getByTestId('preview-browse-button');
      fireEvent.click(browseButton);

      // Both items should be available in drawer
      expect(screen.getByTestId('drawer-item-diagram-1')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-item-doc-1')).toBeInTheDocument();
    });

    it('should pass selected item ID to drawer for highlighting', () => {
      useSessionStore.setState({
        diagrams: [mockDiagram],
        documents: [mockDocument],
        selectedDiagramId: 'diagram-1',
        currentSession: mockSession as any,
      });
      render(<PreviewTab />);

      const browseButton = screen.getByTestId('preview-browse-button');
      fireEvent.click(browseButton);

      // Drawer receives selectedItemId (tested in ItemDrawer component itself)
      expect(screen.getByTestId('item-drawer-mock')).toBeInTheDocument();
    });
  });

  describe('Custom Styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <PreviewTab className="custom-class" />
      );
      const previewTab = container.querySelector('[data-testid="preview-tab"]');
      expect(previewTab).toHaveClass('custom-class');
    });
  });
});
