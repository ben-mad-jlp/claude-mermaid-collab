/**
 * EditorToolbar Component Tests
 *
 * Test coverage includes:
 * - Component rendering with all controls
 * - Undo/Redo button functionality
 * - Zoom controls (in/out and percentage display)
 * - Rotate button visibility and functionality for diagrams
 * - Rotate button hidden for documents
 * - Overflow menu with additional actions
 * - Unsaved changes indicator
 * - Disabled states for unavailable actions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorToolbar } from '../EditorToolbar';
import { ToolbarAction } from '@/types';

describe('EditorToolbar', () => {
  let mockCallbacks: {
    onUndo: ReturnType<typeof vi.fn>;
    onRedo: ReturnType<typeof vi.fn>;
    onZoomIn: ReturnType<typeof vi.fn>;
    onZoomOut: ReturnType<typeof vi.fn>;
    onRotate: ReturnType<typeof vi.fn>;
    onExportSVG: ReturnType<typeof vi.fn>;
    onExportPNG: ReturnType<typeof vi.fn>;
    onFormat: ReturnType<typeof vi.fn>;
    onAddComment: ReturnType<typeof vi.fn>;
    onApproveAll: ReturnType<typeof vi.fn>;
    onRejectAll: ReturnType<typeof vi.fn>;
    onClearProposals: ReturnType<typeof vi.fn>;
  };

  const defaultProps = {
    itemName: 'Test Diagram',
    hasUnsavedChanges: false,
    canUndo: true,
    canRedo: true,
    zoom: 100,
    overflowActions: [] as ToolbarAction[],
  };

  beforeEach(() => {
    mockCallbacks = {
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onRotate: vi.fn(),
      onExportSVG: vi.fn(),
      onExportPNG: vi.fn(),
      onFormat: vi.fn(),
      onAddComment: vi.fn(),
      onApproveAll: vi.fn(),
      onRejectAll: vi.fn(),
      onClearProposals: vi.fn(),
    };
  });

  describe('Rendering', () => {
    it('should render the toolbar container', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const toolbar = screen.getByTestId('editor-toolbar');
      expect(toolbar).toBeDefined();
    });

    it('should display item name', () => {
      const itemName = 'My Diagram';
      render(
        <EditorToolbar
          {...defaultProps}
          itemName={itemName}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const title = screen.getByTestId('editor-toolbar-title');
      expect(title.textContent).toContain(itemName);
    });

    it('should show unsaved changes indicator when hasUnsavedChanges is true', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          hasUnsavedChanges={true}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const unsavedIndicator = screen.getByTestId('unsaved-indicator');
      expect(unsavedIndicator).toBeDefined();
      expect(unsavedIndicator.textContent).toBe('●');
    });

    it('should not show unsaved indicator when hasUnsavedChanges is false', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          hasUnsavedChanges={false}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const unsavedIndicator = screen.queryByTestId('unsaved-indicator');
      expect(unsavedIndicator).toBeNull();
    });
  });

  describe('Undo/Redo Controls', () => {
    it('should render undo button', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const undoButton = screen.getByTestId('editor-toolbar-undo');
      expect(undoButton).toBeDefined();
    });

    it('should call onUndo when undo button is clicked', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const undoButton = screen.getByTestId('editor-toolbar-undo');
      fireEvent.click(undoButton);

      expect(mockCallbacks.onUndo).toHaveBeenCalledOnce();
    });

    it('should render redo button', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const redoButton = screen.getByTestId('editor-toolbar-redo');
      expect(redoButton).toBeDefined();
    });

    it('should call onRedo when redo button is clicked', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const redoButton = screen.getByTestId('editor-toolbar-redo');
      fireEvent.click(redoButton);

      expect(mockCallbacks.onRedo).toHaveBeenCalledOnce();
    });

    it('should disable undo button when canUndo is false', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          canUndo={false}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const undoButton = screen.getByTestId('editor-toolbar-undo') as HTMLButtonElement;
      expect(undoButton.disabled).toBe(true);
    });

    it('should disable redo button when canRedo is false', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          canRedo={false}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const redoButton = screen.getByTestId('editor-toolbar-redo') as HTMLButtonElement;
      expect(redoButton.disabled).toBe(true);
    });
  });

  describe('Zoom Controls', () => {
    it('should display current zoom level', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          zoom={150}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const zoomLevel = screen.getByTestId('editor-toolbar-zoom-level');
      expect(zoomLevel.textContent).toBe('150%');
    });

    it('should call onZoomIn when zoom in button is clicked', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const zoomInButton = screen.getByTestId('editor-toolbar-zoom-in');
      fireEvent.click(zoomInButton);

      expect(mockCallbacks.onZoomIn).toHaveBeenCalledOnce();
    });

    it('should call onZoomOut when zoom out button is clicked', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const zoomOutButton = screen.getByTestId('editor-toolbar-zoom-out');
      fireEvent.click(zoomOutButton);

      expect(mockCallbacks.onZoomOut).toHaveBeenCalledOnce();
    });
  });

  describe('Rotate Button', () => {
    it('should show rotate button when itemType is "diagram" and canRotate is true', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          itemType="diagram"
          canRotate={true}
          onRotate={mockCallbacks.onRotate}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const rotateButton = screen.getByTestId('editor-toolbar-rotate');
      expect(rotateButton).toBeDefined();
    });

    it('should not show rotate button when itemType is "document"', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          itemType="document"
          canRotate={true}
          onRotate={mockCallbacks.onRotate}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const rotateButton = screen.queryByTestId('editor-toolbar-rotate');
      expect(rotateButton).toBeNull();
    });

    it('should hide rotate button when canRotate is false', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          itemType="diagram"
          canRotate={false}
          onRotate={mockCallbacks.onRotate}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const rotateButton = screen.queryByTestId('editor-toolbar-rotate');
      expect(rotateButton).toBeNull();
    });

    it('should call onRotate when rotate button is clicked', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          itemType="diagram"
          canRotate={true}
          onRotate={mockCallbacks.onRotate}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const rotateButton = screen.getByTestId('editor-toolbar-rotate');
      fireEvent.click(rotateButton);

      expect(mockCallbacks.onRotate).toHaveBeenCalledOnce();
    });

    it('should position rotate button between zoom controls and overflow menu', () => {
      const { container } = render(
        <EditorToolbar
          {...defaultProps}
          itemType="diagram"
          canRotate={true}
          onRotate={mockCallbacks.onRotate}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const toolbar = screen.getByTestId('editor-toolbar');
      const buttons = toolbar.querySelectorAll('button');

      // Find indices of specific buttons
      let zoomInIdx = -1;
      let rotateIdx = -1;
      let overflowIdx = -1;

      buttons.forEach((btn, idx) => {
        if (btn.getAttribute('data-testid') === 'editor-toolbar-zoom-in') {
          zoomInIdx = idx;
        } else if (btn.getAttribute('data-testid') === 'editor-toolbar-rotate') {
          rotateIdx = idx;
        } else if (btn.getAttribute('data-testid') === 'editor-toolbar-overflow') {
          overflowIdx = idx;
        }
      });

      // Rotate should come after zoom-in and before overflow
      expect(zoomInIdx).toBeGreaterThan(-1);
      expect(rotateIdx).toBeGreaterThan(zoomInIdx);
      expect(overflowIdx).toBeGreaterThan(rotateIdx);
    });
  });

  describe('Overflow Menu', () => {
    it('should render overflow menu button', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const overflowButton = screen.getByTestId('editor-toolbar-overflow');
      expect(overflowButton).toBeDefined();
    });

    it('should toggle overflow menu when menu button is clicked', async () => {
      render(
        <EditorToolbar
          {...defaultProps}
          overflowActions={[
            {
              id: 'test-action',
              label: 'Test Action',
              onClick: vi.fn(),
              icon: <span>Test Icon</span>,
            },
          ]}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const overflowButton = screen.getByTestId('editor-toolbar-overflow');
      fireEvent.click(overflowButton);

      await waitFor(() => {
        const menu = screen.getByTestId('editor-toolbar-overflow-menu');
        expect(menu).toBeDefined();
      });
    });

    it('should close overflow menu when action is clicked', async () => {
      const actionCallback = vi.fn();
      render(
        <EditorToolbar
          {...defaultProps}
          overflowActions={[
            {
              id: 'test-action',
              label: 'Test Action',
              onClick: actionCallback,
              icon: <span>Test Icon</span>,
            },
          ]}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const overflowButton = screen.getByTestId('editor-toolbar-overflow');
      fireEvent.click(overflowButton);

      await waitFor(() => {
        const menu = screen.getByTestId('editor-toolbar-overflow-menu');
        expect(menu).toBeDefined();
      });

      const actionButton = screen.getByTestId('overflow-action-test-action');
      fireEvent.click(actionButton);

      expect(actionCallback).toHaveBeenCalledOnce();

      await waitFor(() => {
        const closedMenu = screen.queryByTestId('editor-toolbar-overflow-menu');
        expect(closedMenu).toBeNull();
      });
    });
  });

  describe('Center and Fit buttons', () => {
    it('should render center button when onCenter is provided', () => {
      const onCenter = vi.fn();
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
          onCenter={onCenter}
        />
      );

      const centerButton = screen.getByTestId('editor-toolbar-center');
      expect(centerButton).toBeDefined();
    });

    it('should not render center button when onCenter is not provided', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const centerButton = screen.queryByTestId('editor-toolbar-center');
      expect(centerButton).toBeNull();
    });

    it('should call onCenter when center button is clicked', () => {
      const onCenter = vi.fn();
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
          onCenter={onCenter}
        />
      );

      const centerButton = screen.getByTestId('editor-toolbar-center');
      fireEvent.click(centerButton);

      expect(onCenter).toHaveBeenCalledOnce();
    });

    it('should render fit-to-view button when onFitToView is provided', () => {
      const onFitToView = vi.fn();
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
          onFitToView={onFitToView}
        />
      );

      const fitButton = screen.getByTestId('editor-toolbar-fit');
      expect(fitButton).toBeDefined();
    });

    it('should not render fit-to-view button when onFitToView is not provided', () => {
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
        />
      );

      const fitButton = screen.queryByTestId('editor-toolbar-fit');
      expect(fitButton).toBeNull();
    });

    it('should call onFitToView when fit button is clicked', () => {
      const onFitToView = vi.fn();
      render(
        <EditorToolbar
          {...defaultProps}
          onUndo={mockCallbacks.onUndo}
          onRedo={mockCallbacks.onRedo}
          onZoomIn={mockCallbacks.onZoomIn}
          onZoomOut={mockCallbacks.onZoomOut}
          onFitToView={onFitToView}
        />
      );

      const fitButton = screen.getByTestId('editor-toolbar-fit');
      fireEvent.click(fitButton);

      expect(onFitToView).toHaveBeenCalledOnce();
    });
  });
});
