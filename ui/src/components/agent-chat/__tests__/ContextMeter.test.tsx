/**
 * ContextMeter Component Tests
 *
 * Tests verify:
 * - Percentage and token label rendering
 * - Bar width reflects used/max ratio
 * - Color thresholds: default gray, >=80% amber, >=95% red
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContextMeter from '../ContextMeter';

describe('ContextMeter Component', () => {
  it('renders the token label', () => {
    render(<ContextMeter used={500} max={1000} />);
    expect(screen.getByText('500/1000 tokens')).toBeInTheDocument();
  });

  it('renders the percentage', () => {
    render(<ContextMeter used={500} max={1000} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('sets bar width to the used/max ratio', () => {
    render(<ContextMeter used={250} max={1000} />);
    const bar = screen.getByTestId('context-meter-bar');
    expect(bar.style.width).toBe('25%');
  });

  it('uses default gray color below 80%', () => {
    render(<ContextMeter used={700} max={1000} />);
    const bar = screen.getByTestId('context-meter-bar');
    expect(bar.className).toContain('bg-gray-400');
    expect(bar.className).not.toContain('bg-amber-500');
    expect(bar.className).not.toContain('bg-red-500');
  });

  it('uses amber color at 80% threshold', () => {
    render(<ContextMeter used={800} max={1000} />);
    const bar = screen.getByTestId('context-meter-bar');
    expect(bar.className).toContain('bg-amber-500');
    expect(bar.className).not.toContain('bg-red-500');
  });

  it('uses amber color between 80% and 95%', () => {
    render(<ContextMeter used={900} max={1000} />);
    const bar = screen.getByTestId('context-meter-bar');
    expect(bar.className).toContain('bg-amber-500');
  });

  it('uses red color at 95% threshold', () => {
    render(<ContextMeter used={950} max={1000} />);
    const bar = screen.getByTestId('context-meter-bar');
    expect(bar.className).toContain('bg-red-500');
  });

  it('uses red color above 95%', () => {
    render(<ContextMeter used={990} max={1000} />);
    const bar = screen.getByTestId('context-meter-bar');
    expect(bar.className).toContain('bg-red-500');
  });

  it('clamps when used exceeds max', () => {
    render(<ContextMeter used={1500} max={1000} />);
    const bar = screen.getByTestId('context-meter-bar');
    expect(bar.style.width).toBe('100%');
    expect(bar.className).toContain('bg-red-500');
  });

  it('handles max of 0 without dividing by zero', () => {
    render(<ContextMeter used={0} max={0} />);
    const bar = screen.getByTestId('context-meter-bar');
    expect(bar.style.width).toBe('0%');
  });
});
