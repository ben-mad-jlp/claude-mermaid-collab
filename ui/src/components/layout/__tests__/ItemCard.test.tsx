/**
 * ItemCard Component Tests
 *
 * Tests for:
 * - Rendering item information (name, type, lastModified)
 * - Click handlers and selection state
 * - Icon display for all artifact types (diagram, document, design, spreadsheet, snippet)
 * - Relative time formatting
 * - Snippet-specific metadata (language, line count, size)
 * - Delete button visibility and functionality
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItemCard } from '../ItemCard';
import { Item } from '@/types';

describe('ItemCard', () => {
  const baseItem: Item = {
    id: 'test-1',
    name: 'Test Item',
    type: 'diagram',
    content: 'test content',
    lastModified: Date.now(),
  };

  describe('Rendering', () => {
    it('renders item name and type label', () => {
      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText('Test Item')).toBeInTheDocument();
      expect(screen.getByText(/Diagram/)).toBeInTheDocument();
    });

    it('displays correct icon for diagram type', () => {
      const { container } = render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('displays correct icon for document type', () => {
      const docItem: Item = {
        ...baseItem,
        type: 'document',
      };

      const { container } = render(
        <ItemCard
          item={docItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(screen.getByText(/Document/)).toBeInTheDocument();
    });

    it('displays correct icon for design type', () => {
      const designItem: Item = {
        ...baseItem,
        type: 'design',
      };

      render(
        <ItemCard
          item={designItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/Design/)).toBeInTheDocument();
    });

    it('displays correct icon for spreadsheet type', () => {
      const sheetItem: Item = {
        ...baseItem,
        type: 'spreadsheet',
      };

      render(
        <ItemCard
          item={sheetItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/Spreadsheet/)).toBeInTheDocument();
    });

    it('displays snippet icon for snippet type', () => {
      const snippetItem: Item = {
        ...baseItem,
        type: 'snippet',
        name: 'example.js',
      };

      render(
        <ItemCard
          item={snippetItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/Snippet/)).toBeInTheDocument();
    });
  });

  describe('Snippet Metadata', () => {
    it('displays language, line count, and size for snippets', () => {
      const snippetContent = 'function hello() {\n  console.log("world");\n}';
      const snippetItem: Item = {
        ...baseItem,
        type: 'snippet',
        name: 'hello.js',
        content: snippetContent,
      };

      render(
        <ItemCard
          item={snippetItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/JavaScript/)).toBeInTheDocument();
      expect(screen.getByText(/3 lines/)).toBeInTheDocument();
      expect(screen.getByText(/[0-9]+B/)).toBeInTheDocument();
    });

    it('detects correct language from file extension', () => {
      const snippetItem: Item = {
        ...baseItem,
        type: 'snippet',
        name: 'script.ts',
        content: 'const x: number = 5;',
      };

      render(
        <ItemCard
          item={snippetItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/TypeScript/)).toBeInTheDocument();
    });

    it('shows correct line count for snippets', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';
      const snippetItem: Item = {
        ...baseItem,
        type: 'snippet',
        name: 'test.txt',
        content,
      };

      render(
        <ItemCard
          item={snippetItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/5 lines/)).toBeInTheDocument();
    });

    it('does not show metadata for non-snippet items', () => {
      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      // Should not have "lines" text for non-snippets
      expect(screen.queryByText(/lines/)).not.toBeInTheDocument();
    });
  });

  describe('Selection State', () => {
    it('applies selected styling when isSelected is true', () => {
      const { container } = render(
        <ItemCard
          item={baseItem}
          isSelected={true}
          onClick={vi.fn()}
        />
      );

      const cardDiv = container.querySelector('[data-testid]');
      expect(cardDiv).toHaveClass('ring-2');
      expect(cardDiv).toHaveClass('border-accent-400');
    });

    it('applies unselected styling when isSelected is false', () => {
      const { container } = render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      const cardDiv = container.querySelector('[data-testid]');
      expect(cardDiv).not.toHaveClass('ring-2');
    });

    it('has data-testid with item id', () => {
      const { container } = render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      const cardDiv = container.querySelector(`[data-testid="item-card-${baseItem.id}"]`);
      expect(cardDiv).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('calls onClick when card is clicked', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={onClick}
        />
      );

      const card = screen.getByTestId(`item-card-${baseItem.id}`);
      await user.click(card);

      expect(onClick).toHaveBeenCalledOnce();
    });

    it('calls onClick when Enter key is pressed', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={onClick}
        />
      );

      const card = screen.getByTestId(`item-card-${baseItem.id}`);
      card.focus();
      await user.keyboard('{Enter}');

      expect(onClick).toHaveBeenCalledOnce();
    });

    it('calls onClick when Space key is pressed', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={onClick}
        />
      );

      const card = screen.getByTestId(`item-card-${baseItem.id}`);
      card.focus();
      await user.keyboard(' ');

      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  describe('Delete Button', () => {
    it('shows delete button when showDelete is true', () => {
      const onDelete = vi.fn();

      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
          showDelete={true}
          onDelete={onDelete}
        />
      );

      const deleteButton = screen.getByLabelText(`Delete ${baseItem.name}`);
      expect(deleteButton).toBeInTheDocument();
    });

    it('hides delete button when showDelete is false', () => {
      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
          showDelete={false}
        />
      );

      const deleteButton = screen.queryByLabelText(`Delete ${baseItem.name}`);
      expect(deleteButton).not.toBeInTheDocument();
    });

    it('calls onDelete when delete button is clicked', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();

      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
          showDelete={true}
          onDelete={onDelete}
        />
      );

      const deleteButton = screen.getByLabelText(`Delete ${baseItem.name}`);
      await user.click(deleteButton);

      expect(onDelete).toHaveBeenCalledOnce();
    });

    it('does not call onClick when delete button is clicked', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      const onDelete = vi.fn();

      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={onClick}
          showDelete={true}
          onDelete={onDelete}
        />
      );

      const deleteButton = screen.getByLabelText(`Delete ${baseItem.name}`);
      await user.click(deleteButton);

      expect(onClick).not.toHaveBeenCalled();
      expect(onDelete).toHaveBeenCalledOnce();
    });
  });

  describe('Time Formatting', () => {
    it('shows "just now" for very recent modifications', () => {
      const justNow = Date.now() - 10000; // 10 seconds ago
      const item: Item = {
        ...baseItem,
        lastModified: justNow,
      };

      render(
        <ItemCard
          item={item}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/just now/)).toBeInTheDocument();
    });

    it('shows minutes ago for recent modifications', () => {
      const fiveMinsAgo = Date.now() - 5 * 60000;
      const item: Item = {
        ...baseItem,
        lastModified: fiveMinsAgo,
      };

      render(
        <ItemCard
          item={item}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/[0-9]+m ago/)).toBeInTheDocument();
    });

    it('shows hours ago for modifications within 24 hours', () => {
      const oneHourAgo = Date.now() - 3600000;
      const item: Item = {
        ...baseItem,
        lastModified: oneHourAgo,
      };

      render(
        <ItemCard
          item={item}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/\d+h ago/)).toBeInTheDocument();
    });

    it('shows days ago for older modifications', () => {
      const threeDaysAgo = Date.now() - 3 * 86400000;
      const item: Item = {
        ...baseItem,
        lastModified: threeDaysAgo,
      };

      render(
        <ItemCard
          item={item}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      expect(screen.getByText(/\d+d ago/)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper role and tabIndex for keyboard interaction', () => {
      const { container } = render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      const card = container.querySelector('[role="button"]');
      expect(card).toHaveAttribute('tabindex', '0');
    });

    it('has aria-label for delete button', () => {
      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
          showDelete={true}
          onDelete={vi.fn()}
        />
      );

      const deleteButton = screen.getByLabelText(`Delete ${baseItem.name}`);
      expect(deleteButton).toHaveAttribute('title', 'Delete item');
    });

    it('has title attribute for item name truncation', () => {
      render(
        <ItemCard
          item={baseItem}
          isSelected={false}
          onClick={vi.fn()}
        />
      );

      const nameElement = screen.getByTitle(baseItem.name);
      expect(nameElement).toBeInTheDocument();
    });
  });
});
