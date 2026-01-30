/**
 * Tests for wireframe layout calculator
 */
import { describe, it, expect } from 'vitest';
import {
  calculateLayout,
  getLayoutDirection,
  getViewportDimensions,
  LayoutResult,
} from '../layout';
import type {
  WireframeComponent,
  ScreenComponent,
  ColComponent,
  RowComponent,
  CardComponent,
  ButtonComponent,
  TextComponent,
  LayoutBounds,
  Viewport,
  Direction,
} from '../../../types/wireframe';

// Helper to create test components
function createButton(id: string, bounds: LayoutBounds): ButtonComponent {
  return {
    id,
    type: 'button',
    bounds,
    label: 'Test Button',
  };
}

function createText(id: string, bounds: LayoutBounds): TextComponent {
  return {
    id,
    type: 'text',
    bounds,
    content: 'Test Text',
  };
}

function createCol(
  id: string,
  bounds: LayoutBounds,
  children: WireframeComponent[] = [],
  options: { gap?: number; padding?: number } = {}
): ColComponent {
  return {
    id,
    type: 'col',
    bounds,
    children,
    ...options,
  };
}

function createRow(
  id: string,
  bounds: LayoutBounds,
  children: WireframeComponent[] = [],
  options: { gap?: number; padding?: number } = {}
): RowComponent {
  return {
    id,
    type: 'row',
    bounds,
    children,
    ...options,
  };
}

function createScreen(
  id: string,
  bounds: LayoutBounds,
  children: WireframeComponent[] = []
): ScreenComponent {
  return {
    id,
    type: 'screen',
    name: 'Test Screen',
    bounds,
    children,
  };
}

function createCard(
  id: string,
  bounds: LayoutBounds,
  children: WireframeComponent[] = [],
  options: { gap?: number; padding?: number; title?: string } = {}
): CardComponent {
  return {
    id,
    type: 'card',
    bounds,
    children,
    ...options,
  };
}

describe('getLayoutDirection', () => {
  it('returns vertical for Col component', () => {
    const col = createCol('col-1', { x: 0, y: 0, width: 100, height: 100 });
    expect(getLayoutDirection(col)).toBe('vertical');
  });

  it('returns vertical for Screen component', () => {
    const screen = createScreen('screen-1', { x: 0, y: 0, width: 375, height: 600 });
    expect(getLayoutDirection(screen)).toBe('vertical');
  });

  it('returns horizontal for Row component', () => {
    const row = createRow('row-1', { x: 0, y: 0, width: 100, height: 50 });
    expect(getLayoutDirection(row)).toBe('horizontal');
  });

  it('returns vertical for Button (leaf component)', () => {
    const button = createButton('btn-1', { x: 0, y: 0, width: 80, height: 40 });
    expect(getLayoutDirection(button)).toBe('vertical');
  });

  it('returns vertical for Text (leaf component)', () => {
    const text = createText('text-1', { x: 0, y: 0, width: 100, height: 20 });
    expect(getLayoutDirection(text)).toBe('vertical');
  });
});

describe('getViewportDimensions', () => {
  describe('single screen', () => {
    it('returns correct dimensions for mobile viewport', () => {
      const dims = getViewportDimensions('mobile', 'LR', 1);
      expect(dims.width).toBe(375 + 16 * 2); // screenWidth + padding * 2
      expect(dims.height).toBe(600 + 16 * 2 + 32); // screenHeight + padding * 2 + label space
    });

    it('returns correct dimensions for tablet viewport', () => {
      const dims = getViewportDimensions('tablet', 'LR', 1);
      expect(dims.width).toBe(768 + 16 * 2);
      expect(dims.height).toBe(600 + 16 * 2 + 32);
    });

    it('returns correct dimensions for desktop viewport', () => {
      const dims = getViewportDimensions('desktop', 'LR', 1);
      expect(dims.width).toBe(1200 + 16 * 2);
      expect(dims.height).toBe(600 + 16 * 2 + 32);
    });
  });

  describe('multiple screens - LR direction', () => {
    it('calculates width for 2 screens side by side', () => {
      const dims = getViewportDimensions('mobile', 'LR', 2);
      const screenWidthWithPadding = 375 + 16 * 2;
      const gap = 32;
      expect(dims.width).toBe(screenWidthWithPadding * 2 + gap);
      expect(dims.height).toBe(600 + 16 * 2 + 32);
    });

    it('calculates width for 3 screens side by side', () => {
      const dims = getViewportDimensions('mobile', 'LR', 3);
      const screenWidthWithPadding = 375 + 16 * 2;
      const gap = 32;
      expect(dims.width).toBe(screenWidthWithPadding * 3 + gap * 2);
    });
  });

  describe('multiple screens - TD direction', () => {
    it('calculates height for 2 screens stacked vertically', () => {
      const dims = getViewportDimensions('mobile', 'TD', 2);
      const screenHeightWithPadding = 600 + 16 * 2 + 32;
      const gap = 32;
      expect(dims.width).toBe(375 + 16 * 2);
      expect(dims.height).toBe(screenHeightWithPadding * 2 + gap);
    });

    it('calculates height for 3 screens stacked vertically', () => {
      const dims = getViewportDimensions('mobile', 'TD', 3);
      const screenHeightWithPadding = 600 + 16 * 2 + 32;
      const gap = 32;
      expect(dims.height).toBe(screenHeightWithPadding * 3 + gap * 2);
    });
  });
});

