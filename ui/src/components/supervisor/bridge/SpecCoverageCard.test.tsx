/**
 * SpecCoverageCard — renders the rollup with one-red tints and self-hides when
 * the project has no spec objects.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpecCoverageCard } from './SpecCoverageCard';
import type { CoverageRollup } from '@/stores/supervisorStore';

const rollup: CoverageRollup = {
  total: 3,
  covered: 1,
  partial: 1,
  uncovered: 1,
  stale: 0,
  byObject: [],
};

describe('SpecCoverageCard', () => {
  it('renders covered/partial/uncovered segments with correct tints', () => {
    render(<SpecCoverageCard coverage={rollup} />);
    expect(screen.getByTestId('spec-coverage-card')).toBeInTheDocument();
    expect(screen.getByTestId('spec-coverage-covered').className).toContain('success');
    expect(screen.getByTestId('spec-coverage-partial').className).toContain('info');
    const uncovered = screen.getByTestId('spec-coverage-uncovered');
    expect(uncovered.className).toContain('warning');
    expect(uncovered.className).not.toContain('danger');
  });

  it('shows an amber stale indicator when objects have drifted, and hides it when none', () => {
    const { container: none } = render(<SpecCoverageCard coverage={rollup} />);
    expect(none.querySelector('[data-testid="spec-coverage-stale"]')).toBeNull();
    render(<SpecCoverageCard coverage={{ ...rollup, stale: 2 }} />);
    const stale = screen.getByTestId('spec-coverage-stale');
    expect(stale.textContent).toContain('2');
    expect(stale.className).toContain('warning'); // amber, one-red discipline
    expect(stale.className).not.toContain('danger');
  });

  it('self-hides when there are no spec objects', () => {
    const { container: a } = render(<SpecCoverageCard coverage={undefined} />);
    expect(a.querySelector('[data-testid="spec-coverage-card"]')).toBeNull();
    const { container: b } = render(<SpecCoverageCard coverage={{ ...rollup, total: 0 }} />);
    expect(b.querySelector('[data-testid="spec-coverage-card"]')).toBeNull();
  });
});
