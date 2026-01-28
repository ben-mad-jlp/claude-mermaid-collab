/**
 * ItemDrawer Component Tests
 *
 * Tests for the mobile bottom sheet drawer component for item selection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItemDrawer, ItemDrawerProps } from './ItemDrawer';
import { Item } from '@/types';

describe('ItemDrawer', () => {
  const mockItems: Item[] = [
    {
      id: 'item-1',
      name: 'Diagram One',
      type: 'diagram',
      content: 'graph TD; A[Start] --> B[End]',
      lastModified: Date.now() - 3600000, // 1 hour ago
    },
    {
      id: 'item-2',
      name: 'Document Two',
      type: 'document',
      content: '# Markdown Content',
      lastModified: Date.now() - 7200000, // 2 hours ago
    },
    {
      id: 'item-3',
      name: 'Another Diagram',
      type: 'diagram',
      content: 'flowchart LR; X --> Y',
      lastModified: Date.now() - 86400000, // 1 day ago
    },
  ];

  const mockProps: ItemDrawerProps = {
    isOpen: true,
    onClose: vi.fn(),
    items: mockItems,
    selectedItemId: null,
    onItemSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Visibility', () => {
    it('should not render when isOpen is false', () => {
      const { container } = render(
        <ItemDrawer {...mockProps} isOpen={false} />
      );
      // Should not have the drawer container
      expect(container.querySelector('[data-testid="item-drawer"]')).not.toBeInTheDocument();
    });

    it('should render when isOpen is true', () => {
      render(<ItemDrawer {...mockProps} />);
      expect(screen.getByTestId('item-drawer')).toBeInTheDocument();
    });

    it('should render backdrop overlay', () => {
      render(<ItemDrawer {...mockProps} />);
      expect(screen.getByTestId('item-drawer-backdrop')).toBeInTheDocument();
    });
  });

  describe('Backdrop Interaction', () => {
    it('should close drawer when backdrop is clicked', async () => {
      const onClose = vi.fn();
      render(<ItemDrawer {...mockProps} onClose={onClose} />);

      const backdrop = screen.getByTestId('item-drawer-backdrop');
      fireEvent.click(backdrop);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not close drawer when sheet content is clicked', async () => {
      const onClose = jest.fn();
      render(<ItemDrawer {...mockProps} onClose={onClose} />);

      const sheet = screen.getByTestId('item-drawer-sheet');
      fireEvent.click(sheet);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Search Functionality', () => {
    it('should render search input', () => {
      render(<ItemDrawer {...mockProps} />);
      expect(screen.getByPlaceholderText('Search items...')).toBeInTheDocument();
    });

    it('should filter items by search query', async () => {
      const user = userEvent.setup();
      render(<ItemDrawer {...mockProps} />);

      const searchInput = screen.getByPlaceholderText('Search items...');
      await user.type(searchInput, 'Diagram');

      // Should show only items with "Diagram" in the name
      expect(screen.getByText('Diagram One')).toBeInTheDocument();
      expect(screen.getByText('Another Diagram')).toBeInTheDocument();
      expect(screen.queryByText('Document Two')).not.toBeInTheDocument();
    });

    it('should filter case-insensitively', async () => {
      const user = userEvent.setup();
      render(<ItemDrawer {...mockProps} />);

      const searchInput = screen.getByPlaceholderText('Search items...');
      await user.type(searchInput, 'document');

      expect(screen.getByText('Document Two')).toBeInTheDocument();
    });

    it('should show "No items found" message when no items match search', async () => {
      const user = userEvent.setup();
      render(<ItemDrawer {...mockProps} />);

      const searchInput = screen.getByPlaceholderText('Search items...');
      await user.type(searchInput, 'nonexistent');

      expect(screen.getByText('No items found')).toBeInTheDocument();
    });

    it('should show all items when search is cleared', async () => {
      const user = userEvent.setup();
      render(<ItemDrawer {...mockProps} />);

      const searchInput = screen.getByPlaceholderText('Search items...');
      await user.type(searchInput, 'Diagram');
      expect(screen.queryByText('Document Two')).not.toBeInTheDocument();

      await user.clear(searchInput);
      expect(screen.getByText('Document Two')).toBeInTheDocument();
    });
  });

  describe('Item List', () => {
    it('should render all items sorted by lastModified (newest first)', () => {
      render(<ItemDrawer {...mockProps} />);

      const items = screen.getAllByTestId(/^item-drawer-item-/);
      expect(items).toHaveLength(3);

      // Items should be sorted by lastModified descending
      // item-1 (1h ago), item-2 (2h ago), item-3 (1 day ago)
      expect(items[0]).toHaveAttribute('data-testid', 'item-drawer-item-item-1');
      expect(items[1]).toHaveAttribute('data-testid', 'item-drawer-item-item-2');
      expect(items[2]).toHaveAttribute('data-testid', 'item-drawer-item-item-3');
    });

    it('should render item cards with name and type', () => {
      render(<ItemDrawer {...mockProps} />);

      expect(screen.getByText('Diagram One')).toBeInTheDocument();
      expect(screen.getByText('Document Two')).toBeInTheDocument();
      expect(screen.getByText('Another Diagram')).toBeInTheDocument();
    });

    it('should highlight selected item', () => {
      render(
        <ItemDrawer
          {...mockProps}
          selectedItemId="item-2"
        />
      );

      const selectedItem = screen.getByTestId('item-drawer-item-item-2');
      expect(selectedItem).toHaveClass('ring-2');
    });

    it('should not highlight item when no item is selected', () => {
      render(<ItemDrawer {...mockProps} selectedItemId={null} />);

      const item = screen.getByTestId('item-drawer-item-item-1');
      expect(item).not.toHaveClass('ring-2');
    });
  });

  describe('Item Selection', () => {
    it('should call onItemSelect when item is clicked', async () => {
      const onItemSelect = jest.fn();
      render(<ItemDrawer {...mockProps} onItemSelect={onItemSelect} />);

      const itemButton = screen.getByTestId('item-drawer-item-item-2');
      fireEvent.click(itemButton);

      expect(onItemSelect).toHaveBeenCalledWith(mockItems[1]);
      expect(onItemSelect).toHaveBeenCalledTimes(1);
    });

    it('should call onClose after item selection', async () => {
      const onClose = jest.fn();
      const onItemSelect = jest.fn();
      render(
        <ItemDrawer
          {...mockProps}
          onClose={onClose}
          onItemSelect={onItemSelect}
        />
      );

      const itemButton = screen.getByTestId('item-drawer-item-item-1');
      fireEvent.click(itemButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Drag Handle', () => {
    it('should render drag handle', () => {
      render(<ItemDrawer {...mockProps} />);
      expect(screen.getByTestId('item-drawer-handle')).toBeInTheDocument();
    });

    it('should close drawer when dragged down more than 100px', async () => {
      const onClose = jest.fn();
      render(<ItemDrawer {...mockProps} onClose={onClose} />);

      const handle = screen.getByTestId('item-drawer-handle');

      fireEvent.touchStart(handle, {
        touches: [{ clientY: 0 }],
      });

      fireEvent.touchMove(handle, {
        touches: [{ clientY: 150 }],
      });

      fireEvent.touchEnd(handle);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not close drawer when dragged down less than 100px', async () => {
      const onClose = jest.fn();
      render(<ItemDrawer {...mockProps} onClose={onClose} />);

      const handle = screen.getByTestId('item-drawer-handle');

      fireEvent.touchStart(handle, {
        touches: [{ clientY: 0 }],
      });

      fireEvent.touchMove(handle, {
        touches: [{ clientY: 50 }],
      });

      fireEvent.touchEnd(handle);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Empty State', () => {
    it('should show "No items in session" when items array is empty', () => {
      render(<ItemDrawer {...mockProps} items={[]} />);
      expect(screen.getByText('No items in session')).toBeInTheDocument();
    });
  });

  describe('Styling and Classes', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <ItemDrawer {...mockProps} className="custom-class" />
      );
      const drawer = container.querySelector('[data-testid="item-drawer"]');
      expect(drawer).toHaveClass('custom-class');
    });
  });

  describe('Scroll Behavior', () => {
    it('should have scrollable item list', () => {
      render(<ItemDrawer {...mockProps} />);
      const itemList = screen.getByTestId('item-drawer-list');
      expect(itemList).toBeInTheDocument();
    });

    it('should reset scroll when search query changes', async () => {
      const user = userEvent.setup();
      render(<ItemDrawer {...mockProps} />);

      const searchInput = screen.getByPlaceholderText('Search items...');
      await user.type(searchInput, 'Diagram');

      const itemList = screen.getByTestId('item-drawer-list');
      // Simulate scroll
      itemList.scrollTop = 100;

      // Type more
      await user.type(searchInput, ' One');

      // Should have reset scroll
      await waitFor(() => {
        expect(itemList.scrollTop).toBe(0);
      });
    });
  });
});
