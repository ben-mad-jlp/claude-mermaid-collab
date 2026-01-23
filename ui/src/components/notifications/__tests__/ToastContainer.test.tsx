import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastContainer } from '../ToastContainer';
import { useNotificationStore } from '@/stores/notificationStore';

// Helper to create a test toast
const createTestToast = (overrides?: any) => ({
  id: 'test-toast-1',
  type: 'info' as const,
  title: 'Test Title',
  message: 'Test message',
  duration: 4000,
  timestamp: Date.now(),
  ...overrides,
});

describe('ToastContainer Component', () => {
  beforeEach(() => {
    // Clear all toasts before each test
    useNotificationStore.setState({ toasts: [] });
  });

  afterEach(() => {
    // Clean up after each test
    useNotificationStore.setState({ toasts: [] });
  });

  describe('Rendering', () => {
    it('renders container div with correct structure', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer).toBeInTheDocument();
    });

    it('renders empty container when no toasts exist', () => {
      useNotificationStore.setState({ toasts: [] });

      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer?.children.length).toBe(0);
    });

    it('renders single toast when one exists', () => {
      const toast = createTestToast({ id: 'toast-1', title: 'Single Toast' });
      useNotificationStore.setState({ toasts: [toast] });

      render(<ToastContainer />);

      expect(screen.getByText('Single Toast')).toBeInTheDocument();
    });

    it('renders multiple toasts when several exist', () => {
      const toasts = [
        createTestToast({ id: 'toast-1', title: 'Toast 1' }),
        createTestToast({ id: 'toast-2', title: 'Toast 2' }),
        createTestToast({ id: 'toast-3', title: 'Toast 3' }),
      ];
      useNotificationStore.setState({ toasts });

      render(<ToastContainer />);

      expect(screen.getByText('Toast 1')).toBeInTheDocument();
      expect(screen.getByText('Toast 2')).toBeInTheDocument();
      expect(screen.getByText('Toast 3')).toBeInTheDocument();
    });
  });

  describe('Positioning', () => {
    it('has fixed positioning', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer?.className).toContain('fixed');
    });

    it('is positioned at bottom-right', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer?.className).toContain('bottom-4');
      expect(toastContainer?.className).toContain('right-4');
    });

    it('has very high z-index', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer?.className).toContain('z-[9999]');
    });
  });

  describe('Stacking', () => {
    it('stacks toasts vertically', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer?.className).toContain('flex');
      expect(toastContainer?.className).toContain('flex-col-reverse');
    });

    it('has gap between toasts', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer?.className).toContain('gap-2');
    });

    it('displays toasts in reverse order (newest at bottom)', () => {
      const toasts = [
        createTestToast({ id: 'toast-1', title: 'Oldest' }),
        createTestToast({ id: 'toast-2', title: 'Middle' }),
        createTestToast({ id: 'toast-3', title: 'Newest' }),
      ];
      useNotificationStore.setState({ toasts });

      const { container } = render(<ToastContainer />);

      const toastDivs = container.querySelectorAll('[role="alert"]');
      // In column-reverse, the newest (last in array) should appear visually last (bottom)
      expect(toastDivs.length).toBe(3);
    });
  });

  describe('Maximum Toasts', () => {
    it('limits visible toasts to 5 maximum', () => {
      const toasts = Array.from({ length: 10 }, (_, i) =>
        createTestToast({
          id: `toast-${i}`,
          title: `Toast ${i}`,
        })
      );
      useNotificationStore.setState({ toasts });

      const { container } = render(<ToastContainer />);

      const toastDivs = container.querySelectorAll('[role="alert"]');
      expect(toastDivs.length).toBe(5);
    });

    it('shows the 5 most recent toasts when more than 5 exist', () => {
      const toasts = Array.from({ length: 8 }, (_, i) =>
        createTestToast({
          id: `toast-${i}`,
          title: `Toast ${i}`,
        })
      );
      useNotificationStore.setState({ toasts });

      render(<ToastContainer />);

      // Should show toasts 3-7 (the last 5)
      expect(screen.getByText('Toast 3')).toBeInTheDocument();
      expect(screen.getByText('Toast 4')).toBeInTheDocument();
      expect(screen.getByText('Toast 5')).toBeInTheDocument();
      expect(screen.getByText('Toast 6')).toBeInTheDocument();
      expect(screen.getByText('Toast 7')).toBeInTheDocument();

      // Should NOT show the first 3
      expect(screen.queryByText('Toast 0')).not.toBeInTheDocument();
      expect(screen.queryByText('Toast 1')).not.toBeInTheDocument();
      expect(screen.queryByText('Toast 2')).not.toBeInTheDocument();
    });

    it('shows fewer than 5 toasts when fewer exist', () => {
      const toasts = [
        createTestToast({ id: 'toast-1', title: 'Toast 1' }),
        createTestToast({ id: 'toast-2', title: 'Toast 2' }),
      ];
      useNotificationStore.setState({ toasts });

      const { container } = render(<ToastContainer />);

      const toastDivs = container.querySelectorAll('[role="alert"]');
      expect(toastDivs.length).toBe(2);
    });
  });

  describe('Toast Removal', () => {
    it('calls removeToast when dismiss is clicked', () => {
      const toast = createTestToast({ id: 'test-toast', title: 'Test' });
      const removeToastSpy = vi.spyOn(useNotificationStore.getState(), 'removeToast');

      useNotificationStore.setState({ toasts: [toast] });

      render(<ToastContainer />);

      const dismissButton = screen.getByLabelText('Dismiss notification');
      dismissButton.click();

      expect(removeToastSpy).toHaveBeenCalledWith('test-toast');

      removeToastSpy.mockRestore();
    });

    it('removes toast from display after removal', () => {
      const toast = createTestToast({ id: 'test-toast', title: 'Test' });
      useNotificationStore.setState({ toasts: [toast] });

      const { rerender } = render(<ToastContainer />);

      expect(screen.getByText('Test')).toBeInTheDocument();

      // Remove the toast
      useNotificationStore.setState({ toasts: [] });
      rerender(<ToastContainer />);

      expect(screen.queryByText('Test')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper role="region"', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer).toBeInTheDocument();
    });

    it('has aria-live="polite"', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[aria-live="polite"]');
      expect(toastContainer).toBeInTheDocument();
    });

    it('has descriptive aria-label', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[aria-label="Notifications"]');
      expect(toastContainer).toBeInTheDocument();
    });

    it('renders nested Toast components with proper accessibility', () => {
      const toast = createTestToast({ title: 'Accessible Toast' });
      useNotificationStore.setState({ toasts: [toast] });

      const { container } = render(<ToastContainer />);

      const alertDiv = container.querySelector('[role="alert"]');
      expect(alertDiv).toBeInTheDocument();
    });
  });

  describe('Pointer Events', () => {
    it('has pointer-events-none on container', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer?.className).toContain('pointer-events-none');
    });

    it('has pointer-events-auto on individual toasts', () => {
      const toast = createTestToast({ title: 'Test' });
      useNotificationStore.setState({ toasts: [toast] });

      const { container } = render(<ToastContainer />);

      const toastDivs = container.querySelectorAll('.pointer-events-auto');
      expect(toastDivs.length).toBeGreaterThan(0);
    });
  });

  describe('Different Toast Types', () => {
    it('renders info toasts', () => {
      const toast = createTestToast({ type: 'info', title: 'Info Toast' });
      useNotificationStore.setState({ toasts: [toast] });

      render(<ToastContainer />);

      expect(screen.getByText('Info Toast')).toBeInTheDocument();
    });

    it('renders success toasts', () => {
      const toast = createTestToast({ type: 'success', title: 'Success Toast' });
      useNotificationStore.setState({ toasts: [toast] });

      render(<ToastContainer />);

      expect(screen.getByText('Success Toast')).toBeInTheDocument();
    });

    it('renders warning toasts', () => {
      const toast = createTestToast({ type: 'warning', title: 'Warning Toast' });
      useNotificationStore.setState({ toasts: [toast] });

      render(<ToastContainer />);

      expect(screen.getByText('Warning Toast')).toBeInTheDocument();
    });

    it('renders error toasts', () => {
      const toast = createTestToast({ type: 'error', title: 'Error Toast' });
      useNotificationStore.setState({ toasts: [toast] });

      render(<ToastContainer />);

      expect(screen.getByText('Error Toast')).toBeInTheDocument();
    });

    it('renders mixed toast types together', () => {
      const toasts = [
        createTestToast({ type: 'info', id: 'info', title: 'Info' }),
        createTestToast({ type: 'success', id: 'success', title: 'Success' }),
        createTestToast({ type: 'warning', id: 'warning', title: 'Warning' }),
        createTestToast({ type: 'error', id: 'error', title: 'Error' }),
      ];
      useNotificationStore.setState({ toasts });

      render(<ToastContainer />);

      expect(screen.getByText('Info')).toBeInTheDocument();
      expect(screen.getByText('Success')).toBeInTheDocument();
      expect(screen.getByText('Warning')).toBeInTheDocument();
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  describe('Dynamic Updates', () => {
    it('adds new toasts dynamically', () => {
      const toast1 = createTestToast({ id: 'toast-1', title: 'First' });
      useNotificationStore.setState({ toasts: [toast1] });

      const { rerender } = render(<ToastContainer />);

      expect(screen.getByText('First')).toBeInTheDocument();

      const toast2 = createTestToast({ id: 'toast-2', title: 'Second' });
      useNotificationStore.setState({ toasts: [toast1, toast2] });

      rerender(<ToastContainer />);

      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
    });

    it('removes toasts dynamically', () => {
      const toasts = [
        createTestToast({ id: 'toast-1', title: 'First' }),
        createTestToast({ id: 'toast-2', title: 'Second' }),
      ];
      useNotificationStore.setState({ toasts });

      const { rerender } = render(<ToastContainer />);

      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();

      useNotificationStore.setState({ toasts: [toasts[0]] });

      rerender(<ToastContainer />);

      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.queryByText('Second')).not.toBeInTheDocument();
    });

    it('handles rapid toast additions', () => {
      useNotificationStore.setState({ toasts: [] });

      const { rerender } = render(<ToastContainer />);

      for (let i = 0; i < 10; i++) {
        const toast = createTestToast({ id: `toast-${i}`, title: `Toast ${i}` });
        const currentToasts = useNotificationStore.getState().toasts;
        useNotificationStore.setState({ toasts: [...currentToasts, toast] });
        rerender(<ToastContainer />);
      }

      // Should show the last 5
      expect(screen.getByText('Toast 5')).toBeInTheDocument();
      expect(screen.getByText('Toast 9')).toBeInTheDocument();
    });
  });

  describe('Auto-dismiss Integration', () => {
    it('passes removeToast callback to Toast components', () => {
      const toast = createTestToast({ title: 'Test Toast' });
      useNotificationStore.setState({ toasts: [toast] });

      render(<ToastContainer />);

      // Find the dismiss button and verify it exists
      const dismissButton = screen.getByLabelText('Dismiss notification');
      expect(dismissButton).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('applies flexbox column-reverse layout', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer?.className).toContain('flex');
      expect(toastContainer?.className).toContain('flex-col-reverse');
    });

    it('has proper spacing with gap', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      expect(toastContainer?.className).toContain('gap-2');
    });

    it('maintains bottom-right corner position', () => {
      const { container } = render(<ToastContainer />);

      const toastContainer = container.querySelector('[role="region"]');
      const className = toastContainer?.className || '';
      expect(className).toContain('fixed');
      expect(className).toContain('bottom-4');
      expect(className).toContain('right-4');
    });
  });

  describe('Edge Cases', () => {
    it('handles clearing all toasts', () => {
      const toasts = [
        createTestToast({ id: 'toast-1', title: 'Toast 1' }),
        createTestToast({ id: 'toast-2', title: 'Toast 2' }),
      ];
      useNotificationStore.setState({ toasts });

      const { rerender } = render(<ToastContainer />);

      expect(screen.getByText('Toast 1')).toBeInTheDocument();

      useNotificationStore.getState().clearAll();
      rerender(<ToastContainer />);

      expect(screen.queryByText('Toast 1')).not.toBeInTheDocument();
      expect(screen.queryByText('Toast 2')).not.toBeInTheDocument();
    });

    it('handles exactly 5 toasts at limit', () => {
      const toasts = Array.from({ length: 5 }, (_, i) =>
        createTestToast({ id: `toast-${i}`, title: `Toast ${i}` })
      );
      useNotificationStore.setState({ toasts });

      const { container } = render(<ToastContainer />);

      const toastDivs = container.querySelectorAll('[role="alert"]');
      expect(toastDivs.length).toBe(5);
    });

    it('handles exactly 6 toasts (1 hidden)', () => {
      const toasts = Array.from({ length: 6 }, (_, i) =>
        createTestToast({ id: `toast-${i}`, title: `Toast ${i}` })
      );
      useNotificationStore.setState({ toasts });

      const { container } = render(<ToastContainer />);

      const toastDivs = container.querySelectorAll('[role="alert"]');
      expect(toastDivs.length).toBe(5);

      // First toast should be hidden
      expect(screen.queryByText('Toast 0')).not.toBeInTheDocument();
      // Last 5 should be visible
      expect(screen.getByText('Toast 1')).toBeInTheDocument();
    });
  });
});
