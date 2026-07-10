import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ProjectFooter } from './ProjectFooter';
import type { UnlandedEpic, CoverageRollup } from '@/stores/supervisorStore';

const EPICS: UnlandedEpic[] = [
  { branch: 'collab/epic/aaa', epicId8: 'aaaaaaaa', ahead: 3 },
  { branch: 'collab/epic/bbb', epicId8: 'bbbbbbbb', ahead: 1 },
];

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

  it('unlanded warning appears with a nonzero count', () => {
    render(<ProjectFooter unlandedEpics={EPICS} />);
    const warning = screen.getByTestId('unlanded-epics');
    expect(warning).toHaveTextContent('2 epics');
    expect(warning).toHaveTextContent('4 commits');
  });

  it('clicking the unlanded warning selects the Land panel', () => {
    const onSelectPanel = vi.fn();
    render(
      <ProjectFooter unlandedEpics={EPICS} onSelectPanel={onSelectPanel} />
    );

    const button = within(screen.getByTestId('unlanded-epics')).getByRole(
      'button'
    );
    fireEvent.click(button);

    expect(onSelectPanel).toHaveBeenCalledWith('land');
  });

  it('branch list collapses and expands', () => {
    render(<ProjectFooter unlandedEpics={EPICS} />);

    const button = within(screen.getByTestId('unlanded-epics')).getByRole(
      'button'
    );

    // Initially expanded
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('collab/epic/aaa')).toBeInTheDocument();
    expect(screen.getByText('collab/epic/bbb')).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('collab/epic/aaa')).not.toBeInTheDocument();
    expect(screen.queryByText('collab/epic/bbb')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('collab/epic/aaa')).toBeInTheDocument();
    expect(screen.getByText('collab/epic/bbb')).toBeInTheDocument();
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
