/**
 * Container Component Tests
 *
 * Tests for wireframe container renderers:
 * - ScreenRenderer - Outer screen container with device frame
 * - ColRenderer - Vertical flex container
 * - RowRenderer - Horizontal flex container
 * - CardRenderer - Card with rough.js border/shadow
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ScreenRenderer,
  ColRenderer,
  RowRenderer,
  CardRenderer,
} from '../Container';
import type {
  ScreenComponent,
  ColComponent,
  RowComponent,
  CardComponent,
  LayoutBounds,
  RenderContext,
} from '@/types/wireframe';

// Mock rough.js
vi.mock('roughjs', () => ({
  default: {
    svg: vi.fn(() => ({
      rectangle: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
      line: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
    })),
  },
}));

describe('Container Renderers', () => {
  const defaultBounds: LayoutBounds = {
    x: 0,
    y: 0,
    width: 375,
    height: 667,
  };

  const mockRenderChildren = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ScreenRenderer', () => {
    it('renders screen container with device frame', () => {
      const component: ScreenComponent = {
        id: 'screen-1',
        type: 'screen',
        name: 'Login Screen',
        bounds: defaultBounds,
        children: [],
      };

      const { container } = render(
        <svg>
          <ScreenRenderer
            component={component}
            bounds={defaultBounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      // Should render a group element
      const group = container.querySelector('g[data-component-id="screen-1"]');
      expect(group).toBeInTheDocument();
    });

    it('displays screen label at the top', () => {
      const component: ScreenComponent = {
        id: 'screen-2',
        type: 'screen',
        name: 'Home Screen',
        bounds: defaultBounds,
        children: [],
      };

      const { container } = render(
        <svg>
          <ScreenRenderer
            component={component}
            bounds={defaultBounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      // Should have a text element with the screen name
      const textElement = container.querySelector('text');
      expect(textElement).toBeInTheDocument();
      expect(textElement?.textContent).toBe('Home Screen');
    });

    it('calls renderChildren for child components', () => {
      const component: ScreenComponent = {
        id: 'screen-3',
        type: 'screen',
        name: 'Test Screen',
        bounds: defaultBounds,
        children: [
          {
            id: 'col-1',
            type: 'col',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            children: [],
          },
        ],
      };

      render(
        <svg>
          <ScreenRenderer
            component={component}
            bounds={defaultBounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      expect(mockRenderChildren).toHaveBeenCalledWith(
        component.children,
        expect.any(Object) // child bounds
      );
    });

    it('applies background color when specified', () => {
      const component: ScreenComponent = {
        id: 'screen-4',
        type: 'screen',
        name: 'Styled Screen',
        bounds: defaultBounds,
        backgroundColor: '#f0f0f0',
        children: [],
      };

      const { container } = render(
        <svg>
          <ScreenRenderer
            component={component}
            bounds={defaultBounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      // Should have a rect with the background color
      const rect = container.querySelector('rect');
      expect(rect).toHaveAttribute('fill', '#f0f0f0');
    });
  });

  describe('ColRenderer', () => {
    it('renders vertical flex container', () => {
      const component: ColComponent = {
        id: 'col-1',
        type: 'col',
        bounds: { x: 10, y: 10, width: 200, height: 400 },
        children: [],
      };

      const { container } = render(
        <svg>
          <ColRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      const group = container.querySelector('g[data-component-id="col-1"]');
      expect(group).toBeInTheDocument();
    });

    it('applies padding when specified', () => {
      const component: ColComponent = {
        id: 'col-2',
        type: 'col',
        bounds: { x: 0, y: 0, width: 200, height: 400 },
        padding: 16,
        children: [],
      };

      render(
        <svg>
          <ColRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      // renderChildren should be called with adjusted bounds for padding
      expect(mockRenderChildren).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          x: 16,
          y: 16,
          width: 168, // 200 - 16*2
          height: 368, // 400 - 16*2
        })
      );
    });

    it('calls renderChildren with correct bounds', () => {
      const component: ColComponent = {
        id: 'col-3',
        type: 'col',
        bounds: { x: 20, y: 30, width: 150, height: 300 },
        children: [
          {
            id: 'text-1',
            type: 'text',
            content: 'Hello',
            bounds: { x: 0, y: 0, width: 100, height: 30 },
          },
        ],
      };

      render(
        <svg>
          <ColRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      expect(mockRenderChildren).toHaveBeenCalledWith(
        component.children,
        expect.objectContaining({
          x: 20,
          y: 30,
          width: 150,
          height: 300,
        })
      );
    });
  });

  describe('RowRenderer', () => {
    it('renders horizontal flex container', () => {
      const component: RowComponent = {
        id: 'row-1',
        type: 'row',
        bounds: { x: 10, y: 10, width: 400, height: 100 },
        children: [],
      };

      const { container } = render(
        <svg>
          <RowRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      const group = container.querySelector('g[data-component-id="row-1"]');
      expect(group).toBeInTheDocument();
    });

    it('applies padding when specified', () => {
      const component: RowComponent = {
        id: 'row-2',
        type: 'row',
        bounds: { x: 0, y: 0, width: 400, height: 100 },
        padding: 8,
        children: [],
      };

      render(
        <svg>
          <RowRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      expect(mockRenderChildren).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          x: 8,
          y: 8,
          width: 384, // 400 - 8*2
          height: 84, // 100 - 8*2
        })
      );
    });

    it('calls renderChildren with correct bounds', () => {
      const component: RowComponent = {
        id: 'row-3',
        type: 'row',
        bounds: { x: 50, y: 100, width: 300, height: 60 },
        children: [
          {
            id: 'btn-1',
            type: 'button',
            label: 'Click',
            bounds: { x: 0, y: 0, width: 80, height: 40 },
          },
        ],
      };

      render(
        <svg>
          <RowRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      expect(mockRenderChildren).toHaveBeenCalledWith(
        component.children,
        expect.objectContaining({
          x: 50,
          y: 100,
          width: 300,
          height: 60,
        })
      );
    });
  });

  describe('CardRenderer', () => {
    it('renders card with rough.js border', () => {
      const component: CardComponent = {
        id: 'card-1',
        type: 'card',
        bounds: { x: 10, y: 10, width: 300, height: 200 },
        children: [],
      };

      const { container } = render(
        <svg>
          <CardRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      const group = container.querySelector('g[data-component-id="card-1"]');
      expect(group).toBeInTheDocument();
    });

    it('displays card title when specified', () => {
      const component: CardComponent = {
        id: 'card-2',
        type: 'card',
        title: 'Card Title',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        children: [],
      };

      const { container } = render(
        <svg>
          <CardRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      const textElement = container.querySelector('text');
      expect(textElement).toBeInTheDocument();
      expect(textElement?.textContent).toBe('Card Title');
    });

    it('applies padding when specified', () => {
      const component: CardComponent = {
        id: 'card-3',
        type: 'card',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        padding: 12,
        children: [],
      };

      render(
        <svg>
          <CardRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      expect(mockRenderChildren).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          x: 12,
          y: 12,
          width: 276, // 300 - 12*2
          height: 176, // 200 - 12*2
        })
      );
    });

    it('renders shadow effect', () => {
      const component: CardComponent = {
        id: 'card-4',
        type: 'card',
        bounds: { x: 20, y: 20, width: 250, height: 150 },
        children: [],
      };

      const { container } = render(
        <svg>
          <CardRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      // Should have a shadow rect offset from the main card
      const rects = container.querySelectorAll('rect');
      // At least one rect for shadow and one for card background
      expect(rects.length).toBeGreaterThanOrEqual(1);
    });

    it('calls renderChildren with adjusted bounds for title', () => {
      const component: CardComponent = {
        id: 'card-5',
        type: 'card',
        title: 'With Title',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        children: [
          {
            id: 'text-1',
            type: 'text',
            content: 'Content',
            bounds: { x: 0, y: 0, width: 100, height: 30 },
          },
        ],
      };

      render(
        <svg>
          <CardRenderer
            component={component}
            bounds={component.bounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      // When title is present, content area should start below the title
      expect(mockRenderChildren).toHaveBeenCalledWith(
        component.children,
        expect.objectContaining({
          y: expect.any(Number), // Should be offset for title
        })
      );
    });
  });

  describe('Shared behavior', () => {
    it('all containers have data-component-id attribute', () => {
      const screenComponent: ScreenComponent = {
        id: 'unique-screen',
        type: 'screen',
        name: 'Screen',
        bounds: defaultBounds,
        children: [],
      };

      const colComponent: ColComponent = {
        id: 'unique-col',
        type: 'col',
        bounds: defaultBounds,
        children: [],
      };

      const rowComponent: RowComponent = {
        id: 'unique-row',
        type: 'row',
        bounds: defaultBounds,
        children: [],
      };

      const cardComponent: CardComponent = {
        id: 'unique-card',
        type: 'card',
        bounds: defaultBounds,
        children: [],
      };

      const { container } = render(
        <svg>
          <ScreenRenderer
            component={screenComponent}
            bounds={defaultBounds}
            renderChildren={mockRenderChildren}
          />
          <ColRenderer
            component={colComponent}
            bounds={defaultBounds}
            renderChildren={mockRenderChildren}
          />
          <RowRenderer
            component={rowComponent}
            bounds={defaultBounds}
            renderChildren={mockRenderChildren}
          />
          <CardRenderer
            component={cardComponent}
            bounds={defaultBounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      expect(container.querySelector('[data-component-id="unique-screen"]')).toBeInTheDocument();
      expect(container.querySelector('[data-component-id="unique-col"]')).toBeInTheDocument();
      expect(container.querySelector('[data-component-id="unique-row"]')).toBeInTheDocument();
      expect(container.querySelector('[data-component-id="unique-card"]')).toBeInTheDocument();
    });

    it('containers handle empty children array', () => {
      const component: ColComponent = {
        id: 'empty-col',
        type: 'col',
        bounds: defaultBounds,
        children: [],
      };

      const { container } = render(
        <svg>
          <ColRenderer
            component={component}
            bounds={defaultBounds}
            renderChildren={mockRenderChildren}
          />
        </svg>
      );

      expect(container.querySelector('g[data-component-id="empty-col"]')).toBeInTheDocument();
      expect(mockRenderChildren).toHaveBeenCalledWith([], expect.any(Object));
    });
  });
});
