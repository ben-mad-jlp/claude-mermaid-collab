import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toast } from '../Toast';
import type { Toast as ToastType } from '@/stores/notificationStore';

// Helper to create a test toast
const createTestToast = (overrides?: Partial<ToastType>): ToastType => ({
  id: 'test-toast-1',
  type: 'info',
  title: 'Test Title',
  message: 'Test message',
  duration: 4000,
  timestamp: Date.now(),
  ...overrides,
});

describe('Toast Component', () => {
  describe('Rendering', () => {
    it('renders with title and message', () => {
      const toast = createTestToast({
        title: 'Success!',
        message: 'Document saved',
      });
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      expect(screen.getByText('Success!')).toBeInTheDocument();
      expect(screen.getByText('Document saved')).toBeInTheDocument();
    });

    it('renders without message when message is undefined', () => {
      const toast = createTestToast({
        title: 'Notification',
        message: undefined,
      });
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      expect(screen.getByText('Notification')).toBeInTheDocument();
    });

    it('renders with correct data-testid', () => {
      const toast = createTestToast({ id: 'custom-id' });
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      expect(screen.getByTestId('toast-custom-id')).toBeInTheDocument();
    });
  });

  describe('Toast Types', () => {
    it('renders with info type styling', () => {
      const toast = createTestToast({ type: 'info' });
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      // The container should have the info-related classes
      const toastDiv = container.querySelector('[role="alert"]');
      expect(toastDiv).toBeInTheDocument();
    });

    it('renders with success type styling', () => {
      const toast = createTestToast({ type: 'success' });
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const toastDiv = container.querySelector('[role="alert"]');
      expect(toastDiv).toBeInTheDocument();
    });

    it('renders with warning type styling', () => {
      const toast = createTestToast({ type: 'warning' });
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const toastDiv = container.querySelector('[role="alert"]');
      expect(toastDiv).toBeInTheDocument();
    });

    it('renders with error type styling', () => {
      const toast = createTestToast({ type: 'error' });
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const toastDiv = container.querySelector('[role="alert"]');
      expect(toastDiv).toBeInTheDocument();
    });
  });

  describe('Close Button', () => {
    it('calls onDismiss when close button is clicked', () => {
      const toast = createTestToast({ id: 'test-id-123' });
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      const closeButton = screen.getByLabelText('Dismiss notification');
      fireEvent.click(closeButton);

      expect(onDismiss).toHaveBeenCalledWith('test-id-123');
    });

    it('passes correct id to onDismiss callback', () => {
      const toastId = 'unique-toast-id';
      const toast = createTestToast({ id: toastId });
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      const closeButton = screen.getByLabelText('Dismiss notification');
      fireEvent.click(closeButton);

      expect(onDismiss).toHaveBeenCalledWith(toastId);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('Icons', () => {
    it('renders appropriate icon for info type', () => {
      const toast = createTestToast({ type: 'info' });
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      // SVG should be present
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });

    it('renders appropriate icon for success type', () => {
      const toast = createTestToast({ type: 'success' });
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });

    it('renders appropriate icon for warning type', () => {
      const toast = createTestToast({ type: 'warning' });
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });

    it('renders appropriate icon for error type', () => {
      const toast = createTestToast({ type: 'error' });
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('has proper role alert for screen readers', () => {
      const toast = createTestToast();
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const alertDiv = container.querySelector('[role="alert"]');
      expect(alertDiv).toBeInTheDocument();
    });

    it('has aria-live polite for screen readers', () => {
      const toast = createTestToast();
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const alertDiv = container.querySelector('[aria-live="polite"]');
      expect(alertDiv).toBeInTheDocument();
    });

    it('close button has proper aria label', () => {
      const toast = createTestToast();
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      const closeButton = screen.getByLabelText('Dismiss notification');
      expect(closeButton).toBeInTheDocument();
    });

    it('icons have aria-hidden attribute', () => {
      const toast = createTestToast();
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const svgs = container.querySelectorAll('svg[aria-hidden="true"]');
      expect(svgs.length).toBeGreaterThan(0);
    });
  });

  describe('Styling', () => {
    it('applies animation classes', () => {
      const toast = createTestToast();
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const alertDiv = container.querySelector('[role="alert"]');
      expect(alertDiv?.className).toContain('animate-slideInRight');
    });

    it('has proper layout structure', () => {
      const toast = createTestToast({
        title: 'Title Text',
        message: 'Message Text',
      });
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const alertDiv = container.querySelector('[role="alert"]');
      expect(alertDiv?.className).toContain('flex');
      expect(alertDiv?.className).toContain('items-start');
      expect(alertDiv?.className).toContain('gap-3');
    });

    it('renders shadow for visual depth', () => {
      const toast = createTestToast();
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const alertDiv = container.querySelector('[role="alert"]');
      expect(alertDiv?.className).toContain('shadow-lg');
    });

    it('has rounded corners', () => {
      const toast = createTestToast();
      const onDismiss = vi.fn();

      const { container } = render(<Toast toast={toast} onDismiss={onDismiss} />);

      const alertDiv = container.querySelector('[role="alert"]');
      expect(alertDiv?.className).toContain('rounded-lg');
    });
  });

  describe('Props Handling', () => {
    it('handles long titles', () => {
      const longTitle = 'This is a very long title that should still display properly';
      const toast = createTestToast({ title: longTitle });
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      expect(screen.getByText(longTitle)).toBeInTheDocument();
    });

    it('handles long messages', () => {
      const longMessage =
        'This is a very long message that should still display properly and wrap to multiple lines if needed';
      const toast = createTestToast({ message: longMessage });
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      expect(screen.getByText(longMessage)).toBeInTheDocument();
    });

    it('handles special characters in title', () => {
      const specialTitle = 'Error: <div> & "quotes"';
      const toast = createTestToast({ title: specialTitle });
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      expect(screen.getByText(specialTitle)).toBeInTheDocument();
    });

    it('handles special characters in message', () => {
      const specialMessage = 'Message: <script> & "quotes"';
      const toast = createTestToast({ message: specialMessage });
      const onDismiss = vi.fn();

      render(<Toast toast={toast} onDismiss={onDismiss} />);

      expect(screen.getByText(specialMessage)).toBeInTheDocument();
    });
  });

  describe('Type Safety', () => {
    it('accepts all notification types', () => {
      const types: Array<'info' | 'success' | 'warning' | 'error'> = [
        'info',
        'success',
        'warning',
        'error',
      ];
      const onDismiss = vi.fn();

      types.forEach((type) => {
        const toast = createTestToast({ type });
        const { unmount } = render(<Toast toast={toast} onDismiss={onDismiss} />);
        unmount();
      });
    });
  });
});
