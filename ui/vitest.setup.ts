/**
 * Vitest Setup File
 *
 * Configures testing environment with:
 * - jest-dom matchers for DOM testing
 * - Testing library cleanup
 * - Component mocks for terminal/xterm
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';
import React from 'react';

// Mock EmbeddedTerminal component to avoid xterm DOM issues in tests
vi.mock('@/components/EmbeddedTerminal', () => ({
  EmbeddedTerminal: function MockTerminal({ className }: { className?: string }) {
    return React.createElement('div', {
      'data-testid': 'mock-terminal',
      className: className,
    }, 'Mock Terminal');
  },
}));
