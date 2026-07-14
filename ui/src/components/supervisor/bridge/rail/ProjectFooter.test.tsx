import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectFooter } from './ProjectFooter';
import type { CoverageRollup } from '@/stores/supervisorStore';

const cov = (o: Partial<CoverageRollup> = {}): CoverageRollup => ({
  total: 4,
  covered: 2,
  partial: 1,
  uncovered: 1,
  stale: 0,
  byObject: [],
  ...o,
});

describe('ProjectFooter', () => {
  it('renders nothing when there are no unlanded epics and no spec objects', () => {
    const { container: a } = render(
      <ProjectFooter unlandedEpics={[]} coverage={undefined} />
    );
    expect(a.querySelector('[data-testid="project-footer"]')).toBeNull();

    const { container: b } = render(
      <ProjectFooter
        unlandedEpics={[]}
        coverage={cov({ total: 0, covered: 0, partial: 0, uncovered: 0 })}
      />
    );
    expect(b.querySelector('[data-testid="project-footer"]')).toBeNull();
  });

  it('spec coverage renders forced-visible with sliver buckets', () => {
    render(
      <ProjectFooter
        coverage={cov({ uncovered: 0 })}
      />
    );

    expect(screen.getByTestId('spec-coverage-card')).toBeInTheDocument();
    expect(screen.getByTestId('spec-coverage-uncovered')).toBeInTheDocument();
  });

  it('stale badge appears only when stale > 0', () => {
    const { container: a } = render(
      <ProjectFooter coverage={cov({ stale: 0 })} />
    );
    expect(a.querySelector('[data-testid="spec-coverage-stale"]')).toBeNull();

    render(
      <ProjectFooter coverage={cov({ stale: 2 })} />
    );
    const stale = screen.getByTestId('spec-coverage-stale');
    expect(stale.textContent).toContain('2');
  });

  it('footer renders coverage alone when there are no unlanded epics', () => {
    render(
      <ProjectFooter
        unlandedEpics={[]}
        coverage={cov()}
      />
    );

    expect(screen.getByTestId('project-footer')).toBeInTheDocument();
    expect(screen.getByTestId('spec-coverage-card')).toBeInTheDocument();
    expect(screen.queryByTestId('unlanded-epics')).not.toBeInTheDocument();
  });
});
