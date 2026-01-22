import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '../Checkbox';
import { describe, it, expect, vi } from 'vitest';

describe('Checkbox', () => {
  const mockOptions = [
    { value: 'option1', label: 'Option 1' },
    { value: 'option2', label: 'Option 2' },
    { value: 'option3', label: 'Option 3' },
  ];

  it('renders all options', () => {
    const mockOnChange = vi.fn();
    render(<Checkbox options={mockOptions} onChange={mockOnChange} />);

    mockOptions.forEach((option) => {
      expect(screen.getByText(option.label)).toBeInTheDocument();
    });
  });

  it('renders with legend', () => {
    const mockOnChange = vi.fn();
    render(<Checkbox options={mockOptions} onChange={mockOnChange} label="Select items" />);

    expect(screen.getByText('Select items')).toBeInTheDocument();
  });

  it('calls onChange with selected values', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    render(<Checkbox options={mockOptions} onChange={mockOnChange} />);

    const checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' });
    await user.click(checkbox1);

    expect(mockOnChange).toHaveBeenCalledWith(['option1']);
  });

  it('handles multiple selections', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <Checkbox
        options={mockOptions}
        onChange={mockOnChange}
        values={[]}
      />
    );

    const checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' });
    await user.click(checkbox1);
    expect(mockOnChange).toHaveBeenCalledWith(['option1']);

    rerender(
      <Checkbox
        options={mockOptions}
        onChange={mockOnChange}
        values={['option1']}
      />
    );

    const checkbox2 = screen.getByRole('checkbox', { name: 'Option 2' });
    await user.click(checkbox2);
    expect(mockOnChange).toHaveBeenCalledWith(['option1', 'option2']);
  });

  it('deselects when clicking checked checkbox', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <Checkbox options={mockOptions} onChange={mockOnChange} values={['option1']} />
    );

    const checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' }) as HTMLInputElement;
    expect(checkbox1.checked).toBe(true);

    await user.click(checkbox1);
    expect(mockOnChange).toHaveBeenCalledWith([]);
  });

  it('displays selected values', () => {
    const mockOnChange = vi.fn();
    render(
      <Checkbox
        options={mockOptions}
        onChange={mockOnChange}
        values={['option1', 'option3']}
      />
    );

    const checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' }) as HTMLInputElement;
    const checkbox2 = screen.getByRole('checkbox', { name: 'Option 2' }) as HTMLInputElement;
    const checkbox3 = screen.getByRole('checkbox', { name: 'Option 3' }) as HTMLInputElement;

    expect(checkbox1.checked).toBe(true);
    expect(checkbox2.checked).toBe(false);
    expect(checkbox3.checked).toBe(true);
  });

  it('disables all options when disabled prop is true', () => {
    const mockOnChange = vi.fn();
    render(<Checkbox options={mockOptions} onChange={mockOnChange} disabled />);

    mockOptions.forEach((option) => {
      const checkbox = screen.getByRole('checkbox', { name: option.label }) as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
    });
  });

  it('disables specific options', () => {
    const mockOnChange = vi.fn();
    const optionsWithDisabled = [
      { value: 'option1', label: 'Option 1', disabled: false },
      { value: 'option2', label: 'Option 2', disabled: true },
      { value: 'option3', label: 'Option 3', disabled: false },
    ];

    render(<Checkbox options={optionsWithDisabled} onChange={mockOnChange} />);

    const checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' }) as HTMLInputElement;
    const checkbox2 = screen.getByRole('checkbox', { name: 'Option 2' }) as HTMLInputElement;
    const checkbox3 = screen.getByRole('checkbox', { name: 'Option 3' }) as HTMLInputElement;

    expect(checkbox1.disabled).toBe(false);
    expect(checkbox2.disabled).toBe(true);
    expect(checkbox3.disabled).toBe(false);
  });

  it('does not call onChange when disabled and clicked', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    render(<Checkbox options={mockOptions} onChange={mockOnChange} disabled />);

    const checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' });
    await user.click(checkbox1);

    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('does not call onChange when specific option is disabled', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    const optionsWithDisabled = [
      { value: 'option1', label: 'Option 1', disabled: true },
      { value: 'option2', label: 'Option 2', disabled: false },
    ];

    render(<Checkbox options={optionsWithDisabled} onChange={mockOnChange} />);

    const checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' });
    await user.click(checkbox1);

    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('has correct aria attributes', () => {
    const mockOnChange = vi.fn();
    render(
      <Checkbox
        options={mockOptions}
        onChange={mockOnChange}
        label="Select options"
        ariaLabel="Custom group label"
      />
    );

    const group = screen.getByRole('group', { name: 'Custom group label' });
    expect(group).toHaveAttribute('aria-label', 'Custom group label');
  });

  it('associates checkboxes with labels', () => {
    const mockOnChange = vi.fn();
    render(<Checkbox options={mockOptions} onChange={mockOnChange} />);

    mockOptions.forEach((option) => {
      const checkbox = screen.getByRole('checkbox', { name: option.label });
      const label = screen.getByText(option.label);

      expect(checkbox).toHaveAttribute('id');
      expect(label).toHaveAttribute('for', checkbox.id);
    });
  });

  it('applies dark mode styles', () => {
    const mockOnChange = vi.fn();
    render(<Checkbox options={mockOptions} onChange={mockOnChange} />);

    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((checkbox) => {
      expect(checkbox.className).toContain('dark:bg-gray-800');
      expect(checkbox.className).toContain('dark:border-gray-600');
    });
  });

  it('applies disabled styling to disabled options', () => {
    const mockOnChange = vi.fn();
    const optionsWithDisabled = [
      { value: 'option1', label: 'Option 1', disabled: true },
      { value: 'option2', label: 'Option 2', disabled: false },
    ];

    render(<Checkbox options={optionsWithDisabled} onChange={mockOnChange} />);

    const label1 = screen.getByText('Option 1');
    const label2 = screen.getByText('Option 2');

    expect(label1.className).toContain('text-gray-400');
    expect(label2.className).toContain('text-gray-900');
  });

  it('renders as fieldset with legend', () => {
    const mockOnChange = vi.fn();
    render(
      <Checkbox options={mockOptions} onChange={mockOnChange} label="Choose options" />
    );

    const legend = screen.getByText('Choose options');
    expect(legend.tagName).toBe('LEGEND');

    const fieldset = legend.parentElement;
    expect(fieldset?.tagName).toBe('FIELDSET');
  });

  it('handles empty options', () => {
    const mockOnChange = vi.fn();
    render(<Checkbox options={[]} onChange={mockOnChange} />);

    const checkboxes = screen.queryAllByRole('checkbox');
    expect(checkboxes).toHaveLength(0);
  });

  it('preserves selection on re-render', () => {
    const mockOnChange = vi.fn();
    const { rerender } = render(
      <Checkbox options={mockOptions} onChange={mockOnChange} values={['option1', 'option2']} />
    );

    let checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' }) as HTMLInputElement;
    let checkbox2 = screen.getByRole('checkbox', { name: 'Option 2' }) as HTMLInputElement;

    expect(checkbox1.checked).toBe(true);
    expect(checkbox2.checked).toBe(true);

    rerender(
      <Checkbox options={mockOptions} onChange={mockOnChange} values={['option1', 'option2']} />
    );

    checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' }) as HTMLInputElement;
    checkbox2 = screen.getByRole('checkbox', { name: 'Option 2' }) as HTMLInputElement;

    expect(checkbox1.checked).toBe(true);
    expect(checkbox2.checked).toBe(true);
  });

  it('toggles individual checkboxes correctly', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <Checkbox options={mockOptions} onChange={mockOnChange} values={['option1']} />
    );

    const checkbox2 = screen.getByRole('checkbox', { name: 'Option 2' });
    await user.click(checkbox2);

    expect(mockOnChange).toHaveBeenLastCalledWith(['option1', 'option2']);

    rerender(
      <Checkbox options={mockOptions} onChange={mockOnChange} values={['option1', 'option2']} />
    );

    const checkbox1 = screen.getByRole('checkbox', { name: 'Option 1' });
    await user.click(checkbox1);

    expect(mockOnChange).toHaveBeenLastCalledWith(['option2']);
  });

  it('has accessible labels for all options', () => {
    const mockOnChange = vi.fn();
    render(<Checkbox options={mockOptions} onChange={mockOnChange} />);

    mockOptions.forEach((option) => {
      const checkbox = screen.getByRole('checkbox', { name: option.label });
      expect(checkbox).toHaveAttribute('aria-label', option.label);
    });
  });

  it('renders in proper flex layout', () => {
    const mockOnChange = vi.fn();
    const { container } = render(
      <Checkbox options={mockOptions} onChange={mockOnChange} />
    );

    const fieldset = container.querySelector('fieldset');
    expect(fieldset?.className).toContain('flex');
    expect(fieldset?.className).toContain('flex-col');
  });
});
