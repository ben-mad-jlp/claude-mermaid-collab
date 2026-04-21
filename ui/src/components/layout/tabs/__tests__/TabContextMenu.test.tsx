import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabContextMenu from '../TabContextMenu';

const makeTab = () => ({
  id: 't1',
  kind: 'artifact' as const,
  artifactType: 'diagram' as const,
  artifactId: 'd1',
  name: 'n',
  isPreview: false,
  isPinned: false,
  order: 0,
  openedAt: 0,
});

function renderMenu(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseToRight: vi.fn(),
    onCloseAll: vi.fn(),
    onOpenInRightPane: vi.fn(),
    onPinToggle: vi.fn(),
    onDismiss: vi.fn(),
  };
  const tab = { ...makeTab(), ...(overrides.tab as object || {}) };
  const props = {
    tab,
    x: 100,
    y: 200,
    ...handlers,
    ...overrides,
  };
  const utils = render(<TabContextMenu {...(props as any)} />);
  return { ...utils, ...handlers, props };
}

describe('TabContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all menu items', () => {
    renderMenu();
    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(screen.getByText('Close Others')).toBeInTheDocument();
    expect(screen.getByText('Close to the Right')).toBeInTheDocument();
    expect(screen.getByText('Close All')).toBeInTheDocument();
    expect(screen.getByText('Open in Right Pane')).toBeInTheDocument();
    expect(screen.getByText('Pin Tab')).toBeInTheDocument();
    expect(screen.queryByText('Reveal in Sidebar')).not.toBeInTheDocument();
  });

  it('shows "Unpin Tab" when isPinned=true', () => {
    renderMenu({ tab: { ...makeTab(), isPinned: true } });
    expect(screen.getByText('Unpin Tab')).toBeInTheDocument();
  });

  it('click Close calls onClose and onDismiss', () => {
    const { onClose, onDismiss } = renderMenu();
    fireEvent.click(screen.getByTestId('tab-context-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('click Close Others calls onCloseOthers and onDismiss', () => {
    const { onCloseOthers, onDismiss } = renderMenu();
    fireEvent.click(screen.getByTestId('tab-context-close-others'));
    expect(onCloseOthers).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('click Close to the Right calls onCloseToRight and onDismiss', () => {
    const { onCloseToRight, onDismiss } = renderMenu();
    fireEvent.click(screen.getByTestId('tab-context-close-to-right'));
    expect(onCloseToRight).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('click Pin Tab calls onPinToggle and onDismiss', () => {
    const { onPinToggle, onDismiss } = renderMenu();
    fireEvent.click(screen.getByTestId('tab-context-pin-toggle'));
    expect(onPinToggle).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('click Close All calls onCloseAll and onDismiss', () => {
    const { onCloseAll, onDismiss } = renderMenu();
    fireEvent.click(screen.getByTestId('tab-context-close-all'));
    expect(onCloseAll).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('click Open in Right Pane calls onOpenInRightPane and onDismiss', () => {
    const { onOpenInRightPane, onDismiss } = renderMenu();
    fireEvent.click(screen.getByTestId('tab-context-open-right'));
    expect(onOpenInRightPane).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Escape key calls onDismiss', () => {
    const { onDismiss } = renderMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('outside click calls onDismiss', () => {
    const { onDismiss } = renderMenu();
    fireEvent.mouseDown(document.body);
    expect(onDismiss).toHaveBeenCalled();
  });
});
