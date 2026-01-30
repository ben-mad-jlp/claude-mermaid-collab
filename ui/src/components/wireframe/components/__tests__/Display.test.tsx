import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Avatar, Image, Icon, List } from '../Display';
import type { AvatarComponent, ImageComponent, IconComponent, ListComponent, LayoutBounds } from '../../../../types/wireframe';

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

describe('Display Components', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Avatar', () => {
    const defaultBounds: LayoutBounds = {
      x: 10,
      y: 10,
      width: 48,
      height: 48,
    };

    const createAvatarComponent = (
      overrides: Partial<AvatarComponent> = {}
    ): AvatarComponent => ({
      id: 'avatar-1',
      type: 'avatar',
      bounds: defaultBounds,
      ...overrides,
    });

    it('renders an SVG group element', () => {
      const component = createAvatarComponent();
      const { container } = render(
        <svg>
          <Avatar component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="avatar"]');
      expect(group).toBeInTheDocument();
    });

    it('positions group using transform', () => {
      const bounds: LayoutBounds = { x: 20, y: 30, width: 64, height: 64 };
      const component = createAvatarComponent({ bounds });
      const { container } = render(
        <svg>
          <Avatar component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="avatar"]');
      expect(group).toHaveAttribute('transform', 'translate(20, 30)');
    });

    it('renders with initials', () => {
      const component = createAvatarComponent({ initials: 'JD' });
      const { container } = render(
        <svg>
          <Avatar component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      expect(text?.textContent).toBe('JD');
    });

    it('renders with custom size', () => {
      const component = createAvatarComponent({ size: 32 });
      const { container } = render(
        <svg>
          <Avatar component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="avatar"]');
      expect(group).toBeInTheDocument();
    });

    it('renders placeholder when no initials', () => {
      const component = createAvatarComponent();
      delete component.initials;
      const { container } = render(
        <svg>
          <Avatar component={component} bounds={defaultBounds} />
        </svg>
      );

      // Should have circles for placeholder person icon
      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBeGreaterThan(0);
    });
  });

  describe('Image', () => {
    const defaultBounds: LayoutBounds = {
      x: 0,
      y: 0,
      width: 200,
      height: 150,
    };

    const createImageComponent = (
      overrides: Partial<ImageComponent> = {}
    ): ImageComponent => ({
      id: 'image-1',
      type: 'image',
      bounds: defaultBounds,
      ...overrides,
    });

    it('renders an SVG group element', () => {
      const component = createImageComponent();
      const { container } = render(
        <svg>
          <Image component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="image"]');
      expect(group).toBeInTheDocument();
    });

    it('positions group using transform', () => {
      const bounds: LayoutBounds = { x: 50, y: 100, width: 300, height: 200 };
      const component = createImageComponent({ bounds });
      const { container } = render(
        <svg>
          <Image component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="image"]');
      expect(group).toHaveAttribute('transform', 'translate(50, 100)');
    });

    it('renders with alt text', () => {
      const component = createImageComponent({ alt: 'Product photo' });
      const { container } = render(
        <svg>
          <Image component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      expect(text?.textContent).toBe('Product photo');
    });

    it('renders placeholder icons', () => {
      const component = createImageComponent();
      const { container } = render(
        <svg>
          <Image component={component} bounds={defaultBounds} />
        </svg>
      );

      // Should have path (mountain) and circle (sun)
      const path = container.querySelector('path');
      const circle = container.querySelector('circle');
      expect(path).toBeInTheDocument();
      expect(circle).toBeInTheDocument();
    });
  });

  describe('Icon', () => {
    const defaultBounds: LayoutBounds = {
      x: 0,
      y: 0,
      width: 24,
      height: 24,
    };

    const createIconComponent = (
      overrides: Partial<IconComponent> = {}
    ): IconComponent => ({
      id: 'icon-1',
      type: 'icon',
      bounds: defaultBounds,
      ...overrides,
    });

    it('renders an SVG group element', () => {
      const component = createIconComponent();
      const { container } = render(
        <svg>
          <Icon component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="icon"]');
      expect(group).toBeInTheDocument();
    });

    it('positions group using transform', () => {
      const bounds: LayoutBounds = { x: 10, y: 20, width: 32, height: 32 };
      const component = createIconComponent({ bounds });
      const { container } = render(
        <svg>
          <Icon component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="icon"]');
      expect(group).toHaveAttribute('transform', 'translate(10, 20)');
    });

    it('renders with name as letter', () => {
      const component = createIconComponent({ name: 'settings' });
      const { container } = render(
        <svg>
          <Icon component={component} bounds={defaultBounds} />
        </svg>
      );

      const text = container.querySelector('text');
      expect(text?.textContent).toBe('S');
    });

    it('renders with custom size', () => {
      const component = createIconComponent({ size: 48 });
      const { container } = render(
        <svg>
          <Icon component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="icon"]');
      expect(group).toBeInTheDocument();
    });
  });

  describe('List', () => {
    const defaultBounds: LayoutBounds = {
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    };

    const createListComponent = (
      overrides: Partial<ListComponent> = {}
    ): ListComponent => ({
      id: 'list-1',
      type: 'list',
      bounds: defaultBounds,
      items: [
        { id: '1', label: 'Item 1' },
        { id: '2', label: 'Item 2' },
        { id: '3', label: 'Item 3' },
      ],
      ...overrides,
    });

    it('renders an SVG group element', () => {
      const component = createListComponent();
      const { container } = render(
        <svg>
          <List component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="list"]');
      expect(group).toBeInTheDocument();
    });

    it('positions group using transform', () => {
      const bounds: LayoutBounds = { x: 20, y: 40, width: 400, height: 300 };
      const component = createListComponent({ bounds });
      const { container } = render(
        <svg>
          <List component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="list"]');
      expect(group).toHaveAttribute('transform', 'translate(20, 40)');
    });

    it('renders with items', () => {
      const component = createListComponent({
        items: [
          { id: '1', label: 'First Item' },
          { id: '2', label: 'Second Item' },
        ],
      });
      const { container } = render(
        <svg>
          <List component={component} bounds={defaultBounds} />
        </svg>
      );

      const texts = container.querySelectorAll('text');
      const labels = Array.from(texts).map(t => t.textContent);
      expect(labels).toContain('First Item');
      expect(labels).toContain('Second Item');
    });

    it('renders with dividers', () => {
      const component = createListComponent({ dividers: true });
      const { container } = render(
        <svg>
          <List component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="list"]');
      expect(group).toBeInTheDocument();
    });

    it('renders items with icons', () => {
      const component = createListComponent({
        items: [
          { id: '1', label: 'Settings', icon: 'settings' },
          { id: '2', label: 'Help', icon: 'help' },
        ],
      });
      const { container } = render(
        <svg>
          <List component={component} bounds={defaultBounds} />
        </svg>
      );

      const texts = container.querySelectorAll('text');
      const contents = Array.from(texts).map(t => t.textContent);
      // Should have icon letters and labels
      expect(contents).toContain('S');
      expect(contents).toContain('Settings');
    });

    it('handles empty items array', () => {
      const component = createListComponent({ items: [] });
      const { container } = render(
        <svg>
          <List component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="list"]');
      expect(group).toBeInTheDocument();
    });
  });
});
