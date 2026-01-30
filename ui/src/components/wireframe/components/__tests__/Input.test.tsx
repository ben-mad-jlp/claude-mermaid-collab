import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Input } from '../Input';
import type { InputComponent, LayoutBounds } from '../../../../types/wireframe';

// Mock rough.js
vi.mock('roughjs', () => ({
  default: {
    svg: vi.fn(() => ({
      rectangle: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
      line: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
    })),
  },
}));

describe('Input', () => {
  const defaultBounds: LayoutBounds = {
    x: 10,
    y: 20,
    width: 200,
    height: 40,
  };

  const createInputComponent = (
    overrides: Partial<InputComponent> = {}
  ): InputComponent => ({
    id: 'input-1',
    type: 'input',
    bounds: defaultBounds,
    placeholder: 'Enter text...',
    ...overrides,
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders an SVG group element', () => {
      const component = createInputComponent();
      const { container } = render(
        <svg>
          <Input component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="input"]');
      expect(group).toBeInTheDocument();
    });

    it('positions group using transform', () => {
      const bounds: LayoutBounds = { x: 50, y: 100, width: 300, height: 50 };
      const component = createInputComponent({ bounds });
      const { container } = render(
        <svg>
          <Input component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="input"]');
      expect(group).toHaveAttribute('transform', 'translate(50, 100)');
    });

    it('renders with placeholder text', () => {
      const component = createInputComponent({ placeholder: 'Type here' });
      const { container } = render(
        <svg>
          <Input component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      expect(text).toBeInTheDocument();
      expect(text?.textContent).toBe('Type here');
    });

    it('renders with value text', () => {
      const component = createInputComponent({ value: 'Hello World' });
      const { container } = render(
        <svg>
          <Input component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      expect(text?.textContent).toBe('Hello World');
    });
  });

  describe('disabled state', () => {
    it('renders disabled input', () => {
      const component = createInputComponent({ disabled: true });
      const { container } = render(
        <svg>
          <Input component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="input"]');
      expect(group).toBeInTheDocument();
    });
  });

  describe('input types', () => {
    it('renders text input type', () => {
      const component = createInputComponent({ inputType: 'text' });
      const { container } = render(
        <svg>
          <Input component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="input"]');
      expect(group).toBeInTheDocument();
    });

    it('renders password input type with masked text', () => {
      const component = createInputComponent({ inputType: 'password', value: 'secret' });
      const { container } = render(
        <svg>
          <Input component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      // Password should be masked with bullet points
      expect(text?.textContent).toBe('\u2022\u2022\u2022\u2022\u2022\u2022');
    });

    it('renders email input type', () => {
      const component = createInputComponent({ inputType: 'email', placeholder: 'email@example.com' });
      const { container } = render(
        <svg>
          <Input component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      expect(text?.textContent).toBe('email@example.com');
    });
  });

  describe('default values', () => {
    it('uses default placeholder when not specified', () => {
      const component = createInputComponent();
      delete component.placeholder;
      delete component.value;

      const { container } = render(
        <svg>
          <Input component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      expect(text?.textContent).toBe('Enter text...');
    });
  });

  describe('props interface', () => {
    it('accepts component and bounds props', () => {
      const component = createInputComponent();
      const bounds: LayoutBounds = { x: 5, y: 10, width: 250, height: 45 };

      expect(() =>
        render(
          <svg>
            <Input component={component} bounds={bounds} />
          </svg>
        )
      ).not.toThrow();
    });
  });
});
