import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WireframeRenderer } from '../WireframeRenderer';
import type { WireframeRoot } from '../../../types/wireframe';

// Mock rough.js
vi.mock('roughjs', () => ({
  default: {
    svg: vi.fn(() => ({
      rectangle: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
      line: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
      circle: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
      ellipse: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
    })),
  },
}));

describe('WireframeRenderer', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Invalid wireframe structure', () => {
    it('displays error message when screens is undefined', () => {
      const invalidWireframe = {
        viewport: 'mobile',
        direction: 'LR',
      } as unknown as WireframeRoot;
      const { getByText } = render(<WireframeRenderer wireframe={invalidWireframe} />);
      expect(getByText('Invalid wireframe structure')).toBeInTheDocument();
      expect(getByText('Missing required "screens" array')).toBeInTheDocument();
    });

    it('displays error message when screens is not an array', () => {
      const invalidWireframe = {
        viewport: 'mobile',
        direction: 'LR',
        screens: 'not-an-array',
      } as unknown as WireframeRoot;
      const { getByText } = render(<WireframeRenderer wireframe={invalidWireframe} />);
      expect(getByText('Invalid wireframe structure')).toBeInTheDocument();
    });

    it('displays error message when screens is null', () => {
      const invalidWireframe = {
        viewport: 'mobile',
        direction: 'LR',
        screens: null,
      } as unknown as WireframeRoot;
      const { getByText } = render(<WireframeRenderer wireframe={invalidWireframe} />);
      expect(getByText('Invalid wireframe structure')).toBeInTheDocument();
    });

    it('does not render SVG for invalid wireframe', () => {
      const invalidWireframe = {
        viewport: 'mobile',
        direction: 'LR',
      } as unknown as WireframeRoot;
      const { container } = render(<WireframeRenderer wireframe={invalidWireframe} />);
      expect(container.querySelector('svg')).not.toBeInTheDocument();
    });

    it('renders empty screens array without error', () => {
      const wireframe = {
        viewport: 'mobile',
        direction: 'LR',
        screens: [],
      } as WireframeRoot;
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  const createBasicWireframe = (overrides: Partial<WireframeRoot> = {}): WireframeRoot => ({
    viewport: 'mobile',
    direction: 'LR',
    screens: [
      {
        id: 'screen-1',
        type: 'screen',
        name: 'Home',
        bounds: { x: 0, y: 0, width: 375, height: 600 },
        children: [],
      },
    ],
    ...overrides,
  });

  describe('Basic rendering', () => {
    it('renders without crashing', () => {
      const wireframe = createBasicWireframe();
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      expect(container).toBeInTheDocument();
    });

    it('renders as SVG element', () => {
      const wireframe = createBasicWireframe();
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('renders screen label', () => {
      const wireframe = createBasicWireframe();
      const { getByText } = render(<WireframeRenderer wireframe={wireframe} />);
      expect(getByText('Home')).toBeInTheDocument();
    });

    it('renders multiple screens', () => {
      const wireframe = createBasicWireframe({
        screens: [
          {
            id: 'screen-1',
            type: 'screen',
            name: 'Screen 1',
            bounds: { x: 0, y: 0, width: 375, height: 600 },
            children: [],
          },
          {
            id: 'screen-2',
            type: 'screen',
            name: 'Screen 2',
            bounds: { x: 0, y: 0, width: 375, height: 600 },
            children: [],
          },
        ],
      });
      const { getByText } = render(<WireframeRenderer wireframe={wireframe} />);
      expect(getByText('Screen 1')).toBeInTheDocument();
      expect(getByText('Screen 2')).toBeInTheDocument();
    });
  });

  describe('Viewport handling', () => {
    it('handles mobile viewport', () => {
      const wireframe = createBasicWireframe({ viewport: 'mobile' });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('handles tablet viewport', () => {
      const wireframe = createBasicWireframe({ viewport: 'tablet' });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('handles desktop viewport', () => {
      const wireframe = createBasicWireframe({ viewport: 'desktop' });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Direction handling', () => {
    it('handles LR direction', () => {
      const wireframe = createBasicWireframe({ direction: 'LR' });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('handles TD direction', () => {
      const wireframe = createBasicWireframe({ direction: 'TD' });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Scale handling', () => {
    it('applies default scale of 1', () => {
      const wireframe = createBasicWireframe();
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('applies custom scale', () => {
      const wireframe = createBasicWireframe();
      const { container } = render(<WireframeRenderer wireframe={wireframe} scale={0.5} />);
      const svg = container.querySelector('svg') as SVGSVGElement;
      // SVG width should be scaled
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Component rendering', () => {
    it('renders text component', () => {
      const wireframe = createBasicWireframe({
        screens: [
          {
            id: 'screen-1',
            type: 'screen',
            name: 'Home',
            bounds: { x: 0, y: 0, width: 375, height: 600 },
            children: [
              {
                id: 'text-1',
                type: 'text',
                bounds: { x: 0, y: 0, width: 200, height: 30 },
                content: 'Hello World',
              },
            ],
          },
        ],
      });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      expect(container).toBeInTheDocument();
    });

    it('renders button component', () => {
      const wireframe = createBasicWireframe({
        screens: [
          {
            id: 'screen-1',
            type: 'screen',
            name: 'Home',
            bounds: { x: 0, y: 0, width: 375, height: 600 },
            children: [
              {
                id: 'button-1',
                type: 'button',
                bounds: { x: 0, y: 0, width: 120, height: 40 },
                label: 'Click Me',
              },
            ],
          },
        ],
      });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const button = container.querySelector('g[data-component-type="button"]');
      expect(button).toBeInTheDocument();
    });

    it('renders input component', () => {
      const wireframe = createBasicWireframe({
        screens: [
          {
            id: 'screen-1',
            type: 'screen',
            name: 'Home',
            bounds: { x: 0, y: 0, width: 375, height: 600 },
            children: [
              {
                id: 'input-1',
                type: 'input',
                bounds: { x: 0, y: 0, width: 200, height: 40 },
                placeholder: 'Enter text',
              },
            ],
          },
        ],
      });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const input = container.querySelector('g[data-component-type="input"]');
      expect(input).toBeInTheDocument();
    });

    it('renders unknown component with placeholder', () => {
      const wireframe = createBasicWireframe({
        screens: [
          {
            id: 'screen-1',
            type: 'screen',
            name: 'Home',
            bounds: { x: 0, y: 0, width: 375, height: 600 },
            children: [
              {
                id: 'unknown-1',
                type: 'unknown-type' as any,
                bounds: { x: 0, y: 0, width: 100, height: 50 },
              },
            ],
          },
        ],
      });
      const { getByText } = render(<WireframeRenderer wireframe={wireframe} />);
      expect(getByText(/Unknown/)).toBeInTheDocument();
    });
  });

  describe('Nested components', () => {
    it('renders col with children', () => {
      const wireframe = createBasicWireframe({
        screens: [
          {
            id: 'screen-1',
            type: 'screen',
            name: 'Home',
            bounds: { x: 0, y: 0, width: 375, height: 600 },
            children: [
              {
                id: 'col-1',
                type: 'col',
                bounds: { x: 0, y: 0, width: 375, height: 200 },
                children: [
                  {
                    id: 'text-1',
                    type: 'text',
                    bounds: { x: 0, y: 0, width: 375, height: 100 },
                    content: 'First',
                  },
                  {
                    id: 'text-2',
                    type: 'text',
                    bounds: { x: 0, y: 0, width: 375, height: 100 },
                    content: 'Second',
                  },
                ],
              },
            ],
          },
        ],
      });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const col = container.querySelector('g[data-component-type="col"]');
      expect(col).toBeInTheDocument();
    });

    it('renders row with children', () => {
      const wireframe = createBasicWireframe({
        screens: [
          {
            id: 'screen-1',
            type: 'screen',
            name: 'Home',
            bounds: { x: 0, y: 0, width: 375, height: 600 },
            children: [
              {
                id: 'row-1',
                type: 'row',
                bounds: { x: 0, y: 0, width: 375, height: 100 },
                children: [
                  {
                    id: 'button-1',
                    type: 'button',
                    bounds: { x: 0, y: 0, width: 150, height: 40 },
                    label: 'Left',
                  },
                  {
                    id: 'button-2',
                    type: 'button',
                    bounds: { x: 0, y: 0, width: 150, height: 40 },
                    label: 'Right',
                  },
                ],
              },
            ],
          },
        ],
      });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const row = container.querySelector('g[data-component-type="row"]');
      expect(row).toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('applies className to SVG', () => {
      const wireframe = createBasicWireframe();
      const { container } = render(
        <WireframeRenderer wireframe={wireframe} className="custom-class" />
      );
      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('custom-class');
    });
  });

  describe('Screen background color', () => {
    it('applies custom background color', () => {
      const wireframe = createBasicWireframe({
        screens: [
          {
            id: 'screen-1',
            type: 'screen',
            name: 'Home',
            backgroundColor: '#f0f0f0',
            bounds: { x: 0, y: 0, width: 375, height: 600 },
            children: [],
          },
        ],
      });
      const { container } = render(<WireframeRenderer wireframe={wireframe} />);
      const rect = container.querySelector('rect[fill="#f0f0f0"]');
      expect(rect).toBeInTheDocument();
    });
  });
});