describe('calculateLayout', () => {
  describe('leaf nodes', () => {
    it('returns bounds as-is for component with no children', () => {
      const bounds: LayoutBounds = { x: 10, y: 20, width: 100, height: 40 };
      const button = createButton('btn-1', bounds);

      const result = calculateLayout(button, bounds);

      expect(result).toHaveLength(1);
      expect(result[0].component).toBe(button);
      expect(result[0].bounds).toEqual(bounds);
    });

    it('returns bounds as-is for text component', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 24 };
      const text = createText('text-1', bounds);

      const result = calculateLayout(text, bounds);

      expect(result).toHaveLength(1);
      expect(result[0].bounds).toEqual(bounds);
    });
  });

  describe('vertical layout (Col)', () => {
    it('distributes children evenly in vertical direction', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 120 };
      const child1 = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const child2 = createButton('btn-2', { x: 0, y: 0, width: 0, height: 0 });
      const child3 = createButton('btn-3', { x: 0, y: 0, width: 0, height: 0 });
      const col = createCol('col-1', bounds, [child1, child2, child3]);

      const result = calculateLayout(col, bounds);

      // Should have 3 results for 3 children
      expect(result).toHaveLength(3);

      // Each child should get 1/3 of the height (40px each)
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 200, height: 40 });
      expect(result[1].bounds).toEqual({ x: 0, y: 40, width: 200, height: 40 });
      expect(result[2].bounds).toEqual({ x: 0, y: 80, width: 200, height: 40 });
    });

    it('applies gap between children', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 120 };
      const child1 = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const child2 = createButton('btn-2', { x: 0, y: 0, width: 0, height: 0 });
      const col = createCol('col-1', bounds, [child1, child2], { gap: 20 });

      const result = calculateLayout(col, bounds);

      // Available height = 120 - 20 (gap) = 100
      // Each child gets 50
      expect(result).toHaveLength(2);
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 200, height: 50 });
      expect(result[1].bounds).toEqual({ x: 0, y: 70, width: 200, height: 50 });
    });

    it('applies padding', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 100 };
      const child = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const col = createCol('col-1', bounds, [child], { padding: 10 });

      const result = calculateLayout(col, bounds);

      // Content area = 180 x 80 (after padding)
      expect(result).toHaveLength(1);
      expect(result[0].bounds).toEqual({ x: 10, y: 10, width: 180, height: 80 });
    });
  });

  describe('horizontal layout (Row)', () => {
    it('distributes children evenly in horizontal direction', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 300, height: 50 };
      const child1 = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const child2 = createButton('btn-2', { x: 0, y: 0, width: 0, height: 0 });
      const child3 = createButton('btn-3', { x: 0, y: 0, width: 0, height: 0 });
      const row = createRow('row-1', bounds, [child1, child2, child3]);

      const result = calculateLayout(row, bounds);

      expect(result).toHaveLength(3);
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
      expect(result[1].bounds).toEqual({ x: 100, y: 0, width: 100, height: 50 });
      expect(result[2].bounds).toEqual({ x: 200, y: 0, width: 100, height: 50 });
    });

    it('applies gap between children horizontally', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 50 };
      const child1 = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const child2 = createButton('btn-2', { x: 0, y: 0, width: 0, height: 0 });
      const row = createRow('row-1', bounds, [child1, child2], { gap: 20 });

      const result = calculateLayout(row, bounds);

      // Available width = 200 - 20 (gap) = 180
      // Each child gets 90
      expect(result).toHaveLength(2);
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 90, height: 50 });
      expect(result[1].bounds).toEqual({ x: 110, y: 0, width: 90, height: 50 });
    });

    it('applies padding', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 80 };
      const child = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const row = createRow('row-1', bounds, [child], { padding: 15 });

      const result = calculateLayout(row, bounds);

      expect(result).toHaveLength(1);
      expect(result[0].bounds).toEqual({ x: 15, y: 15, width: 170, height: 50 });
    });
  });

  describe('nested layouts', () => {
    it('calculates nested Col within Row', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 400, height: 100 };

      const leftChild = createButton('btn-left', { x: 0, y: 0, width: 0, height: 0 });
      const rightChild1 = createButton('btn-right-1', { x: 0, y: 0, width: 0, height: 0 });
      const rightChild2 = createButton('btn-right-2', { x: 0, y: 0, width: 0, height: 0 });
      const rightCol = createCol('col-right', { x: 0, y: 0, width: 0, height: 0 }, [
        rightChild1,
        rightChild2,
      ]);

      const row = createRow('row-1', bounds, [leftChild, rightCol]);

      const result = calculateLayout(row, bounds);

      // Row divides into 2 equal parts: 200 each
      // Left button gets full 200x100
      // Right col gets 200x100, then splits vertically into 2x50
      expect(result).toHaveLength(3);
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 200, height: 100 }); // left button
      expect(result[1].bounds).toEqual({ x: 200, y: 0, width: 200, height: 50 }); // right child 1
      expect(result[2].bounds).toEqual({ x: 200, y: 50, width: 200, height: 50 }); // right child 2
    });

    it('calculates nested Row within Col', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 200 };

      const topChild = createButton('btn-top', { x: 0, y: 0, width: 0, height: 0 });
      const bottomChild1 = createButton('btn-bottom-1', { x: 0, y: 0, width: 0, height: 0 });
      const bottomChild2 = createButton('btn-bottom-2', { x: 0, y: 0, width: 0, height: 0 });
      const bottomRow = createRow('row-bottom', { x: 0, y: 0, width: 0, height: 0 }, [
        bottomChild1,
        bottomChild2,
      ]);

      const col = createCol('col-1', bounds, [topChild, bottomRow]);

      const result = calculateLayout(col, bounds);

      // Col divides into 2 equal parts: 100 height each
      // Top button gets full 200x100
      // Bottom row gets 200x100, then splits horizontally into 2x100 width
      expect(result).toHaveLength(3);
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 200, height: 100 }); // top button
      expect(result[1].bounds).toEqual({ x: 0, y: 100, width: 100, height: 100 }); // bottom child 1
      expect(result[2].bounds).toEqual({ x: 100, y: 100, width: 100, height: 100 }); // bottom child 2
    });
  });

  describe('Screen component', () => {
    it('lays out screen children vertically', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 375, height: 600 };
      const child1 = createText('title', { x: 0, y: 0, width: 0, height: 0 });
      const child2 = createButton('btn', { x: 0, y: 0, width: 0, height: 0 });
      const screen = createScreen('screen-1', bounds, [child1, child2]);

      const result = calculateLayout(screen, bounds);

      expect(result).toHaveLength(2);
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 375, height: 300 });
      expect(result[1].bounds).toEqual({ x: 0, y: 300, width: 375, height: 300 });
    });
  });

  describe('empty children', () => {
    it('returns empty array for container with empty children array', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 100 };
      const col = createCol('col-1', bounds, []);

      const result = calculateLayout(col, bounds);

      expect(result).toHaveLength(0);
    });
  });

  describe('single child', () => {
    it('gives full space to single child in Col', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 100 };
      const child = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const col = createCol('col-1', bounds, [child]);

      const result = calculateLayout(col, bounds);

      expect(result).toHaveLength(1);
      expect(result[0].bounds).toEqual(bounds);
    });

    it('gives full space to single child in Row', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 100 };
      const child = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const row = createRow('row-1', bounds, [child]);

      const result = calculateLayout(row, bounds);

      expect(result).toHaveLength(1);
      expect(result[0].bounds).toEqual(bounds);
    });
  });

  describe('offset bounds', () => {
    it('respects x,y offset in bounds', () => {
      const bounds: LayoutBounds = { x: 50, y: 100, width: 200, height: 80 };
      const child1 = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const child2 = createButton('btn-2', { x: 0, y: 0, width: 0, height: 0 });
      const col = createCol('col-1', bounds, [child1, child2]);

      const result = calculateLayout(col, bounds);

      expect(result).toHaveLength(2);
      expect(result[0].bounds).toEqual({ x: 50, y: 100, width: 200, height: 40 });
      expect(result[1].bounds).toEqual({ x: 50, y: 140, width: 200, height: 40 });
    });
  });

  describe('Card component', () => {
    it('lays out card children vertically', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 100 };
      const child1 = createText('title', { x: 0, y: 0, width: 0, height: 0 });
      const child2 = createButton('btn', { x: 0, y: 0, width: 0, height: 0 });
      const card = createCard('card-1', bounds, [child1, child2]);

      const result = calculateLayout(card, bounds);

      expect(result).toHaveLength(2);
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 200, height: 50 });
      expect(result[1].bounds).toEqual({ x: 0, y: 50, width: 200, height: 50 });
    });

    it('applies gap and padding to card', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 100 };
      const child1 = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const child2 = createButton('btn-2', { x: 0, y: 0, width: 0, height: 0 });
      const card = createCard('card-1', bounds, [child1, child2], { padding: 10, gap: 10 });

      const result = calculateLayout(card, bounds);

      // Content area = 180 x 80 (after padding)
      // Available height = 80 - 10 (gap) = 70
      // Each child gets 35
      expect(result).toHaveLength(2);
      expect(result[0].bounds).toEqual({ x: 10, y: 10, width: 180, height: 35 });
      expect(result[1].bounds).toEqual({ x: 10, y: 55, width: 180, height: 35 });
    });

    it('returns vertical direction for Card', () => {
      const card = createCard('card-1', { x: 0, y: 0, width: 100, height: 100 });
      expect(getLayoutDirection(card)).toBe('vertical');
    });
  });

  describe('flex layout', () => {
    it('uses flex: 1 as default (equal distribution)', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 300, height: 50 };
      const child1 = createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 });
      const child2 = createButton('btn-2', { x: 0, y: 0, width: 0, height: 0 });
      const row = createRow('row-1', bounds, [child1, child2]);

      const result = calculateLayout(row, bounds);

      // Default flex: 1 means equal distribution
      expect(result).toHaveLength(2);
      expect(result[0].bounds.width).toBe(150);
      expect(result[1].bounds.width).toBe(150);
    });

    it('respects flex: 0 for fixed-size children (horizontal)', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 340, height: 50 };
      // Sidebar with fixed 240px width
      const sidebar = { ...createButton('sidebar', { x: 0, y: 0, width: 240, height: 0 }), flex: 0 };
      // Content fills remaining space
      const content = createButton('content', { x: 0, y: 0, width: 0, height: 0 });
      const row = createRow('row-1', bounds, [sidebar as any, content]);

      const result = calculateLayout(row, bounds);

      expect(result).toHaveLength(2);
      // Sidebar should be fixed at 240px
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 240, height: 50 });
      // Content should fill remaining: 340 - 240 = 100
      expect(result[1].bounds).toEqual({ x: 240, y: 0, width: 100, height: 50 });
    });

    it('respects flex: 0 for fixed-size children (vertical)', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 160 };
      // Header with fixed 60px height
      const header = { ...createButton('header', { x: 0, y: 0, width: 0, height: 60 }), flex: 0 };
      // Content fills remaining space
      const content = createButton('content', { x: 0, y: 0, width: 0, height: 0 });
      const col = createCol('col-1', bounds, [header as any, content]);

      const result = calculateLayout(col, bounds);

      expect(result).toHaveLength(2);
      // Header should be fixed at 60px height
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 200, height: 60 });
      // Content should fill remaining: 160 - 60 = 100
      expect(result[1].bounds).toEqual({ x: 0, y: 60, width: 200, height: 100 });
    });

    it('distributes flex space proportionally among flex children', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 300, height: 50 };
      // flex: 1 gets 1/3
      const child1 = { ...createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 }), flex: 1 };
      // flex: 2 gets 2/3
      const child2 = { ...createButton('btn-2', { x: 0, y: 0, width: 0, height: 0 }), flex: 2 };
      const row = createRow('row-1', bounds, [child1 as any, child2 as any]);

      const result = calculateLayout(row, bounds);

      expect(result).toHaveLength(2);
      expect(result[0].bounds.width).toBe(100); // 1/3 of 300
      expect(result[1].bounds.width).toBe(200); // 2/3 of 300
    });

    it('combines fixed and proportional flex', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 400, height: 50 };
      // Fixed sidebar
      const sidebar = { ...createButton('sidebar', { x: 0, y: 0, width: 100, height: 0 }), flex: 0 };
      // flex: 1 gets 1/3 of remaining
      const content1 = { ...createButton('content1', { x: 0, y: 0, width: 0, height: 0 }), flex: 1 };
      // flex: 2 gets 2/3 of remaining
      const content2 = { ...createButton('content2', { x: 0, y: 0, width: 0, height: 0 }), flex: 2 };
      const row = createRow('row-1', bounds, [sidebar as any, content1 as any, content2 as any]);

      const result = calculateLayout(row, bounds);

      expect(result).toHaveLength(3);
      // Sidebar fixed at 100
      expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
      // Remaining 300px split 1:2
      expect(result[1].bounds).toEqual({ x: 100, y: 0, width: 100, height: 50 }); // 1/3 of 300
      expect(result[2].bounds).toEqual({ x: 200, y: 0, width: 200, height: 50 }); // 2/3 of 300
    });

    it('applies cross-axis alignment: center', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 300, height: 100 };
      // Small button centered vertically
      const button = {
        ...createButton('btn', { x: 0, y: 0, width: 0, height: 40 }),
        align: 'center' as const,
      };
      const row = createRow('row-1', bounds, [button as any]);

      const result = calculateLayout(row, bounds);

      expect(result).toHaveLength(1);
      // Centered vertically: (100 - 40) / 2 = 30 offset
      expect(result[0].bounds).toEqual({ x: 0, y: 30, width: 300, height: 40 });
    });

    it('applies cross-axis alignment: end', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 300, height: 100 };
      // Small button at bottom
      const button = {
        ...createButton('btn', { x: 0, y: 0, width: 0, height: 40 }),
        align: 'end' as const,
      };
      const row = createRow('row-1', bounds, [button as any]);

      const result = calculateLayout(row, bounds);

      expect(result).toHaveLength(1);
      // At end: 100 - 40 = 60 offset
      expect(result[0].bounds).toEqual({ x: 0, y: 60, width: 300, height: 40 });
    });

    it('applies cross-axis alignment in vertical layout', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 100 };
      // Small button centered horizontally
      const button = {
        ...createButton('btn', { x: 0, y: 0, width: 80, height: 0 }),
        align: 'center' as const,
      };
      const col = createCol('col-1', bounds, [button as any]);

      const result = calculateLayout(col, bounds);

      expect(result).toHaveLength(1);
      // Centered horizontally: (200 - 80) / 2 = 60 offset
      expect(result[0].bounds).toEqual({ x: 60, y: 0, width: 80, height: 100 });
    });

    it('handles multiple fixed-size children', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 50 };
      const icon = { ...createButton('icon', { x: 0, y: 0, width: 32, height: 0 }), flex: 0 };
      const text = createButton('text', { x: 0, y: 0, width: 0, height: 0 }); // flex: 1
      const action = { ...createButton('action', { x: 0, y: 0, width: 48, height: 0 }), flex: 0 };
      const row = createRow('row-1', bounds, [icon as any, text, action as any]);

      const result = calculateLayout(row, bounds);

      expect(result).toHaveLength(3);
      expect(result[0].bounds.width).toBe(32);   // Fixed icon
      expect(result[1].bounds.width).toBe(120);  // Flex text: 200 - 32 - 48 = 120
      expect(result[2].bounds.width).toBe(48);   // Fixed action
    });

    it('handles all flex: 0 children (fallback to flex distribution)', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 50 };
      // Two children both with flex: 0 but no explicit width
      const child1 = { ...createButton('btn-1', { x: 0, y: 0, width: 0, height: 0 }), flex: 0 };
      const child2 = { ...createButton('btn-2', { x: 0, y: 0, width: 0, height: 0 }), flex: 0 };
      const row = createRow('row-1', bounds, [child1 as any, child2 as any]);

      const result = calculateLayout(row, bounds);

      // When bounds are 0 and flex is 0, should fallback gracefully
      expect(result).toHaveLength(2);
      // Both get 0 width since no flex children and no explicit width
      expect(result[0].bounds.width).toBe(0);
      expect(result[1].bounds.width).toBe(0);
    });
  });
});
