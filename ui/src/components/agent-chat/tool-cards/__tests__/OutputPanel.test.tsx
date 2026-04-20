import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OutputPanel from '../OutputPanel';

describe('OutputPanel', () => {
  it('error status: expanded with red border and error text', () => {
    render(<OutputPanel toolUseId="t1" status="error" error="boom" />);
    expect(screen.getByText('boom')).toBeInTheDocument();
    const panel = screen.getByTestId('output-panel');
    expect(panel.className).toMatch(/red/);
  });

  it('canceled status: muted banner, no pre', () => {
    render(<OutputPanel toolUseId="t1" status="canceled" />);
    expect(screen.getByText(/canceled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('ok status: collapsed by default with line-count toggle', () => {
    render(<OutputPanel toolUseId="t1" status="ok" stdout={'a\nb\nc'} />);
    const btn = screen.getByRole('button', { name: /show output \(3 lines\)/i });
    expect(btn).toBeInTheDocument();
    expect(screen.queryByText('a', { exact: false, selector: 'pre' })).toBeNull();
    fireEvent.click(btn);
    // Now pre is rendered
    const pre = screen.getByText((_c, el) => el?.tagName === 'PRE' && /a\nb\nc/.test(el?.textContent ?? ''));
    expect(pre).toBeInTheDocument();
  });

  it('ANSI stripping when format=ansi', () => {
    const ansi = String.fromCharCode(27) + '[31mred' + String.fromCharCode(27) + '[0m plain';
    render(<OutputPanel toolUseId="t1" status="ok" stdout={ansi} format="ansi" />);
    fireEvent.click(screen.getByRole('button'));
    const pre = screen.getByText((_c, el) => el?.tagName === 'PRE' && (el?.textContent ?? '').trim() === 'red plain');
    expect(pre).toBeInTheDocument();
  });

  it('JSON pretty-print for object output', () => {
    render(<OutputPanel toolUseId="t1" status="ok" output={{ foo: 'bar', n: 1 }} format="json" />);
    fireEvent.click(screen.getByRole('button'));
    const pre = screen.getByText((_c, el) => el?.tagName === 'PRE' && /"foo": "bar"/.test(el?.textContent ?? ''));
    expect(pre).toBeInTheDocument();
  });
});
