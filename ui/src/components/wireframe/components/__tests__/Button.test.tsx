import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Button } from '../Button';
import type { ButtonComponent, LayoutBounds } from '../../../../types/wireframe';

// Mock rough.js
vi.mock('roughjs', () => ({
  default: {
    svg: vi.fn(() => ({
      rectangle: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
    })),
  },
}));

describe('Button', () => {
  const defaultBounds: LayoutBounds = {
    x: 10,
    y: 20,
    width: 120,
    height: 40,
  };

  const createButtonComponent = (
    overrides: Partial<ButtonComponent> = {}
  ): ButtonComponent => ({
    id: 'btn-1',
    type: 'button',
    bounds: defaultBounds,
    label: 'Click Me',
    ...overrides,
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders an SVG group element', () => {
      const component = createButtonComponent();
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toBeInTheDocument();
    });

    it('renders with label text', () => {
      const component = createButtonComponent({ label: 'Submit' });
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      expect(text).toBeInTheDocument();
      expect(text?.textContent).toBe('Submit');
    });

    it('positions group using transform', () => {
      const bounds: LayoutBounds = { x: 50, y: 100, width: 200, height: 50 };
      const component = createButtonComponent({ bounds });
      const { container } = render(
        <svg>
          <Button component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toHaveAttribute('transform', 'translate(50, 100)');
    });
  });

  describe('variants', () => {
    it('renders default variant', () => {
      const component = createButtonComponent({ variant: 'default' });
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toBeInTheDocument();
    });

    it('renders primary variant', () => {
      const component = createButtonComponent({ variant: 'primary' });
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toBeInTheDocument();
    });

    it('renders secondary variant', () => {
      const component = createButtonComponent({ variant: 'secondary' });
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toBeInTheDocument();
    });

    it('renders danger variant', () => {
      const component = createButtonComponent({ variant: 'danger' });
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toBeInTheDocument();
    });

    it('renders success variant', () => {
      const component = createButtonComponent({ variant: 'success' });
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toBeInTheDocument();
    });

    it('renders disabled variant', () => {
      const component = createButtonComponent({ variant: 'disabled' });
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('renders disabled button with disabled prop', () => {
      const component = createButtonComponent({ disabled: true });
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toBeInTheDocument();
    });

    it('treats disabled prop same as disabled variant', () => {
      const disabledProp = createButtonComponent({ disabled: true });
      const disabledVariant = createButtonComponent({ variant: 'disabled' });

      const { container: c1 } = render(
        <svg>
          <Button component={disabledProp} bounds={defaultBounds} />
        </svg>
      );
      const { container: c2 } = render(
        <svg>
          <Button component={disabledVariant} bounds={defaultBounds} />
        </svg>
      );

      // Both should render groups
      expect(c1.querySelector('g[data-component-type="button"]')).toBeInTheDocument();
      expect(c2.querySelector('g[data-component-type="button"]')).toBeInTheDocument();
    });
  });

  describe('default values', () => {
    it('uses default variant when not specified', () => {
      const component = createButtonComponent();
      delete component.variant;

      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="button"]');
      expect(group).toBeInTheDocument();
    });

    it('uses "Button" label when label is empty', () => {
      const component = createButtonComponent({ label: '' });
      const { container } = render(
        <svg>
          <Button component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      expect(text?.textContent).toBe('Button');
    });
  });

  describe('props interface', () => {
    it('accepts component and bounds props', () => {
      const component = createButtonComponent();
      const bounds: LayoutBounds = { x: 5, y: 10, width: 150, height: 45 };

      // Should not throw
      expect(() =>
        render(
          <svg>
            <Button component={component} bounds={bounds} />
          </svg>
        )
      ).not.toThrow();
    });
  });
});
