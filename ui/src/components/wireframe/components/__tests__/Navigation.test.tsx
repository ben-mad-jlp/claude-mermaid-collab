import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AppBar, BottomNav, NavMenu } from '../Navigation';
import type { AppBarComponent, BottomNavComponent, NavMenuComponent, LayoutBounds } from '../../../../types/wireframe';

// Mock rough.js
vi.mock('roughjs', () => ({
  default: {
    svg: vi.fn(() => ({
      rectangle: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
      line: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
      circle: vi.fn(() => document.createElementNS('http://www.w3.org/2000/svg', 'g')),
    })),
  },
}));

describe('Navigation Components', () => {
  const defaultBounds: LayoutBounds = {
    x: 0,
    y: 0,
    width: 375,
    height: 56,
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('AppBar', () => {
    const createAppBarComponent = (
      overrides: Partial<AppBarComponent> = {}
    ): AppBarComponent => ({
      id: 'appbar-1',
      type: 'appbar',
      bounds: defaultBounds,
      title: 'App Title',
      ...overrides,
    });

    it('renders an SVG group element', () => {
      const component = createAppBarComponent();
      const { container } = render(
        <svg>
          <AppBar component={component} bounds={defaultBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="appbar"]');
      expect(group).toBeInTheDocument();
    });

    it('positions group using transform', () => {
      const bounds: LayoutBounds = { x: 10, y: 20, width: 400, height: 64 };
      const component = createAppBarComponent({ bounds });
      const { container } = render(
        <svg>
          <AppBar component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="appbar"]');
      expect(group).toHaveAttribute('transform', 'translate(10, 20)');
    });

    it('renders with title', () => {
      const component = createAppBarComponent({ title: 'My App' });
      const { container } = render(
        <svg>
          <AppBar component={component} bounds={defaultBounds} />
        </svg>
      );

      const texts = container.querySelectorAll('text');
      const titleText = Array.from(texts).find(t => t.textContent === 'My App');
      expect(titleText).toBeInTheDocument();
    });

    it('renders with left icon', () => {
      const component = createAppBarComponent({ leftIcon: 'menu' });
      const { container } = render(
        <svg>
          <AppBar component={component} bounds={defaultBounds} />
        </svg>
      );

      const texts = container.querySelectorAll('text');
      const iconText = Array.from(texts).find(t => t.textContent === 'M');
      expect(iconText).toBeInTheDocument();
    });

    it('renders with right icons', () => {
      const component = createAppBarComponent({ rightIcons: ['search', 'more'] });
      const { container } = render(
        <svg>
          <AppBar component={component} bounds={defaultBounds} />
        </svg>
      );

      const texts = container.querySelectorAll('text');
      expect(texts.length).toBeGreaterThan(1);
    });
  });

  describe('BottomNav', () => {
    const bottomNavBounds: LayoutBounds = {
      x: 0,
      y: 0,
      width: 375,
      height: 56,
    };

    const createBottomNavComponent = (
      overrides: Partial<BottomNavComponent> = {}
    ): BottomNavComponent => ({
      id: 'bottomnav-1',
      type: 'bottomnav',
      bounds: bottomNavBounds,
      items: [
        { label: 'Home', icon: 'home' },
        { label: 'Search', icon: 'search' },
        { label: 'Profile', icon: 'person' },
      ],
      ...overrides,
    });

    it('renders an SVG group element', () => {
      const component = createBottomNavComponent();
      const { container } = render(
        <svg>
          <BottomNav component={component} bounds={bottomNavBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="bottomnav"]');
      expect(group).toBeInTheDocument();
    });

    it('positions group using transform', () => {
      const bounds: LayoutBounds = { x: 0, y: 500, width: 400, height: 64 };
      const component = createBottomNavComponent({ bounds });
      const { container } = render(
        <svg>
          <BottomNav component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="bottomnav"]');
      expect(group).toHaveAttribute('transform', 'translate(0, 500)');
    });

    it('renders with items', () => {
      const component = createBottomNavComponent({
        items: [
          { label: 'Tab 1' },
          { label: 'Tab 2' },
        ],
      });
      const { container } = render(
        <svg>
          <BottomNav component={component} bounds={bottomNavBounds} />
        </svg>
      );

      const texts = container.querySelectorAll('text');
      const labels = Array.from(texts).map(t => t.textContent);
      expect(labels).toContain('Tab 1');
      expect(labels).toContain('Tab 2');
    });

    it('renders with active index', () => {
      const component = createBottomNavComponent({ activeIndex: 1 });
      const { container } = render(
        <svg>
          <BottomNav component={component} bounds={bottomNavBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="bottomnav"]');
      expect(group).toBeInTheDocument();
    });

    it('handles empty items array', () => {
      const component = createBottomNavComponent({ items: [] });
      const { container } = render(
        <svg>
          <BottomNav component={component} bounds={bottomNavBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="bottomnav"]');
      expect(group).toBeInTheDocument();
    });
  });

  describe('NavMenu', () => {
    const navMenuBounds: LayoutBounds = {
      x: 0,
      y: 0,
      width: 200,
      height: 300,
    };

    const createNavMenuComponent = (
      overrides: Partial<NavMenuComponent> = {}
    ): NavMenuComponent => ({
      id: 'navmenu-1',
      type: 'navmenu',
      bounds: navMenuBounds,
      items: [
        { label: 'Dashboard', icon: 'dashboard' },
        { label: 'Settings', icon: 'settings' },
        { label: 'Help', icon: 'help' },
      ],
      ...overrides,
    });

    it('renders an SVG group element', () => {
      const component = createNavMenuComponent();
      const { container } = render(
        <svg>
          <NavMenu component={component} bounds={navMenuBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="navmenu"]');
      expect(group).toBeInTheDocument();
    });

    it('positions group using transform', () => {
      const bounds: LayoutBounds = { x: 20, y: 60, width: 250, height: 400 };
      const component = createNavMenuComponent({ bounds });
      const { container } = render(
        <svg>
          <NavMenu component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="navmenu"]');
      expect(group).toHaveAttribute('transform', 'translate(20, 60)');
    });

    it('renders vertical variant by default', () => {
      const component = createNavMenuComponent();
      const { container } = render(
        <svg>
          <NavMenu component={component} bounds={navMenuBounds} />
        </svg>
      );

      const texts = container.querySelectorAll('text');
      const labels = Array.from(texts).map(t => t.textContent);
      expect(labels).toContain('Dashboard');
    });

    it('renders horizontal variant', () => {
      const component = createNavMenuComponent({ variant: 'horizontal' });
      const bounds: LayoutBounds = { x: 0, y: 0, width: 400, height: 48 };
      const { container } = render(
        <svg>
          <NavMenu component={component} bounds={bounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="navmenu"]');
      expect(group).toBeInTheDocument();
    });

    it('renders with active item', () => {
      const component = createNavMenuComponent({
        items: [
          { label: 'Home', active: true },
          { label: 'About' },
        ],
      });
      const { container } = render(
        <svg>
          <NavMenu component={component} bounds={navMenuBounds} />
        </svg>
      );

      const texts = container.querySelectorAll('text');
      const labels = Array.from(texts).map(t => t.textContent);
      expect(labels).toContain('Home');
    });

    it('handles empty items array', () => {
      const component = createNavMenuComponent({ items: [] });
      const { container } = render(
        <svg>
          <NavMenu component={component} bounds={navMenuBounds} />
        </svg>
      );

      const group = container.querySelector('g[data-component-type="navmenu"]');
      expect(group).toBeInTheDocument();
    });
  });
});
