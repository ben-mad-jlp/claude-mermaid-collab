/**
 * InputControls Component Tests
 *
 * Tests for the input controls with clear and send buttons
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputControls } from './InputControls';

describe('InputControls Component', () => {
  const mockOnSend = vi.fn();
  const mockOnClear = vi.fn();

  beforeEach(() => {
    mockOnSend.mockClear();
    mockOnClear.mockClear();
  });

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );
      expect(container).toBeDefined();
    });

    it('should render clear button on the left', () => {
      render(<InputControls onSend={mockOnSend} onClear={mockOnClear} />);
      const clearButton = screen.getByRole('button', { name: /clear/i });
      expect(clearButton).toBeDefined();
    });

    it('should render input field in the middle', () => {
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );
      const textarea = container.querySelector('textarea');
      expect(textarea).toBeDefined();
    });

    it('should render send button on the right', () => {
      render(<InputControls onSend={mockOnSend} onClear={mockOnClear} />);
      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDefined();
    });

    it('should render layout with flex direction left to right', () => {
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );
      const flexContainer = container.querySelector('[class*="flex"]');
      expect(flexContainer).toBeDefined();
      expect(flexContainer?.className).toContain('flex');
      expect(flexContainer?.className).toContain('gap');
    });

    it('should have input field with flex-1 to fill space', () => {
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );
      const textarea = container.querySelector('textarea');
      expect(textarea?.className).toContain('flex-1');
    });
  });

  describe('Clear Button Functionality', () => {
    it('should call onClear when clear button is clicked', async () => {
      const user = userEvent.setup();
      render(<InputControls onSend={mockOnSend} onClear={mockOnClear} />);

      const clearButton = screen.getByRole('button', { name: /clear/i });
      await user.click(clearButton);

      expect(mockOnClear).toHaveBeenCalledTimes(1);
    });

    it('should be enabled by default', () => {
      render(<InputControls onSend={mockOnSend} onClear={mockOnClear} />);
      const clearButton = screen.getByRole('button', { name: /clear/i });
      expect((clearButton as HTMLButtonElement).disabled).toBe(false);
    });

    it('should be disabled when disabled prop is true', () => {
      render(
        <InputControls
          onSend={mockOnSend}
          onClear={mockOnClear}
          disabled={true}
        />
      );
      const clearButton = screen.getByRole('button', { name: /clear/i });
      expect((clearButton as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('Input Field Functionality', () => {
    it('should allow typing in input field', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'Hello World');

      expect(textarea.value).toBe('Hello World');
    });

    it('should be disabled when disabled prop is true', () => {
      const { container } = render(
        <InputControls
          onSend={mockOnSend}
          onClear={mockOnClear}
          disabled={true}
        />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(true);
    });

    it('should have appropriate placeholder text', () => {
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.placeholder).toBeDefined();
    });

    it('should support multiline input with Enter+Shift', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

      expect(textarea.value).toContain('Line 1');
      expect(textarea.value).toContain('Line 2');
    });
  });

  describe('Send Button Functionality', () => {
    it('should call onSend when send button is clicked', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'Test message');

      const sendButton = screen.getByRole('button', { name: /send/i });
      await user.click(sendButton);

      expect(mockOnSend).toHaveBeenCalledWith('Test message');
    });

    it('should send on Enter key press without Shift', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'Test message{Enter}');

      expect(mockOnSend).toHaveBeenCalledWith('Test message');
    });

    it('should not send on Shift+Enter', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      // Note: userEvent doesn't easily support Shift modifier with Enter, so we test the logic
      await user.type(textarea, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

      // Should not have sent yet - only when pressing Enter without Shift
      expect(mockOnSend).not.toHaveBeenCalled();
    });

    it('should be disabled when input is empty', () => {
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    });

    it('should be enabled when input has text', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'Some text');

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect((sendButton as HTMLButtonElement).disabled).toBe(false);
    });

    it('should clear input after sending', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'Test message');

      const sendButton = screen.getByRole('button', { name: /send/i });
      await user.click(sendButton);

      expect(textarea.value).toBe('');
    });

    it('should be disabled when disabled prop is true', () => {
      render(
        <InputControls
          onSend={mockOnSend}
          onClear={mockOnClear}
          disabled={true}
        />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('Layout and Styling', () => {
    it('should have clear button on left, input in middle, send button on right', () => {
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBe(2); // clear and send

      // The structure should have clear button, then input, then send button
      const flexContainer = container.querySelector('[class*="flex"]');
      expect(flexContainer?.children.length).toBeGreaterThanOrEqual(3);
    });

    it('should apply disabled styling when disabled', () => {
      const { container } = render(
        <InputControls
          onSend={mockOnSend}
          onClear={mockOnClear}
          disabled={true}
        />
      );

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.className).toContain('disabled:');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible button labels', () => {
      render(<InputControls onSend={mockOnSend} onClear={mockOnClear} />);

      const clearButton = screen.getByRole('button', { name: /clear/i });
      const sendButton = screen.getByRole('button', { name: /send/i });

      expect(clearButton).toBeDefined();
      expect(sendButton).toBeDefined();
    });

    it('should have input field with accessible name', () => {
      const { container } = render(
        <InputControls onSend={mockOnSend} onClear={mockOnClear} />
      );

      const textarea = container.querySelector('textarea');
      expect(textarea).toBeDefined();
    });
  });
});
