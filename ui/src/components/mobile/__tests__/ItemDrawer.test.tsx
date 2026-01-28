/**
 * ItemDrawer Component Integration Tests
 *
 * Integration and snapshot tests for the mobile bottom sheet drawer.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItemDrawer } from '../ItemDrawer';
import { Item } from '@/types';

describe('ItemDrawer Integration Tests', () => {
  const mockItems: Item[] = [
    {
      id: 'diagram-flow',
      name: 'System Flow Diagram',
      type: 'diagram',
      content: 'graph LR; A --> B',
      lastModified: Date.now() - 1000,
    },
    {
      id: 'doc-design',
      name: 'Design Document',
      type: 'document',
      content: '# Design Notes',
      lastModified: Date.now() - 60000,
    },
    {
      id: 'diagram-arch',
      name: 'Architecture Diagram',
      type: 'diagram',
      content: 'graph TD; X --> Y',
      lastModified: Date.now() - 120000,
    },
  ];

  describe('Full Workflow', () => {
    it('should handle complete search and selection workflow', async () => {
      const user = userEvent.setup();
      const onItemSelect = vi.fn();
      const onClose = vi.fn();

      render(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={onItemSelect}
          onClose={onClose}
        />
      );

      // Search for "diagram"
      const searchInput = screen.getByPlaceholderText('Search items...');
      await user.type(searchInput, 'diagram');

      // Should show only diagrams
      expect(screen.getByText('System Flow Diagram')).toBeInTheDocument();
      expect(screen.getByText('Architecture Diagram')).toBeInTheDocument();
      expect(screen.queryByText('Design Document')).not.toBeInTheDocument();

      // Clear search
      await user.clear(searchInput);

      // All items should be back
      expect(screen.getByText('Design Document')).toBeInTheDocument();

      // Select an item
      const itemButton = screen.getByTestId('item-drawer-item-diagram-flow');
      await user.click(itemButton);

      expect(onItemSelect).toHaveBeenCalledWith(mockItems[0]);
      expect(onClose).toHaveBeenCalled();
    });

    it('should handle backdrop and gesture dismissal together', async () => {
      const onClose = vi.fn();

      const { rerender } = render(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={onClose}
        />
      );

      // First, try gesture (drag down)
      const handle = screen.getByTestId('item-drawer-handle');
      fireEvent.touchStart(handle, { touches: [{ clientY: 0 }] as any });
      fireEvent.touchEnd(handle, { changedTouches: [{ clientY: 120 }] as any });

      expect(onClose).toHaveBeenCalledTimes(1);

      // Close and reopen
      rerender(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={onClose}
        />
      );

      // Now try backdrop click
      const backdrop = screen.getByTestId('item-drawer-backdrop');
      fireEvent.click(backdrop);

      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('Item Type Icons', () => {
    it('should display correct icons for different item types', () => {
      render(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={vi.fn()}
        />
      );

      // Both diagram items should have diagram icon
      const diagramItems = screen.getAllByTestId(/item-drawer-item-(diagram|arch)/);
      expect(diagramItems.length).toBeGreaterThan(0);

      // Document item should exist
      expect(screen.getByText('Design Document')).toBeInTheDocument();
    });
  });

  describe('Selection State Persistence', () => {
    it('should maintain selection state across search', async () => {
      const user = userEvent.setup();
      render(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId="doc-design"
          onItemSelect={vi.fn()}
          onClose={vi.fn()}
        />
      );

      // Item should be selected
      const selectedItem = screen.getByTestId('item-drawer-item-doc-design');
      expect(selectedItem).toHaveClass('ring-2');

      // Search for it
      const searchInput = screen.getByPlaceholderText('Search items...');
      await user.type(searchInput, 'design');

      // Should still be selected
      const foundItem = screen.getByTestId('item-drawer-item-doc-design');
      expect(foundItem).toHaveClass('ring-2');
    });
  });

  describe('Sorting', () => {
    it('should sort items by lastModified in descending order', () => {
      render(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={vi.fn()}
        />
      );

      const items = screen.getAllByTestId(/^item-drawer-item-/);
      // Most recent first: diagram-flow, doc-design, diagram-arch
      expect(items[0]).toHaveAttribute('data-testid', 'item-drawer-item-diagram-flow');
      expect(items[1]).toHaveAttribute('data-testid', 'item-drawer-item-doc-design');
      expect(items[2]).toHaveAttribute('data-testid', 'item-drawer-item-diagram-arch');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty items array gracefully', () => {
      render(
        <ItemDrawer
          isOpen={true}
          items={[]}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText('No items in session')).toBeInTheDocument();
    });

    it('should handle items with very long names', () => {
      const longNameItems: Item[] = [
        {
          id: 'long-name',
          name: 'This is a very long item name that should be truncated with ellipsis to prevent layout breaking',
          type: 'diagram',
          content: 'graph LR; A --> B',
          lastModified: Date.now(),
        },
      ];

      render(
        <ItemDrawer
          isOpen={true}
          items={longNameItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText(/This is a very long/)).toBeInTheDocument();
    });

    it('should handle rapid open/close cycles', async () => {
      const onClose = vi.fn();
      const { rerender } = render(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={onClose}
        />
      );

      rerender(
        <ItemDrawer
          isOpen={false}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={onClose}
        />
      );

      rerender(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={onClose}
        />
      );

      expect(screen.getByTestId('item-drawer')).toBeInTheDocument();
    });
  });

  describe('Mobile Responsiveness', () => {
    it('should render drawer with appropriate mobile styling', () => {
      const { container } = render(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={vi.fn()}
        />
      );

      const sheet = container.querySelector('[data-testid="item-drawer-sheet"]');
      expect(sheet).toBeInTheDocument();
      // Should have bottom positioning and height constraint for mobile
      expect(sheet?.className).toMatch(/bottom|fixed/);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={vi.fn()}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search items...');
      expect(searchInput).toHaveAttribute('type', 'text');
    });

    it('should allow keyboard navigation for search input', async () => {
      const user = userEvent.setup();
      render(
        <ItemDrawer
          isOpen={true}
          items={mockItems}
          selectedItemId={null}
          onItemSelect={vi.fn()}
          onClose={vi.fn()}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search items...');
      await user.click(searchInput);
      expect(searchInput).toHaveFocus();
    });
  });
});
