import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropertiesPane } from '../PropertiesPane';

describe('PropertiesPane', () => {
  const mockOnAddState = vi.fn();
  const mockOnAddTransition = vi.fn();
  const mockOnEditProperties = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render the properties pane container', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByTestId('properties-pane')).toBeDefined();
    });

    it('should render with proper Tailwind styling classes', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const pane = screen.getByTestId('properties-pane');
      expect(pane.className).toContain('w-80');
      expect(pane.className).toContain('bg-white');
      expect(pane.className).toContain('border');
    });
  });

  describe('Add State button', () => {
    it('should render Add State button', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByTestId('add-state-button')).toBeDefined();
    });

    it('should call onAddState when Add State button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const button = screen.getByTestId('add-state-button');
      await user.click(button);

      expect(mockOnAddState).toHaveBeenCalledTimes(1);
    });

    it('should render Add State button even when no node is selected', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByTestId('add-state-button')).toBeDefined();
    });
  });

  describe('No selection state', () => {
    it('should show "No state selected" message when selectedNodeId is null', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByText('No state selected')).toBeDefined();
    });

    it('should show "No state selected" message when selectedNodeId is empty string', () => {
      render(
        <PropertiesPane
          selectedNodeId=""
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByText('No state selected')).toBeDefined();
    });

    it('should not render Add Transition button when no node is selected', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.queryByTestId('add-transition-button')).toBeNull();
    });
  });

  describe('Node selection', () => {
    it('should display selected node ID when provided', () => {
      render(
        <PropertiesPane
          selectedNodeId="state1"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByText(/state1/)).toBeDefined();
    });

    it('should not show "No state selected" message when node is selected', () => {
      render(
        <PropertiesPane
          selectedNodeId="state1"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.queryByText('No state selected')).toBeNull();
    });
  });

  describe('Add Transition button', () => {
    it('should render Add Transition button when node is selected', () => {
      render(
        <PropertiesPane
          selectedNodeId="state1"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByTestId('add-transition-button')).toBeDefined();
    });

    it('should not render Add Transition button when no node is selected', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.queryByTestId('add-transition-button')).toBeNull();
    });

    it('should call onAddTransition with selectedNodeId when button is clicked', async () => {
      const user = userEvent.setup();
      const selectedNodeId = 'state1';

      render(
        <PropertiesPane
          selectedNodeId={selectedNodeId}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const button = screen.getByTestId('add-transition-button');
      await user.click(button);

      expect(mockOnAddTransition).toHaveBeenCalledWith(selectedNodeId);
      expect(mockOnAddTransition).toHaveBeenCalledTimes(1);
    });

    it('should pass correct nodeId to onAddTransition for different nodes', async () => {
      const user = userEvent.setup();

      const { rerender } = render(
        <PropertiesPane
          selectedNodeId="state1"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const button1 = screen.getByTestId('add-transition-button');
      await user.click(button1);

      expect(mockOnAddTransition).toHaveBeenCalledWith('state1');

      // Change selected node
      rerender(
        <PropertiesPane
          selectedNodeId="state2"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const button2 = screen.getByTestId('add-transition-button');
      await user.click(button2);

      expect(mockOnAddTransition).toHaveBeenLastCalledWith('state2');
      expect(mockOnAddTransition).toHaveBeenCalledTimes(2);
    });
  });

  describe('Property editing', () => {
    it('should render property fields when node is selected', () => {
      render(
        <PropertiesPane
          selectedNodeId="state1"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      // Should have property input fields
      const inputs = screen.getAllByRole('textbox');
      expect(inputs.length).toBeGreaterThan(0);
    });

    it('should not render property fields when no node is selected', () => {
      const { container } = render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      // Should not have property input section for editing
      const inputs = container.querySelectorAll('input[type="text"]');
      const editPropertyInputs = Array.from(inputs).filter(
        (input) =>
          input.getAttribute('placeholder') &&
          input.getAttribute('placeholder')?.includes('property')
      );

      expect(editPropertyInputs.length).toBe(0);
    });

    it('should call onEditProperties when property field is updated', async () => {
      const user = userEvent.setup();

      render(
        <PropertiesPane
          selectedNodeId="state1"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const inputs = screen.getAllByRole('textbox');
      const firstInput = inputs[0];

      await user.clear(firstInput);
      await user.type(firstInput, 'new value');

      // Should be called during/after typing
      expect(mockOnEditProperties).toHaveBeenCalled();
    });

    it('should include nodeId in onEditProperties callback', async () => {
      const user = userEvent.setup();
      const selectedNodeId = 'state1';

      render(
        <PropertiesPane
          selectedNodeId={selectedNodeId}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const inputs = screen.getAllByRole('textbox');
      const firstInput = inputs[0];

      await user.clear(firstInput);
      await user.type(firstInput, 'test value');

      expect(mockOnEditProperties).toHaveBeenCalledWith(
        selectedNodeId,
        expect.any(Object)
      );
    });

    it('should pass property object with correct structure to callback', async () => {
      const user = userEvent.setup();

      render(
        <PropertiesPane
          selectedNodeId="state1"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const inputs = screen.getAllByRole('textbox');
      const firstInput = inputs[0];

      await user.clear(firstInput);
      await user.type(firstInput, 'test value');

      const callArgs = mockOnEditProperties.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs[0]).toBe('state1');
      expect(typeof callArgs[1]).toBe('object');
      expect(callArgs[1]).not.toBeNull();
    });
  });

  describe('Styling and layout', () => {
    it('should have proper background color', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const pane = screen.getByTestId('properties-pane');
      expect(pane.className).toContain('bg-white');
    });

    it('should have proper border styling', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const pane = screen.getByTestId('properties-pane');
      expect(pane.className).toContain('border');
    });

    it('should have proper padding', () => {
      render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const pane = screen.getByTestId('properties-pane');
      expect(pane.className).toMatch(/p-\d+/);
    });

    it('should have consistent button styling', () => {
      render(
        <PropertiesPane
          selectedNodeId="state1"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);

      buttons.forEach((button) => {
        // Should have some common button classes
        expect(button.className.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Props interface compliance', () => {
    it('should accept all required props', () => {
      expect(() => {
        render(
          <PropertiesPane
            selectedNodeId="state1"
            onAddState={mockOnAddState}
            onAddTransition={mockOnAddTransition}
            onEditProperties={mockOnEditProperties}
          />
        );
      }).not.toThrow();
    });

    it('should accept null selectedNodeId', () => {
      expect(() => {
        render(
          <PropertiesPane
            selectedNodeId={null}
            onAddState={mockOnAddState}
            onAddTransition={mockOnAddTransition}
            onEditProperties={mockOnEditProperties}
          />
        );
      }).not.toThrow();
    });

    it('should handle all callback props being called', () => {
      const onAddState = vi.fn();
      const onAddTransition = vi.fn();
      const onEditProperties = vi.fn();

      expect(() => {
        render(
          <PropertiesPane
            selectedNodeId={null}
            onAddState={onAddState}
            onAddTransition={onAddTransition}
            onEditProperties={onEditProperties}
          />
        );
      }).not.toThrow();
    });
  });

  describe('Component lifecycle', () => {
    it('should render without errors', () => {
      expect(() => {
        render(
          <PropertiesPane
            selectedNodeId={null}
            onAddState={mockOnAddState}
            onAddTransition={mockOnAddTransition}
            onEditProperties={mockOnEditProperties}
          />
        );
      }).not.toThrow();
    });

    it('should unmount without errors', () => {
      const { unmount } = render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(() => unmount()).not.toThrow();
    });

    it('should handle prop updates', () => {
      const { rerender } = render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(() => {
        rerender(
          <PropertiesPane
            selectedNodeId="state1"
            onAddState={mockOnAddState}
            onAddTransition={mockOnAddTransition}
            onEditProperties={mockOnEditProperties}
          />
        );
      }).not.toThrow();
    });

    it('should handle selectedNodeId changes', () => {
      const { rerender } = render(
        <PropertiesPane
          selectedNodeId="state1"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByText(/state1/)).toBeDefined();

      rerender(
        <PropertiesPane
          selectedNodeId="state2"
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByText(/state2/)).toBeDefined();
    });

    it('should handle callback prop updates', () => {
      const newOnAddState = vi.fn();

      const { rerender } = render(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={mockOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      rerender(
        <PropertiesPane
          selectedNodeId={null}
          onAddState={newOnAddState}
          onAddTransition={mockOnAddTransition}
          onEditProperties={mockOnEditProperties}
        />
      );

      expect(screen.getByTestId('properties-pane')).toBeDefined();
    });
  });
});
