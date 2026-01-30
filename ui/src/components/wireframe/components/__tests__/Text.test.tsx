import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextRenderer, TitleRenderer } from '../Text';
import type { TextComponent, LayoutBounds } from '../../../../types/wireframe';

// Mock rough.js
vi.mock('roughjs', () => ({
  default: {
    svg: vi.fn(() => ({
      rectangle: vi.fn(),
      line: vi.fn(),
    })),
  },
}));

// Mock useTheme hook
vi.mock('../../../../hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({ theme: 'light' })),
}));

describe('TextRenderer', () => {
  const defaultBounds: LayoutBounds = {
    x: 10,
    y: 20,
    width: 200,
    height: 30,
  };

  const createTextComponent = (overrides: Partial<TextComponent> = {}): TextComponent => ({
    id: 'text-1',
    type: 'text',
    bounds: defaultBounds,
    content: 'Hello World',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders text content within SVG', () => {
      const component = createTextComponent({ content: 'Test Text' });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      expect(screen.getByText('Test Text')).toBeInTheDocument();
    });

    it('renders text element with correct position', () => {
      const bounds: LayoutBounds = { x: 50, y: 100, width: 150, height: 40 };
      const component = createTextComponent({ content: 'Positioned Text' });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={bounds} />
        </svg>
      );

      const textElement = screen.getByText('Positioned Text');
      // Text should be vertically centered in bounds
      expect(textElement).toHaveAttribute('x', '50');
      // y should be at center + font baseline adjustment
      expect(textElement).toHaveAttribute('y');
    });

    it('renders empty text when content is empty string', () => {
      const component = createTextComponent({ content: '' });

      const { container } = render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      // Should render a text element even if empty
      const textElement = container.querySelector('text');
      expect(textElement).toBeInTheDocument();
    });

    it('applies default font size when not specified', () => {
      const component = createTextComponent({ content: 'Default Size' });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Default Size');
      expect(textElement).toHaveAttribute('font-size', '14');
    });

    it('applies custom font size when specified', () => {
      const component = createTextComponent({
        content: 'Large Text',
        fontSize: 24,
      });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Large Text');
      expect(textElement).toHaveAttribute('font-size', '24');
    });

    it('applies font weight when specified', () => {
      const component = createTextComponent({
        content: 'Bold Text',
        fontWeight: 'bold',
      });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Bold Text');
      expect(textElement).toHaveAttribute('font-weight', 'bold');
    });

    it('applies custom color when specified', () => {
      const component = createTextComponent({
        content: 'Colored Text',
        color: '#ff0000',
      });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Colored Text');
      expect(textElement).toHaveAttribute('fill', '#ff0000');
    });
  });

  describe('theme support', () => {
    it('applies light theme colors by default', async () => {
      const { useTheme } = await import('../../../../hooks/useTheme');
      vi.mocked(useTheme).mockReturnValue({
        theme: 'light',
        setTheme: vi.fn(),
        toggleTheme: vi.fn(),
      });

      const component = createTextComponent({ content: 'Light Theme Text' });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Light Theme Text');
      // Default light theme text color
      expect(textElement).toHaveAttribute('fill', '#1f2937');
    });

    it('applies dark theme colors when theme is dark', async () => {
      const { useTheme } = await import('../../../../hooks/useTheme');
      vi.mocked(useTheme).mockReturnValue({
        theme: 'dark',
        setTheme: vi.fn(),
        toggleTheme: vi.fn(),
      });

      const component = createTextComponent({ content: 'Dark Theme Text' });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Dark Theme Text');
      // Default dark theme text color
      expect(textElement).toHaveAttribute('fill', '#f3f4f6');
    });

    it('custom color overrides theme color', async () => {
      const { useTheme } = await import('../../../../hooks/useTheme');
      vi.mocked(useTheme).mockReturnValue({
        theme: 'dark',
        setTheme: vi.fn(),
        toggleTheme: vi.fn(),
      });

      const component = createTextComponent({
        content: 'Custom Color',
        color: '#00ff00',
      });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Custom Color');
      expect(textElement).toHaveAttribute('fill', '#00ff00');
    });
  });

  describe('text styling', () => {
    it('applies hand-drawn font family', () => {
      const component = createTextComponent({ content: 'Styled Text' });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Styled Text');
      expect(textElement).toHaveAttribute('font-family');
      // Should use a hand-drawn style font
      const fontFamily = textElement.getAttribute('font-family');
      expect(fontFamily).toContain('Comic');
    });

    it('text is left-aligned by default', () => {
      const component = createTextComponent({ content: 'Left Aligned' });

      render(
        <svg data-testid="test-svg">
          <TextRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Left Aligned');
      expect(textElement).toHaveAttribute('text-anchor', 'start');
    });
  });
});

