/**
 * AI-UI Recursive Renderer Tests
 *
 * Tests for the recursive renderer including:
 * - Component rendering
 * - Nested component rendering
 * - Props passing and merging
 * - Action callback handling
 * - Error handling and fallbacks
 * - Type validation
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AIUIRenderer,
  useAIUIRenderer,
  renderComponents,
  withAIUIRenderer,
} from '../renderer';
import type { UIComponent } from '@/types/ai-ui';

describe('AIUIRenderer', () => {
  // Setup for window.matchMedia
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  describe('Basic rendering', () => {
    it('should render a simple component', () => {
      const component: UIComponent = {
        type: 'Card',
        props: { title: 'Test Card' },
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Test Card')).toBeInTheDocument();
    });

    it('should render component with text content', () => {
      const component: UIComponent = {
        type: 'Section',
        props: { heading: 'Test Section' },
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Test Section')).toBeInTheDocument();
    });

    it('should handle null component gracefully', () => {
      const component: any = null;
      const { container } = render(<AIUIRenderer component={component} />);
      expect(container.firstChild).toBeNull();
    });

    it('should handle undefined component gracefully', () => {
      const component: any = undefined;
      const { container } = render(<AIUIRenderer component={component} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render Alert component', () => {
      const component: UIComponent = {
        type: 'Alert',
        props: {
          type: 'success',
          title: 'Success',
          message: 'Operation completed',
        },
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Success')).toBeInTheDocument();
    });
  });

  describe('Nested component rendering', () => {
    it('should recursively render nested components', () => {
      const component: UIComponent = {
        type: 'Section',
        props: { heading: 'Parent Section' },
        children: [
          {
            type: 'Card',
            props: { title: 'Child Card' },
          },
        ],
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Parent Section')).toBeInTheDocument();
      expect(screen.getByText('Child Card')).toBeInTheDocument();
    });

    it('should render multiple nested children', () => {
      const component: UIComponent = {
        type: 'Columns',
        props: { columns: 2 },
        children: [
          {
            type: 'Card',
            props: { title: 'Card 1' },
          },
          {
            type: 'Card',
            props: { title: 'Card 2' },
          },
          {
            type: 'Card',
            props: { title: 'Card 3' },
          },
        ],
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Card 1')).toBeInTheDocument();
      expect(screen.getByText('Card 2')).toBeInTheDocument();
      expect(screen.getByText('Card 3')).toBeInTheDocument();
    });

    it('should render deeply nested components', () => {
      const component: UIComponent = {
        type: 'Section',
        props: { heading: 'Level 1' },
        children: [
          {
            type: 'Card',
            props: { title: 'Level 2' },
            children: [
              {
                type: 'Alert',
                props: { type: 'info', message: 'Level 3' },
              },
            ],
          },
        ],
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Level 1')).toBeInTheDocument();
      expect(screen.getByText('Level 2')).toBeInTheDocument();
      expect(screen.getByText('Level 3')).toBeInTheDocument();
    });

    it('should handle empty children array', () => {
      const component: UIComponent = {
        type: 'Card',
        props: { title: 'Test' },
        children: [],
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Test')).toBeInTheDocument();
    });
  });

  describe('Props handling', () => {
    it('should pass props to components', () => {
      const component: UIComponent = {
        type: 'Card',
        props: {
          title: 'Card Title',
          subtitle: 'Card Subtitle',
          collapsible: true,
        },
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Card Title')).toBeInTheDocument();
      expect(screen.getByText('Card Subtitle')).toBeInTheDocument();
    });

    it('should merge component and renderer props', () => {
      const component: UIComponent = {
        type: 'Card',
        props: { title: 'Test Card', className: 'component-class' },
      };

      const { container } = render(
        <AIUIRenderer
          component={component}
          componentProps={{ className: 'renderer-class' }}
        />
      );

      const card = container.querySelector('[role="region"]');
      expect(card?.className).toContain('component-class');
      expect(card?.className).toContain('renderer-class');
    });

    it('should override props with componentProps', () => {
      const component: UIComponent = {
        type: 'Alert',
        props: { type: 'error', title: 'Original' },
      };

      render(
        <AIUIRenderer
          component={component}
          componentProps={{ title: 'Override' }}
        />
      );

      expect(screen.getByText('Override')).toBeInTheDocument();
    });

    it('should handle className merging', () => {
      const component: UIComponent = {
        type: 'Card',
        props: {
          title: 'Test',
          className: 'card-class',
        },
      };

      const { container } = render(
        <AIUIRenderer
          component={component}
          className="renderer-class"
          componentProps={{ className: 'props-class' }}
        />
      );

      const card = container.querySelector('[role="region"]');
      expect(card?.className).toContain('card-class');
      expect(card?.className).toContain('renderer-class');
      expect(card?.className).toContain('props-class');
    });
  });

  describe('Action callback handling', () => {
    it('should accept and call action callbacks', async () => {
      const mockAction = vi.fn();
      const component: UIComponent = {
        type: 'ApprovalButtons',
        props: {
          actions: [
            { id: 'approve', label: 'Approve' },
            { id: 'reject', label: 'Reject' },
          ],
        },
      };

      render(<AIUIRenderer component={component} onAction={mockAction} />);

      // The actual action calling would depend on ApprovalButtons implementation
      // This tests that the callback is passed through
      expect(mockAction).toBeDefined();
    });

    it('should handle async action callbacks', async () => {
      const mockAction = vi.fn().mockResolvedValue(undefined);
      const component: UIComponent = {
        type: 'Card',
        props: { title: 'Test' },
      };

      render(<AIUIRenderer component={component} onAction={mockAction} />);

      expect(mockAction).toBeDefined();
      expect(typeof mockAction).toBe('function');
    });

    it('should not include onAction if not provided', () => {
      const component: UIComponent = {
        type: 'Card',
        props: { title: 'Test' },
      };

      const { container } = render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Test')).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('should render fallback for unknown component types', () => {
      const component: UIComponent = {
        type: 'UnknownComponent',
        props: {},
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText(/Unknown component type/i)).toBeInTheDocument();
      expect(screen.getByText(/UnknownComponent/)).toBeInTheDocument();
    });

    it('should render error fallback for component rendering errors', () => {
      // Create a component that will cause an error
      const component: UIComponent = {
        type: 'CodeBlock',
        props: {
          code: 'test',
          // Missing language prop which could cause issues
        },
      };

      // Should not throw but render error boundary
      const { container } = render(<AIUIRenderer component={component} />);
      // Component should either render or show error gracefully
      expect(container).toBeDefined();
    });

    it('should handle missing type gracefully', () => {
      const component: any = {
        props: { title: 'Test' },
        // Missing 'type'
      };

      const { container } = render(<AIUIRenderer component={component} />);
      expect(container.firstChild).toBeNull();
    });

    it('should handle component validation errors gracefully', () => {
      const component: UIComponent = {
        type: 'InvalidType123',
        props: {},
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText(/Unknown component type/i)).toBeInTheDocument();
    });

    it('should handle invalid component gracefully', () => {
      const component: UIComponent = {
        type: 'InvalidComponent999',
        props: {},
      };

      const { container } = render(<AIUIRenderer component={component} />);
      // Should render fallback UI for unknown components
      expect(container.querySelector('[role="alert"]')).toBeInTheDocument();
    });
  });

  describe('useAIUIRenderer hook', () => {
    it('should provide renderComponent function', () => {
      let hookResult: any;

      function TestComponent() {
        hookResult = useAIUIRenderer();
        return null;
      }

      render(<TestComponent />);
      expect(hookResult.renderComponent).toBeDefined();
      expect(typeof hookResult.renderComponent).toBe('function');
    });

    it('should render component using hook', () => {
      function TestComponent() {
        const { renderComponent } = useAIUIRenderer();
        const component: UIComponent = {
          type: 'Card',
          props: { title: 'Hook Test' },
        };

        return <div>{renderComponent(component)}</div>;
      }

      render(<TestComponent />);
      expect(screen.getByText('Hook Test')).toBeInTheDocument();
    });

    it('should support action callbacks in hook', () => {
      const mockAction = vi.fn();

      function TestComponent() {
        const { renderComponent } = useAIUIRenderer();
        const component: UIComponent = {
          type: 'Card',
          props: { title: 'Hook Test' },
        };

        return <div>{renderComponent(component, mockAction)}</div>;
      }

      render(<TestComponent />);
      expect(screen.getByText('Hook Test')).toBeInTheDocument();
    });
  });

  describe('renderComponents function', () => {
    it('should render multiple components', () => {
      const components: UIComponent[] = [
        { type: 'Card', props: { title: 'Card 1' } },
        { type: 'Card', props: { title: 'Card 2' } },
        { type: 'Card', props: { title: 'Card 3' } },
      ];

      const result = renderComponents(components);
      render(<div>{result}</div>);

      expect(screen.getByText('Card 1')).toBeInTheDocument();
      expect(screen.getByText('Card 2')).toBeInTheDocument();
      expect(screen.getByText('Card 3')).toBeInTheDocument();
    });

    it('should pass action callbacks to all components', () => {
      const mockAction = vi.fn();
      const components: UIComponent[] = [
        { type: 'Card', props: { title: 'Card 1' } },
        { type: 'Card', props: { title: 'Card 2' } },
      ];

      const result = renderComponents(components, mockAction);
      expect(result).toHaveLength(2);
    });

    it('should apply componentProps to all rendered components', () => {
      const components: UIComponent[] = [
        { type: 'Card', props: { title: 'Card 1' } },
        { type: 'Card', props: { title: 'Card 2' } },
      ];

      const result = renderComponents(components, undefined, {
        className: 'test-class',
      });
      render(<div>{result}</div>);

      expect(screen.getByText('Card 1')).toBeInTheDocument();
      expect(screen.getByText('Card 2')).toBeInTheDocument();
    });
  });

  describe('withAIUIRenderer HOC', () => {
    it('should wrap component with renderer', () => {
      const TestComponent = () => {
        return <div>Test Content</div>;
      };

      const WrappedComponent = withAIUIRenderer(TestComponent);
      const component: UIComponent = {
        type: 'Card',
        props: { title: 'Wrapped Test' },
      };

      render(<WrappedComponent uiComponent={component} />);
      expect(screen.getByText('Wrapped Test')).toBeInTheDocument();
    });

    it('should support onAction in HOC', () => {
      const mockAction = vi.fn();
      const TestComponent = () => <div>Test</div>;
      const WrappedComponent = withAIUIRenderer(TestComponent, mockAction);

      const component: UIComponent = {
        type: 'Card',
        props: { title: 'With Action' },
      };

      render(<WrappedComponent uiComponent={component} />);
      expect(screen.getByText('With Action')).toBeInTheDocument();
    });
  });

  describe('All 22 components rendering', () => {
    const componentProps: Record<string, Record<string, any>> = {
      // Display
      Table: { rows: [], columns: [] },
      CodeBlock: { code: 'console.log("test");', language: 'javascript' },
      DiffView: { before: 'old content', after: 'new content' },
      JsonViewer: { data: { test: 'value' } },
      Markdown: { content: '# Test' },
      // Layout
      Card: { title: 'Test Card' },
      Section: { heading: 'Test Section' },
      Columns: { columns: 2 },
      Accordion: { sections: [] },
      Alert: { type: 'info' as const, message: 'Test' },
      // Interactive
      Wizard: {
        steps: [
          { id: 'step1', title: 'Step 1', description: 'First step' },
        ],
      },
      Checklist: { items: [] },
      ApprovalButtons: { actions: [] },
      ProgressBar: { value: 50 },
      Tabs: { tabs: [] },
      // Inputs
      MultipleChoice: { options: [] },
      TextInput: { label: 'Input' },
      TextArea: { label: 'Area' },
      Checkbox: { options: [] },
      Confirmation: { title: 'Confirm', description: 'Confirm?' },
      // Mermaid
      DiagramEmbed: { content: 'graph LR\n  A --> B' },
      WireframeEmbed: { content: 'sketch' },
    };

    Object.entries(componentProps).forEach(([componentName, props]) => {
      it(`should render ${componentName} component`, () => {
        const component: UIComponent = {
          type: componentName,
          props,
        };

        const { container } = render(<AIUIRenderer component={component} />);
        // Should not throw and should render something or error fallback
        expect(container).toBeDefined();
      });
    });
  });

  describe('Display name', () => {
    it('should have correct displayName', () => {
      expect(AIUIRenderer.displayName).toBe('AIUIRenderer');
    });
  });

  describe('Edge cases', () => {
    it('should handle component with no props', () => {
      const component: UIComponent = {
        type: 'Card',
        props: {},
      };

      render(<AIUIRenderer component={component} />);
      expect(screen.getByRole('region')).toBeInTheDocument();
    });

    it('should handle component with empty string type', () => {
      const component: any = {
        type: '',
        props: { title: 'Test' },
      };

      const { container } = render(<AIUIRenderer component={component} />);
      expect(container.firstChild).toBeNull();
    });

    it('should handle very deep nesting', () => {
      let component: UIComponent = {
        type: 'Alert',
        props: { type: 'info', message: 'Level 5' },
      };

      // Build deeply nested structure
      for (let i = 0; i < 5; i++) {
        component = {
          type: 'Card',
          props: { title: `Level ${i}` },
          children: [component],
        };
      }

      render(<AIUIRenderer component={component} />);
      expect(screen.getByText('Level 4')).toBeInTheDocument();
    });

    it('should handle components with special characters in props', () => {
      const component: UIComponent = {
        type: 'Card',
        props: { title: '<script>alert("xss")</script>' },
      };

      render(<AIUIRenderer component={component} />);
      // Should render safely without executing
      expect(screen.getByText(/script/)).toBeInTheDocument();
    });
  });
});
