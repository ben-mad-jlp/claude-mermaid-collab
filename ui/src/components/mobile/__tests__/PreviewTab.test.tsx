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

describe('PreviewTab Integration', () => {
  const mockItems: Item[] = [
    {
      id: 'diagram-1',
      name: 'Flow Chart',
      type: 'diagram',
      content: 'flowchart LR; A --> B',
      lastModified: Date.now() - 3600000,
    },
    {
      id: 'diagram-2',
      name: 'State Machine',
      type: 'diagram',
      content: 'stateDiagram-v2; [*] --> A; A --> B',
      lastModified: Date.now() - 7200000,
    },
    {
      id: 'doc-1',
      name: 'README',
      type: 'document',
      content: '# Project README\n\nThis is the README.',
      lastModified: Date.now(),
    },
    {
      id: 'doc-2',
      name: 'Design Notes',
      type: 'document',
      content: '# Design Notes\n\nSome notes.',
      lastModified: Date.now() - 1800000,
    },
  ];

  const mockProps: PreviewTabProps = {
    selectedItem: mockItems[0],
    items: mockItems,
    onItemSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Workflow: Browse and Select Items', () => {
    it('should allow browsing and selecting multiple items in sequence', async () => {
      const onItemSelect = vi.fn();
      const { rerender } = render(
        <PreviewTab {...mockProps} onItemSelect={onItemSelect} />
      );

      // Start with diagram-1
      expect(screen.getByTestId('mermaid-preview-mock')).toHaveTextContent('flowchart LR; A --> B');

      // Open drawer
      fireEvent.click(screen.getByTestId('preview-browse-button'));
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-diagram-2')).toBeInTheDocument();
      });

      // Select diagram-2
      fireEvent.click(screen.getByTestId('drawer-item-diagram-2'));
      expect(onItemSelect).toHaveBeenCalledWith(mockItems[1]);

      // Rerender with new selection
      rerender(
        <PreviewTab
          {...mockProps}
          selectedItem={mockItems[1]}
          onItemSelect={onItemSelect}
        />
      );

      // Should now show diagram-2 content
      expect(screen.getByTestId('mermaid-preview-mock')).toHaveTextContent('stateDiagram-v2; [*] --> A; A --> B');

      // Open drawer again
      fireEvent.click(screen.getByTestId('preview-browse-button'));
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-doc-1')).toBeInTheDocument();
      });

      // Select document
      fireEvent.click(screen.getByTestId('drawer-item-doc-1'));
      expect(onItemSelect).toHaveBeenCalledWith(mockItems[2]);

      // Rerender with document selection
      rerender(
        <PreviewTab
          {...mockProps}
          selectedItem={mockItems[2]}
          onItemSelect={onItemSelect}
        />
      );

      // Should now show document content
      expect(screen.getByTestId('markdown-preview-mock')).toHaveTextContent('# Project README');
    });
  });

  describe('State Management', () => {
    it('should maintain drawer state independently from item selection', async () => {
      const { rerender } = render(
        <PreviewTab {...mockProps} selectedItem={mockItems[0]} />
      );

      // Drawer should be closed initially
      expect(screen.queryByTestId('drawer-close-btn')).not.toBeInTheDocument();

      // Open drawer
      fireEvent.click(screen.getByTestId('preview-browse-button'));
      await waitFor(() => {
        expect(screen.getByTestId('drawer-close-btn')).toBeInTheDocument();
      });

      // Change selected item externally
      rerender(
        <PreviewTab {...mockProps} selectedItem={mockItems[1]} />
      );

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
      render(<PreviewTab {...mockProps} />);

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
      render(
        <PreviewTab {...mockProps} selectedItem={null} />
      );

      // Drawer should auto-open
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-diagram-1')).toBeInTheDocument();
      });

      // Empty state should be visible
      expect(screen.getByTestId('preview-empty-state')).toBeInTheDocument();
    });

    it('should handle empty items list with no selection', () => {
      render(
        <PreviewTab
          selectedItem={null}
          items={[]}
          onItemSelect={vi.fn()}
        />
      );

      // Should show empty state
      expect(screen.getByTestId('preview-empty-state')).toBeInTheDocument();

      // Drawer should be visible but empty
      expect(screen.getByTestId('item-drawer-mock')).toBeInTheDocument();
    });

    it('should transition from empty state to preview when item is selected', async () => {
      const onItemSelect = vi.fn();
      const { rerender } = render(
        <PreviewTab
          selectedItem={null}
          items={mockItems}
          onItemSelect={onItemSelect}
        />
      );

      // Initially in empty state
      expect(screen.getByTestId('preview-empty-state')).toBeInTheDocument();
      expect(screen.queryByTestId('mermaid-preview-mock')).not.toBeInTheDocument();

      // Select an item
      fireEvent.click(screen.getByTestId('drawer-item-diagram-1'));
      expect(onItemSelect).toHaveBeenCalledWith(mockItems[0]);

      // Rerender with selection
      rerender(
        <PreviewTab
          selectedItem={mockItems[0]}
          items={mockItems}
          onItemSelect={onItemSelect}
        />
      );

      // Should now show preview
      expect(screen.queryByTestId('preview-empty-state')).not.toBeInTheDocument();
      expect(screen.getByTestId('mermaid-preview-mock')).toBeInTheDocument();
      expect(screen.getByTestId('preview-top-bar')).toBeInTheDocument();
    });
  });

  describe('Content Type Switching', () => {
    it('should correctly render both diagram and document types', () => {
      const diagramItem = mockItems[0];
      const documentItem = mockItems[2];

      const { rerender } = render(
        <PreviewTab {...mockProps} selectedItem={diagramItem} />
      );

      // Should show diagram
      expect(screen.getByTestId('mermaid-preview-mock')).toBeInTheDocument();
      expect(screen.queryByTestId('markdown-preview-mock')).not.toBeInTheDocument();

      // Switch to document
      rerender(
        <PreviewTab {...mockProps} selectedItem={documentItem} />
      );

      // Should show document
      expect(screen.getByTestId('markdown-preview-mock')).toBeInTheDocument();
      expect(screen.queryByTestId('mermaid-preview-mock')).not.toBeInTheDocument();

      // Switch back to diagram
      rerender(
        <PreviewTab {...mockProps} selectedItem={diagramItem} />
      );

      // Should show diagram again
      expect(screen.getByTestId('mermaid-preview-mock')).toBeInTheDocument();
      expect(screen.queryByTestId('markdown-preview-mock')).not.toBeInTheDocument();
    });
  });

  describe('Props Updates', () => {
    it('should update preview content when selected item content changes', () => {
      const updatedItem = {
        ...mockItems[0],
        content: 'graph TD; X[New] --> Y[Content]',
      };

      const { rerender } = render(
        <PreviewTab {...mockProps} selectedItem={mockItems[0]} />
      );

      expect(screen.getByTestId('mermaid-preview-mock')).toHaveTextContent('flowchart LR; A --> B');

      rerender(
        <PreviewTab {...mockProps} selectedItem={updatedItem} />
      );

      expect(screen.getByTestId('mermaid-preview-mock')).toHaveTextContent('graph TD; X[New] --> Y[Content]');
    });

    it('should update drawer items list when items prop changes', async () => {
      const { rerender } = render(
        <PreviewTab {...mockProps} />
      );

      fireEvent.click(screen.getByTestId('preview-browse-button'));
      await waitFor(() => {
        expect(screen.getByTestId('drawer-item-diagram-1')).toBeInTheDocument();
      });

      // Update items list
      const newItems: Item[] = [
        ...mockItems,
        {
          id: 'new-diagram',
          name: 'New Diagram',
          type: 'diagram' as const,
          content: 'new content',
          lastModified: Date.now(),
        },
      ];

      rerender(
        <PreviewTab {...mockProps} items={newItems} />
      );

      // Drawer should still be open with new item
      expect(screen.getByTestId('drawer-item-new-diagram')).toBeInTheDocument();
    });
  });
});