describe('TitleRenderer', () => {
  const defaultBounds: LayoutBounds = {
    x: 10,
    y: 20,
    width: 300,
    height: 50,
  };

  const createTextComponent = (overrides: Partial<TextComponent> = {}): TextComponent => ({
    id: 'title-1',
    type: 'text',
    bounds: defaultBounds,
    content: 'Page Title',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders title content within SVG', () => {
      const component = createTextComponent({ content: 'Main Title' });

      render(
        <svg data-testid="test-svg">
          <TitleRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      expect(screen.getByText('Main Title')).toBeInTheDocument();
    });

    it('uses larger default font size than TextRenderer', () => {
      const component = createTextComponent({ content: 'Big Title' });

      render(
        <svg data-testid="test-svg">
          <TitleRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Big Title');
      // Title should have larger font size (24px default)
      expect(textElement).toHaveAttribute('font-size', '24');
    });

    it('applies bold font weight by default', () => {
      const component = createTextComponent({ content: 'Bold Title' });

      render(
        <svg data-testid="test-svg">
          <TitleRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Bold Title');
      expect(textElement).toHaveAttribute('font-weight', 'bold');
    });

    it('respects custom font size when specified', () => {
      const component = createTextComponent({
        content: 'Custom Size Title',
        fontSize: 32,
      });

      render(
        <svg data-testid="test-svg">
          <TitleRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Custom Size Title');
      expect(textElement).toHaveAttribute('font-size', '32');
    });

    it('respects custom font weight when specified', () => {
      const component = createTextComponent({
        content: 'Normal Weight Title',
        fontWeight: 'normal',
      });

      render(
        <svg data-testid="test-svg">
          <TitleRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Normal Weight Title');
      expect(textElement).toHaveAttribute('font-weight', 'normal');
    });
  });

  describe('theme support', () => {
    it('applies light theme colors by default', async () => {
      const { useTheme } = await import('../../../../hooks/useTheme');
      vi.mocked(useTheme).mockReturnValue({
        theme: 'light',
        setTheme: vi.fn(),
        toggleTheme: vi.fn(),
      });

      const component = createTextComponent({ content: 'Light Title' });

      render(
        <svg data-testid="test-svg">
          <TitleRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Light Title');
      expect(textElement).toHaveAttribute('fill', '#111827');
    });

    it('applies dark theme colors when theme is dark', async () => {
      const { useTheme } = await import('../../../../hooks/useTheme');
      vi.mocked(useTheme).mockReturnValue({
        theme: 'dark',
        setTheme: vi.fn(),
        toggleTheme: vi.fn(),
      });

      const component = createTextComponent({ content: 'Dark Title' });

      render(
        <svg data-testid="test-svg">
          <TitleRenderer component={component} bounds={defaultBounds} />
        </svg>
      );

      const textElement = screen.getByText('Dark Title');
      expect(textElement).toHaveAttribute('fill', '#ffffff');
    });
  });

  describe('positioning', () => {
    it('positions text at correct x coordinate', () => {
      const bounds: LayoutBounds = { x: 100, y: 50, width: 200, height: 40 };
      const component = createTextComponent({ content: 'Positioned Title' });

      render(
        <svg data-testid="test-svg">
          <TitleRenderer component={component} bounds={bounds} />
        </svg>
      );

      const textElement = screen.getByText('Positioned Title');
      expect(textElement).toHaveAttribute('x', '100');
    });

    it('vertically centers text in bounds', () => {
      const bounds: LayoutBounds = { x: 0, y: 0, width: 200, height: 60 };
      const component = createTextComponent({ content: 'Centered Title' });

      render(
        <svg data-testid="test-svg">
          <TitleRenderer component={component} bounds={bounds} />
        </svg>
      );

      const textElement = screen.getByText('Centered Title');
      const y = parseFloat(textElement.getAttribute('y') || '0');
      // y should be roughly centered (considering font baseline)
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(bounds.height);
    });
  });
});
