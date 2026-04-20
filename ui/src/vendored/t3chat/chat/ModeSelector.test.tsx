import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModeSelector } from './ModeSelector';
import type { RuntimeMode, InteractionMode } from '@/types/agent';

function setup(overrides: Partial<React.ComponentProps<typeof ModeSelector>> = {}) {
  const props = {
    runtime: 'edit' as RuntimeMode,
    interaction: 'ask' as InteractionMode,
    onRuntimeChange: vi.fn(),
    onInteractionChange: vi.fn(),
    ...overrides,
  };
  const result = render(<ModeSelector {...props} />);
  return { ...result, props };
}

describe('ModeSelector', () => {
  it('renders the correct preset label for the default runtime+interaction', () => {
    setup();
    // edit + ask => supervised
    expect(screen.getByTestId('mode-preset-trigger')).toHaveTextContent('Supervised');
  });

  it('renders preset label for read-only + plan => Plan', () => {
    setup({ runtime: 'read-only', interaction: 'plan' });
    expect(screen.getByTestId('mode-preset-trigger')).toHaveTextContent('Plan');
  });

  it('renders preset label for bypass => Bypass', () => {
    setup({ runtime: 'bypass', interaction: 'accept-edits' });
    expect(screen.getByTestId('mode-preset-trigger')).toHaveTextContent('Bypass');
  });

  it('changing preset calls both onRuntimeChange and onInteractionChange with split values', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    const trigger = screen.getByTestId('mode-preset-trigger');
    await user.click(trigger);
    const planItem = await screen.findByRole('option', { name: 'Plan' });
    await user.click(planItem);
    // plan => runtime: 'read-only', interaction: 'plan'
    expect(props.onRuntimeChange).toHaveBeenCalledWith('read-only');
    expect(props.onInteractionChange).toHaveBeenCalledWith('plan');
  });

  it('advanced popover exposes both runtime and interaction selects', () => {
    setup({ runtime: 'read-only', interaction: 'plan' });
    const advanced = screen.getByTestId('mode-advanced-trigger');
    act(() => {
      fireEvent.click(advanced);
    });
    // After opening, two independent selects should appear with current labels.
    expect(screen.getByTestId('mode-runtime-trigger')).toHaveTextContent('Read-only');
    expect(screen.getByTestId('mode-interaction-trigger')).toHaveTextContent('Plan');
  });
});
