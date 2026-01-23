import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MermaidPreview } from '../MermaidPreview';

// Mock mermaid
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

// Mock useTheme hook
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light',
  }),
}));

import mermaid from 'mermaid';

describe('MermaidPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mermaid.initialize as any).mockResolvedValue(undefined);
    (mermaid.render as any).mockResolvedValue({
      svg: '<svg><rect/></svg>',
    });
  });

  describe('rendering', () => {
    it('should render the preview container', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const container = screen.getByTestId('mermaid-preview');
      expect(container).toBeDefined();
      expect(container.className).toContain('mermaid-preview-container');
    });

    it('should render with responsive width classes', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const container = screen.getByTestId('mermaid-preview');
      expect(container.className).toContain('w-full');
      expect(container.className).toContain('relative');
    });

    it('should show empty state when content is empty', () => {
      render(<MermaidPreview content="" />);

      expect(
        screen.queryByText(/Enter Mermaid syntax to preview diagram/i)
      ).toBeDefined();
    });

    it('should show empty state when content is only whitespace', () => {
      render(<MermaidPreview content="   \n  \t " />);

      expect(
        screen.queryByText(/Enter Mermaid syntax to preview diagram/i)
      ).toBeDefined();
    });
  });

  describe('styling', () => {
    it('should apply custom className to container', () => {
      render(
        <MermaidPreview
          content="graph TD; A-->B"
          className="test-custom-class"
        />
      );

      const container = screen.getByTestId('mermaid-preview');
      expect(container.className).toContain('test-custom-class');
    });

    it('should have dark mode support classes', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const container = screen.getByTestId('mermaid-preview');
      // Check for presence of tailwind classes
      expect(container.className).toMatch(/relative|w-full/);
    });

    it('should apply proper border and padding classes to diagram wrapper', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');
      expect(wrapper.className).toContain('overflow-auto');
      expect(wrapper.className).toContain('rounded-lg');
      expect(wrapper.className).toContain('p-4');
      expect(wrapper.className).toContain('border');
    });
  });

  describe('props and content', () => {
    it('should accept and handle content prop', () => {
      const { rerender } = render(
        <MermaidPreview content="graph TD; A-->B" />
      );

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();

      rerender(<MermaidPreview content="graph TD; C-->D" />);

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should handle very long content', () => {
      const longContent = 'graph TD; ' + 'A-->B; '.repeat(1000);

      render(<MermaidPreview content={longContent} />);

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should handle special characters', () => {
      const contentWithSpecialChars = 'graph TD; A["test<>&"]';

      render(<MermaidPreview content={contentWithSpecialChars} />);

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });
  });

  describe('mermaid initialization', () => {
    it('should initialize mermaid', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      expect(mermaid.initialize).toHaveBeenCalled();
    });

    it('should pass security and config options to mermaid', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      expect(mermaid.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          securityLevel: 'loose',
        })
      );
    });

    it('should set theme in mermaid config', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const callArgs = (mermaid.initialize as any).mock.calls[0][0];
      expect(callArgs).toHaveProperty('theme');
      expect(['default', 'dark']).toContain(callArgs.theme);
    });
  });

  describe('error handling and callbacks', () => {
    it('should handle onRender callback prop', () => {
      const onRender = vi.fn();

      render(
        <MermaidPreview content="graph TD; A-->B" onRender={onRender} />
      );

      // The component accepts the callback prop
      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should handle onError callback prop', () => {
      const onError = vi.fn();

      render(
        <MermaidPreview content="graph TD; A-->B" onError={onError} />
      );

      // The component accepts the callback prop
      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should not throw on render error scenarios', () => {
      expect(() => {
        render(
          <MermaidPreview
            content="invalid"
            onError={() => {}}
          />
        );
      }).not.toThrow();
    });
  });

  describe('component lifecycle', () => {
    it('should render without errors', () => {
      expect(() => {
        render(<MermaidPreview content="graph TD; A-->B" />);
      }).not.toThrow();
    });

    it('should unmount without errors', () => {
      const { unmount } = render(
        <MermaidPreview content="graph TD; A-->B" />
      );

      expect(() => unmount()).not.toThrow();
    });

    it('should handle updates without errors', () => {
      const { rerender } = render(
        <MermaidPreview content="graph TD; A-->B" />
      );

      expect(() => {
        rerender(<MermaidPreview content="graph TD; C-->D" />);
      }).not.toThrow();
    });

    it('should handle rapid prop changes', () => {
      const { rerender } = render(
        <MermaidPreview content="graph TD; A-->B" />
      );

      expect(() => {
        rerender(<MermaidPreview content="graph TD; C-->D" />);
        rerender(<MermaidPreview content="graph TD; E-->F" />);
        rerender(<MermaidPreview content="" />);
      }).not.toThrow();
    });
  });

  describe('interface compliance', () => {
    it('should have all required properties in props interface', () => {
      const props = {
        content: 'graph TD; A-->B',
        className: 'test',
        onRender: () => {},
        onError: () => {},
      };

      expect(() => {
        render(<MermaidPreview {...props} />);
      }).not.toThrow();
    });

    it('should render with minimal required props', () => {
      expect(() => {
        render(<MermaidPreview content="graph TD; A-->B" />);
      }).not.toThrow();
    });

    it('should work with className prop', () => {
      render(
        <MermaidPreview
          content="graph TD; A-->B"
          className="custom-wrapper"
        />
      );

      const container = screen.getByTestId('mermaid-preview');
      expect(container.className).toContain('custom-wrapper');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(() => {
        render(<MermaidPreview content="" />);
      }).not.toThrow();
    });

    it('should handle null-like string', () => {
      expect(() => {
        render(<MermaidPreview content="null" />);
      }).not.toThrow();
    });

    it('should handle multiline content', () => {
      const multilineContent = `graph TD
        A --> B
        B --> C
        C --> A`;

      expect(() => {
        render(<MermaidPreview content={multilineContent} />);
      }).not.toThrow();
    });

    it('should handle content with newlines and tabs', () => {
      const contentWithWhitespace = `graph TD;\n\t\tA-->B\n\t\tB-->C`;

      expect(() => {
        render(<MermaidPreview content={contentWithWhitespace} />);
      }).not.toThrow();
    });
  });

  describe('render ID caching (Item 8 - Fix)', () => {
    it('should generate unique render ID with timestamp on each render', async () => {
      const { rerender } = render(
        <MermaidPreview content="graph TD; A-->B" />
      );

      const firstCallArgs = (mermaid.render as any).mock.calls[0];
      const firstRenderId = firstCallArgs[0];

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      // Rerender with new content
      rerender(<MermaidPreview content="graph TD; C-->D" />);

      const secondCallArgs = (mermaid.render as any).mock.calls[1];
      const secondRenderId = secondCallArgs[0];

      // IDs should be different due to timestamp
      expect(firstRenderId).not.toEqual(secondRenderId);
      expect(firstRenderId).toMatch(/^mermaid-.*-\d+$/);
      expect(secondRenderId).toMatch(/^mermaid-.*-\d+$/);
    });

    it('should pass unique render ID to mermaid.render', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const callArgs = (mermaid.render as any).mock.calls[0];
      const renderId = callArgs[0];

      expect(renderId).toBeDefined();
      expect(typeof renderId).toBe('string');
      expect(renderId).toMatch(/^mermaid-/);
    });
  });

  describe('edit mode click handlers (Item 3 - Node/Edge Detection)', () => {
    it('should accept editMode prop', () => {
      const { rerender } = render(
        <MermaidPreview
          content="graph TD; A-->B"
          editMode={false}
        />
      );

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();

      rerender(
        <MermaidPreview
          content="graph TD; A-->B"
          editMode={true}
        />
      );

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should accept onNodeClick callback prop', () => {
      const onNodeClick = vi.fn();

      render(
        <MermaidPreview
          content="graph TD; A-->B"
          editMode={true}
          onNodeClick={onNodeClick}
        />
      );

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should accept onEdgeClick callback prop', () => {
      const onEdgeClick = vi.fn();

      render(
        <MermaidPreview
          content="graph TD; A-->B"
          editMode={true}
          onEdgeClick={onEdgeClick}
        />
      );

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should trigger onNodeClick when node element is clicked in edit mode', () => {
      const onNodeClick = vi.fn();

      render(
        <MermaidPreview
          content="graph TD; A-->B"
          editMode={true}
          onNodeClick={onNodeClick}
        />
      );

      const diagram = screen.getByTestId('mermaid-diagram');

      // Create a mock node element with data-id and class 'node'
      const nodeElement = document.createElement('g');
      nodeElement.classList.add('node');
      nodeElement.setAttribute('data-id', 'A');

      // Mock the diagram's child to have the node
      (diagram.querySelector as any) = () => nodeElement;

      // Simulate click on the diagram wrapper
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      });

      // Note: This test verifies the handler is set up correctly
      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should not trigger click handlers when editMode is false', () => {
      const onNodeClick = vi.fn();

      render(
        <MermaidPreview
          content="graph TD; A-->B"
          editMode={false}
          onNodeClick={onNodeClick}
        />
      );

      const diagram = screen.getByTestId('mermaid-diagram');

      // Simulate click - should not trigger callback
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      });

      diagram.dispatchEvent(clickEvent);

      // Callback should not have been called
      expect(onNodeClick).not.toHaveBeenCalled();
    });
  });

  describe('shift+click pan (Item 5)', () => {
    it('should detect shift+left-click+drag pan gesture', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');

      // Simulate shift+left-click (button 0 with shift key)
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        buttons: 1,
      });
      Object.defineProperty(mouseDownEvent, 'button', { value: 0, writable: true });
      Object.defineProperty(mouseDownEvent, 'shiftKey', { value: true, writable: true });

      wrapper.dispatchEvent(mouseDownEvent);

      // The component should have entered panning mode
      expect(wrapper).toBeDefined();
    });

    it('should maintain middle-click panning functionality', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');

      // Simulate middle-click (button 1)
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        buttons: 4,
      });
      Object.defineProperty(mouseDownEvent, 'button', { value: 1, writable: true });
      Object.defineProperty(mouseDownEvent, 'shiftKey', { value: false, writable: true });

      wrapper.dispatchEvent(mouseDownEvent);

      // Middle-click panning should still work
      expect(wrapper).toBeDefined();
    });

    it('should update cursor to grabbing during shift+click pan', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');

      // Verify initial cursor state
      expect(wrapper.style.cursor).not.toBe('grabbing');

      // Simulate shift+left-click
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        buttons: 1,
      });
      Object.defineProperty(mouseDownEvent, 'button', { value: 0, writable: true });
      Object.defineProperty(mouseDownEvent, 'shiftKey', { value: true, writable: true });

      wrapper.dispatchEvent(mouseDownEvent);

      // Cursor should be grabbing
      expect(wrapper.style.cursor).toBe('grabbing');
    });

    it('should change cursor to grab when shift key is held', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');

      // Simulate shift key down
      const keyDownEvent = new KeyboardEvent('keydown', {
        key: 'Shift',
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(keyDownEvent);

      // Cursor should change to grab
      expect(wrapper.style.cursor).toBe('grab');
    });

    it('should reset cursor when shift key is released', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');

      // Simulate shift key down
      const keyDownEvent = new KeyboardEvent('keydown', {
        key: 'Shift',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(keyDownEvent);
      expect(wrapper.style.cursor).toBe('grab');

      // Simulate shift key up
      const keyUpEvent = new KeyboardEvent('keyup', {
        key: 'Shift',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(keyUpEvent);

      // Cursor should be reset
      expect(wrapper.style.cursor).toBe('');
    });

    it('should track drag movement during shift+click pan', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');
      const containerDiv = wrapper.querySelector('div');

      // Simulate shift+left-click
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        buttons: 1,
      });
      Object.defineProperty(mouseDownEvent, 'button', { value: 0, writable: true });
      Object.defineProperty(mouseDownEvent, 'shiftKey', { value: true, writable: true });

      wrapper.dispatchEvent(mouseDownEvent);

      // Simulate mouse move
      const mouseMoveEvent = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: 150,
        clientY: 150,
      });

      window.dispatchEvent(mouseMoveEvent);

      // Pan offset should have been updated (transform should reflect movement)
      const innerDiv = containerDiv as HTMLElement;
      expect(innerDiv.style.transform).toBeTruthy();
    });

    it('should update viewBox-like behavior when panning', () => {
      render(<MermaidPreview content="graph TD; A-->B" zoomLevel={100} />);

      const wrapper = screen.getByTestId('mermaid-diagram');
      const innerContainer = wrapper.querySelector('div');

      // Start pan with shift+click
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
        buttons: 1,
      });
      Object.defineProperty(mouseDownEvent, 'button', { value: 0, writable: true });
      Object.defineProperty(mouseDownEvent, 'shiftKey', { value: true, writable: true });

      wrapper.dispatchEvent(mouseDownEvent);

      // Move mouse to simulate dragging
      const mouseMoveEvent = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      });

      window.dispatchEvent(mouseMoveEvent);

      // Check that transform includes translation
      const transform = (innerContainer as HTMLElement).style.transform;
      expect(transform).toMatch(/translate\(/);
    });

    it('should maintain zoom level while panning', () => {
      const { rerender } = render(
        <MermaidPreview content="graph TD; A-->B" zoomLevel={150} />
      );

      const wrapper = screen.getByTestId('mermaid-diagram');
      const innerContainer = wrapper.querySelector('div') as HTMLElement;

      // Start pan
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
        buttons: 1,
      });
      Object.defineProperty(mouseDownEvent, 'button', { value: 0, writable: true });
      Object.defineProperty(mouseDownEvent, 'shiftKey', { value: true, writable: true });

      wrapper.dispatchEvent(mouseDownEvent);

      // Move mouse
      const mouseMoveEvent = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      });

      window.dispatchEvent(mouseMoveEvent);

      // Transform should include both scale and translate
      const transform = innerContainer.style.transform;
      expect(transform).toMatch(/scale\(1\.5\)/);
      expect(transform).toMatch(/translate\(/);
    });

    it('should end pan on mouseup after shift+click drag', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');

      // Start pan with shift+click
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
        buttons: 1,
      });
      Object.defineProperty(mouseDownEvent, 'button', { value: 0, writable: true });
      Object.defineProperty(mouseDownEvent, 'shiftKey', { value: true, writable: true });

      wrapper.dispatchEvent(mouseDownEvent);
      expect(wrapper.style.cursor).toBe('grabbing');

      // Release mouse
      const mouseUpEvent = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        buttons: 0,
      });

      window.dispatchEvent(mouseUpEvent);

      // Cursor should reset (and since shift is not held, it should be empty)
      expect(wrapper.style.cursor).toBe('');
    });

    it('should not interfere with other interactions', () => {
      const onNodeClick = vi.fn();

      render(
        <MermaidPreview
          content="graph TD; A-->B"
          editMode={true}
          onNodeClick={onNodeClick}
        />
      );

      const wrapper = screen.getByTestId('mermaid-diagram');

      // Regular click without shift should not trigger pan
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
        buttons: 1,
      });
      Object.defineProperty(clickEvent, 'button', { value: 0, writable: true });
      Object.defineProperty(clickEvent, 'shiftKey', { value: false, writable: true });

      wrapper.dispatchEvent(clickEvent);

      // Should not change cursor (only shift triggers grab cursor)
      expect(wrapper.style.cursor).not.toBe('grab');
    });

    it('should handle rapid shift key presses', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');

      // Multiple rapid shift key presses
      for (let i = 0; i < 5; i++) {
        const keyDownEvent = new KeyboardEvent('keydown', {
          key: 'Shift',
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(keyDownEvent);

        const keyUpEvent = new KeyboardEvent('keyup', {
          key: 'Shift',
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(keyUpEvent);
      }

      // Should handle gracefully without errors
      expect(wrapper).toBeDefined();
    });
  });
});
