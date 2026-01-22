import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultipleChoice } from '../MultipleChoice';
import { describe, it, expect, vi } from 'vitest';

describe('MultipleChoice', () => {
  const mockOptions = [
    { value: 'option1', label: 'Option 1' },
    { value: 'option2', label: 'Option 2' },
    { value: 'option3', label: 'Option 3' },
  ];

  it('renders with options', () => {
    const mockOnChange = vi.fn();
    render(<MultipleChoice options={mockOptions} onChange={mockOnChange} />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    mockOptions.forEach((option) => {
      expect(screen.getByText(option.label)).toBeInTheDocument();
    });
  });

  it('renders with label', () => {
    const mockOnChange = vi.fn();
    render(
      <MultipleChoice options={mockOptions} onChange={mockOnChange} label="Choose one" />
    );

    expect(screen.getByText('Choose one')).toBeInTheDocument();
  });

  it('calls onChange when value is selected', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    render(<MultipleChoice options={mockOptions} onChange={mockOnChange} />);

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'option1');

    expect(mockOnChange).toHaveBeenCalledWith('option1');
  });

  it('displays selected value', () => {
    const mockOnChange = vi.fn();
    render(
      <MultipleChoice options={mockOptions} onChange={mockOnChange} value="option2" />
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('option2');
  });

  it('disables when disabled prop is true', () => {
    const mockOnChange = vi.fn();
    render(<MultipleChoice options={mockOptions} onChange={mockOnChange} disabled />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('does not call onChange when disabled', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    render(<MultipleChoice options={mockOptions} onChange={mockOnChange} disabled />);

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'option1');

    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('has correct aria attributes', () => {
    const mockOnChange = vi.fn();
    render(
      <MultipleChoice
        options={mockOptions}
        onChange={mockOnChange}
        label="Choose option"
        ariaLabel="Custom aria label"
      />
    );

    const select = screen.getByRole('combobox');
    expect(select).toHaveAttribute('aria-label', 'Custom aria label');
  });

  it('renders with aria-describedby', () => {
    const mockOnChange = vi.fn();
    render(
      <MultipleChoice
        options={mockOptions}
        onChange={mockOnChange}
        ariaDescribedBy="help-text"
      />
    );

    const select = screen.getByRole('combobox');
    expect(select).toHaveAttribute('aria-describedby');
  });

  it('renders default placeholder option', () => {
    const mockOnChange = vi.fn();
    render(<MultipleChoice options={mockOptions} onChange={mockOnChange} />);

    const placeholderOption = screen.getByText('Select an option');
    expect(placeholderOption).toBeInTheDocument();
  });

  it('handles multiple selections in sequence', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <MultipleChoice options={mockOptions} onChange={mockOnChange} value="option1" />
    );

    const select = screen.getByRole('combobox');

    await user.selectOptions(select, 'option2');
    expect(mockOnChange).toHaveBeenCalledWith('option2');

    rerender(
      <MultipleChoice options={mockOptions} onChange={mockOnChange} value="option2" />
    );

    const updatedSelect = screen.getByRole('combobox') as HTMLSelectElement;
    expect(updatedSelect.value).toBe('option2');
  });

  it('applies dark mode styles', () => {
    const mockOnChange = vi.fn();
    render(<MultipleChoice options={mockOptions} onChange={mockOnChange} />);

    const select = screen.getByRole('combobox');
    expect(select.className).toContain('dark:bg-gray-800');
    expect(select.className).toContain('dark:text-white');
    expect(select.className).toContain('dark:border-gray-600');
  });

  it('applies focus styles', () => {
    const mockOnChange = vi.fn();
    render(<MultipleChoice options={mockOptions} onChange={mockOnChange} />);

    const select = screen.getByRole('combobox');
    expect(select.className).toContain('focus:ring-2');
    expect(select.className).toContain('focus:ring-blue-500');
  });

  it('has accessible label association', () => {
    const mockOnChange = vi.fn();
    render(
      <MultipleChoice options={mockOptions} onChange={mockOnChange} label="Test label" />
    );

    const label = screen.getByText('Test label');
    const select = screen.getByRole('combobox');

    expect(label.tagName).toBe('LABEL');
    expect(select).toHaveAttribute('id');
    expect(label).toHaveAttribute('for', select.id);
  });

  it('handles empty options', () => {
    const mockOnChange = vi.fn();
    render(<MultipleChoice options={[]} onChange={mockOnChange} />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('preserves value on re-render', () => {
    const mockOnChange = vi.fn();
    const { rerender } = render(
      <MultipleChoice options={mockOptions} onChange={mockOnChange} value="option1" />
    );

    let select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('option1');

    rerender(
      <MultipleChoice
        options={mockOptions}
        onChange={mockOnChange}
        value="option1"
        label="New label"
      />
    );

    select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('option1');
  });
});
