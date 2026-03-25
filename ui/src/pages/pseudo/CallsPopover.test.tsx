/**
 * CallsPopover Component Tests
 *
 * Comprehensive test suite for the popover card displayed on hover of CallsLink.
 * - Fixed positioning with portal
 * - File path display (muted, mono, small)
 * - Title and subtitle lines
 * - Export function listing (green, small)
 * - Mouse event handlers
 * - 320px card width
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CallsPopover from './CallsPopover';

describe('CallsPopover', () => {
  const mockOnNavigate = vi.fn();
  const mockOnMouseEnter = vi.fn();
  const mockOnMouseLeave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render popover on document.body via portal', () => {
      const content = '// Test Module\nFUNCTION testFn() EXPORT\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      // Should render in DOM (portal)
      expect(document.querySelector('[data-testid="calls-popover"]')).toBeInTheDocument();
    });

    it('should display file stem in muted mono font, small size', () => {
      const content = '// Test Module\n';
      render(
        <CallsPopover
          content={content}
          fileStem="myfile"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const fileStem = screen.getByText('myfile');
      expect(fileStem).toBeInTheDocument();
      expect(fileStem).toHaveClass('font-mono');
      expect(fileStem).toHaveClass('text-xs');
      expect(fileStem).toHaveClass('text-stone-500');
    });

    it('should have 320px width', () => {
      const content = '// Test Module\n';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const card = document.querySelector('[data-testid="calls-popover"]') as HTMLElement;
      expect(card).toHaveClass('w-80'); // Tailwind w-80 = 320px
    });
  });

  describe('Title and Subtitle Rendering', () => {
    it('should display title line in bold', () => {
      const content = '// File Parser\n// Parse pseudo code\nFUNCTION test() EXPORT\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="parser"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const titleLine = screen.getByText('File Parser');
      expect(titleLine).toBeInTheDocument();
      expect(titleLine).toHaveClass('font-bold');
    });

    it('should display subtitle line in muted small text when present', () => {
      const content = '// File Parser\n// Parse pseudo code\nFUNCTION test() EXPORT\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="parser"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const subtitleLine = screen.getByText('Parse pseudo code');
      expect(subtitleLine).toBeInTheDocument();
      expect(subtitleLine).toHaveClass('text-xs');
      expect(subtitleLine).toHaveClass('text-stone-500');
    });

    it('should not render subtitle section when subtitle is empty', () => {
      const content = '// File Parser\nFUNCTION test() EXPORT\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="parser"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      // Should not have two hr separators (file/title only, no subtitle section)
      const hrs = document.querySelectorAll('[data-testid="calls-popover"] hr');
      expect(hrs.length).toBe(2); // file stem hr + title/exports hr
    });
  });

  describe('Export Functions Listing', () => {
    it('should display "Exports:" label in small text', () => {
      const content = '// Test Module\nFUNCTION test() EXPORT\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const exportsLabel = screen.getByText('Exports:');
      expect(exportsLabel).toBeInTheDocument();
      expect(exportsLabel).toHaveClass('text-xs');
    });

    it('should list exported functions in green', () => {
      const content =
        '// Test Module\nFUNCTION foo() EXPORT\n---\nFUNCTION bar() EXPORT\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const foo = screen.getByText('foo');
      const bar = screen.getByText('bar');
      expect(foo).toBeInTheDocument();
      expect(bar).toBeInTheDocument();
      expect(foo).toHaveClass('text-green-600');
      expect(bar).toHaveClass('text-green-600');
    });

    it('should only list exported functions, not internal ones', () => {
      const content = `// Test Module
FUNCTION exported() EXPORT
---
FUNCTION internal()
---`;
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const exported = screen.getByText('exported');
      expect(exported).toBeInTheDocument();
      expect(screen.queryByText('internal')).not.toBeInTheDocument();
    });

    it('should display functions in small text size', () => {
      const content = '// Test Module\nFUNCTION testFn() EXPORT\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const fn = screen.getByText('testFn');
      expect(fn).toHaveClass('text-xs');
    });

    it('should handle no exported functions gracefully', () => {
      const content = '// Test Module\nFUNCTION internal()\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      // Component should still render
      expect(document.querySelector('[data-testid="calls-popover"]')).toBeInTheDocument();
      // But no exported functions listed
      const exportsLabel = screen.queryByText('Exports:');
      expect(exportsLabel).not.toBeInTheDocument();
    });
  });

  describe('Fixed Positioning', () => {
    it('should apply top and left position styles', () => {
      const content = '// Test Module\n';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 150, left: 250 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const popover = document.querySelector('[data-testid="calls-popover"]') as HTMLElement;
      expect(popover).toHaveStyle('top: 150px');
      expect(popover).toHaveStyle('left: 250px');
    });

    it('should be fixed positioned', () => {
      const content = '// Test Module\n';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const popover = document.querySelector('[data-testid="calls-popover"]') as HTMLElement;
      const computedStyle = window.getComputedStyle(popover);
      expect(computedStyle.position).toBe('fixed');
    });
  });

  describe('Mouse Event Handlers', () => {
    it('should call onMouseEnter when mouse enters', async () => {
      const user = userEvent.setup();
      const content = '// Test Module\n';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const popover = document.querySelector('[data-testid="calls-popover"]') as HTMLElement;
      await user.hover(popover);

      expect(mockOnMouseEnter).toHaveBeenCalled();
    });

    it('should call onMouseLeave when mouse leaves', async () => {
      const user = userEvent.setup();
      const content = '// Test Module\n';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const popover = document.querySelector('[data-testid="calls-popover"]') as HTMLElement;
      await user.hover(popover);
      await user.unhover(popover);

      expect(mockOnMouseLeave).toHaveBeenCalled();
    });
  });

  describe('Card Structure', () => {
    it('should have horizontal rule after file stem', () => {
      const content = '// Test Module\nFUNCTION test() EXPORT\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const hrs = document.querySelectorAll('[data-testid="calls-popover"] hr');
      expect(hrs.length).toBeGreaterThan(0);
    });

    it('should have proper card styling with border and shadow', () => {
      const content = '// Test Module\nFUNCTION test() EXPORT\n---';
      render(
        <CallsPopover
          content={content}
          fileStem="test"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      const popover = document.querySelector('[data-testid="calls-popover"]') as HTMLElement;
      expect(popover).toHaveClass('border');
      expect(popover).toHaveClass('bg-white');
    });
  });

  describe('Integration with parsePseudo', () => {
    it('should correctly parse and display complex pseudo content', () => {
      const content = `// Data Parser
// Parse JSON and validate data

FUNCTION readFile(path: string) -> string EXPORT
open file
read content
return content
---

FUNCTION parseJSON(text: string) -> object EXPORT
deserialize text
validate data
---

FUNCTION logError(msg: string)
log message
---`;
      render(
        <CallsPopover
          content={content}
          fileStem="parser"
          position={{ top: 100, left: 200 }}
          onNavigate={mockOnNavigate}
          onMouseEnter={mockOnMouseEnter}
          onMouseLeave={mockOnMouseLeave}
        />
      );

      // Check title and subtitle
      expect(screen.getByText('Data Parser')).toBeInTheDocument();
      expect(screen.getByText('Parse JSON and validate data')).toBeInTheDocument();

      // Check file stem
      expect(screen.getByText('parser')).toBeInTheDocument();

      // Check exported functions only
      expect(screen.getByText('readFile')).toBeInTheDocument();
      expect(screen.getByText('parseJSON')).toBeInTheDocument();
      expect(screen.queryByText('logError')).not.toBeInTheDocument();
    });
  });
});
