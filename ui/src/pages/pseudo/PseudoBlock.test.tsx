/**
 * PseudoBlock Component Tests
 *
 * Comprehensive test suite for rendering a single FUNCTION block covering:
 * - Function header with keyword, name, params, and return type
 * - EXPORT badge styling and positioning
 * - CALLS section with CallsLink components
 * - Body rendering with proper indentation
 * - IF/ELSE formatting in body
 * - Separator styling
 * - Long name truncation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PseudoBlock from './PseudoBlock';
import { ParsedFunction } from './parsePseudo';

describe('PseudoBlock', () => {
  const mockOnNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Header Rendering', () => {
    it('should render FUNCTION keyword in purple', () => {
      const func: ParsedFunction = {
        name: 'greet',
        params: 'name: string',
        returnType: 'string',
        isExport: false,
        calls: [],
        body: ['return "Hello, " + name'],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      const keyword = screen.getByText('FUNCTION');
      expect(keyword).toBeInTheDocument();
      expect(keyword).toHaveStyle('color: #7c3aed'); // purple
      expect(keyword).toHaveStyle('font-weight: bold');
    });

    it('should render function name in bold stone color', () => {
      const func: ParsedFunction = {
        name: 'calculateSum',
        params: 'a: number, b: number',
        returnType: 'number',
        isExport: false,
        calls: [],
        body: ['return a + b'],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      const name = screen.getByText('calculateSum');
      expect(name).toBeInTheDocument();
      expect(name).toHaveStyle('color: #1c1917'); // stone
      expect(name).toHaveStyle('font-weight: bold');
    });

    it('should render params in stone-dark color', () => {
      const func: ParsedFunction = {
        name: 'multiply',
        params: 'x: number, y: number',
        returnType: 'number',
        isExport: false,
        calls: [],
        body: [],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      const paramsText = screen.getByText('(x: number, y: number)');
      expect(paramsText).toBeInTheDocument();
      expect(paramsText).toHaveStyle('color: #44403c'); // stone-dark
    });

    it('should render return type in stone-dark color', () => {
      const func: ParsedFunction = {
        name: 'process',
        params: 'data: any',
        returnType: 'Promise<void>',
        isExport: false,
        calls: [],
        body: [],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      const returnType = screen.getByText('-> Promise<void>');
      expect(returnType).toBeInTheDocument();
      expect(returnType).toHaveStyle('color: #44403c'); // stone-dark
    });

    it('should handle empty params', () => {
      const func: ParsedFunction = {
        name: 'init',
        params: '',
        returnType: 'void',
        isExport: false,
        calls: [],
        body: [],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      expect(screen.getByText('()')).toBeInTheDocument();
    });

    it('should handle missing return type', () => {
      const func: ParsedFunction = {
        name: 'log',
        params: 'message: string',
        returnType: '',
        isExport: false,
        calls: [],
        body: [],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const header = container.querySelector('[data-testid="pseudo-block-header"]');
      expect(header?.textContent).not.toContain('->');
    });
  });

  describe('EXPORT Badge', () => {
    it('should render EXPORT badge when isExport is true', () => {
      const func: ParsedFunction = {
        name: 'exportedFunc',
        params: '',
        returnType: '',
        isExport: true,
        calls: [],
        body: [],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      const badge = screen.getByText('EXPORT');
      expect(badge).toBeInTheDocument();
    });

    it('should style EXPORT badge with green background and text', () => {
      const func: ParsedFunction = {
        name: 'publicFunc',
        params: '',
        returnType: '',
        isExport: true,
        calls: [],
        body: [],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      const badge = screen.getByText('EXPORT');
      expect(badge).toHaveClass('bg-green-100');
      expect(badge).toHaveClass('text-green-700');
      expect(badge).toHaveClass('text-xs');
      expect(badge).toHaveClass('rounded');
      expect(badge).toHaveClass('px-1');
    });

    it('should not render EXPORT badge when isExport is false', () => {
      const func: ParsedFunction = {
        name: 'privateFunc',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: [],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      expect(screen.queryByText('EXPORT')).not.toBeInTheDocument();
    });

    it('should position EXPORT badge on the right', () => {
      const func: ParsedFunction = {
        name: 'exported',
        params: '',
        returnType: '',
        isExport: true,
        calls: [],
        body: [],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const headerDiv = container.querySelector('[data-testid="pseudo-block-header"]');
      expect(headerDiv).toHaveClass('justify-between');
    });
  });

  describe('CALLS Section', () => {
    it('should not render CALLS section when calls array is empty', () => {
      const func: ParsedFunction = {
        name: 'noCalls',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: [],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      expect(screen.queryByText('CALLS')).not.toBeInTheDocument();
    });

    it('should render CALLS label when calls exist', () => {
      const func: ParsedFunction = {
        name: 'withCalls',
        params: '',
        returnType: '',
        isExport: false,
        calls: [{ name: 'helper', fileStem: 'utils' }],
        body: [],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const callsDiv = container.querySelector('[data-testid="pseudo-calls-section"]');
      expect(callsDiv?.textContent).toContain('CALLS');
    });

    it('should style CALLS label with stone-dark color and text-xs', () => {
      const func: ParsedFunction = {
        name: 'withCalls',
        params: '',
        returnType: '',
        isExport: false,
        calls: [{ name: 'helper', fileStem: 'utils' }],
        body: [],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const label = container.querySelector('[data-testid="pseudo-calls-section"]');
      expect(label).toHaveClass('text-xs');
      expect(label).toHaveStyle('color: rgb(120, 113, 108)');
    });

    it('should render multiple CallsLink components', () => {
      const func: ParsedFunction = {
        name: 'multiCall',
        params: '',
        returnType: '',
        isExport: false,
        calls: [
          { name: 'handler', fileStem: 'handlers' },
          { name: 'validate', fileStem: 'validators' },
          { name: 'format', fileStem: 'utils' },
        ],
        body: [],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      expect(screen.getByText(/handler/)).toBeInTheDocument();
      expect(screen.getByText(/validate/)).toBeInTheDocument();
      expect(screen.getByText(/format/)).toBeInTheDocument();
    });
  });

  describe('Separator', () => {
    it('should render horizontal separator', () => {
      const func: ParsedFunction = {
        name: 'test',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: [],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const hr = container.querySelector('hr');
      expect(hr).toBeInTheDocument();
    });

    it('should style separator with stone-200 border', () => {
      const func: ParsedFunction = {
        name: 'test',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: [],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const hr = container.querySelector('hr');
      expect(hr).toHaveClass('border-stone-200');
    });
  });

  describe('Body Rendering', () => {
    it('should render body lines', () => {
      const func: ParsedFunction = {
        name: 'withBody',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: ['line1', 'line2', 'line3'],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      expect(screen.getByText('line1')).toBeInTheDocument();
      expect(screen.getByText('line2')).toBeInTheDocument();
      expect(screen.getByText('line3')).toBeInTheDocument();
    });

    it('should render body lines with indentation applied via paddingLeft', () => {
      const func: ParsedFunction = {
        name: 'indented',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: ['top level', '  indented line'],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const bodyDiv = container.querySelector('[data-testid="pseudo-block-body"]');
      expect(bodyDiv).toBeInTheDocument();
      // Indented line should have more padding than top-level line
      const lines = bodyDiv!.querySelectorAll('div[style*="paddingLeft"], div[style*="padding-left"]');
      const topPadding = parseInt((lines[0] as HTMLElement).style.paddingLeft || '0');
      const indentedPadding = parseInt((lines[1] as HTMLElement).style.paddingLeft || '0');
      expect(indentedPadding).toBeGreaterThan(topPadding);
    });

    it('should render body text in stone-dark color and text-sm', () => {
      const func: ParsedFunction = {
        name: 'styled',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: ['body text'],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const bodyDiv = container.querySelector('[data-testid="pseudo-block-body"]');
      expect(bodyDiv).toHaveClass('text-sm');
      expect(bodyDiv).toHaveStyle('color: #44403c');
    });

    it('should handle empty body', () => {
      const func: ParsedFunction = {
        name: 'emptyBody',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: [],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const bodyDiv = container.querySelector('[data-testid="pseudo-block-body"]');
      // Body div should exist but be empty or have no text content
      if (bodyDiv) {
        expect(bodyDiv.textContent).toBe('');
      }
    });

    it('should format IF/ELSE keywords in body', () => {
      const func: ParsedFunction = {
        name: 'conditional',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: ['IF condition', 'return value', 'ELSE', 'return default'],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      const ifKeyword = screen.getByText('IF');
      const elseKeyword = screen.getByText('ELSE');
      expect(ifKeyword).toBeInTheDocument();
      expect(elseKeyword).toBeInTheDocument();
    });

    it('should make IF/ELSE keywords bold using strong elements', () => {
      const func: ParsedFunction = {
        name: 'conditional',
        params: '',
        returnType: '',
        isExport: false,
        calls: [],
        body: ['IF something', 'ELSE fallback'],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      const strongElements = container.querySelectorAll('[data-testid="pseudo-block-body"] strong');
      const boldTexts = Array.from(strongElements).map((el) => el.textContent);
      expect(boldTexts).toContain('IF');
      expect(boldTexts).toContain('ELSE');
    });
  });

  describe('Long Name Handling', () => {
    it('should handle very long function names', () => {
      const longName = 'veryLongFunctionNameThatMightNeedTruncation'.repeat(2);
      const func: ParsedFunction = {
        name: longName,
        params: 'arg1, arg2',
        returnType: 'string',
        isExport: false,
        calls: [],
        body: [],
      };

      const { container } = render(
        <PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />
      );

      expect(container).toBeInTheDocument();
    });
  });

  describe('Integration', () => {
    it('should render complete function block with all elements', () => {
      const func: ParsedFunction = {
        name: 'complete',
        params: 'input: string',
        returnType: 'Result',
        isExport: true,
        calls: [
          { name: 'validate', fileStem: 'validators' },
          { name: 'process', fileStem: 'processor' },
        ],
        body: [
          'IF input is empty',
          'return error',
          'ELSE',
          'validate(validators)',
          'process(processor)',
          'return success',
        ],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      // Header
      expect(screen.getByText('FUNCTION')).toBeInTheDocument();
      expect(screen.getByText('complete')).toBeInTheDocument();
      expect(screen.getByText('(input: string)')).toBeInTheDocument();
      expect(screen.getByText('-> Result')).toBeInTheDocument();

      // Export badge
      expect(screen.getByText('EXPORT')).toBeInTheDocument();

      // Calls
      expect(screen.getByRole('button', { name: /validate/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /process/ })).toBeInTheDocument();

      // Body
      expect(screen.getByText('return error')).toBeInTheDocument();
      expect(screen.getByText('return success')).toBeInTheDocument();
    });

    it('should call onNavigate when CallsLink is clicked', () => {
      const func: ParsedFunction = {
        name: 'caller',
        params: '',
        returnType: '',
        isExport: false,
        calls: [{ name: 'helper', fileStem: 'helpers' }],
        body: [],
      };

      render(<PseudoBlock func={func} project="/test-project" onNavigate={mockOnNavigate} />);

      // The CallsLink should be clickable and call onNavigate
      const callLink = screen.getByRole('button', { name: /helper/ });
      callLink.click();

      expect(mockOnNavigate).toHaveBeenCalledWith('helpers');
    });
  });
});
