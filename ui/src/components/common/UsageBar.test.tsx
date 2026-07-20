import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsageBar, UsageMeters } from './UsageBar';
import { useUsageStore } from '@/stores/usageStore';

afterEach(() => useUsageStore.setState({ usage: null }));

describe('UsageBar', () => {
  it('shows the percent and a neutral gray fill when null', () => {
    render(<UsageBar label="5h" percent={null} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('5h').className).toContain('text-gray-400');
  });

  it('colours by tier: <50 green, 50–79 amber, ≥80 red', () => {
    const { rerender } = render(<UsageBar label="7d" percent={20} />);
    expect(screen.getByText('20%').className).toContain('text-success');
    rerender(<UsageBar label="7d" percent={65} />);
    expect(screen.getByText('65%').className).toContain('text-yellow');
    rerender(<UsageBar label="7d" percent={92} />);
    expect(screen.getByText('92%').className).toContain('text-danger');
  });
});

describe('UsageMeters', () => {
  it('renders nothing until a usage snapshot exists', () => {
    render(<UsageMeters />);
    expect(screen.queryByTestId('usage-meters')).toBeNull();
  });

  it('renders both the 5h and 7d gauges from the store', () => {
    useUsageStore.setState({ usage: { fiveHourPercent: 42, sevenDayPercent: 88, updatedAt: 0 } });
    render(<UsageMeters />);
    expect(screen.getByTestId('usage-meters')).toBeTruthy();
    expect(screen.getByText('5h')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('7d')).toBeTruthy();
    expect(screen.getByText('88%')).toBeTruthy();
  });
});
