import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dropdown } from './Dropdown';

describe('Dropdown Component', () => {
  const defaultProps = {
    name: 'test-dropdown',
    options: [
      { value: 'option1', label: 'Option 1' },
      { value: 'option2', label: 'Option 2' },
      { value: 'option3', label: 'Option 3' },
    ],
  };

  it('renders select element with correct name', () => {
    render(<Dropdown {...defaultProps} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.name).toBe('test-dropdown');
  });

  it('renders label when provided', () => {
    const label = 'Choose an option';
    render(<Dropdown {...defaultProps} label={label} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('does not render label when not provided', () => {
    const { container } = render(<Dropdown {...defaultProps} />);
    const labels = container.querySelectorAll('label');
    expect(labels).toHaveLength(0);
  });

  it('renders all options', () => {
    render(<Dropdown {...defaultProps} />);
    expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option 3' })).toBeInTheDocument();
  });

  it('renders placeholder option', () => {
    render(<Dropdown {...defaultProps} placeholder="Select..." />);
    const placeholderOption = screen.getByRole('option', { name: 'Select...' });
    expect(placeholderOption).toBeInTheDocument();
    expect((placeholderOption as HTMLOptionElement).value).toBe('');
  });

  it('sets default value when provided', () => {
    render(<Dropdown {...defaultProps} defaultValue="option2" />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('option2');
  });

  it('calls onChange handler when selection changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Dropdown {...defaultProps} onChange={onChange} />);

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'option2');

    expect(onChange).toHaveBeenCalledWith('option2');
  });

  it('handles disabled state', () => {
    render(<Dropdown {...defaultProps} required disabled />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('handles required attribute', () => {
    render(<Dropdown {...defaultProps} required />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.required).toBe(true);
  });

  it('applies default CSS class for styling', () => {
    const { container } = render(<Dropdown {...defaultProps} />);
    const wrapper = container.querySelector('.dropdown-field');
    expect(wrapper).toBeInTheDocument();
  });

  it('applies select CSS class', () => {
    const { container } = render(<Dropdown {...defaultProps} />);
    const select = container.querySelector('.dropdown-select');
    expect(select).toBeInTheDocument();
  });

  it('handles controlled value', () => {
    const { rerender } = render(
      <Dropdown {...defaultProps} defaultValue="option1" />
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('option1');

    rerender(<Dropdown {...defaultProps} defaultValue="option2" />);
    const updatedSelect = screen.getByRole('combobox') as HTMLSelectElement;
    expect(updatedSelect.value).toBe('option2');
  });

  it('renders disabled options', () => {
    const propsWithDisabledOption = {
      ...defaultProps,
      options: [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2', disabled: true },
        { value: 'option3', label: 'Option 3' },
      ],
    };
    render(<Dropdown {...propsWithDisabledOption} />);
    const disabledOption = screen.getByRole('option', {
      name: 'Option 2',
    }) as HTMLOptionElement;
    expect(disabledOption.disabled).toBe(true);
  });

  it('associates label with select via htmlFor', () => {
    const label = 'Choose an option';
    render(<Dropdown {...defaultProps} label={label} />);
    const labelEl = screen.getByText(label) as HTMLLabelElement;
    const selectEl = screen.getByRole('combobox') as HTMLSelectElement;
    expect(labelEl.htmlFor).toBe(selectEl.id);
  });

  it('renders with proper container structure', () => {
    const { container } = render(<Dropdown {...defaultProps} label="Test" />);
    const fieldDiv = container.querySelector('.dropdown-field');
    const labelEl = fieldDiv?.querySelector('label');
    const selectEl = fieldDiv?.querySelector('select');

    expect(fieldDiv).toBeInTheDocument();
    expect(labelEl).toBeInTheDocument();
    expect(selectEl).toBeInTheDocument();
  });

  it('handles empty options array', () => {
    render(<Dropdown {...defaultProps} options={[]} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionElements = select.querySelectorAll('option');
    // Should have placeholder option only
    expect(optionElements.length).toBeGreaterThan(0);
  });

  it('maintains value after re-render', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dropdown {...defaultProps} />);

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'option2');

    rerender(<Dropdown {...defaultProps} />);
    const updatedSelect = screen.getByRole('combobox') as HTMLSelectElement;
    expect(updatedSelect.value).toBe('option2');
  });

  it('displays name attribute correctly', () => {
    render(<Dropdown {...defaultProps} name="my-select" />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.getAttribute('name')).toBe('my-select');
  });
});
