import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SidebarNodeContextMenu } from '../SidebarNodeContextMenu';
import type { MenuAction } from '../getActionsForNode';

afterEach(() => {
  cleanup();
});

describe('SidebarNodeContextMenu', () => {
  it('renders all actions as menuitems', () => {
    const actions: MenuAction[] = [
      { id: 'a1', label: 'One' },
      { id: 'a2', label: 'Two' },
      { id: 'a3', label: 'Three' },
    ];
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        actions={actions}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
  });

  it('positions menu using x/y props', () => {
    render(
      <SidebarNodeContextMenu
        x={100}
        y={200}
        actions={[{ id: 'a1', label: 'One' }]}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByTestId('sidebar-node-context-menu') as HTMLElement;
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('200px');
  });

  it('calls onAction with action id and closes on click', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        actions={[{ id: 'open', label: 'Open' }]}
        onAction={onAction}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('menuitem'));
    expect(onAction).toHaveBeenCalledWith('open');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onAction when disabled', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        actions={[{ id: 'rename', label: 'Rename', disabled: true }]}
        onAction={onAction}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('menuitem'));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        actions={[{ id: 'a1', label: 'One' }]}
        onAction={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on outside mousedown', () => {
    const onClose = vi.fn();
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        actions={[{ id: 'a1', label: 'One' }]}
        onAction={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders separator before items with separator=true', () => {
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        actions={[
          { id: 'open', label: 'Open' },
          { id: 'delete', label: 'Delete', separator: true },
        ]}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const deleteBtn = screen.getByTestId('menu-item-delete');
    const prev = deleteBtn.previousElementSibling;
    expect(prev).not.toBeNull();
    expect(prev!.className).toContain('border-t');
  });

  it('applies destructive styling', () => {
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        actions={[{ id: 'delete', label: 'Delete', destructive: true }]}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const btn = screen.getByRole('menuitem');
    expect(btn.className).toContain('text-red-700');
  });
});
