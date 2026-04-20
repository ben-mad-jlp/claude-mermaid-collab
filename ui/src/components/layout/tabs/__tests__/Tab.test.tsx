import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Tab from '../Tab';

function makeTab(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    kind: 'artifact',
    artifactType: 'diagram',
    artifactId: 'd1',
    name: 'My Diagram',
    isPreview: false,
    isPinned: false,
    order: 0,
    openedAt: 0,
    ...overrides,
  };
}

const noop = () => {};

describe('Tab', () => {
  it('renders name and an svg icon', () => {
    const tab = makeTab();
    const { container } = render(
      <Tab
        tab={tab as any}
        isActive={false}
        onClick={noop}
        onClose={noop}
        onContextMenu={noop}
      />
    );
    expect(screen.getByText('My Diagram')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('applies active classes when isActive=true', () => {
    const tab = makeTab();
    const { container } = render(
      <Tab
        tab={tab as any}
        isActive={true}
        onClick={noop}
        onClose={noop}
        onContextMenu={noop}
      />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('bg-accent-100');
    expect(root.className).toContain('border-accent-700');
  });

  it('calls onClose when × clicked, not parent onClick', () => {
    const onClose = vi.fn();
    const onClick = vi.fn();
    const tab = makeTab();
    render(
      <Tab
        tab={tab as any}
        isActive={false}
        onClick={onClick}
        onClose={onClose}
        onContextMenu={noop}
      />
    );
    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders name in italic when isPreview=true', () => {
    const tab = makeTab({ isPreview: true });
    render(
      <Tab
        tab={tab as any}
        isActive={false}
        onClick={noop}
        onClose={noop}
        onContextMenu={noop}
      />
    );
    const nameSpan = screen.getByText('My Diagram');
    expect(nameSpan.className).toContain('italic');
  });

  it('calls onContextMenu on right-click', () => {
    const onContextMenu = vi.fn();
    const tab = makeTab();
    const { container } = render(
      <Tab
        tab={tab as any}
        isActive={false}
        onClick={noop}
        onClose={noop}
        onContextMenu={onContextMenu}
      />
    );
    const root = container.firstChild as HTMLElement;
    fireEvent.contextMenu(root);
    expect(onContextMenu).toHaveBeenCalled();
  });
});
