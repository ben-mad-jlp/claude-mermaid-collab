import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BridgeRail, type BridgeRailProps } from './BridgeRail';
import type { RailKey } from './RailNav';

const renderRail = (props: Partial<BridgeRailProps> = {}) => {
  return render(<BridgeRail {...props} />);
};

describe('BridgeRail', () => {
  it('renders section order as ACT, WORK, TELEMETRY', () => {
    renderRail();
    const sectionLabels = screen.getAllByTestId(/^rail-section-label-/);
    expect(sectionLabels).toHaveLength(3);
    expect(sectionLabels[0]).toHaveTextContent('ACT');
    expect(sectionLabels[1]).toHaveTextContent('WORK');
    expect(sectionLabels[2]).toHaveTextContent('TELEMETRY');
  });

  it('renders items in correct order within sections', () => {
    renderRail();
    const items = screen.getAllByTestId(/^rail-item-/);
    const expectedOrder: RailKey[] = [
      'escalations',
      'land',
      'work',
      'stranded',
      'stream',
      'executor',
      'subscribers',
      'dogfood',
    ];
    expect(items).toHaveLength(expectedOrder.length);
    expectedOrder.forEach((key, index) => {
      expect(items[index]).toHaveAttribute('data-testid', `rail-item-${key}`);
    });
  });

  it('zero count renders NO badge', () => {
    renderRail({
      counts: { escalations: 0, land: 3, stranded: 0 },
    });

    expect(screen.queryByTestId('rail-badge-escalations')).toBeNull();
    expect(screen.queryByTestId('rail-badge-stranded')).toBeNull();
    expect(screen.getByTestId('rail-badge-land')).toHaveTextContent('3');
  });

  it('telemetry items never carry a badge', () => {
    renderRail();

    expect(screen.queryByTestId('rail-badge-stream')).toBeNull();
    expect(screen.queryByTestId('rail-badge-executor')).toBeNull();
    expect(screen.queryByTestId('rail-badge-subscribers')).toBeNull();
    expect(screen.queryByTestId('rail-badge-dogfood')).toBeNull();
  });

  it('work badge renders as inflight·ready', () => {
    renderRail({
      counts: { inflight: 6, ready: 40 },
    });

    const badge = screen.getByTestId('rail-badge-work');
    expect(badge.textContent).toBe('6·40');
  });

  it('work badge with 0·0 renders no badge', () => {
    renderRail({
      counts: { inflight: 0, ready: 0 },
    });

    expect(screen.queryByTestId('rail-badge-work')).toBeNull();
  });

  it('work badge renders when either count is > 0', () => {
    const { rerender } = render(
      <BridgeRail counts={{ inflight: 0, ready: 5 }} />
    );
    expect(screen.getByTestId('rail-badge-work')).toHaveTextContent('0·5');

    rerender(<BridgeRail counts={{ inflight: 3, ready: 0 }} />);
    expect(screen.getByTestId('rail-badge-work')).toHaveTextContent('3·0');
  });

  it('exactly one panel is mounted at a time', () => {
    renderRail({
      panels: {
        stream: <div data-testid="p-stream" />,
        executor: <div data-testid="p-executor" />,
      },
    });

    // Before any click: no panel mounted
    expect(screen.queryAllByTestId('bridge-rail-panel')).toHaveLength(0);

    // Click stream
    fireEvent.click(screen.getByTestId('rail-item-stream'));
    expect(screen.getAllByTestId('bridge-rail-panel')).toHaveLength(1);
    expect(screen.getByTestId('p-stream')).toBeInTheDocument();
    expect(screen.queryByTestId('p-executor')).not.toBeInTheDocument();

    // Click executor
    fireEvent.click(screen.getByTestId('rail-item-executor'));
    expect(screen.getAllByTestId('bridge-rail-panel')).toHaveLength(1);
    expect(screen.getByTestId('p-executor')).toBeInTheDocument();
    expect(screen.queryByTestId('p-stream')).not.toBeInTheDocument();

    // Click executor again (toggle off)
    fireEvent.click(screen.getByTestId('rail-item-executor'));
    expect(screen.queryAllByTestId('bridge-rail-panel')).toHaveLength(0);
  });

  it('does not render mutation control buttons', () => {
    renderRail({
      panels: {
        stream: <div>Stream content</div>,
      },
    });

    fireEvent.click(screen.getByTestId('rail-item-stream'));

    const allButtons = screen.getAllByRole('button');
    allButtons.forEach((button) => {
      expect(button.textContent?.toLowerCase()).not.toMatch(
        /mark met|next phase|advance/i
      );
    });
  });

  it('supports controlled selection', () => {
    const handleSelect = vi.fn();
    const { rerender } = render(
      <BridgeRail selected="stream" onSelect={handleSelect} panels={{ stream: <div /> }} />
    );

    expect(screen.getByTestId('rail-item-stream')).toHaveAttribute(
      'data-active',
      'true'
    );

    fireEvent.click(screen.getByTestId('rail-item-executor'));
    expect(handleSelect).toHaveBeenCalledWith('executor');

    // Rerender with new selection
    rerender(
      <BridgeRail
        selected="executor"
        onSelect={handleSelect}
        panels={{ executor: <div /> }}
      />
    );

    expect(screen.getByTestId('rail-item-executor')).toHaveAttribute(
      'data-active',
      'true'
    );
  });

  it('supports uncontrolled selection with defaultSelected', () => {
    renderRail({
      defaultSelected: 'land',
      panels: { land: <div data-testid="p-land" /> },
    });

    expect(screen.getByTestId('rail-item-land')).toHaveAttribute(
      'data-active',
      'true'
    );
    expect(screen.getByTestId('p-land')).toBeInTheDocument();
  });

  it('renders footer when provided', () => {
    renderRail({
      footer: <div data-testid="test-footer">Footer content</div>,
    });

    expect(screen.getByTestId('bridge-rail-footer')).toBeInTheDocument();
    expect(screen.getByTestId('test-footer')).toHaveTextContent('Footer content');
  });

  it('does not render footer when not provided', () => {
    renderRail({});

    expect(screen.queryByTestId('bridge-rail-footer')).toBeNull();
  });

  it('only mounts panel for selected key', () => {
    renderRail({
      selected: 'executor',
      panels: {
        stream: <div>Stream</div>,
        executor: <div data-testid="p-executor">Executor</div>,
        land: <div>Land</div>,
      },
    });

    expect(screen.getByTestId('bridge-rail-panel')).toHaveAttribute(
      'data-panel',
      'executor'
    );
    expect(screen.getByTestId('p-executor')).toBeInTheDocument();
  });
});
