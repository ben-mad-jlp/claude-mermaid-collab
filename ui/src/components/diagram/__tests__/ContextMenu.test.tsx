import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMenu, ContextMenuProps } from '../ContextMenu';

describe('ContextMenu', () => {
  let defaultProps: ContextMenuProps;

  beforeEach(() => {
    defaultProps = {
      x: 150,
      y: 200,
      type: 'node',
      targetId: 'node-1',
      onClose: vi.fn(),
      onEditLabel: vi.fn(),
      onChangeType: vi.fn(),
      onDelete: vi.fn(),
      onAddTransition: vi.fn(),
    };
  });

  describe('positioning', () => {
    it('should render menu at specified x, y coordinates', () => {
      render(<ContextMenu {...defaultProps} />);

      const menu = screen.getByRole('menu');
      expect(menu).toBeDefined();
      const style = window.getComputedStyle(menu);
      // Menu should be positioned absolutely
      expect(menu).toHaveStyle(`left: ${defaultProps.x}px`);
      expect(menu).toHaveStyle(`top: ${defaultProps.y}px`);
    });

    it('should render menu at different coordinates', () => {
      const customProps = {
        ...defaultProps,
        x: 300,
        y: 400,
      };
      render(<ContextMenu {...customProps} />);

      const menu = screen.getByRole('menu');
      expect(menu).toHaveStyle('left: 300px');
      expect(menu).toHaveStyle('top: 400px');
    });
  });

  describe('node context menu', () => {
    beforeEach(() => {
      defaultProps.type = 'node';
    });

    it('should show correct options for node type', () => {
      render(<ContextMenu {...defaultProps} />);

      expect(screen.getByText(/Edit Description/i)).toBeDefined();
      expect(screen.getByText(/Add Transition/i)).toBeDefined();
      expect(screen.getByText(/Delete Node/i)).toBeDefined();
    });

    it('should not show edge-only options for node', () => {
      render(<ContextMenu {...defaultProps} />);

      expect(screen.queryByText(/Change Origin/i)).toBeNull();
      expect(screen.queryByText(/Change Destination/i)).toBeNull();
    });

    it('should call onEditLabel when Edit Description is clicked', async () => {
      const user = userEvent.setup();
      render(<ContextMenu {...defaultProps} />);

      const editButton = screen.getByText(/Edit Description/i);
      await user.click(editButton);

      expect(defaultProps.onEditLabel).toHaveBeenCalledWith(defaultProps.targetId);
    });

    it('should call onAddTransition when Add Transition is clicked', async () => {
      const user = userEvent.setup();
      render(<ContextMenu {...defaultProps} />);

      const addTransitionButton = screen.getByText(/Add Transition/i);
      await user.click(addTransitionButton);

      expect(defaultProps.onAddTransition).toHaveBeenCalledWith(defaultProps.targetId);
    });

    it('should call onDelete when Delete Node is clicked', async () => {
      const user = userEvent.setup();
      render(<ContextMenu {...defaultProps} />);

      const deleteButton = screen.getByText(/Delete Node/i);
      await user.click(deleteButton);

      expect(defaultProps.onDelete).toHaveBeenCalledWith(defaultProps.targetId);
    });

    it('should close menu after menu item clicked', async () => {
      const user = userEvent.setup();
      render(<ContextMenu {...defaultProps} />);

      const editButton = screen.getByText(/Edit Description/i);
      await user.click(editButton);

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('edge context menu', () => {
    beforeEach(() => {
      defaultProps.type = 'edge';
      defaultProps.onChangeOrigin = vi.fn();
      defaultProps.onChangeDest = vi.fn();
    });

    it('should show correct options for edge type', () => {
      render(<ContextMenu {...defaultProps} />);

      expect(screen.getByText(/Edit Label/i)).toBeDefined();
      expect(screen.getByText(/Change Origin/i)).toBeDefined();
      expect(screen.getByText(/Change Destination/i)).toBeDefined();
      expect(screen.getByText(/Delete Arrow/i)).toBeDefined();
    });

    it('should not show node-only options for edge', () => {
      render(<ContextMenu {...defaultProps} />);

      expect(screen.queryByText(/Add Transition/i)).toBeNull();
    });

    it('should call onEditLabel when Edit Label is clicked', async () => {
      const user = userEvent.setup();
      render(<ContextMenu {...defaultProps} />);

      const editButton = screen.getByText(/Edit Label/i);
      await user.click(editButton);

      expect(defaultProps.onEditLabel).toHaveBeenCalledWith(defaultProps.targetId);
    });

    it('should call onChangeOrigin when Change Origin is clicked', async () => {
      const user = userEvent.setup();
      render(<ContextMenu {...defaultProps} />);

      const changeOriginButton = screen.getByText(/Change Origin/i);
      await user.click(changeOriginButton);

      expect(defaultProps.onChangeOrigin).toHaveBeenCalledWith(defaultProps.targetId);
    });

    it('should call onChangeDest when Change Destination is clicked', async () => {
      const user = userEvent.setup();
      render(<ContextMenu {...defaultProps} />);

      const changeDestButton = screen.getByText(/Change Destination/i);
      await user.click(changeDestButton);

      expect(defaultProps.onChangeDest).toHaveBeenCalledWith(defaultProps.targetId);
    });

    it('should call onDelete when Delete Arrow is clicked', async () => {
      const user = userEvent.setup();
      render(<ContextMenu {...defaultProps} />);

      const deleteButton = screen.getByText(/Delete Arrow/i);
      await user.click(deleteButton);

      expect(defaultProps.onDelete).toHaveBeenCalledWith(defaultProps.targetId);
    });
  });

  describe('click outside behavior', () => {
    it('should close menu when clicking outside', () => {
      render(<ContextMenu {...defaultProps} />);

      // Click on the document body (outside the menu)
      fireEvent.mouseDown(document.body);

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should close menu when pressing Escape key', () => {
      render(<ContextMenu {...defaultProps} />);

      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should not close menu when clicking inside menu', async () => {
      const user = userEvent.setup();
      render(<ContextMenu {...defaultProps} />);

      const menu = screen.getByRole('menu');
      await user.click(menu);

      // onClose should not be called from clicking inside
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });

  describe('styling and appearance', () => {
    it('should have menu role for accessibility', () => {
      render(<ContextMenu {...defaultProps} />);

      const menu = screen.getByRole('menu');
      expect(menu).toBeDefined();
    });

    it('should have proper styling classes', () => {
      render(<ContextMenu {...defaultProps} />);

      const menu = screen.getByRole('menu');
      expect(menu.className).toContain('bg-');
      expect(menu.className).toContain('border');
      expect(menu.className).toContain('rounded');
      expect(menu.className).toContain('shadow');
    });

    it('should have menu items styled as buttons', () => {
      render(<ContextMenu {...defaultProps} />);

      const buttons = screen.getAllByRole('menuitem');
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((button) => {
        expect(button.className).toMatch(/px|py/); // Has padding
      });
    });

    it('should have proper z-index for visibility', () => {
      render(<ContextMenu {...defaultProps} />);

      const menu = screen.getByRole('menu');
      const style = window.getComputedStyle(menu);
      expect(menu.className).toContain('z-');
    });
  });

  describe('target id passing', () => {
    it('should pass correct targetId to callbacks', async () => {
      const user = userEvent.setup();
      const customTargetId = 'custom-node-123';
      render(
        <ContextMenu {...defaultProps} targetId={customTargetId} />
      );

      const editButton = screen.getByText(/Edit Description/i);
      await user.click(editButton);

      expect(defaultProps.onEditLabel).toHaveBeenCalledWith(customTargetId);
    });

    it('should pass correct targetId for different nodes', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <ContextMenu {...defaultProps} targetId="node-1" />
      );

      let editButton = screen.getByText(/Edit Description/i);
      await user.click(editButton);
      expect(defaultProps.onEditLabel).toHaveBeenCalledWith('node-1');

      defaultProps.onEditLabel = vi.fn();

      rerender(
        <ContextMenu {...defaultProps} targetId="node-2" />
      );

      editButton = screen.getByText(/Edit Description/i);
      await user.click(editButton);
      expect(defaultProps.onEditLabel).toHaveBeenCalledWith('node-2');
    });
  });
});
