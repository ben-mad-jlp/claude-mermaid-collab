import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useRawIdMode } from './useRawIdMode';

function TestComponent() {
  const [raw, setRaw] = useRawIdMode();
  return (
    <div>
      <span data-testid="raw-value">{String(raw)}</span>
      <button data-testid="set-true" onClick={() => setRaw(true)}>
        set true
      </button>
    </div>
  );
}

describe('useRawIdMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('defaults to false with a clean localStorage', () => {
    render(<TestComponent />);
    expect(screen.getByTestId('raw-value').textContent).toBe('false');
  });

  it('useRawIdMode value survives unmount and remount via localStorage', () => {
    const { unmount } = render(<TestComponent />);
    fireEvent.click(screen.getByTestId('set-true'));
    expect(screen.getByTestId('raw-value').textContent).toBe('true');
    unmount();

    render(<TestComponent />);
    expect(screen.getByTestId('raw-value').textContent).toBe('true');
  });

  it('tolerates localStorage.getItem/setItem throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => render(<TestComponent />)).not.toThrow();
    expect(screen.getByTestId('raw-value').textContent).toBe('false');
    expect(() => fireEvent.click(screen.getByTestId('set-true'))).not.toThrow();
    expect(screen.getByTestId('raw-value').textContent).toBe('true');
  });
});
